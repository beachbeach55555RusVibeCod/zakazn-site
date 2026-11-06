
begin;
create schema if not exists private;
create table public.payroll_months (
 month text primary key check(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 closed_at timestamptz not null default now(),
 orders jsonb not null check(jsonb_typeof(orders)='array')
);
alter table public.payroll_months enable row level security;
revoke all on public.payroll_months from public, anon, authenticated;
grant select on public.payroll_months to authenticated;
create policy payroll_read on public.payroll_months for select to authenticated using (true);
create function private.reject_payroll_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Зарплата закрытого месяца зафиксирована'; end $$;
create trigger payroll_immutable before update or delete on public.payroll_months for each statement execute function private.reject_payroll_change();

create function private.close_payroll_months() returns void language plpgsql security definer set search_path='' as $$
declare m text; first_month date; this_month date := date_trunc('month', now() at time zone 'Europe/Moscow')::date;
begin
 if auth.uid() is null and session_user not in ('postgres','supabase_admin') then raise exception 'Authentication required'; end if;
 perform pg_advisory_xact_lock(71420611);
 select min((substring(value::jsonb->>'dateOut',1,7)||'-01')::date) into first_month
 from public.kv_store where key like 'order:%' and value::jsonb->>'status'='done'
 and value::jsonb->>'dateOut' ~ '^[0-9]{4}-(0[1-9]|1[0-2])-[0-9]{2}$';
 first_month := least(first_month, (select min((month||'-01')::date) from public.payroll_months));
 if first_month is null then first_month := this_month - interval '1 month'; end if;
 for m in select to_char(d,'YYYY-MM') from generate_series(first_month,this_month-interval '1 month',interval '1 month') d loop
  if exists(select 1 from public.payroll_months where month=m) then continue; end if;
  insert into public.payroll_months(month,orders)
  select m,coalesce(jsonb_agg(o || jsonb_build_object('payrollFrozenMonth',m,'lines',
    (select coalesce(jsonb_agg(l || jsonb_build_object('payrollCommissions',
      case when l->>'type'='work' then
       (select coalesce(jsonb_agg(jsonb_build_object('staffId',a.sid,'name',coalesce(s.value::jsonb->>'name','Бывший сотрудник'),'pct',coalesce(nullif(s.value::jsonb->>'commissionPct','')::numeric,40),'amount',
       coalesce(nullif(l->>'qty','')::numeric,0)*coalesce(nullif(l->>'price','')::numeric,0) /
       greatest((select count(*) from jsonb_array_elements_text(coalesce(l->'assignees','[]'::jsonb)) z where z<>''),1) *
       coalesce(nullif(s.value::jsonb->>'commissionPct','')::numeric,40)/100)), '[]'::jsonb)
       from jsonb_array_elements_text(coalesce(l->'assignees','[]'::jsonb)) a(sid)
       left join public.kv_store s on s.key='staff:'||a.sid where a.sid<>'')
      else '[]'::jsonb end) order by ord),'[]'::jsonb)
     from jsonb_array_elements(coalesce(o->'lines','[]'::jsonb)) with ordinality x(l,ord))
  ) order by o->>'orderNumber'),'[]'::jsonb)
  from (select value::jsonb o from public.kv_store where key like 'order:%') q
  where o->>'status'='done' and substring(o->>'dateOut',1,7)=m
  and not exists(select 1 from public.payroll_months pm cross join lateral jsonb_array_elements(pm.orders) frozen where frozen->>'id'=o->>'id')
  on conflict(month) do nothing;
 end loop;
end $$;
revoke all on function private.close_payroll_months() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.close_payroll_months() to authenticated;
create function public.close_payroll_months() returns void language sql security invoker set search_path='' as $$
 select private.close_payroll_months();
$$;
revoke all on function public.close_payroll_months() from public, anon;
grant execute on function public.close_payroll_months() to authenticated;

create function private.payroll_before_kv_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.close_payroll_months();
 return null;
end $$;
revoke all on function private.payroll_before_kv_change() from public, anon, authenticated;
revoke all on function private.reject_payroll_change() from public, anon, authenticated;
create trigger payroll_capture_before_change before insert or update or delete on public.kv_store for each statement execute function private.payroll_before_kv_change();

create function private.payroll_issue_date() returns trigger language plpgsql set search_path='' as $
declare o jsonb;
begin
 if new.key not like 'order:%' then return new; end if;
 o:=new.value::jsonb;
 if o->>'status'='done' and (tg_op='INSERT' or old.value::jsonb->>'status' is distinct from 'done')
 and (coalesce(o->>'dateOut','')='' or substring(o->>'dateOut',1,7)<to_char(now() at time zone 'Europe/Moscow','YYYY-MM')) then
  new.value := (o || jsonb_build_object('dateOut',to_char(now() at time zone 'Europe/Moscow','YYYY-MM-DD'),'issuedAt',floor(extract(epoch from now())*1000)::bigint))::text;
 end if;
 return new;
end $;
revoke all on function private.payroll_issue_date() from public, anon, authenticated;
create trigger payroll_issue_date before insert or update on public.kv_store for each row execute function private.payroll_issue_date();

select private.close_payroll_months();
commit;
