begin;
create table public.employees (
 id uuid primary key,company_id uuid not null references public.companies(id),branch_id uuid not null,payload jsonb not null,
 unique(company_id,id),foreign key(company_id,branch_id) references public.branches(company_id,id)
);
create table public.employee_attendance (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,employee_id uuid not null,day date not null,
 status text not null check(status in ('present','absent','half_day','paid_leave','unpaid_leave','off')),note text not null default '' check(length(note)<=500),
 unique(company_id,employee_id,day),foreign key(company_id,employee_id) references public.employees(company_id,id)
);
create table public.employee_attendance_changes (
 id uuid primary key,company_id uuid not null,employee_id uuid not null,data jsonb not null,
 foreign key(company_id,employee_id) references public.employees(company_id,id)
);
create table public.employee_payrolls (
 id uuid primary key,company_id uuid not null,employee_id uuid not null,branch_id uuid not null,month date not null check(extract(day from month)=1),
 status text not null default 'approved' check(status in ('approved','void')),data jsonb not null,void_reason text not null default '',
 unique(company_id,id),foreign key(company_id,employee_id) references public.employees(company_id,id),foreign key(company_id,branch_id) references public.branches(company_id,id)
);
create unique index one_approved_employee_month on public.employee_payrolls(company_id,employee_id,month) where status='approved';
create table public.employee_advances (
 id uuid primary key,company_id uuid not null,employee_id uuid not null,branch_id uuid not null,amount bigint not null check(amount>0),day date not null,note text not null default '',
 transaction_id uuid not null unique references public.transactions(id),foreign key(company_id,employee_id) references public.employees(company_id,id),foreign key(company_id,branch_id) references public.branches(company_id,id)
);
create table public.employee_payments (
 id uuid primary key,company_id uuid not null,payroll_id uuid not null,kind text not null check(kind in ('salary','epf','etf')),amount bigint not null check(amount>0),day date not null,
 account_id uuid not null references public.accounts(id),transaction_id uuid not null unique references public.transactions(id),note text not null default '',
 foreign key(company_id,payroll_id) references public.employee_payrolls(company_id,id)
);
do $$declare t text;begin
 foreach t in array array['employees','employee_attendance','employee_attendance_changes','employee_payrolls','employee_advances','employee_payments'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy owner_employment_read on public.%I for select to authenticated using(company_id=public.cashdesk_company() and public.cashdesk_role()=''owner'')',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

create function public.cashdesk_hr_int(p jsonb,field text,maximum bigint default 999999999999) returns bigint language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
 if jsonb_typeof(p->field) is distinct from 'number' then raise exception 'Enter a valid %',field;end if;
 n:=(p->>field)::numeric;
 if n<>trunc(n) or n<0 or n>maximum then raise exception 'Enter a valid %',field;end if;
 return n::bigint;
end $$;

create function public.cashdesk_hr_calculation(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare company uuid:=public.cashdesk_company();e public.employees%rowtype;period date:=(p->>'month')::date;last_day date;working bigint;scheduled bigint;allowance bigint;eligible bigint;advance bigint;other bigint;
 paid numeric;unpaid numeric;recorded integer;eligible_days integer;basic bigint;absence bigint;earned bigint;gross bigint;employee_epf bigint;employer_epf bigint;etf bigint;net bigint;cost bigint;available bigint;
begin
 if company is null or public.cashdesk_role() is distinct from 'owner' then raise exception 'Only the owner can manage employees and salaries' using errcode='42501';end if;
 select * into e from public.employees where id=(p->>'employeeId')::uuid and company_id=company;
 if not found then raise exception 'Employee not found';end if;
 if period is null or extract(day from period)<>1 then raise exception 'Choose a month';end if;
 last_day:=(period+interval '1 month'-interval '1 day')::date;
 if last_day<(e.payload->>'joined')::date then raise exception 'This month is before the employee joined';end if;
 working:=public.cashdesk_hr_int(p,'workingDays',31);scheduled:=public.cashdesk_hr_int(p,'scheduledDays',31);
 if working<1 then raise exception 'Working days must be at least one';end if;
 allowance:=public.cashdesk_hr_int(p,'allowance');eligible:=public.cashdesk_hr_int(p,'eligible');advance:=public.cashdesk_hr_int(p,'advance');other:=public.cashdesk_hr_int(p,'other');
 select coalesce(sum(case when status in ('present','paid_leave') then 1 when status='half_day' then .5 else 0 end),0),
 coalesce(sum(case when status in ('absent','unpaid_leave') then 1 when status='half_day' then .5 else 0 end),0),count(*) filter(where status<>'off')
 into paid,unpaid,recorded from public.employee_attendance where company_id=company and employee_id=e.id and day between period and last_day;
 eligible_days:=last_day-greatest(period,(e.payload->>'joined')::date)+1;
 if scheduled>working or scheduled>eligible_days or recorded>scheduled or unpaid>scheduled then raise exception 'Scheduled days must cover marked working days and fit the employment period';end if;
 if e.payload->>'payType'='monthly' then
  basic:=round((e.payload->>'rate')::numeric*scheduled/working);absence:=round((e.payload->>'rate')::numeric*unpaid/working);
 else basic:=round((e.payload->>'rate')::numeric*(paid+unpaid));absence:=round((e.payload->>'rate')::numeric*unpaid);end if;
 earned:=basic-absence;gross:=earned+allowance;
 if eligible>gross then raise exception 'Eligible earnings cannot exceed gross salary';end if;
 employee_epf:=case when (e.payload->>'epfEnabled')::boolean then round(eligible::numeric*(e.payload->>'employeeRate')::numeric/10000) else 0 end;
 employer_epf:=case when (e.payload->>'epfEnabled')::boolean then round(eligible::numeric*(e.payload->>'employerRate')::numeric/10000) else 0 end;
 etf:=case when (e.payload->>'etfEnabled')::boolean then round(eligible::numeric*(e.payload->>'etfRate')::numeric/10000) else 0 end;
 select coalesce(sum(amount),0) into available from public.employee_advances where company_id=company and employee_id=e.id and day<=last_day;
 available:=available-coalesce((select sum((data->'calculation'->>'advance')::bigint) from public.employee_payrolls where company_id=company and employee_id=e.id and status='approved'),0);
 if advance>greatest(0,available) then raise exception 'Advance deduction exceeds unallocated advances';end if;
 net:=gross-employee_epf-advance-other;cost:=gross+employer_epf+etf;
 if net<0 then raise exception 'Deductions exceed salary; reduce the deductions or carry advances forward';end if;
 if greatest(basic,absence,earned,gross,employee_epf,employer_epf,etf,net,cost)>999999999999 then raise exception 'Salary exceeds the supported amount';end if;
 return jsonb_build_object('basic',basic,'absence',absence,'earned',earned,'gross',gross,'eligible',eligible,'employeeEpf',employee_epf,'employerEpf',employer_epf,'etf',etf,'advance',advance,'other',other,'net',net,'cost',cost,'paidUnits',paid,'unpaidUnits',unpaid,'recordedDays',recorded);
end $$;

create function public.cashdesk_apply_hr_command(command jsonb) returns void language plpgsql security definer set search_path='' as $$
declare company uuid:=public.cashdesk_company();p jsonb:=command->'payload';op text:=command->>'type';entity uuid:=(p->>'id')::uuid;
 e public.employees%rowtype;prior public.employees%rowtype;run public.employee_payrolls%rowtype;a public.accounts%rowtype;employee_id uuid;branch uuid;first_day date;last_day date;day date;
 amount bigint;due bigint;calculation jsonb;content jsonb;note text:=coalesce(p->>'note','');description text;actor_name text;pay_kind text;
begin
 if company is null or public.cashdesk_role() is distinct from 'owner' then raise exception 'Only the owner can manage employees and salaries' using errcode='42501';end if;
 perform 1 from public.companies where id=company for no key update;
 if public.cashdesk_role() is distinct from 'owner' then raise exception 'Owner access required' using errcode='42501';end if;
 if entity is null then raise exception 'Record ID required';end if;
 if length(note)>500 then raise exception 'Keep the note under 500 characters';end if;
 if op='saveEmployee' then
  if p->>'name' is null or length(btrim(p->>'name')) not between 1 and 160 or p->>'phone' is null or length(p->>'phone')>40 then raise exception 'Enter a name and valid contact number';end if;
  if p->>'payType' is null or p->>'payType' not in ('monthly','daily') then raise exception 'Choose monthly salary or daily wage';end if;
  if p->>'joined' is null or p->>'joined' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter a joining date';end if;
  day:=(p->>'joined')::date;branch:=(p->>'branchId')::uuid;
  if not exists(select 1 from public.branches where id=branch and company_id=company) then raise exception 'Choose a location in your business';end if;
  if jsonb_typeof(p->'active') is distinct from 'boolean' or jsonb_typeof(p->'epfEnabled') is distinct from 'boolean' or jsonb_typeof(p->'etfEnabled') is distinct from 'boolean' then raise exception 'Choose valid employee settings';end if;
  perform public.cashdesk_hr_int(p,'rate');perform public.cashdesk_hr_int(p,'allowance');perform public.cashdesk_hr_int(p,'leaveAllowance',366);
  if public.cashdesk_hr_int(p,'workingDays',31)<1 then raise exception 'Working days must be at least one';end if;
  perform public.cashdesk_hr_int(p,'employeeRate',10000);perform public.cashdesk_hr_int(p,'employerRate',10000);perform public.cashdesk_hr_int(p,'etfRate',10000);
  select * into prior from public.employees where id=entity for update;
  if found and (prior.company_id<>company or prior.branch_id<>branch) then raise exception 'Keep the employee in their original location';end if;
  if exists(select 1 from public.employee_attendance where employee_attendance.employee_id=entity and company_id=company and employee_attendance.day<(p->>'joined')::date) or exists(select 1 from public.employee_advances where employee_advances.employee_id=entity and company_id=company and employee_advances.day<(p->>'joined')::date) then raise exception 'Joining date cannot follow existing attendance';end if;
  insert into public.employees(id,company_id,branch_id,payload) values(entity,company,branch,p||jsonb_build_object('id',entity,'branchId',branch,'joined',day,'phone',p->>'phone','name',btrim(p->>'name')))
    on conflict(id) do update set payload=excluded.payload;
 else
  if op in ('voidPayroll','payPayroll') then
   select * into run from public.employee_payrolls where id=case when op='voidPayroll' then entity else (p->>'payrollId')::uuid end and company_id=company for update;
   if not found or run.status<>'approved' then raise exception 'Approved payroll not found';end if;
   employee_id:=run.employee_id;branch:=run.branch_id;
  else employee_id:=(p->>'employeeId')::uuid;end if;
  select * into e from public.employees where id=employee_id and company_id=company for update;
  if not found then raise exception 'Employee not found';end if;
  branch:=e.branch_id;
  if op='setAttendance' then
   first_day:=(p->>'from')::date;last_day:=(p->>'to')::date;
   if first_day is null or last_day is null or first_day>last_day or date_trunc('month',first_day)<>date_trunc('month',last_day) or first_day<(e.payload->>'joined')::date then raise exception 'Choose dates in one month on or after joining';end if;
   if not (e.payload->>'active')::boolean then raise exception 'Activate the employee before changing attendance';end if;
   if p->>'status' is null or p->>'status' not in ('present','absent','half_day','paid_leave','unpaid_leave','off','clear') then raise exception 'Choose an attendance status';end if;
   if exists(select 1 from public.employee_payrolls where company_id=company and employee_payrolls.employee_id=e.id and month=date_trunc('month',first_day)::date and status='approved') then raise exception 'Attendance is locked by approved payroll. Void unpaid payroll to correct it.';end if;
   if last_day>(now() at time zone 'Asia/Colombo')::date and p->>'status' not in ('paid_leave','unpaid_leave','off','clear') then raise exception 'Actual attendance cannot be dated in the future';end if;
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'employeeId',employee_attendance.employee_id,'date',employee_attendance.day,'status',status,'note',employee_attendance.note) order by employee_attendance.day),'[]'::jsonb) into content from public.employee_attendance where company_id=company and employee_attendance.employee_id=e.id and employee_attendance.day between first_day and last_day;
   if length(btrim(note))=0 and exists(select 1 from public.employee_attendance where company_id=company and employee_attendance.employee_id=e.id and employee_attendance.day between first_day and last_day and (status is distinct from p->>'status' or employee_attendance.note is distinct from coalesce(p->>'note',''))) then raise exception 'Add a note explaining the attendance correction';end if;
   if p->>'status'='clear' then delete from public.employee_attendance where company_id=company and employee_attendance.employee_id=e.id and employee_attendance.day between first_day and last_day;
   else
    insert into public.employee_attendance(company_id,employee_id,day,status,note)
      select company,e.id,d::date,p->>'status',note from generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') as d
      on conflict on constraint employee_attendance_company_id_employee_id_day_key do update set status=excluded.status,note=excluded.note;
   end if;
   insert into public.employee_attendance_changes values(entity,company,e.id,jsonb_build_object('id',entity,'employeeId',e.id,'from',first_day,'to',last_day,'note',note,'at',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'actorName',(select name from public.members where id=auth.uid()),'before',content,
    'after',coalesce((select jsonb_agg(jsonb_build_object('id',id,'employeeId',employee_attendance.employee_id,'date',employee_attendance.day,'status',status,'note',employee_attendance.note) order by employee_attendance.day) from public.employee_attendance where company_id=company and employee_attendance.employee_id=e.id and employee_attendance.day between first_day and last_day),'[]'::jsonb)));
  elsif op='approvePayroll' then
   first_day:=(p->>'month')::date;
   if first_day is null or first_day>date_trunc('month',now() at time zone 'Asia/Colombo')::date then raise exception 'Choose a current or past month';end if;
   calculation:=public.cashdesk_hr_calculation(p);
   if calculation is distinct from p->'expected' then raise exception 'The calculation changed. Refresh and review before approval.';end if;
   content:=(p-'expected')||jsonb_build_object('id',entity,'employeeId',e.id,'month',first_day,'joined',e.payload->>'joined','note',note,'branchId',branch,'employeeName',e.payload->>'name','payType',e.payload->>'payType','rate',e.payload->'rate','employeeRate',e.payload->'employeeRate','employerRate',e.payload->'employerRate','etfRate',e.payload->'etfRate','epfEnabled',e.payload->'epfEnabled','etfEnabled',e.payload->'etfEnabled','calculation',calculation,'status','approved','approvedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'voidReason','',
    'attendance',coalesce((select jsonb_agg(jsonb_build_object('id',id,'employeeId',employee_attendance.employee_id,'date',employee_attendance.day,'status',status,'note',employee_attendance.note) order by employee_attendance.day) from public.employee_attendance where company_id=company and employee_attendance.employee_id=e.id and date_trunc('month',employee_attendance.day)::date=first_day),'[]'::jsonb));
   insert into public.employee_payrolls(id,company_id,employee_id,branch_id,month,data) values(entity,company,e.id,branch,first_day,content);
  elsif op='voidPayroll' then
   if exists(select 1 from public.employee_payments where company_id=company and payroll_id=run.id) then raise exception 'Paid payroll cannot be voided; record corrections in the next payroll';end if;
   if p->>'reason' is null or length(btrim(p->>'reason')) not between 1 and 500 then raise exception 'Enter a reason for voiding payroll';end if;
   update public.employee_payrolls set status='void',void_reason=btrim(p->>'reason') where id=run.id;
  elsif op in ('addAdvance','payPayroll') then
   day:=(p->>'date')::date;amount:=public.cashdesk_hr_int(p,'amount');
   if amount<=0 or day is null or day>(now() at time zone 'Asia/Colombo')::date or day<(case when op='payPayroll' then (run.data->>'joined')::date else (e.payload->>'joined')::date end) then raise exception 'Choose a positive payment and a valid date on or after joining';end if;
   if op='addAdvance' then
    if not (e.payload->>'active')::boolean then raise exception 'Choose an active employee';end if;
    description:='Staff salary advance';
   else
    pay_kind:=p->>'kind';if pay_kind is null or pay_kind not in ('salary','epf','etf') then raise exception 'Choose salary, EPF or ETF';end if;
    due:=case when pay_kind='salary' then (run.data->'calculation'->>'net')::bigint when pay_kind='epf' then (run.data->'calculation'->>'employeeEpf')::bigint+(run.data->'calculation'->>'employerEpf')::bigint else (run.data->'calculation'->>'etf')::bigint end;
    due:=due-coalesce((select sum(employee_payments.amount) from public.employee_payments where company_id=company and payroll_id=run.id and kind=pay_kind),0);
    if day<run.month or amount>due then raise exception 'Payment must fit the outstanding amount and pay period';end if;
    description:=case when pay_kind='salary' then 'Staff pay' when pay_kind='epf' then 'EPF contribution' else 'ETF contribution' end||' - '||to_char(run.month,'YYYY-MM');
   end if;
   select * into a from public.accounts where id=(p->>'accountId')::uuid and company_id=company and branch_id=branch;
   if not found then raise exception 'Choose an account in the employee''s location';end if;
   perform public.cashdesk_apply_command(jsonb_build_object('type','addTransaction','payload',jsonb_build_object('id',entity,'branchId',branch,'accountId',a.id,'amount',amount,'type','expense','date',day,'category',case when op='addAdvance' then 'Staff advance' when pay_kind='salary' then 'Staff pay' else 'EPF / ETF' end,'description',description,'method',case when a.account_type='bank' then 'transfer' else 'cash' end,'supplierId',null,'chequeId',null)));
   if op='addAdvance' then insert into public.employee_advances values(entity,company,e.id,branch,amount,day,note,entity);
   else insert into public.employee_payments values(entity,company,run.id,pay_kind,amount,day,a.id,entity,note);end if;
  else raise exception 'Unknown employee operation';end if;
 end if;
 select name into actor_name from public.members where id=auth.uid();
 insert into public.audit_logs(company_id,branch_id,actor_id,actor_name,action,entity_id) values(company,branch,auth.uid(),actor_name,op,entity);
