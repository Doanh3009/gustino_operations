create unique index if not exists report_snapshots_one_per_branch_day_idx
on public.report_snapshots(branch_id, report_date);

drop policy if exists "shift leaders update shift reports" on public.report_snapshots;
create policy "shift leaders update shift reports" on public.report_snapshots
for update to authenticated
using (
  (public.current_profile()).role = 'shift_leader'
  and branch_id = (public.current_profile()).branch_id
)
with check (
  (public.current_profile()).role = 'shift_leader'
  and branch_id = (public.current_profile()).branch_id
  and created_by = auth.uid()
);

do $$
begin
  alter publication supabase_realtime add table public.bag_shift_sessions;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.bag_allocations;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.stock_movements;
exception
  when duplicate_object then null;
end $$;
