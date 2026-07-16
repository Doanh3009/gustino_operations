-- Harden daily report closing and realtime cross-role sync.

create unique index if not exists report_snapshots_one_per_branch_day_idx
  on public.report_snapshots(branch_id, report_date);

drop policy if exists "shift leaders update shift reports" on public.report_snapshots;
create policy "shift leaders update shift reports" on public.report_snapshots
for update to authenticated
using (
  (public.current_profile()).role in ('shift_leader', 'manager', 'admin')
  and (
    branch_id = (public.current_profile()).branch_id
    or public.can_manage_branch(branch_id)
  )
)
with check (
  (public.current_profile()).role in ('shift_leader', 'manager', 'admin')
  and (
    branch_id = (public.current_profile()).branch_id
    or public.can_manage_branch(branch_id)
  )
);

drop policy if exists "operations close operation days" on public.operation_days;
create policy "operations close operation days" on public.operation_days
for update to authenticated
using (
  (public.current_profile()).role in ('shift_leader', 'manager', 'admin')
  and (
    branch_id = (public.current_profile()).branch_id
    or public.can_manage_branch(branch_id)
  )
)
with check (
  (public.current_profile()).role in ('shift_leader', 'manager', 'admin')
  and (
    branch_id = (public.current_profile()).branch_id
    or public.can_manage_branch(branch_id)
  )
);

do $$
begin
  alter publication supabase_realtime add table public.stock_movements;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.bag_shift_sessions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.bag_allocations;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.sales_receipts;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.sales_receipt_items;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.report_snapshots;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.operation_days;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.inventory_reports;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.supply_requests;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.employee_kpi_targets;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
