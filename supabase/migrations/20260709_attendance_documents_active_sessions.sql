create table if not exists public.attendance_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  branch_id text not null references public.branches(id),
  kind text not null check (kind in ('late_arrival', 'early_leave')),
  work_date date not null,
  scheduled_time time not null,
  actual_time time not null,
  reason text not null default '',
  evidence_note text not null default '',
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists attendance_adjustment_requests_branch_date_idx
on public.attendance_adjustment_requests(branch_id, work_date desc, created_at desc);

alter table public.attendance_adjustment_requests enable row level security;

drop policy if exists "attendance adjustment permitted read" on public.attendance_adjustment_requests;
create policy "attendance adjustment permitted read"
on public.attendance_adjustment_requests for select to authenticated
using (
  user_id = auth.uid()
  or (public.current_profile()).role = 'admin'
  or (
    (public.current_profile()).role = 'shift_leader'
    and branch_id = (public.current_profile()).branch_id
  )
);

drop policy if exists "attendance adjustment create" on public.attendance_adjustment_requests;
create policy "attendance adjustment create"
on public.attendance_adjustment_requests for insert to authenticated
with check (
  created_by = auth.uid()
  and (
    user_id = auth.uid()
    or public.can_manage_branch(branch_id)
  )
);

create table if not exists public.active_user_sessions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  user_name text not null default '',
  role public.app_role not null,
  branch_id text references public.branches(id),
  page text not null default '',
  last_seen_at timestamptz not null default now()
);

alter table public.active_user_sessions enable row level security;

drop policy if exists "users write own active session" on public.active_user_sessions;
create policy "users write own active session"
on public.active_user_sessions for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "users update own active session" on public.active_user_sessions;
create policy "users update own active session"
on public.active_user_sessions for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "admin reads active sessions" on public.active_user_sessions;
create policy "admin reads active sessions"
on public.active_user_sessions for select to authenticated
using ((public.current_profile()).role = 'admin');
