begin;
create table public.reminder_settings (
  company_id uuid primary key references public.companies(id), enabled boolean not null default false,
  recipients text[] not null default '{}', sender text not null default ''
);
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), cheque_id uuid not null references public.cheques(id),
  scheduled_date date not null, stage text not null, status text not null check(status in ('sending','sent','failed')),
  attempts integer not null default 1, claim_token uuid not null default gen_random_uuid(), updated_at timestamptz not null default now(),
  provider_id text, error text, constraint delivery_identity unique(cheque_id,scheduled_date,stage)
);
alter table public.reminder_settings enable row level security;
alter table public.notification_deliveries enable row level security;
create policy reminder_settings_read on public.reminder_settings for select to authenticated using(company_id=public.cashdesk_company() and public.cashdesk_role()='owner');
create policy delivery_read on public.notification_deliveries for select to authenticated using(company_id=public.cashdesk_company() and public.cashdesk_role()='owner');
revoke all on public.reminder_settings,public.notification_deliveries from anon,authenticated;
grant select on public.reminder_settings,public.notification_deliveries to authenticated;
grant all on public.reminder_settings,public.notification_deliveries to service_role;

create function public.claim_due_reminders() returns jsonb language plpgsql security definer set search_path='' as $$
declare d date:=(now() at time zone 'Asia/Colombo')::date; item record; delivery public.notification_deliveries%rowtype; result jsonb:='[]'; stage text;
begin
  for item in select c.*,s.recipients,s.sender from public.cheques c join public.reminder_settings s on s.company_id=c.company_id
    where s.enabled and cardinality(s.recipients)>0 and length(s.sender)>0 and (c.status='returned' or (c.status in ('issued','received','presented') and (c.due_date-d in (7,3,1,0) or c.due_date<d)))
    order by c.due_date for update of c skip locked
  loop
    stage:=case when item.status='returned' then 'returned' when item.due_date<d then 'overdue' when item.due_date=d then 'due' else (item.due_date-d)::text||'-days' end;
    insert into public.notification_deliveries(company_id,cheque_id,scheduled_date,stage,status)
      values(item.company_id,item.id,d,stage,'sending')
      on conflict on constraint delivery_identity do update set status='sending',attempts=public.notification_deliveries.attempts+1,claim_token=gen_random_uuid(),updated_at=now()
      where public.notification_deliveries.status<>'sent' and public.notification_deliveries.attempts<3 and public.notification_deliveries.updated_at<now()-interval '15 minutes'
      returning * into delivery;
    if found then
      result:=result||jsonb_build_array(jsonb_build_object('id',delivery.id,'token',delivery.claim_token,'key','cashdesk/'||item.id||'/'||d||'/'||stage,'recipients',item.recipients,'sender',item.sender,'payee',item.payee,'number',item.cheque_number,'amount',item.amount,'dueDate',item.due_date,'type',item.cheque_type,'stage',stage));
      if jsonb_array_length(result)>=50 then exit; end if;
    end if;
  end loop;
  return result;
end $$;
create function public.finish_reminder(delivery_id uuid,token uuid,delivered boolean,provider text default null,failure text default null) returns void language sql security definer set search_path='' as $$
  update public.notification_deliveries set status=case when delivered then 'sent' else 'failed' end,provider_id=provider,error=left(failure,500),updated_at=now()
    where id=delivery_id and claim_token=token and status='sending'
$$;
revoke all on function public.claim_due_reminders(),public.finish_reminder(uuid,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.claim_due_reminders(),public.finish_reminder(uuid,uuid,boolean,text,text) to service_role;
commit;
