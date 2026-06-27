drop policy if exists "branch users delete movements" on public.stock_movements;

create policy "branch users delete movements" on public.stock_movements
for delete to authenticated using (
  branch_id = (public.current_profile()).branch_id
  or (public.current_profile()).role in ('admin', 'manager')
);
