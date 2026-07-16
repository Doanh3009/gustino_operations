-- Durable payroll/KPI model for fixed pay, evidence, KPI color metrics, and
-- three-tier bonus accounting. Existing payroll_entries remains compatible.

alter table public.payroll_entries
add column if not exists evidence_url text not null default '',
add column if not exists evidence_note text not null default '';

create table if not exists public.payroll_fixed (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  role text not null,
  employment_type text,
  position_title text,
  fixed_salary numeric not null default 0,
  hourly_rate_weekday numeric not null default 0,
  hourly_rate_weekend numeric not null default 0,
  lunch_allowance numeric not null default 0,
  attendance_allowance numeric not null default 0,
  responsibility_allowance numeric not null default 0,
  parking_allowance numeric not null default 0,
  max_late_count_for_attendance_allowance integer not null default 3,
  active boolean not null default true,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (branch_id, role, employment_type, position_title)
);

insert into public.payroll_fixed (
  branch_id,
  role,
  employment_type,
  position_title,
  fixed_salary,
  hourly_rate_weekday,
  hourly_rate_weekend,
  lunch_allowance,
  attendance_allowance,
  responsibility_allowance,
  parking_allowance
)
values
  ('gold-coast', 'shift_leader', 'leader', 'Ca trưởng', 6500000, 0, 0, 700000, 500000, 500000, 500000),
  ('lotte-vt', 'shift_leader', 'leader', 'Ca trưởng', 6500000, 0, 0, 700000, 500000, 500000, 500000),
  ('lotte-2310', 'shift_leader', 'leader', 'Ca trưởng', 6500000, 0, 0, 700000, 500000, 500000, 500000),
  ('gold-coast', 'staff', 'part_time', 'PG Part-time', 0, 28000, 32000, 0, 0, 0, 0),
  ('lotte-vt', 'staff', 'part_time', 'PG Part-time', 0, 28000, 32000, 0, 0, 0, 0),
  ('lotte-2310', 'staff', 'part_time', 'PG Part-time', 0, 28000, 32000, 0, 0, 0, 0)
on conflict (branch_id, role, employment_type, position_title) do update
set fixed_salary = excluded.fixed_salary,
    hourly_rate_weekday = excluded.hourly_rate_weekday,
    hourly_rate_weekend = excluded.hourly_rate_weekend,
    lunch_allowance = excluded.lunch_allowance,
    attendance_allowance = excluded.attendance_allowance,
    responsibility_allowance = excluded.responsibility_allowance,
    parking_allowance = excluded.parking_allowance,
    updated_at = now();

create table if not exists public.payroll_kpi_metrics (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  employee_id uuid references public.profiles(id) on delete set null,
  employee_key text not null,
  metric_date date not null,
  metric_type text not null check (metric_type in ('revenue', 'conversion', 'wastage', 'service_score')),
  actual_value numeric not null default 0,
  target_value numeric not null default 0,
  progress numeric generated always as (
    case
      when target_value = 0 then 0
      when metric_type = 'wastage' then 100 - greatest(0, actual_value - target_value)
      else actual_value / nullif(target_value, 0) * 100
    end
  ) stored,
  color text not null check (color in ('green', 'yellow', 'red')),
  source text not null default 'system',
  evidence_url text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (branch_id, employee_key, metric_date, metric_type)
);

create table if not exists public.payroll_bonus_ledger (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  employee_id uuid references public.profiles(id) on delete set null,
  employee_key text not null,
  period text not null,
  bonus_date date,
  tier text not null check (tier in ('daily', 'weekly', 'monthly')),
  amount numeric not null default 0,
  reason text not null default '',
  evidence_url text not null default '',
  evidence_note text not null default '',
  source_report_id uuid references public.report_snapshots(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (branch_id, employee_key, period, tier, bonus_date, reason)
);

alter table public.payroll_fixed enable row level security;
alter table public.payroll_kpi_metrics enable row level security;
alter table public.payroll_bonus_ledger enable row level security;

drop policy if exists "managers manage payroll fixed" on public.payroll_fixed;
create policy "managers manage payroll fixed" on public.payroll_fixed
  for all to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

drop policy if exists "branch users read own visible kpi metrics" on public.payroll_kpi_metrics;
create policy "branch users read own visible kpi metrics" on public.payroll_kpi_metrics
  for select to authenticated
  using (
    public.can_manage_branch(branch_id)
    or employee_id = auth.uid()
    or (
      (public.current_profile()).role = 'shift_leader'
      and (public.current_profile()).branch_id = branch_id
    )
  );

drop policy if exists "managers manage kpi metrics" on public.payroll_kpi_metrics;
create policy "managers manage kpi metrics" on public.payroll_kpi_metrics
  for all to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

drop policy if exists "employees read own payroll bonuses" on public.payroll_bonus_ledger;
create policy "employees read own payroll bonuses" on public.payroll_bonus_ledger
  for select to authenticated
  using (public.can_manage_branch(branch_id) or employee_id = auth.uid());

drop policy if exists "managers manage payroll bonuses" on public.payroll_bonus_ledger;
create policy "managers manage payroll bonuses" on public.payroll_bonus_ledger
  for all to authenticated
  using (public.can_manage_branch(branch_id))
  with check (public.can_manage_branch(branch_id));

notify pgrst, 'reload schema';
