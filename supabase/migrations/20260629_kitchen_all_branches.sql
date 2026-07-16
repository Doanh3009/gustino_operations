-- Kitchen accounts receive and update orders for every branch.
-- The profile.branch_id value is only a legacy fallback and must not limit kitchen scope.

drop policy if exists "branch users read supply requests" on public.supply_requests;
create policy "branch users read supply requests" on public.supply_requests
for select to authenticated using (
  branch_id = (public.current_profile()).branch_id
  or (public.current_profile()).role in ('admin', 'manager', 'kitchen')
);

drop policy if exists "kitchen users update supply requests" on public.supply_requests;
create policy "kitchen users update supply requests" on public.supply_requests
for update to authenticated using (
  (public.current_profile()).role in ('admin', 'manager', 'kitchen')
) with check (
  (public.current_profile()).role in ('admin', 'manager', 'kitchen')
);

notify pgrst, 'reload schema';
