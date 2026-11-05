-- Monetary columns use NUMERIC(15,2). RPC payloads use integer minor units.
-- Runtime users can SELECT through RLS and mutate only through the audited RPC.
begin;

create table public.companies (id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 160));
create table public.members (
  id uuid primary key references auth.users(id), company_id uuid not null references public.companies(id),
  name text not null check(length(name) between 1 and 160), email text not null,
  role text not null check(role in ('owner','manager','staff')),
  unique(company_id,id)
);
create table public.branches (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  name text not null check(length(name) between 1 and 160), location text not null default '', unique(company_id,id)
);
create table public.user_branch_access (
  company_id uuid not null, user_id uuid not null, branch_id uuid not null,
  primary key(user_id,branch_id),
  foreign key(company_id,user_id) references public.members(company_id,id),
  foreign key(company_id,branch_id) references public.branches(company_id,id)
);
create table public.accounts (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, branch_id uuid not null,
  name text not null check(length(name) between 1 and 160), account_type text not null check(account_type in ('bank','cash','petty')),
  bank text not null default '' check(length(bank)<=160), opening_balance numeric(15,2) not null default 0,
  unique(company_id,branch_id,id),
  foreign key(company_id,branch_id) references public.branches(company_id,id),
  check(account_type<>'bank' or length(bank)>0)
);
create table public.suppliers (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, branch_id uuid not null,
  supplier_name text not null check(length(supplier_name) between 1 and 160), contact text not null default '' check(length(contact)<=160),
  phone text not null default '' check(length(phone)<=40), email text not null default '' check(email='' or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  payment_terms integer not null default 30 check(payment_terms between 0 and 365), unique(company_id,branch_id,id),
  foreign key(company_id,branch_id) references public.branches(company_id,id)
);
create table public.supplier_invoices (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, branch_id uuid not null, supplier_id uuid not null,
  reference text not null check(length(reference) between 1 and 160), amount numeric(15,2) not null check(amount>0),
  invoice_date date not null, due_date date not null check(due_date>=invoice_date),
  foreign key(company_id,branch_id,supplier_id) references public.suppliers(company_id,branch_id,id),
  unique(supplier_id,reference)
);
create table public.cheques (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, branch_id uuid not null, account_id uuid not null,
  cheque_number text not null check(cheque_number ~ '^[A-Za-z0-9-]{1,30}$'), cheque_type text not null check(cheque_type in ('issued','received')),
  payee text not null check(length(payee) between 1 and 160), supplier_id uuid, bank text not null check(length(bank) between 1 and 160),
  amount numeric(15,2) not null check(amount>0), issue_date date not null, due_date date not null check(due_date>=issue_date),
  status text not null check(status in ('issued','received','presented','cleared','returned','cancelled')), notes text not null default '' check(length(notes)<=1000),
  check(status not in ('issued','received') or status=cheque_type), check(cheque_type='issued' or supplier_id is null),
  unique(company_id,branch_id,id),
  foreign key(company_id,branch_id,account_id) references public.accounts(company_id,branch_id,id),
  foreign key(company_id,branch_id,supplier_id) references public.suppliers(company_id,branch_id,id)
);
create unique index cheque_identity on public.cheques(account_id,cheque_type,lower(cheque_number));
create index cheque_due_status on public.cheques(company_id,due_date,status);
create table public.transactions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, branch_id uuid not null, account_id uuid not null,
  amount numeric(15,2) not null check(amount>0), transaction_type text not null check(transaction_type in ('income','expense')),
  category text not null check(length(category) between 1 and 160), description text not null check(length(description) between 1 and 160),
  transaction_date date not null, method text not null check(method in ('cash','card','transfer','cheque')), supplier_id uuid,
  cheque_id uuid unique,
  check((method='cheque')=(cheque_id is not null)), check(supplier_id is null or transaction_type='expense'),
  foreign key(company_id,branch_id,account_id) references public.accounts(company_id,branch_id,id),
  foreign key(company_id,branch_id,supplier_id) references public.suppliers(company_id,branch_id,id),
  foreign key(company_id,branch_id,cheque_id) references public.cheques(company_id,branch_id,id)
);
create index transaction_account_date on public.transactions(account_id,transaction_date);
create index transaction_branch_date on public.transactions(company_id,branch_id,transaction_date);
create table public.cheque_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, branch_id uuid not null, cheque_id uuid not null,
  actor_id uuid not null references public.members(id), old_status text, new_status text not null, created_at timestamptz not null default now(),
  foreign key(company_id,branch_id,cheque_id) references public.cheques(company_id,branch_id,id)
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), branch_id uuid,
  actor_id uuid not null references public.members(id), actor_name text not null, action text not null,
  entity_id uuid not null, details jsonb not null default '{}', created_at timestamptz not null default now(),
  foreign key(company_id,branch_id) references public.branches(company_id,id)
);