end $$;

revoke all on function public.cashdesk_apply_hr_command(jsonb),public.cashdesk_hr_calculation(jsonb),public.cashdesk_hr_int(jsonb,text,bigint) from public,anon,authenticated,service_role;

create function public.cashdesk_hr_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare company uuid:=public.cashdesk_company();
begin
 if company is null or public.cashdesk_role() is distinct from 'owner' then raise exception 'Only the owner can view employees and salaries' using errcode='42501';end if;
 return jsonb_build_object(
 'changes',coalesce((select jsonb_agg(data order by data->>'at' desc) from public.employee_attendance_changes where company_id=company),'[]'::jsonb),
 'employees',coalesce((select jsonb_agg(payload order by payload->>'name') from public.employees where company_id=company),'[]'::jsonb),
 'attendance',coalesce((select jsonb_agg(jsonb_build_object('id',id,'employeeId',employee_id,'date',day,'status',status,'note',note) order by day) from public.employee_attendance where company_id=company),'[]'::jsonb),
 'payrolls',coalesce((select jsonb_agg(data||jsonb_build_object('status',status,'voidReason',void_reason) order by month desc,id) from public.employee_payrolls where company_id=company),'[]'::jsonb),
 'advances',coalesce((select jsonb_agg(jsonb_build_object('id',id,'employeeId',employee_id,'branchId',branch_id,'amount',amount,'date',day,'note',note,'transactionId',transaction_id) order by day) from public.employee_advances where company_id=company),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'payrollId',payroll_id,'kind',kind,'amount',amount,'date',day,'accountId',account_id,'transactionId',transaction_id,'note',note) order by day) from public.employee_payments where company_id=company),'[]'::jsonb));
