-- Đơn xin nghỉ việc.
--
-- Nhân viên, Ca trưởng và Ca phó tự nộp đơn trong app. Quản lý/Admin và
-- CA TRƯỞNG CỦA CHÍNH CHI NHÁNH ĐÓ đọc được để chủ động xếp lịch thay người;
-- ca trưởng chi nhánh khác không đọc được đơn của chi nhánh này.
--
-- Quyết định (duyệt/từ chối) chỉ Admin/Quản lý ghi được. Người nộp được rút
-- đơn của chính mình khi đơn còn ở trạng thái chờ.

create table if not exists public.resignation_requests (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches(id),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  employee_name text not null default '',
  position_title text not null default '',
  -- Ngày làm việc cuối cùng mà nhân viên đề nghị.
  last_working_date date not null,
  reason text not null,
  handover_note text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'acknowledged', 'approved', 'rejected', 'withdrawn')),
  -- Ca trưởng chi nhánh bấm "Đã nắm thông tin": ghi nhận đã biết, KHÔNG phải duyệt.
  acknowledged_by uuid references public.profiles(id),
  acknowledged_at timestamptz,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resignation_requests_branch_status_idx
  on public.resignation_requests (branch_id, status, created_at desc);
create index if not exists resignation_requests_employee_idx
  on public.resignation_requests (employee_id, created_at desc);

-- Mỗi người chỉ có tối đa MỘT đơn đang mở; nộp lại phải rút/được xử lý đơn cũ trước.
create unique index if not exists resignation_requests_one_open_per_employee
  on public.resignation_requests (employee_id)
  where status in ('pending', 'acknowledged');

alter table public.resignation_requests enable row level security;

-- Ca trưởng ĐANG HOẠT ĐỘNG của đúng chi nhánh của lá đơn.
create or replace function public.is_branch_shift_leader(p_branch_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and coalesce(actor.active, true)
      and actor.role::text in ('shift_leader', 'shift_deputy')
      and actor.branch_id = p_branch_id
  );
$$;

create or replace function public.can_decide_resignation()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and coalesce(actor.active, true)
      and actor.role::text in ('admin', 'manager')
  );
$$;

drop policy if exists "read resignation requests in scope" on public.resignation_requests;
create policy "read resignation requests in scope"
  on public.resignation_requests
  for select
  to authenticated
  using (
    employee_id = auth.uid()
    or public.can_decide_resignation()
    or public.is_branch_shift_leader(branch_id)
    or exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and coalesce(actor.active, true)
        and actor.role::text = 'supmt'
    )
  );

-- Chỉ tự nộp cho CHÍNH MÌNH, đúng chi nhánh trên hồ sơ, và chỉ ở trạng thái chờ.
drop policy if exists "employees submit own resignation" on public.resignation_requests;
create policy "employees submit own resignation"
  on public.resignation_requests
  for insert
  to authenticated
  with check (
    employee_id = auth.uid()
    and status = 'pending'
    and exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and coalesce(actor.active, true)
        and actor.role::text in ('staff', 'shift_leader', 'shift_deputy')
        and actor.branch_id = resignation_requests.branch_id
    )
  );

-- Người nộp chỉ được RÚT đơn của mình khi còn chờ; không tự duyệt được.
drop policy if exists "employees withdraw own resignation" on public.resignation_requests;
create policy "employees withdraw own resignation"
  on public.resignation_requests
  for update
  to authenticated
  using (employee_id = auth.uid() and status in ('pending', 'acknowledged'))
  with check (employee_id = auth.uid() and status = 'withdrawn');

drop policy if exists "branch leaders acknowledge resignation" on public.resignation_requests;
create policy "branch leaders acknowledge resignation"
  on public.resignation_requests
  for update
  to authenticated
  using (public.is_branch_shift_leader(branch_id) and status = 'pending')
  with check (public.is_branch_shift_leader(branch_id) and status = 'acknowledged');

drop policy if exists "managers decide resignation" on public.resignation_requests;
create policy "managers decide resignation"
  on public.resignation_requests
  for update
  to authenticated
  using (public.can_decide_resignation())
  with check (public.can_decide_resignation());

revoke all on public.resignation_requests from anon;
grant select, insert, update on public.resignation_requests to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.resignation_requests;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
