-- Chấm công & đăng ký ca làm.
-- Tái sử dụng auth.users, profiles và branches hiện có.

create type public.shift_registration_status as enum ('pending', 'approved', 'rejected');

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches(id) on delete cascade,
  name text not null,
  start_time time not null,
  end_time time not null,
  grace_minutes integer not null default 5 check (grace_minutes between 0 and 120),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (branch_id, name)
);

create table public.manager_branch_assignments (
  manager_id uuid not null references public.profiles(id) on delete cascade,
  branch_id text not null references public.branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (manager_id, branch_id)
);

create table public.shift_registrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  branch_id text not null references public.branches(id),
  shift_id uuid references public.shifts(id),
  work_date date not null,
  start_time time not null,
  end_time time not null,
  status public.shift_registration_status not null default 'pending',
  note text not null default '',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  check (end_time <> start_time),
  unique (user_id, work_date, start_time, end_time)
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  branch_id text not null references public.branches(id),
  shift_registration_id uuid not null references public.shift_registrations(id) on delete cascade,
  check_in_time timestamptz not null,
  check_out_time timestamptz,
  selfie_url text not null check (length(trim(selfie_url)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (check_out_time is null or check_out_time >= check_in_time),
  unique (shift_registration_id)
);

create index shift_registrations_branch_date_idx on public.shift_registrations(branch_id, work_date desc);
create index shift_registrations_user_date_idx on public.shift_registrations(user_id, work_date desc);
create index attendance_records_branch_checkin_idx on public.attendance_records(branch_id, check_in_time desc);
create index attendance_records_user_checkin_idx on public.attendance_records(user_id, check_in_time desc);

create or replace function public.can_manage_branch(p_branch_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    (public.current_profile()).role = 'admin'
    or (
      (public.current_profile()).role = 'shift_leader'
      and (public.current_profile()).branch_id = p_branch_id
    )
    or (
      (public.current_profile()).role = 'manager'
      and (
        (public.current_profile()).branch_id = p_branch_id
        or exists (
          select 1 from public.manager_branch_assignments mba
          where mba.manager_id = auth.uid() and mba.branch_id = p_branch_id
        )
      )
    )
$$;

alter table public.shifts enable row level security;
alter table public.manager_branch_assignments enable row level security;
alter table public.shift_registrations enable row level security;
alter table public.attendance_records enable row level security;

create policy "users read available shifts" on public.shifts for select to authenticated
using (active and (branch_id = (public.current_profile()).branch_id or public.can_manage_branch(branch_id)));
create policy "managers manage shifts" on public.shifts for all to authenticated
using (public.can_manage_branch(branch_id)) with check (public.can_manage_branch(branch_id));

create policy "read manager branch assignments" on public.manager_branch_assignments for select to authenticated
using (manager_id = auth.uid() or (public.current_profile()).role = 'admin');
create policy "admin manages branch assignments" on public.manager_branch_assignments for all to authenticated
using ((public.current_profile()).role = 'admin') with check ((public.current_profile()).role = 'admin');

create policy "employee reads own registrations" on public.shift_registrations for select to authenticated
using (user_id = auth.uid() or public.can_manage_branch(branch_id));
create policy "employee registers own shift" on public.shift_registrations for insert to authenticated
with check (
  user_id = auth.uid()
  and status = 'pending'
  and (
    branch_id = (public.current_profile()).branch_id
    or exists (
      select 1 from public.manager_branch_assignments
      where manager_id = auth.uid() and branch_id = shift_registrations.branch_id
    )
  )
);
create policy "managers review registrations" on public.shift_registrations for update to authenticated
using (public.can_manage_branch(branch_id)) with check (public.can_manage_branch(branch_id));

create policy "employee reads own attendance" on public.attendance_records for select to authenticated
using (user_id = auth.uid() or public.can_manage_branch(branch_id));
create policy "employee checks in" on public.attendance_records for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.shift_registrations sr
    where sr.id = shift_registration_id
      and sr.user_id = auth.uid()
      and sr.branch_id = attendance_records.branch_id
      and sr.status = 'approved'
  )
);
create policy "employee checks out" on public.attendance_records for update to authenticated
using (user_id = auth.uid() or public.can_manage_branch(branch_id))
with check (user_id = auth.uid() or public.can_manage_branch(branch_id));

drop policy if exists "read own profile" on public.profiles;
create policy "read permitted profiles" on public.profiles for select to authenticated
using (
  id = auth.uid()
  or (public.current_profile()).role = 'admin'
  or (
    (public.current_profile()).role = 'manager'
    and (
      branch_id = (public.current_profile()).branch_id
      or exists (
        select 1 from public.manager_branch_assignments mba
        where mba.manager_id = auth.uid() and mba.branch_id = profiles.branch_id
      )
    )
  )
  or (
    (public.current_profile()).role = 'shift_leader'
    and branch_id = (public.current_profile()).branch_id
  )
);

insert into storage.buckets (id, name, public)
values ('attendance-selfies', 'attendance-selfies', false)
on conflict (id) do nothing;

create policy "employee uploads own attendance selfie" on storage.objects for insert to authenticated
with check (
  bucket_id = 'attendance-selfies'
  and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "attendance selfie permitted read" on storage.objects for select to authenticated
using (
  bucket_id = 'attendance-selfies'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (public.current_profile()).role = 'admin'
    or (
      (public.current_profile()).role = 'manager'
      and public.can_manage_branch((storage.foldername(name))[2])
    )
  )
);

insert into public.shifts (branch_id, name, start_time, end_time, grace_minutes)
select b.id, seed.name, seed.start_time::time, seed.end_time::time, 5
from public.branches b
cross join (values
  ('Ca sáng', '08:00', '16:00'),
  ('Ca chiều', '14:00', '22:00'),
  ('Ca cả ngày', '08:00', '22:00')
) as seed(name, start_time, end_time)
on conflict (branch_id, name) do nothing;
