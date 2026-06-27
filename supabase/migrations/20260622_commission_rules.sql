-- Gắn doanh số với tài khoản nhân viên và chính sách KPI/hoa hồng theo chi nhánh.

alter table public.bag_allocations
add column if not exists employee_id uuid references public.profiles(id);

create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null unique references public.branches(id) on delete cascade,
  target_quantity numeric(14,2) not null default 50 check (target_quantity > 0),
  commission_per_unit numeric(14,2) not null default 1000 check (commission_per_unit >= 0),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.commission_rules enable row level security;

create policy "managers read commission rules" on public.commission_rules
for select to authenticated using (public.can_manage_branch(branch_id));

create policy "managers update commission rules" on public.commission_rules
for all to authenticated using (
  (public.current_profile()).role = 'manager'
  and public.can_manage_branch(branch_id)
) with check (
  (public.current_profile()).role = 'manager'
  and public.can_manage_branch(branch_id)
);

insert into public.commission_rules (branch_id, target_quantity, commission_per_unit)
select id, 50, 1000 from public.branches
on conflict (branch_id) do nothing;