end $$;
revoke all on function public.cashdesk_hr_snapshot() from public,anon;
grant execute on function public.cashdesk_hr_snapshot() to authenticated;
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
  if request is null then if command->>'type'='removeMember' then perform public.cashdesk_remove_member((command->'payload'->>'id')::uuid); elsif command->>'type' in ('saveEmployee','setAttendance','approvePayroll','voidPayroll','payPayroll','addAdvance') then perform public.cashdesk_apply_hr_command(command); else perform public.cashdesk_apply_command(command); end if; return; end if;
  insert into public.operation_requests(company_id,request_id,actor_id,command)
    values(company,request,actor,content) on conflict do nothing;
  select * into receipt from public.operation_requests where company_id=company and request_id=request for update;
  if receipt.actor_id<>actor or receipt.command is distinct from content then
    raise exception 'This request was already used with different details. Refresh your workspace before making another change.';
  end if;
  if receipt.completed then return; end if;
  if command->>'type'='removeMember' then perform public.cashdesk_remove_member((command->'payload'->>'id')::uuid); elsif command->>'type' in ('saveEmployee','setAttendance','approvePayroll','voidPayroll','payPayroll','addAdvance') then perform public.cashdesk_apply_hr_command(command); else perform public.cashdesk_apply_command(command); end if;
  update public.operation_requests set completed=true where company_id=company and request_id=request;
