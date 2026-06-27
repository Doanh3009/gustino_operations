-- Nhân viên bán hàng chỉ được dùng mô-đun chấm công.
-- Ca trưởng, quản lý và quản trị viên được dùng dữ liệu vận hành.

drop policy if exists "branch users read movements" on public.stock_movements;
drop policy if exists "branch users insert movements" on public.stock_movements;
drop policy if exists "branch users delete movements" on public.stock_movements;

create policy "operations users read movements" on public.stock_movements
for select to authenticated using (
  (public.current_profile()).role in ('admin', 'manager', 'shift_leader')
  and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('admin', 'manager')
  )
);

create policy "operations users insert movements" on public.stock_movements
for insert to authenticated with check (
  (public.current_profile()).role in ('admin', 'manager', 'shift_leader')
  and created_by = auth.uid()
  and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('admin', 'manager')
  )
);

create policy "operations users delete movements" on public.stock_movements
for delete to authenticated using (
  (public.current_profile()).role in ('admin', 'manager', 'shift_leader')
  and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('admin', 'manager')
  )
);

drop policy if exists "branch users read reports" on public.report_snapshots;
drop policy if exists "branch users insert reports" on public.report_snapshots;

create policy "operations users read reports" on public.report_snapshots
for select to authenticated using (
  (public.current_profile()).role in ('admin', 'manager', 'shift_leader')
  and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('admin', 'manager')
  )
);

create policy "operations users insert reports" on public.report_snapshots
for insert to authenticated with check (
  (public.current_profile()).role in ('admin', 'manager', 'shift_leader')
  and created_by = auth.uid()
  and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('admin', 'manager')
  )
);

drop policy if exists "branch users read inventory reports" on public.inventory_reports;
drop policy if exists "branch users insert inventory reports" on public.inventory_reports;

create policy "operations users read inventory reports" on public.inventory_reports
for select to authenticated using (
  (public.current_profile()).role in ('admin', 'manager', 'shift_leader')
  and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('admin', 'manager')
  )
);

create policy "operations users insert inventory reports" on public.inventory_reports
for insert to authenticated with check (
  (public.current_profile()).role in ('admin', 'manager', 'shift_leader')
  and created_by = auth.uid()
  and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('admin', 'manager')
  )
);

drop policy if exists "branch users read operation days" on public.operation_days;
drop policy if exists "branch users insert operation days" on public.operation_days;
drop policy if exists "branch users update operation days" on public.operation_days;

create policy "operations users read operation days" on public.operation_days
for select to authenticated using (
  (public.current_profile()).role in ('admin', 'manager', 'shift_leader')
  and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('admin', 'manager')
  )
);

create policy "operations users insert operation days" on public.operation_days
for insert to authenticated with check (
  (public.current_profile()).role in ('admin', 'manager', 'shift_leader')
  and opened_by = auth.uid()
  and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('admin', 'manager')
  )
);

create policy "operations users update operation days" on public.operation_days
for update to authenticated using (
  (public.current_profile()).role in ('admin', 'manager', 'shift_leader')
  and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('admin', 'manager')
  )
) with check (
  (public.current_profile()).role in ('admin', 'manager', 'shift_leader')
  and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('admin', 'manager')
  )
);
