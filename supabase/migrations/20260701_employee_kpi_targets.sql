-- KPI doanh thu riêng theo từng nhân viên.
-- Ca trưởng được đọc KPI trong chi nhánh để báo cáo cuối ngày tính đúng;
-- admin/quản lý được tạo và cập nhật KPI.

create table if not exists public.employee_kpi_targets (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches(id) on delete cascade,
  employee_id uuid references public.profiles(id) on delete set null,
  employee_key text not null,
  employee_name text not null default '',
  target_revenue numeric(14,2) not null default 2000000 check (target_revenue > 0),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (branch_id, employee_key)
);

create index if not exists employee_kpi_targets_branch_idx
  on public.employee_kpi_targets (branch_id);

alter table public.employee_kpi_targets enable row level security;

drop policy if exists "operations users read employee KPI targets" on public.employee_kpi_targets;
create policy "operations users read employee KPI targets" on public.employee_kpi_targets
for select to authenticated using (
  (public.current_profile()).role in ('admin', 'manager', 'shift_leader')
  and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('admin', 'manager')
  )
);

drop policy if exists "managers manage employee KPI targets" on public.employee_kpi_targets;
create policy "managers manage employee KPI targets" on public.employee_kpi_targets
for all to authenticated using (
  (public.current_profile()).role in ('admin', 'manager')
  and public.can_manage_branch(branch_id)
) with check (
  (public.current_profile()).role in ('admin', 'manager')
  and public.can_manage_branch(branch_id)
);

notify pgrst, 'reload schema';
