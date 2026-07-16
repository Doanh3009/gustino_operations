-- Bảng lương theo từng tháng + lương mặc định theo vai trò.
-- Quản lý (can_manage_branch) toàn quyền trong chi nhánh mình phụ trách.

create table if not exists public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  period text not null,                       -- 'YYYY-MM'
  hourly_rate numeric,                         -- null = dùng lương mặc định theo vai trò
  fixed_salary numeric,                        -- null = dùng lương mặc định theo vai trò
  bonus numeric not null default 0,
  deduction numeric not null default 0,
  note text not null default '',
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (employee_id, period)
);

create index if not exists payroll_entries_period_branch_idx
  on public.payroll_entries (period, branch_id);

alter table public.payroll_entries enable row level security;

drop policy if exists "managers manage payroll entries" on public.payroll_entries;
create policy "managers manage payroll entries" on public.payroll_entries
  for all to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

create table if not exists public.payroll_role_defaults (
  branch_id text not null,
  role text not null,
  hourly_rate numeric not null default 0,
  fixed_salary numeric not null default 0,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (branch_id, role)
);

alter table public.payroll_role_defaults enable row level security;

drop policy if exists "managers manage payroll role defaults" on public.payroll_role_defaults;
create policy "managers manage payroll role defaults" on public.payroll_role_defaults
  for all to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

notify pgrst, 'reload schema';
