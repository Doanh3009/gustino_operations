-- Sổ túi theo ca: nhận ca, phát/thu túi theo nhân viên và bàn giao.

create table public.bag_shift_sessions (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches(id),
  business_date date not null,
  sequence integer not null check (sequence > 0),
  leader_id uuid not null references public.profiles(id),
  leader_name text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  opening_balances jsonb not null default '{}'::jsonb,
  closing_balances jsonb,
  discrepancy_note text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (branch_id, business_date, sequence)
);

create unique index bag_shift_one_open_per_branch_idx
on public.bag_shift_sessions(branch_id)
where status = 'open';

create table public.bag_allocations (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches(id),
  shift_id uuid not null references public.bag_shift_sessions(id),
  employee_name text not null check (length(trim(employee_name)) > 0),
  product_id text not null references public.products(id),
  issued_quantity numeric(14,3) not null check (issued_quantity > 0),
  returned_quantity numeric(14,3) not null default 0 check (returned_quantity >= 0),
  damaged_quantity numeric(14,3) not null default 0 check (damaged_quantity >= 0),
  issued_by uuid not null references public.profiles(id),
  issued_at timestamptz not null default now(),
  settled_by uuid references public.profiles(id),
  settlement_shift_id uuid references public.bag_shift_sessions(id),
  settled_at timestamptz,
  posted_at timestamptz,
  check (returned_quantity + damaged_quantity <= issued_quantity)
);

create index bag_shift_sessions_branch_date_idx
on public.bag_shift_sessions(branch_id, business_date desc, sequence desc);

create index bag_allocations_branch_status_idx
on public.bag_allocations(branch_id, settled_at, issued_at desc);

alter table public.bag_shift_sessions enable row level security;
alter table public.bag_allocations enable row level security;

create policy "branch users read bag shifts" on public.bag_shift_sessions
for select to authenticated
using (public.can_manage_branch(branch_id));

create policy "shift leaders create bag shifts" on public.bag_shift_sessions
for insert to authenticated
with check (
  leader_id = auth.uid()
  and public.can_manage_branch(branch_id)
);

create policy "shift leaders close bag shifts" on public.bag_shift_sessions
for update to authenticated
using (public.can_manage_branch(branch_id))
with check (public.can_manage_branch(branch_id));

create policy "branch users read bag allocations" on public.bag_allocations
for select to authenticated
using (public.can_manage_branch(branch_id));

create policy "shift leaders issue bags" on public.bag_allocations
for insert to authenticated
with check (
  issued_by = auth.uid()
  and public.can_manage_branch(branch_id)
);

create policy "shift leaders settle bags" on public.bag_allocations
for update to authenticated
using (public.can_manage_branch(branch_id))
with check (public.can_manage_branch(branch_id));
