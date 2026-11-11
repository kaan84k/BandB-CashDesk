begin;

-- RLS applies to direct table access as well as application RPCs.
create policy entry_only_no_financial_reads on public.accounts as restrictive for select to authenticated using(public.cashdesk_role()<>'staff');
create policy entry_only_no_financial_reads on public.transactions as restrictive for select to authenticated using(public.cashdesk_role()<>'staff');
create policy entry_only_no_financial_reads on public.cheques as restrictive for select to authenticated using(public.cashdesk_role()<>'staff');
create policy entry_only_no_financial_reads on public.suppliers as restrictive for select to authenticated using(public.cashdesk_role()<>'staff');
create policy entry_only_no_financial_reads on public.supplier_invoices as restrictive for select to authenticated using(public.cashdesk_role()<>'staff');
create policy entry_only_no_financial_reads on public.cash_days as restrictive for select to authenticated using(public.cashdesk_role()<>'staff');
create policy entry_only_no_financial_reads on public.bank_transfers as restrictive for select to authenticated using(public.cashdesk_role()<>'staff');
create policy entry_only_no_financial_reads on public.cheque_events as restrictive for select to authenticated using(public.cashdesk_role()<>'staff');
create policy entry_only_no_financial_reads on public.audit_logs as restrictive for select to authenticated using(public.cashdesk_role()<>'staff');
create policy entry_only_own_profile on public.members as restrictive for select to authenticated using(public.cashdesk_role()<>'staff' or id=auth.uid());

create or replace function public.cashdesk_snapshot_base() returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if public.cashdesk_role()='staff' then raise exception 'Financial views are restricted to the owner or manager' using errcode='42501'; end if;
  if public.cashdesk_company() is null then raise exception 'No workspace membership. Ask your owner to provision access.'; end if;
  if not exists(select 1 from public.branches) then raise exception 'No branch access. Ask your workspace owner to grant access.'; end if;
  return jsonb_build_object('version',1,
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'location',location) order by name) from public.branches),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'branchId',branch_id,'name',name,'type',account_type,'bank',bank,'openingBalance',(opening_balance*100)::bigint) order by name) from public.accounts),'[]'::jsonb),
    'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'branchId',branch_id,'accountId',account_id,'type',transaction_type,'amount',(amount*100)::bigint,'category',category,'description',description,'date',transaction_date,'method',method,'supplierId',supplier_id,'chequeId',cheque_id) order by transaction_date desc,id) from public.transactions),'[]'::jsonb),
    'cheques',coalesce((select jsonb_agg(jsonb_build_object('id',id,'branchId',branch_id,'accountId',account_id,'number',cheque_number,'type',cheque_type,'payee',payee,'supplierId',supplier_id,'bank',bank,'amount',(amount*100)::bigint,'issueDate',issue_date,'dueDate',due_date,'status',status,'notes',notes) order by due_date,id) from public.cheques),'[]'::jsonb),
    'suppliers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'branchId',branch_id,'name',supplier_name,'contact',contact,'phone',phone,'email',email,'terms',payment_terms) order by supplier_name) from public.suppliers),'[]'::jsonb),
    'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',id,'branchId',branch_id,'supplierId',supplier_id,'reference',reference,'amount',(amount*100)::bigint,'date',invoice_date,'dueDate',due_date) order by invoice_date desc) from public.supplier_invoices),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'role',role) order by name) from public.members),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(jsonb_build_object('id',id,'action',action,'entityId',entity_id,'actor',actor_name,'at',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by created_at desc) from public.audit_logs),'[]'::jsonb)
  );
end $$;

