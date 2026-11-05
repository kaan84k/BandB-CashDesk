begin;

alter table public.accounts drop constraint accounts_account_type_check;
alter table public.accounts add constraint accounts_account_type_check check(account_type in ('bank','cash','safe','petty'));
create table public.bank_transfers (
  id uuid primary key,company_id uuid not null,branch_id uuid not null,
  from_account_id uuid not null,to_account_id uuid not null,amount numeric(15,2) not null check(amount>0),
  transfer_date date not null,description text not null check(length(description) between 1 and 160),
  check(from_account_id<>to_account_id),unique(company_id,branch_id,id),
  foreign key(company_id,branch_id,from_account_id) references public.accounts(company_id,branch_id,id),
  foreign key(company_id,branch_id,to_account_id) references public.accounts(company_id,branch_id,id)
);
create table public.cash_days (
  id uuid primary key,company_id uuid not null,branch_id uuid not null,account_id uuid not null,day_date date not null,
  opening_count numeric(15,2) not null check(opening_count>=0),opening_ledger numeric(15,2) not null,
  closing_count numeric(15,2) check(closing_count>=0),expected_closing numeric(15,2),notes text not null default '' check(length(notes)<=2000),
  unique(account_id,day_date),unique(company_id,branch_id,id),
  foreign key(company_id,branch_id,account_id) references public.accounts(company_id,branch_id,id),
  check((closing_count is null)=(expected_closing is null))
);
create unique index one_open_cash_day on public.cash_days(account_id) where closing_count is null;
alter table public.transactions add column transfer_id uuid,add column cash_day_id uuid,add column count_kind text check(count_kind in ('opening','closing'));
alter table public.transactions add foreign key(company_id,branch_id,transfer_id) references public.bank_transfers(company_id,branch_id,id);
alter table public.transactions add foreign key(company_id,branch_id,cash_day_id) references public.cash_days(company_id,branch_id,id);
alter table public.transactions add check((cash_day_id is null)=(count_kind is null));
alter table public.transactions add check(transfer_id is null or (method='transfer' and cash_day_id is null and cheque_id is null));
create unique index one_transfer_leg on public.transactions(transfer_id,transaction_type) where transfer_id is not null;
create unique index one_count_adjustment on public.transactions(cash_day_id,count_kind) where cash_day_id is not null;
alter table public.bank_transfers enable row level security;
alter table public.cash_days enable row level security;
create policy transfer_read on public.bank_transfers for select to authenticated using(public.cashdesk_branch_access(branch_id));
create policy cash_day_read on public.cash_days for select to authenticated using(public.cashdesk_branch_access(branch_id));
revoke all on public.bank_transfers,public.cash_days from anon,authenticated;
grant select on public.bank_transfers,public.cash_days to authenticated;
grant all on public.bank_transfers,public.cash_days to service_role;

create function public.cashdesk_balance_at(target uuid,day date,before_day boolean default false) returns numeric
language sql stable security invoker set search_path='' as $$
  select a.opening_balance+coalesce((select sum(case when transaction_type='income' then amount else -amount end) from public.transactions where account_id=target and case when before_day then transaction_date<day else transaction_date<=day end),0) from public.accounts a where a.id=target
$$;
create function public.cashdesk_require_cash_day(target uuid,day date) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.accounts where id=target and account_type='cash') and not exists(select 1 from public.cash_days where account_id=target and day_date=day and closing_count is null) then
    raise exception 'Open the cash day before recording cash. Closed days cannot be changed.';
  end if;
end $$;
revoke all on function public.cashdesk_balance_at(uuid,date,boolean),public.cashdesk_require_cash_day(uuid,date) from public,anon,authenticated;

