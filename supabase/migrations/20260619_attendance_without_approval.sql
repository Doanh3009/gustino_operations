-- Chấm công không cần duyệt lịch làm.
-- Ca do nhân viên tự thêm có hiệu lực ngay; dữ liệu pending cũ được kích hoạt.

update public.shift_registrations
set
  status = 'approved',
  reviewed_by = null,
  reviewed_at = null,
  rejection_reason = null
where status = 'pending';

drop policy if exists "employee registers own shift" on public.shift_registrations;
drop policy if exists "employee registers auto approved shift" on public.shift_registrations;
drop policy if exists "managers review registrations" on public.shift_registrations;

create policy "employee adds own active shift" on public.shift_registrations
for insert to authenticated
with check (
  user_id = auth.uid()
  and status = 'approved'
  and (
    branch_id = (public.current_profile()).branch_id
    or public.can_manage_branch(branch_id)
  )
);

drop policy if exists "employee checks in" on public.attendance_records;

create policy "employee checks in" on public.attendance_records
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.shift_registrations sr
    where sr.id = shift_registration_id
      and sr.user_id = auth.uid()
      and sr.branch_id = attendance_records.branch_id
      and sr.status <> 'rejected'
  )
);