create or replace function public.cashdesk_mutate(command jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
  company uuid:=public.cashdesk_company(); actor uuid:=auth.uid(); request uuid;
  receipt public.operation_requests%rowtype; content jsonb:=command-'requestId';
begin
  if actor is null or company is null then raise exception 'Workspace membership required'; end if;
  if public.cashdesk_role()='staff' then
    if command->>'type' is null or command->>'type' not in ('addTransaction','addCheque','transfer','openDay','closeDay') then
      raise exception 'Data-entry staff cannot perform this operation' using errcode='42501';
    end if;
    if command->>'type' in ('openDay','closeDay') and length(btrim(coalesce(command->'payload'->>'notes','')))=0 then
      raise exception 'Add a note to your cash count';
    end if;
  end if;
  request:=nullif(command->>'requestId','')::uuid;
  -- Stable entity IDs make older add-record clients safe to retry as well.
  if request is null and command->>'type' like 'add%' then request:=(command->'payload'->>'id')::uuid; end if;
  if request is null then perform public.cashdesk_apply_command(command); return; end if;
  insert into public.operation_requests(company_id,request_id,actor_id,command)
    values(company,request,actor,content) on conflict do nothing;
  select * into receipt from public.operation_requests where company_id=company and request_id=request for update;
  if receipt.actor_id<>actor or receipt.command is distinct from content then
    raise exception 'This request was already used with different details. Refresh your workspace before making another change.';
  end if;
  if receipt.completed then return; end if;
  perform public.cashdesk_apply_command(command);
  update public.operation_requests set completed=true where company_id=company and request_id=request;
end $$;
revoke all on function public.cashdesk_mutate(jsonb) from public,anon;
grant execute on function public.cashdesk_mutate(jsonb) to authenticated;


create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
  branch_id uuid not null,invited_by uuid not null references public.members(id),
  email text not null check(email=lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  name text not null check(length(name) between 1 and 160),
  status text not null default 'pending' check(status in ('pending','accepted','revoked','declined')),
  email_status text not null default 'pending' check(email_status in ('pending','sent','failed','existing_account')),
  created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '7 days',
  accepted_by uuid references auth.users(id),
  foreign key(company_id,branch_id) references public.branches(company_id,id)
);
create unique index one_pending_staff_invitation on public.staff_invitations(company_id,email) where status='pending';
alter table public.staff_invitations enable row level security;
revoke all on public.staff_invitations from anon,authenticated;
grant all on public.staff_invitations to service_role;

create function public.cashdesk_prepare_invitation(staff_email text,staff_name text,cafe_branch uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare company uuid:=public.cashdesk_company(); invitation public.staff_invitations%rowtype; target_email text:=lower(btrim(staff_email));
begin
  if company is null or public.cashdesk_role()<>'owner' then raise exception 'Only the owner can invite staff' using errcode='42501'; end if;
  if target_email is null or length(target_email)>254 or target_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or staff_name is null or length(btrim(staff_name)) not between 1 and 160 then raise exception 'Enter a valid name and email'; end if;
  if not exists(select 1 from public.branches where id=cafe_branch and company_id=company) then raise exception 'Choose a branch in your cafe'; end if;
  if exists(select 1 from public.members where company_id=company and lower(members.email)=target_email) then raise exception 'This person already belongs to your cafe'; end if;
  perform 1 from public.companies where id=company for update;
  update public.staff_invitations set status='revoked' where company_id=company and staff_invitations.email=target_email and status='pending' and expires_at<now();
  select * into invitation from public.staff_invitations where company_id=company and staff_invitations.email=target_email and status='pending' for update;
  if not found then
    insert into public.staff_invitations(company_id,branch_id,invited_by,email,name) values(company,cafe_branch,auth.uid(),target_email,btrim(staff_name)) returning * into invitation;
    insert into public.audit_logs(company_id,actor_id,actor_name,action,entity_id)
      select company,auth.uid(),name,'staffInvited',invitation.id from public.members where id=auth.uid();
  end if;
  return jsonb_build_object('id',invitation.id,'email',invitation.email,'name',invitation.name,'emailStatus',invitation.email_status);
end $$;

create function public.cashdesk_finish_invitation(invitation_id uuid,actor uuid,delivery text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if delivery not in ('sent','failed','existing_account') then raise exception 'Invalid delivery status'; end if;
  update public.staff_invitations set email_status=delivery where id=invitation_id and invited_by=actor and status='pending';
end $$;
revoke all on function public.cashdesk_finish_invitation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.cashdesk_finish_invitation(uuid,uuid,text) to service_role;

create function public.cashdesk_accept_invitation(invitation_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare person record; invitation public.staff_invitations%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to accept your invitation'; end if;
  select email,email_confirmed_at into person from auth.users where id=auth.uid() for update;
  if person.email_confirmed_at is null then raise exception 'Verify your email before joining the cafe'; end if;
  select * into invitation from public.staff_invitations where id=invitation_id for update;
  if not found or invitation.email<>lower(person.email) then raise exception 'Invitation not found' using errcode='42501'; end if;
  if invitation.status='accepted' and invitation.accepted_by=auth.uid() then return; end if;
  if invitation.status<>'pending' or invitation.expires_at<=now() then raise exception 'This invitation is no longer active'; end if;
  if exists(select 1 from public.members where id=auth.uid()) then raise exception 'This account already belongs to a cafe'; end if;
  insert into public.members(id,company_id,name,email,role) values(auth.uid(),invitation.company_id,invitation.name,person.email,'staff');
  insert into public.user_branch_access(company_id,user_id,branch_id) values(invitation.company_id,auth.uid(),invitation.branch_id);
  update public.staff_invitations set status='accepted',accepted_by=auth.uid() where id=invitation.id;
  insert into public.audit_logs(company_id,branch_id,actor_id,actor_name,action,entity_id) values(invitation.company_id,invitation.branch_id,auth.uid(),invitation.name,'staffJoined',invitation.id);
end $$;

create function public.cashdesk_decline_invitation(invitation_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.staff_invitations set status='declined' where id=invitation_id and status='pending' and email=(select lower(email) from auth.users where id=auth.uid() and email_confirmed_at is not null);
  if not found then raise exception 'Invitation not found' using errcode='42501'; end if;
end $$;

create function public.cashdesk_revoke_invitation(invitation_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if public.cashdesk_role()<>'owner' or public.cashdesk_company() is null then raise exception 'Owner access required' using errcode='42501'; end if;
  update public.staff_invitations set status='revoked' where id=invitation_id and company_id=public.cashdesk_company() and status='pending';
end $$;

create function public.cashdesk_people() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare company uuid:=public.cashdesk_company();
begin
  if company is null or public.cashdesk_role()<>'owner' then raise exception 'Owner access required' using errcode='42501'; end if;
  return jsonb_build_object('companyName',(select name from public.companies where id=company),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'role',role) order by name) from public.members where company_id=company),'[]'::jsonb),
    'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'status',status,'emailStatus',email_status,'expiresAt',expires_at) order by created_at desc) from public.staff_invitations where company_id=company),'[]'::jsonb));
end $$;

create or replace function public.cashdesk_workspace_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare invitations jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to open a workspace'; end if;
  if public.cashdesk_company() is null then
    select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'companyName',c.name,'invitedBy',m.name)),'[]'::jsonb) into invitations
      from public.staff_invitations i join public.companies c on c.id=i.company_id join public.members m on m.id=i.invited_by
      where i.status='pending' and i.expires_at>now() and i.email=(select lower(email) from auth.users where id=auth.uid() and email_confirmed_at is not null);
    if jsonb_array_length(invitations)>0 then return jsonb_build_object('status','invitation_pending','invitations',invitations); end if;
    return jsonb_build_object('status','setup_required');
  end if;
  if not exists(select 1 from public.branches where public.cashdesk_branch_access(id)) then return jsonb_build_object('status','branch_access_required'); end if;
  return jsonb_build_object('status','ready','role',public.cashdesk_role());
