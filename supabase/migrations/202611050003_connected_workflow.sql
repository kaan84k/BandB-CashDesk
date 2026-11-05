begin;

-- This public probe discloses only the application's schema version.
create function public.cashdesk_health() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('app','bb-cashdesk','schemaVersion',3)
$$;
revoke all on function public.cashdesk_health() from public;
grant execute on function public.cashdesk_health() to anon,authenticated,service_role;

create function public.cashdesk_workspace_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to open a workspace'; end if;
  if public.cashdesk_company() is null then return jsonb_build_object('status','setup_required'); end if;
  if not exists(select 1 from public.branches where public.cashdesk_branch_access(id)) then
    return jsonb_build_object('status','branch_access_required');
  end if;
  return jsonb_build_object('status','ready');
end $$;
revoke all on function public.cashdesk_workspace_state() from public,anon;
grant execute on function public.cashdesk_workspace_state() to authenticated;

-- A verified user can create a new private company, never join or claim an
-- existing one. Existing teammates still need an administrator invitation.
create function public.cashdesk_create_workspace(profile_name text,company_name text,branch_name text,branch_location text default '') returns jsonb
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
  if profile_name is null or length(btrim(profile_name)) not between 1 and 160
    or company_name is null or length(btrim(company_name)) not between 1 and 160
    or branch_name is null or length(btrim(branch_name)) not between 1 and 160
    or branch_location is null or length(branch_location)>500 then raise exception 'Enter a valid name, business name, and first branch'; end if;
  company:=gen_random_uuid(); branch:=gen_random_uuid();
  insert into public.companies(id,name) values(company,btrim(company_name));
  insert into public.members(id,company_id,name,email,role) values(actor,company,btrim(profile_name),owner_email,'owner');
  insert into public.branches(id,company_id,name,location) values(branch,company,btrim(branch_name),btrim(branch_location));
  insert into public.accounts(company_id,branch_id,name,account_type,bank,opening_balance) values(company,branch,'Cash drawer','cash','',0),(company,branch,'Bank account','bank','Bank',0),(company,branch,'Personal safe','safe','',0);
  insert into public.audit_logs(company_id,branch_id,actor_id,actor_name,action,entity_id)
    values(company,branch,actor,btrim(profile_name),'workspaceCreated',company);
  return jsonb_build_object('companyId',company,'branchId',branch,'created',true);
end $$;
revoke all on function public.cashdesk_create_workspace(text,text,text,text) from public,anon;
grant execute on function public.cashdesk_create_workspace(text,text,text,text) to authenticated;

-- Persist the result of a command in the same transaction as its financial
-- effects. A retry after a lost HTTP response returns without writing again.
create table public.operation_requests (
  company_id uuid not null references public.companies(id), request_id uuid not null,
  actor_id uuid not null references public.members(id), command jsonb not null,
  completed boolean not null default false, created_at timestamptz not null default now(),
  primary key(company_id,request_id)
);
alter table public.operation_requests enable row level security;
revoke all on public.operation_requests from anon,authenticated;
grant all on public.operation_requests to service_role;

alter function public.cashdesk_mutate(jsonb) rename to cashdesk_apply_command;
revoke all on function public.cashdesk_apply_command(jsonb) from public,anon,authenticated,service_role;

create function public.cashdesk_mutate(command jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
  company uuid:=public.cashdesk_company(); actor uuid:=auth.uid(); request uuid;
  receipt public.operation_requests%rowtype; content jsonb:=command-'requestId';
begin
  if actor is null or company is null then raise exception 'Workspace membership required'; end if;
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

-- Owner preferences only; provider credentials remain in Edge Function secrets.
create function public.cashdesk_update_reminder_settings(email_enabled boolean,email_recipients text[],email_sender text) returns void
language plpgsql security definer set search_path='' as $$
declare company uuid:=public.cashdesk_company(); actor uuid:=auth.uid(); recipient text; actor_name text;
begin
  if actor is null or company is null or public.cashdesk_role()<>'owner' then raise exception 'Only the owner can configure email reminders'; end if;
  if email_enabled is null or email_recipients is null or cardinality(email_recipients)>10 or email_sender is null or length(email_sender)>254 or email_sender ~ E'[\\r\\n]' then raise exception 'Enter valid reminder settings'; end if;
  foreach recipient in array email_recipients loop
    if recipient is null or length(recipient)>254 or recipient !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then raise exception 'Enter valid email recipients'; end if;
  end loop;
  if email_enabled and (cardinality(email_recipients)=0 or email_sender !~ '[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+') then raise exception 'Choose at least one recipient and a verified sender email'; end if;
  insert into public.reminder_settings(company_id,enabled,recipients,sender)
    values(company,email_enabled,email_recipients,btrim(email_sender))
    on conflict(company_id) do update set enabled=excluded.enabled,recipients=excluded.recipients,sender=excluded.sender;
  select name into actor_name from public.members where id=actor;
  insert into public.audit_logs(company_id,actor_id,actor_name,action,entity_id)
    values(company,actor,actor_name,'reminderSettingsUpdated',company);
end $$;
revoke all on function public.cashdesk_update_reminder_settings(boolean,text[],text) from public,anon;
grant execute on function public.cashdesk_update_reminder_settings(boolean,text[],text) to authenticated;

notify pgrst,'reload schema';
commit;
