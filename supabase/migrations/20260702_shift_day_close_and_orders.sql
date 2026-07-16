-- Final business-day close must not deadlock on open bag sessions.
-- Outstanding employee-held bags are treated as returned stock for the day
-- and bag allocations are settled so they do not roll into the next date.

create unique index if not exists operation_days_one_per_branch_day_idx
  on public.operation_days(branch_id, business_date);

create unique index if not exists report_snapshots_one_per_branch_day_idx
  on public.report_snapshots(branch_id, report_date);

create or replace function public.finalize_daily_report(
  p_branch_id text,
  p_report_date date,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  report_id uuid;
  ended timestamptz := now();
begin
  select * into actor from public.current_profile();
  if actor.role not in ('shift_leader', 'manager', 'admin') then
    raise exception 'Khong co quyen chot bao cao.';
  end if;
  if actor.role = 'shift_leader' and actor.branch_id <> p_branch_id then
    raise exception 'Khong co quyen tai chi nhanh nay.';
  end if;
  if actor.role in ('manager', 'admin') and not public.can_manage_branch(p_branch_id) then
    raise exception 'Khong co quyen tai chi nhanh nay.';
  end if;

  insert into public.operation_days (
    id, branch_id, business_date, status, opened_by, opened_at, closed_by, closed_at
  )
  values (
    gen_random_uuid(), p_branch_id, p_report_date, 'closed', actor.id, ended, actor.id, ended
  )
  on conflict (branch_id, business_date) do update
  set status = 'closed',
      closed_by = actor.id,
      closed_at = ended;

  insert into public.report_snapshots (
    id, branch_id, report_date, created_by, payload
  )
  values (
    gen_random_uuid(), p_branch_id, p_report_date, actor.id, p_payload
  )
  on conflict (branch_id, report_date) do update
  set created_by = actor.id,
      payload = excluded.payload;

  update public.bag_allocations allocation
  set returned_quantity = greatest(0,
        coalesce(allocation.issued_quantity, 0)
        - coalesce(allocation.sold_quantity, 0)
        - coalesce(allocation.damaged_quantity, 0)
      ),
      settled_by = actor.id,
      settlement_shift_id = allocation.shift_id,
      settled_at = ended
  from public.bag_shift_sessions session
  where session.id = allocation.shift_id
    and session.branch_id = p_branch_id
    and session.business_date = p_report_date
    and allocation.settled_at is null;

  update public.bag_shift_sessions
  set status = 'closed',
      discrepancy_note = coalesce(discrepancy_note, 'Auto closed by daily report.'),
      ended_at = coalesce(ended_at, ended)
  where branch_id = p_branch_id
    and business_date = p_report_date
    and status = 'open';
end;
$$;

grant execute on function public.finalize_daily_report(text, date, jsonb) to authenticated;

drop policy if exists "shift leaders delete supply requests" on public.supply_requests;
create policy "shift leaders delete supply requests" on public.supply_requests
for delete to authenticated
using (
  (public.current_profile()).role in ('shift_leader', 'manager', 'admin')
  and public.can_manage_branch(branch_id)
);

drop policy if exists "shift leaders edit supply requests" on public.supply_requests;
create policy "shift leaders edit supply requests" on public.supply_requests
for update to authenticated
using (
  (public.current_profile()).role in ('shift_leader', 'manager', 'admin')
  and public.can_manage_branch(branch_id)
)
with check (
  (public.current_profile()).role in ('shift_leader', 'manager', 'admin')
  and public.can_manage_branch(branch_id)
);

notify pgrst, 'reload schema';
