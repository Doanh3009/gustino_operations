alter type public.app_role add value if not exists 'kitchen';

do $$
begin
  create type public.supply_request_status as enum ('pending', 'acknowledged', 'fulfilled', 'cancelled');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.supply_requests (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches(id),
  product_name text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null default 'kg',
  note text not null default '',
  requested_by uuid references auth.users(id),
  requested_by_name text not null default '',
  status public.supply_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists supply_requests_branch_created_idx
  on public.supply_requests(branch_id, created_at desc);

alter table public.supply_requests enable row level security;

drop policy if exists "branch users read supply requests" on public.supply_requests;
create policy "branch users read supply requests" on public.supply_requests
for select to authenticated using (
  branch_id = (public.current_profile()).branch_id
  or (public.current_profile()).role in ('admin', 'manager')
);

drop policy if exists "shift leaders create supply requests" on public.supply_requests;
create policy "shift leaders create supply requests" on public.supply_requests
for insert to authenticated with check (
  requested_by = auth.uid()
  and (
    (public.current_profile()).role in ('shift_leader', 'manager', 'admin')
  )
  and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('manager', 'admin')
  )
);

drop policy if exists "kitchen users update supply requests" on public.supply_requests;
create policy "kitchen users update supply requests" on public.supply_requests
for update to authenticated using (
  (
    (public.current_profile()).role::text = 'kitchen'
    and branch_id = (public.current_profile()).branch_id
  )
  or (public.current_profile()).role in ('admin', 'manager')
) with check (
  (
    (public.current_profile()).role::text = 'kitchen'
    and branch_id = (public.current_profile()).branch_id
  )
  or (public.current_profile()).role in ('admin', 'manager')
);

do $$
begin
  alter publication supabase_realtime add table public.supply_requests;
exception
  when duplicate_object then null;
end $$;
