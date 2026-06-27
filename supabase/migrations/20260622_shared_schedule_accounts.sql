-- Bảng đăng ký ca chung theo chi nhánh và dữ liệu quản lý tài khoản.

alter table public.shifts
add column if not exists recommended_staff integer not null default 3
check (recommended_staff between 1 and 50);

alter table public.profiles
add column if not exists email text,
add column if not exists active boolean not null default true;

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and p.email is null;

create unique index if not exists profiles_email_lower_unique
on public.profiles (lower(email))
where email is not null and active = true;

drop policy if exists "employee reads own registrations" on public.shift_registrations;
drop policy if exists "branch users read shared registrations" on public.shift_registrations;

create policy "branch users read shared registrations" on public.shift_registrations
for select to authenticated using (
  branch_id = (public.current_profile()).branch_id
  or public.can_manage_branch(branch_id)
);