create function public.cashdesk_company() returns uuid language sql stable security definer set search_path='' as $$
  select company_id from public.members where id=auth.uid()
$$;
create function public.cashdesk_role() returns text language sql stable security definer set search_path='' as $$
  select role from public.members where id=auth.uid()
$$;
create function public.cashdesk_branch_access(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.branches b join public.members m on m.company_id=b.company_id
    where b.id=target and m.id=auth.uid() and (m.role='owner' or exists(select 1 from public.user_branch_access a where a.user_id=m.id and a.branch_id=b.id)))
$$;

alter table public.companies enable row level security;
alter table public.members enable row level security;
alter table public.branches enable row level security;
alter table public.user_branch_access enable row level security;
alter table public.accounts enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_invoices enable row level security;
alter table public.cheques enable row level security;
alter table public.transactions enable row level security;
alter table public.cheque_events enable row level security;
alter table public.audit_logs enable row level security;
create policy company_read on public.companies for select to authenticated using(id=public.cashdesk_company());
create policy member_read on public.members for select to authenticated using(company_id=public.cashdesk_company());
create policy branch_read on public.branches for select to authenticated using(public.cashdesk_branch_access(id));
create policy branch_access_read on public.user_branch_access for select to authenticated using(company_id=public.cashdesk_company() and (user_id=auth.uid() or public.cashdesk_role()='owner'));
create policy account_read on public.accounts for select to authenticated using(public.cashdesk_branch_access(branch_id));
create policy supplier_read on public.suppliers for select to authenticated using(public.cashdesk_branch_access(branch_id));
create policy invoice_read on public.supplier_invoices for select to authenticated using(public.cashdesk_branch_access(branch_id));
create policy cheque_read on public.cheques for select to authenticated using(public.cashdesk_branch_access(branch_id));
create policy transaction_read on public.transactions for select to authenticated using(public.cashdesk_branch_access(branch_id));
create policy cheque_event_read on public.cheque_events for select to authenticated using(public.cashdesk_branch_access(branch_id));
create policy audit_read on public.audit_logs for select to authenticated using(company_id=public.cashdesk_company() and (public.cashdesk_role()='owner' or public.cashdesk_branch_access(branch_id)));

revoke all on public.companies,public.members,public.branches,public.user_branch_access,public.accounts,public.suppliers,public.supplier_invoices,public.cheques,public.transactions,public.cheque_events,public.audit_logs from anon,authenticated;
grant select on public.companies,public.members,public.branches,public.user_branch_access,public.accounts,public.suppliers,public.supplier_invoices,public.cheques,public.transactions,public.cheque_events,public.audit_logs to authenticated;
grant all on public.companies,public.members,public.branches,public.user_branch_access,public.accounts,public.suppliers,public.supplier_invoices,public.cheques,public.transactions,public.cheque_events,public.audit_logs to service_role;

-- Security invoker: every subquery below is filtered by the caller's RLS policies.
create function public.cashdesk_snapshot() returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
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