end $$;

create function public.cashdesk_entry_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare company uuid:=public.cashdesk_company();
begin
  if company is null or public.cashdesk_role()<>'staff' then raise exception 'Data-entry membership required' using errcode='42501'; end if;
  return jsonb_build_object('role','staff',
    'user',(select jsonb_build_object('id',id,'name',name,'email',email,'role',role) from public.members where id=auth.uid()),
    'cafe',(select jsonb_build_object('id',id,'name',name) from public.companies where id=company),
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.branches where company_id=company and public.cashdesk_branch_access(id)),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'branchId',branch_id,'name',name,'type',account_type,'bank',bank) order by name) from public.accounts where company_id=company and public.cashdesk_branch_access(branch_id)),'[]'::jsonb),
    'days',coalesce((select jsonb_agg(jsonb_build_object('id',id,'accountId',account_id,'date',day_date,'status',case when closing_count is null then 'open' else 'closed' end) order by day_date desc) from public.cash_days where company_id=company and public.cashdesk_branch_access(branch_id) and (closing_count is null or day_date=(now() at time zone 'Asia/Colombo')::date)),'[]'::jsonb));
end $$;

revoke all on function public.cashdesk_prepare_invitation(text,text,uuid),public.cashdesk_accept_invitation(uuid),public.cashdesk_decline_invitation(uuid),public.cashdesk_revoke_invitation(uuid),public.cashdesk_people(),public.cashdesk_entry_context() from public,anon;
grant execute on function public.cashdesk_prepare_invitation(text,text,uuid),public.cashdesk_accept_invitation(uuid),public.cashdesk_decline_invitation(uuid),public.cashdesk_revoke_invitation(uuid),public.cashdesk_people(),public.cashdesk_entry_context() to authenticated;
create or replace function public.cashdesk_health() returns jsonb language sql stable security invoker set search_path='' as $$select jsonb_build_object('app','bb-cashdesk','schemaVersion',5)$$;