end $$;

create or replace function public.cashdesk_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
  select public.cashdesk_snapshot_base()||jsonb_build_object(
    'employment',case when public.cashdesk_role()='owner' then public.cashdesk_hr_snapshot() else jsonb_build_object('employees','[]'::jsonb,'attendance','[]'::jsonb,'payrolls','[]'::jsonb,'advances','[]'::jsonb,'payments','[]'::jsonb) end,
    'companyName',(select name from public.companies where id=public.cashdesk_company()),
    'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'branchId',branch_id,'accountId',account_id,'type',transaction_type,'amount',(amount*100)::bigint,'category',category,'description',description,'date',transaction_date,'method',method,'supplierId',supplier_id,'chequeId',cheque_id,'transferId',transfer_id,'cashDayId',cash_day_id,'countKind',count_kind) order by transaction_date desc,id) from public.transactions),'[]'::jsonb),
    'transfers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'branchId',branch_id,'fromAccountId',from_account_id,'toAccountId',to_account_id,'amount',(amount*100)::bigint,'date',transfer_date,'description',description) order by transfer_date desc) from public.bank_transfers),'[]'::jsonb),
    'cashDays',coalesce((select jsonb_agg(jsonb_build_object('id',id,'branchId',branch_id,'accountId',account_id,'date',day_date,'opening',(opening_count*100)::bigint,'openingLedger',(opening_ledger*100)::bigint,'closing',(closing_count*100)::bigint,'expectedClosing',(expected_closing*100)::bigint,'notes',notes) order by day_date desc) from public.cash_days),'[]'::jsonb)
  )
$$;
create or replace function public.cashdesk_health() returns jsonb language sql stable security invoker set search_path='' as $$select jsonb_build_object('app','bb-cashdesk','schemaVersion',7)$$;
notify pgrst,'reload schema';
commit;