alter function public.cashdesk_apply_command(jsonb) rename to cashdesk_apply_legacy_command;
create function public.cashdesk_apply_command(command jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare p jsonb:=command->'payload'; op text:=command->>'type'; company uuid:=public.cashdesk_company(); branch uuid; actor uuid:=auth.uid(); actor_name text;
  entity uuid:=(p->>'id')::uuid; day date; amount numeric; expected numeric; counted numeric; difference numeric; kind text;
  from_account public.accounts%rowtype; to_account public.accounts%rowtype; drawer public.accounts%rowtype; cash_day public.cash_days%rowtype; note text:=coalesce(btrim(p->>'notes'),'');
begin
  if actor is null or company is null then raise exception 'Workspace membership required'; end if;
  if op not in ('transfer','openDay','closeDay') then
    if op='addTransaction' then
      if nullif(p->>'transferId','') is not null or nullif(p->>'cashDayId','') is not null then raise exception 'Use the transfer or daily cash form for these entries'; end if;
      if not public.cashdesk_branch_access((p->>'branchId')::uuid) then raise exception 'No access to this branch'; end if;
      perform 1 from public.accounts where id=(p->>'accountId')::uuid and company_id=company for update;
      perform public.cashdesk_require_cash_day((p->>'accountId')::uuid,(p->>'date')::date);
      if p->>'type'='expense' and exists(select 1 from public.accounts where id=(p->>'accountId')::uuid and account_type in ('cash','safe')) and public.cashdesk_balance_at((p->>'accountId')::uuid,(p->>'date')::date)<public.cashdesk_amount(p,'amount') then raise exception 'There is not enough money in that cash drawer or safe'; end if;
    end if;
    perform public.cashdesk_apply_legacy_command(command);return;
  end if;
  if entity is null then raise exception 'Record ID required'; end if;
  select name into actor_name from public.members where id=actor;
  if op='closeDay' then
    select * into cash_day from public.cash_days where id=entity and company_id=company;
    if not found or not public.cashdesk_branch_access(cash_day.branch_id) then raise exception 'Cash day not found'; end if;
    branch:=cash_day.branch_id;day:=cash_day.day_date;
    select * into drawer from public.accounts where id=cash_day.account_id for update;
    select * into cash_day from public.cash_days where id=entity for update;
    if cash_day.closing_count is not null then raise exception 'This cash day is already closed'; end if;
    counted:=public.cashdesk_amount(p,'closing',true);kind:='closing';
    expected:=public.cashdesk_balance_at(drawer.id,day);
  else
    branch:=(p->>'branchId')::uuid;day:=(p->>'date')::date;
    if not public.cashdesk_branch_access(branch) then raise exception 'No access to this branch'; end if;
    if day is null or day>(now() at time zone 'Asia/Colombo')::date then raise exception 'Enter a valid date, no later than today'; end if;
    if op='transfer' then
      perform 1 from public.accounts where id in ((p->>'fromAccountId')::uuid,(p->>'toAccountId')::uuid) and company_id=company order by id for update;
      select * into from_account from public.accounts where id=(p->>'fromAccountId')::uuid and company_id=company and branch_id=branch;
      select * into to_account from public.accounts where id=(p->>'toAccountId')::uuid and company_id=company and branch_id=branch;
      if from_account.id is null or to_account.id is null or from_account.id=to_account.id then raise exception 'Choose two different accounts in your cafe'; end if;
      perform public.cashdesk_require_cash_day(from_account.id,day);perform public.cashdesk_require_cash_day(to_account.id,day);
      amount:=public.cashdesk_amount(p,'amount');
      if from_account.account_type<>'bank' and public.cashdesk_balance_at(from_account.id,day)<amount then raise exception 'There is not enough money in that cash drawer or safe'; end if;
      insert into public.bank_transfers values(entity,company,branch,from_account.id,to_account.id,amount,day,btrim(p->>'description'));
      insert into public.transactions(company_id,branch_id,account_id,amount,transaction_type,category,description,transaction_date,method,transfer_id)
        values(company,branch,from_account.id,amount,'expense','Money transfer',btrim(p->>'description'),day,'transfer',entity),
              (company,branch,to_account.id,amount,'income','Money transfer',btrim(p->>'description'),day,'transfer',entity);
    else
      select * into drawer from public.accounts where id=(p->>'accountId')::uuid and company_id=company and branch_id=branch and account_type='cash' for update;
      if not found then raise exception 'Choose the cash drawer'; end if;
      if exists(select 1 from public.cash_days where account_id=drawer.id and (day_date>=day or closing_count is null)) then raise exception 'Close the previous day first. Each date can be opened once.'; end if;
      if exists(select 1 from public.transactions where account_id=drawer.id and transaction_date>day) then raise exception 'An earlier day cannot be opened after later cash movements'; end if;
      counted:=public.cashdesk_amount(p,'opening',true);kind:='opening';
      if drawer.opening_balance=0 and not exists(select 1 from public.cash_days where account_id=drawer.id) and not exists(select 1 from public.transactions where account_id=drawer.id) then update public.accounts set opening_balance=counted where id=drawer.id; end if;
      expected:=public.cashdesk_balance_at(drawer.id,day,true);
      insert into public.cash_days(id,company_id,branch_id,account_id,day_date,opening_count,opening_ledger,notes) values(entity,company,branch,drawer.id,day,counted,expected,note);
    end if;
  end if;
  if op in ('openDay','closeDay') then
    if counted<0 then raise exception 'Cash counts cannot be negative'; end if;
    if length(note)>1000 then raise exception 'Keep the note under 1000 characters'; end if;
    difference:=counted-expected;
    if difference<>0 and length(note)=0 then raise exception 'Add a note explaining the cash count difference'; end if;
    if difference<>0 then
      insert into public.transactions(company_id,branch_id,account_id,amount,transaction_type,category,description,transaction_date,method,cash_day_id,count_kind)
        values(company,branch,drawer.id,abs(difference),case when difference>0 then 'income' else 'expense' end,'Cash count adjustment',left(initcap(kind)||' cash count: '||note,160),day,'cash',entity,kind);
    end if;
    if op='closeDay' then update public.cash_days set closing_count=counted,expected_closing=expected,notes=left(concat_ws(E'\n',nullif(notes,''),nullif(note,'')),2000) where id=entity; end if;
  end if;
  insert into public.audit_logs(company_id,branch_id,actor_id,actor_name,action,entity_id) values(company,branch,actor,actor_name,op,entity);
end $$;
revoke all on function public.cashdesk_apply_command(jsonb),public.cashdesk_apply_legacy_command(jsonb) from public,anon,authenticated,service_role;

alter function public.cashdesk_snapshot() rename to cashdesk_snapshot_base;
create function public.cashdesk_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
  select public.cashdesk_snapshot_base()||jsonb_build_object(
    'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'branchId',branch_id,'accountId',account_id,'type',transaction_type,'amount',(amount*100)::bigint,'category',category,'description',description,'date',transaction_date,'method',method,'supplierId',supplier_id,'chequeId',cheque_id,'transferId',transfer_id,'cashDayId',cash_day_id,'countKind',count_kind) order by transaction_date desc,id) from public.transactions),'[]'::jsonb),
    'transfers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'branchId',branch_id,'fromAccountId',from_account_id,'toAccountId',to_account_id,'amount',(amount*100)::bigint,'date',transfer_date,'description',description) order by transfer_date desc) from public.bank_transfers),'[]'::jsonb),
    'cashDays',coalesce((select jsonb_agg(jsonb_build_object('id',id,'branchId',branch_id,'accountId',account_id,'date',day_date,'opening',(opening_count*100)::bigint,'openingLedger',(opening_ledger*100)::bigint,'closing',(closing_count*100)::bigint,'expectedClosing',(expected_closing*100)::bigint,'notes',notes) order by day_date desc) from public.cash_days),'[]'::jsonb)
  )
$$;
revoke all on function public.cashdesk_snapshot() from public,anon;
grant execute on function public.cashdesk_snapshot() to authenticated;
create or replace function public.cashdesk_health() returns jsonb language sql stable security invoker set search_path='' as $$select jsonb_build_object('app','bb-cashdesk','schemaVersion',4)$$;

create or replace function public.cashdesk_mutate(command jsonb) returns void
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


drop function public.cashdesk_create_workspace(text,text,text,text);
create function public.cashdesk_create_workspace(profile_name text,company_name text,branch_name text,branch_location text default '',bank_name text default 'Bank account',bank_opening numeric default 0,safe_opening numeric default 0) returns jsonb
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