create function public.cashdesk_amount(p jsonb,field text,opening boolean default false) returns numeric language plpgsql immutable set search_path='' as $$
declare value numeric;
begin
  if jsonb_typeof(p->field)<>'number' or p->field is null then raise exception 'Amount must be an integer number of minor units'; end if;
  value:=(p->>field)::numeric;
  if value<>trunc(value) or abs(value)>999999999999 or (not opening and value<=0) then raise exception 'Invalid monetary amount'; end if;
  return value/100;
end $$;

create function public.cashdesk_mutate(command jsonb) returns void language plpgsql security definer set search_path='' as $$
declare
  p jsonb:=command->'payload'; operation text:=command->>'type';
  company uuid:=public.cashdesk_company(); branch uuid; entity uuid; actor uuid:=auth.uid();
  actor_role text:=public.cashdesk_role(); actor_name text; c public.cheques%rowtype; new_status text; clearing_date date; account_type text;
begin
  if company is null or actor is null then raise exception 'Workspace membership required'; end if;
  if p is null or jsonb_typeof(p)<>'object' then raise exception 'Missing command payload'; end if;
  entity:=(p->>'id')::uuid;
  if entity is null then raise exception 'Record ID required'; end if;
  select name into actor_name from public.members where id=actor;
  if operation not in ('addTransaction','addCheque','setChequeStatus','addAccount','addSupplier','addInvoice','setMemberRole') or operation is null then raise exception 'Unknown operation'; end if;
  if operation in ('addAccount','setChequeStatus') and actor_role not in ('owner','manager') then raise exception 'A manager or owner must approve this change'; end if;
  if operation not in ('setChequeStatus','setMemberRole') then
    branch:=(p->>'branchId')::uuid;
    if not public.cashdesk_branch_access(branch) then raise exception 'No access to this branch'; end if;
  end if;
  if operation='addAccount' then
    insert into public.accounts(id,company_id,branch_id,name,account_type,bank,opening_balance)
      values(entity,company,branch,btrim(p->>'name'),p->>'type',coalesce(btrim(p->>'bank'),''),public.cashdesk_amount(p,'openingBalance',true));
  elsif operation='addSupplier' then
    insert into public.suppliers(id,company_id,branch_id,supplier_name,contact,phone,email,payment_terms)
      values(entity,company,branch,btrim(p->>'name'),coalesce(p->>'contact',''),coalesce(p->>'phone',''),coalesce(p->>'email',''),(p->>'terms')::integer);
  elsif operation='addInvoice' then
    insert into public.supplier_invoices(id,company_id,branch_id,supplier_id,reference,amount,invoice_date,due_date)
      values(entity,company,branch,(p->>'supplierId')::uuid,btrim(p->>'reference'),public.cashdesk_amount(p,'amount'),(p->>'date')::date,(p->>'dueDate')::date);
  elsif operation='addTransaction' then
    if nullif(p->>'chequeId','') is not null or p->>'method'='cheque' then raise exception 'Use cheque clearance to move cheque funds'; end if;
    if (p->>'date')::date>(now() at time zone 'Asia/Colombo')::date then raise exception 'Actual movements cannot be dated in the future'; end if;
    insert into public.transactions(id,company_id,branch_id,account_id,transaction_type,amount,category,description,transaction_date,method,supplier_id)
      values(entity,company,branch,(p->>'accountId')::uuid,p->>'type',public.cashdesk_amount(p,'amount'),btrim(p->>'category'),btrim(p->>'description'),(p->>'date')::date,p->>'method',nullif(p->>'supplierId','')::uuid);
  elsif operation='addCheque' then
    if p->>'status' is distinct from p->>'type' then raise exception 'New cheque must start as issued or received'; end if;
    select a.account_type into account_type from public.accounts a where a.id=(p->>'accountId')::uuid and a.branch_id=branch and a.company_id=company;
    if account_type is distinct from 'bank' then raise exception 'Cheques require a bank account in this branch'; end if;
    insert into public.cheques(id,company_id,branch_id,account_id,cheque_number,cheque_type,payee,supplier_id,bank,amount,issue_date,due_date,status,notes)
      values(entity,company,branch,(p->>'accountId')::uuid,btrim(p->>'number'),p->>'type',btrim(p->>'payee'),nullif(p->>'supplierId','')::uuid,btrim(p->>'bank'),public.cashdesk_amount(p,'amount'),(p->>'issueDate')::date,(p->>'dueDate')::date,p->>'status',coalesce(p->>'notes',''));
    insert into public.cheque_events(company_id,branch_id,cheque_id,actor_id,new_status) values(company,branch,entity,actor,p->>'status');
  elsif operation='setChequeStatus' then
    -- Row lock plus UNIQUE transactions.cheque_id prevents concurrent double clearing.
    select * into c from public.cheques where id=entity and company_id=company for update;
    if not found or not public.cashdesk_branch_access(c.branch_id) then raise exception 'Cheque not found or no branch access'; end if;
    branch:=c.branch_id;new_status:=p->>'status';
    if c.status in ('cleared','cancelled') or new_status is null or new_status not in ('presented','cleared','returned','cancelled') or new_status=c.status or (c.status='returned' and new_status not in ('presented','cancelled')) then raise exception 'Invalid cheque status transition'; end if;
    update public.cheques set status=new_status where id=entity;
    if new_status='cleared' then
      clearing_date:=(p->>'date')::date;
      if clearing_date is null or clearing_date<c.issue_date or clearing_date>(now() at time zone 'Asia/Colombo')::date then raise exception 'Clearance date must be between issue date and today'; end if;
      insert into public.transactions(company_id,branch_id,account_id,amount,transaction_type,category,description,transaction_date,method,supplier_id,cheque_id)
        values(company,branch,c.account_id,c.amount,case when c.cheque_type='issued' then 'expense' else 'income' end,'Cheque settlement',left('Cheque #'||c.cheque_number||' · '||c.payee,160),clearing_date,'cheque',c.supplier_id,c.id);
    end if;
    insert into public.cheque_events(company_id,branch_id,cheque_id,actor_id,old_status,new_status) values(company,branch,entity,actor,c.status,new_status);
  elsif operation='setMemberRole' then
    -- Serialize owner changes so two owners cannot remove the last owner together.
    perform 1 from public.companies where id=company for update;
    if public.cashdesk_role()<>'owner' then raise exception 'Only the owner can manage team roles'; end if;
    if not exists(select 1 from public.members where id=entity and company_id=company) then raise exception 'Member not found'; end if;
    if exists(select 1 from public.members where id=entity and role='owner') and p->>'role'<>'owner' and (select count(*) from public.members where company_id=company and role='owner')=1 then raise exception 'Keep at least one owner'; end if;
    -- Owners have implicit access to every branch. Preserve that access explicitly
    -- if their role changes, rather than leaving their session without a branch.
    if exists(select 1 from public.members where id=entity and role='owner') and p->>'role'<>'owner' then
      insert into public.user_branch_access(company_id,user_id,branch_id)
        select company,entity,id from public.branches where company_id=company on conflict do nothing;
    end if;
    update public.members set role=p->>'role' where id=entity and company_id=company;
  end if;
  insert into public.audit_logs(company_id,branch_id,actor_id,actor_name,action,entity_id,details)
    values(company,branch,actor,actor_name,operation,entity,case when operation='setChequeStatus' then jsonb_build_object('from',c.status,'to',new_status) when operation='setMemberRole' then jsonb_build_object('role',p->>'role') else '{}'::jsonb end);
end $$;

revoke all on function public.cashdesk_company(),public.cashdesk_role(),public.cashdesk_branch_access(uuid),public.cashdesk_snapshot(),public.cashdesk_mutate(jsonb),public.cashdesk_amount(jsonb,text,boolean) from public,anon;
grant execute on function public.cashdesk_company(),public.cashdesk_role(),public.cashdesk_branch_access(uuid),public.cashdesk_snapshot(),public.cashdesk_mutate(jsonb) to authenticated;
commit;
