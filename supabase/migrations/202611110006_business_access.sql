begin;

-- Preserve historical actor references while revoking current business access.
alter table public.members add column removed_at timestamptz;
create policy active_members_only on public.members as restrictive for select to authenticated using(removed_at is null);
create or replace function public.cashdesk_company() returns uuid language sql stable security definer set search_path='' as $$
  select company_id from public.members where id=auth.uid() and removed_at is null
$$;
create or replace function public.cashdesk_role() returns text language sql stable security definer set search_path='' as $$
  select role from public.members where id=auth.uid() and removed_at is null
$$;
create or replace function public.cashdesk_branch_access(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.branches b join public.members m on m.company_id=b.company_id
    where b.id=target and m.id=auth.uid() and m.removed_at is null and (m.role='owner' or exists(select 1 from public.user_branch_access a where a.user_id=m.id and a.branch_id=b.id)))
$$;

create function public.cashdesk_remove_member(target_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare company uuid:=public.cashdesk_company(); target public.members%rowtype; actor_name text;
begin
  if company is null or public.cashdesk_role()<>'owner' then raise exception 'Only the owner can remove users' using errcode='42501'; end if;
  perform 1 from public.companies where id=company for update;
  if public.cashdesk_role() is distinct from 'owner' then raise exception 'Owner access required' using errcode='42501'; end if;
  if target_user=auth.uid() then raise exception 'You cannot remove your own access'; end if;
  select * into target from public.members where id=target_user and company_id=company for update;
  if not found then raise exception 'Team member not found' using errcode='42501'; end if;
  if target.removed_at is not null then return; end if;
  if target.role='owner' and (select count(*) from public.members where company_id=company and role='owner' and removed_at is null)<=1 then raise exception 'Keep at least one owner'; end if;
  update public.members set removed_at=now() where id=target_user;
  delete from public.user_branch_access where user_id=target_user and company_id=company;
  update public.staff_invitations set status='revoked' where company_id=company and status='pending' and (invited_by=target_user or email in (lower(target.email),(select lower(email) from auth.users where id=target_user)));
  update public.reminder_settings set recipients=array(
    select recipient from unnest(recipients) as recipient
      where lower(btrim(recipient))<>lower(target.email)
        and lower(btrim(recipient)) is distinct from (select lower(email) from auth.users where id=target_user)
  ) where company_id=company;
  update public.reminder_settings set enabled=false where company_id=company and cardinality(recipients)=0;
  select name into actor_name from public.members where id=auth.uid();
  insert into public.audit_logs(company_id,actor_id,actor_name,action,entity_id,details)
    values(company,auth.uid(),actor_name,'removeMember',target_user,jsonb_build_object('name',target.name,'email',target.email,'previousRole',target.role));
end $$;
revoke all on function public.cashdesk_remove_member(uuid) from public,anon,authenticated,service_role;

create or replace function public.cashdesk_people() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare company uuid:=public.cashdesk_company();
begin
  if company is null or public.cashdesk_role()<>'owner' then raise exception 'Owner access required' using errcode='42501'; end if;
  return jsonb_build_object('companyName',(select name from public.companies where id=company),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'role',role) order by name) from public.members where company_id=company and removed_at is null),'[]'::jsonb),
    'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'status',status,'emailStatus',email_status,'expiresAt',expires_at) order by created_at desc) from public.staff_invitations where company_id=company),'[]'::jsonb));
end $$;

create or replace function public.cashdesk_workspace_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare invitations jsonb; membership public.members%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to open a workspace'; end if;
  select * into membership from public.members where id=auth.uid();
  if membership.id is null or membership.removed_at is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'companyName',c.name,'invitedBy',m.name)),'[]'::jsonb) into invitations
      from public.staff_invitations i join public.companies c on c.id=i.company_id join public.members m on m.id=i.invited_by
      where i.status='pending' and i.expires_at>now() and m.removed_at is null
        and (membership.id is null or i.company_id=membership.company_id)
        and i.email=(select lower(email) from auth.users where id=auth.uid() and email_confirmed_at is not null);
    if jsonb_array_length(invitations)>0 then return jsonb_build_object('status','invitation_pending','invitations',invitations); end if;
    if membership.removed_at is not null then return jsonb_build_object('status','access_removed'); end if;
    return jsonb_build_object('status','setup_required');
  end if;
  if not exists(select 1 from public.branches where public.cashdesk_branch_access(id)) then return jsonb_build_object('status','branch_access_required'); end if;
  return jsonb_build_object('status','ready','role',public.cashdesk_role());
