begin transaction read only;

with cutoff as (
  select date '2026-07-14' as last_completed_date
),
stale_days as (
  select branch_id, business_date, status
  from public.operation_days, cutoff
  where business_date <= cutoff.last_completed_date
    and status = 'open'
),
stale_sessions as (
  select branch_id, business_date, count(*)::bigint as open_sessions
  from public.bag_shift_sessions, cutoff
  where business_date <= cutoff.last_completed_date
    and status = 'open'
  group by branch_id, business_date
)
select jsonb_pretty(jsonb_build_object(
  'last_completed_date', (select last_completed_date from cutoff),
  'stale_open_operation_days', coalesce((
    select jsonb_agg(to_jsonb(stale_days) order by business_date, branch_id)
    from stale_days
  ), '[]'::jsonb),
  'stale_open_sessions', coalesce((
    select jsonb_agg(to_jsonb(stale_sessions) order by business_date, branch_id)
    from stale_sessions
  ), '[]'::jsonb)
)) as auto_close_scope;

rollback;
