create index if not exists idx_crm_lead_attempts_broker_date on public.crm_lead_attempts (broker_id, attempt_date desc);
create index if not exists idx_crm_lead_coverages_lead_status_second on public.crm_lead_coverages (lead_id, status, second_called_at desc);
create index if not exists idx_crm_leads_status_received on public.crm_leads (status, received_at desc);

create or replace function public.crm_leads_snapshot(
  _status text default 'novo',
  _broker uuid default null,
  _all_brokers boolean default false,
  _floor timestamptz default '2026-06-01T00:00:00Z',
  _attempts_since date default null,
  _limit integer default 5000
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _is_admin boolean;
  _scope uuid;
  _scope_all boolean;
  _since date := coalesce(_attempts_since, (now() at time zone 'America/Sao_Paulo')::date - 2);
  _today_start timestamptz := ((now() at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo';
  _lim integer := least(greatest(coalesce(_limit, 5000), 1), 20000);
  _leads jsonb;
  _ids uuid[];
begin
  if _uid is null then
    raise exception 'not_authenticated';
  end if;
  select public.has_role(_uid, 'admin') into _is_admin;

  if _is_admin then
    _scope_all := coalesce(_all_brokers, false);
    _scope := _broker;
  else
    _scope_all := false;
    _scope := public.current_broker_id();
  end if;

  with l as (
    select *
      from public.crm_leads
     where status = coalesce(_status, 'novo')
       and received_at >= _floor
       and (
         _scope_all
         or (_scope is null and broker_id is null)
         or (_scope is not null and broker_id = _scope)
       )
     order by received_at desc
     limit _lim
  )
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb), coalesce(array_agg(x.id), '{}')
    into _leads, _ids
  from (
    select id, c2s_lead_id, name, phone, email, source, c2s_broker_alias,
           c2s_broker_email, broker_id, status, received_at, attended_at
      from l
  ) x;

  return jsonb_build_object(
    'leads', _leads,
    'attempts', (
      select coalesce(jsonb_agg(to_jsonb(a) order by a.called_at), '[]'::jsonb)
        from (
          select id, lead_id, period, result, attempt_date, called_at
            from public.crm_lead_attempts
           where lead_id = any(_ids)
             and attempt_date >= _since
        ) a
    ),
    'coverage', (
      select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
        from (
          select lead_id, attempts_done, open_first_period, open_first_called_at,
                 open_expires_at, last_first_called_at, last_second_called_at, last_attempt_number
            from public.crm_lead_coverage_state
           where lead_id = any(_ids)
        ) c
    ),
    'totals', (
      select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
        from (
          select lead_id, total_attempts
            from public.crm_lead_attempt_totals
           where lead_id = any(_ids)
        ) t
    ),
    'calls_today', (
      select coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb)
        from (
          select broker_id, count(*)::int as total
            from public.calls
           where created_at >= _today_start
           group by broker_id
        ) k
    )
  );
end;
$$;

revoke all on function public.crm_leads_snapshot(text, uuid, boolean, timestamptz, date, integer) from public;
grant execute on function public.crm_leads_snapshot(text, uuid, boolean, timestamptz, date, integer) to authenticated;