end $$;

create or replace function public.cashdesk_accept_invitation(invitation_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare person record; invitation public.staff_invitations%rowtype; membership public.members%rowtype; invited_company uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to accept your invitation'; end if;
  select email,email_confirmed_at into person from auth.users where id=auth.uid() for update;
  if person.email_confirmed_at is null then raise exception 'Verify your email before joining the business'; end if;
  select company_id into invited_company from public.staff_invitations where id=invitation_id and email=lower(person.email);
  if not found then raise exception 'Invitation not found' using errcode='42501'; end if;
  -- Match the company-first lock order used by invitations, removals and role changes.
  perform 1 from public.companies where id=invited_company for update;
  select * into invitation from public.staff_invitations where id=invitation_id for update;
  if invitation.status='accepted' and invitation.accepted_by=auth.uid() then return; end if;
  if invitation.status<>'pending' or invitation.expires_at<=now() or not exists(select 1 from public.members where id=invitation.invited_by and company_id=invitation.company_id and removed_at is null) then raise exception 'This invitation is no longer active'; end if;
  select * into membership from public.members where id=auth.uid() for update;
  if membership.id is not null then
    if membership.removed_at is null or membership.company_id<>invitation.company_id then raise exception 'This account already belongs to a business'; end if;
    update public.members set name=invitation.name,email=person.email,role='staff',removed_at=null where id=auth.uid();
    delete from public.user_branch_access where user_id=auth.uid();
  else
    insert into public.members(id,company_id,name,email,role) values(auth.uid(),invitation.company_id,invitation.name,person.email,'staff');
  end if;
  insert into public.user_branch_access(company_id,user_id,branch_id) values(invitation.company_id,auth.uid(),invitation.branch_id);
  update public.staff_invitations set status='accepted',accepted_by=auth.uid() where id=invitation.id;
  insert into public.audit_logs(company_id,branch_id,actor_id,actor_name,action,entity_id) values(invitation.company_id,invitation.branch_id,auth.uid(),invitation.name,'staffJoined',invitation.id);
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
  if command->>'type'='setMemberRole' then
    if public.cashdesk_role()<>'owner' then raise exception 'Only the owner can manage team roles' using errcode='42501'; end if;
    perform 1 from public.companies where id=company for update;
    if public.cashdesk_role() is distinct from 'owner' then raise exception 'Owner access required' using errcode='42501'; end if;
    if not exists(select 1 from public.members where id=(command->'payload'->>'id')::uuid and company_id=company and removed_at is null) then raise exception 'Team member not found'; end if;
    if command->'payload'->>'role' is null or command->'payload'->>'role' not in ('owner','manager','staff') then raise exception 'Invalid role'; end if;
    if command->'payload'->>'role'<>'owner' and exists(select 1 from public.members where id=(command->'payload'->>'id')::uuid and role='owner')
      and (select count(*) from public.members where company_id=company and role='owner' and removed_at is null)<=1 then raise exception 'Keep at least one owner'; end if;
  end if;
  request:=nullif(command->>'requestId','')::uuid;
  -- Stable entity IDs make older add-record clients safe to retry as well.
  if request is null and command->>'type' like 'add%' then request:=(command->'payload'->>'id')::uuid; end if;
  if request is null then if command->>'type'='removeMember' then perform public.cashdesk_remove_member((command->'payload'->>'id')::uuid); else perform public.cashdesk_apply_command(command); end if; return; end if;
  insert into public.operation_requests(company_id,request_id,actor_id,command)
    values(company,request,actor,content) on conflict do nothing;
  select * into receipt from public.operation_requests where company_id=company and request_id=request for update;
  if receipt.actor_id<>actor or receipt.command is distinct from content then
    raise exception 'This request was already used with different details. Refresh your workspace before making another change.';
  end if;
  if receipt.completed then return; end if;
  if command->>'type'='removeMember' then perform public.cashdesk_remove_member((command->'payload'->>'id')::uuid); else perform public.cashdesk_apply_command(command); end if;
  update public.operation_requests set completed=true where company_id=company and request_id=request;
end $$;

create or replace function public.cashdesk_prepare_invitation(staff_email text,staff_name text,cafe_branch uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare company uuid:=public.cashdesk_company(); invitation public.staff_invitations%rowtype; target_email text:=lower(btrim(staff_email));
begin
  if company is null or public.cashdesk_role()<>'owner' then raise exception 'Only the owner can invite staff' using errcode='42501'; end if;
  if target_email is null or length(target_email)>254 or target_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or staff_name is null or length(btrim(staff_name)) not between 1 and 160 then raise exception 'Enter a valid name and email'; end if;
  if not exists(select 1 from public.branches where id=cafe_branch and company_id=company) then raise exception 'Choose a branch in your business'; end if;
  if exists(select 1 from public.members where company_id=company and lower(members.email)=target_email and removed_at is null) then raise exception 'This person already belongs to your business'; end if;
  perform 1 from public.companies where id=company for update;
  if public.cashdesk_role() is distinct from 'owner' then raise exception 'Owner access required' using errcode='42501'; end if;
  update public.staff_invitations set status='revoked' where company_id=company and staff_invitations.email=target_email and status='pending' and expires_at<now();
  select * into invitation from public.staff_invitations where company_id=company and staff_invitations.email=target_email and status='pending' for update;
  if not found then
    insert into public.staff_invitations(company_id,branch_id,invited_by,email,name) values(company,cafe_branch,auth.uid(),target_email,btrim(staff_name)) returning * into invitation;
    insert into public.audit_logs(company_id,actor_id,actor_name,action,entity_id)
      select company,auth.uid(),name,'staffInvited',invitation.id from public.members where id=auth.uid();
  end if;
  return jsonb_build_object('id',invitation.id,'email',invitation.email,'name',invitation.name,'emailStatus',invitation.email_status);
end $$;

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
  if exists(select 1 from public.members where id=actor and removed_at is not null) then raise exception 'Your business access was removed. Ask its owner for a new invitation.'; end if;
  select company_id,role into company,existing_role from public.members where id=actor;
  if found then
    if existing_role<>'owner' then raise exception 'You already belong to a workspace. Contact its owner for access.'; end if;
    return jsonb_build_object('companyId',company,'created',false);
  end if;
  if exists(select 1 from public.staff_invitations where email=lower(owner_email) and status='pending' and expires_at>now()) then raise exception 'Accept or decline your pending business invitation first'; end if;
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

create or replace function public.cashdesk_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
  select public.cashdesk_snapshot_base()||jsonb_build_object(
    'companyName',(select name from public.companies where id=public.cashdesk_company()),
    'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'branchId',branch_id,'accountId',account_id,'type',transaction_type,'amount',(amount*100)::bigint,'category',category,'description',description,'date',transaction_date,'method',method,'supplierId',supplier_id,'chequeId',cheque_id,'transferId',transfer_id,'cashDayId',cash_day_id,'countKind',count_kind) order by transaction_date desc,id) from public.transactions),'[]'::jsonb),
    'transfers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'branchId',branch_id,'fromAccountId',from_account_id,'toAccountId',to_account_id,'amount',(amount*100)::bigint,'date',transfer_date,'description',description) order by transfer_date desc) from public.bank_transfers),'[]'::jsonb),
    'cashDays',coalesce((select jsonb_agg(jsonb_build_object('id',id,'branchId',branch_id,'accountId',account_id,'date',day_date,'opening',(opening_count*100)::bigint,'openingLedger',(opening_ledger*100)::bigint,'closing',(closing_count*100)::bigint,'expectedClosing',(expected_closing*100)::bigint,'notes',notes) order by day_date desc) from public.cash_days),'[]'::jsonb)
  )
$$;

create or replace function public.cashdesk_health() returns jsonb language sql stable security invoker set search_path='' as $$select jsonb_build_object('app','bb-cashdesk','schemaVersion',6)$$;
notify pgrst,'reload schema';
commit;