create or replace function public.cashdesk_create_workspace(profile_name text,company_name text,branch_name text,branch_location text default '',bank_name text default 'Bank account',bank_opening numeric default 0,safe_opening numeric default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); owner_email text; confirmed timestamptz;
  company uuid; branch uuid; existing_role text;
begin
  if actor is null then raise exception 'Sign in before creating a workspace'; end if;
  -- Lock the Auth row to serialize simultaneous first-run requests from this user.
  select email,email_confirmed_at into owner_email,confirmed from auth.users where id=actor for update;
  if not found or owner_email is null or confirmed is null then raise exception 'Verify your email before creating a workspace'; end if;
  select company_id,role into company,existing_role from public.members where id=actor;
  if found then
    if existing_role<>'owner' then raise exception 'You already belong to a workspace. Contact its owner for access.'; end if;
    return jsonb_build_object('companyId',company,'created',false);
  end if;
  if exists(select 1 from public.staff_invitations where email=lower(owner_email) and status='pending' and expires_at>now()) then raise exception 'Accept or decline your pending cafe invitation first'; end if;
  if profile_name is null or length(btrim(profile_name)) not between 1 and 160
    or company_name is null or length(btrim(company_name)) not between 1 and 160
    or branch_name is null or length(btrim(branch_name)) not between 1 and 160
    or branch_location is null or length(branch_location)>500 then raise exception 'Enter a valid name, business name, and first branch'; end if;
  if bank_name is null or length(btrim(bank_name)) not between 1 and 160 or bank_opening is null or safe_opening is null or bank_opening<0 or safe_opening<0 then raise exception 'Enter valid starting bank and safe balances'; end if;
  company:=gen_random_uuid(); branch:=gen_random_uuid();
  insert into public.companies(id,name) values(company,btrim(company_name));
  insert into public.members(id,company_id,name,email,role) values(actor,company,btrim(profile_name),owner_email,'owner');
  insert into public.branches(id,company_id,name,location) values(branch,company,btrim(branch_name),btrim(branch_location));
  insert into public.accounts(company_id,branch_id,name,account_type,bank,opening_balance) values(company,branch,'Cash drawer','cash','',0),(company,branch,btrim(bank_name),'bank',btrim(bank_name),public.cashdesk_amount(jsonb_build_object('amount',bank_opening),'amount',true)),(company,branch,'Personal safe','safe','',public.cashdesk_amount(jsonb_build_object('amount',safe_opening),'amount',true));
  insert into public.audit_logs(company_id,branch_id,actor_id,actor_name,action,entity_id)
    values(company,branch,actor,btrim(profile_name),'workspaceCreated',company);
  return jsonb_build_object('companyId',company,'branchId',branch,'created',true);
end $$;

revoke all on function public.cashdesk_create_workspace(text,text,text,text,text,numeric,numeric) from public,anon;
grant execute on function public.cashdesk_create_workspace(text,text,text,text,text,numeric,numeric) to authenticated;


notify pgrst,'reload schema';
commit;
