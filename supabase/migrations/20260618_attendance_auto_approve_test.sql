-- Chế độ kiểm thử: đăng ký ca được tự động duyệt.
-- Giữ nguyên các cột trạng thái để có thể bật lại quy trình duyệt sau này.

drop policy if exists "employee registers own shift" on public.shift_registrations;

update public.shift_registrations
set
  status = 'approved',
  reviewed_by = user_id,
  reviewed_at = coalesce(reviewed_at, now()),
  rejection_reason = null
where status = 'pending';

create policy "employee registers auto approved shift" on public.shift_registrations
for insert to authenticated
with check (
  user_id = auth.uid()
  and status = 'approved'
  and reviewed_by = auth.uid()
  and reviewed_at is not null
  and (
    branch_id = (public.current_profile()).branch_id
    or public.can_manage_branch(branch_id)
  )
);
