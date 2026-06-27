-- POS receipts persisted in Supabase. Bag quantities are still tracked by
-- bag_allocations.sold_quantity; these tables preserve the customer invoice.

create table if not exists public.sales_receipts (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  branch_id text not null references public.branches(id),
  business_date date not null default current_date,
  seller_id uuid references auth.users(id),
  seller_name text not null,
  payment_method text not null default 'cash' check (payment_method in ('cash', 'qr', 'card')),
  total_quantity numeric(14,3) not null default 0 check (total_quantity >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.sales_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.sales_receipts(id) on delete cascade,
  allocation_id uuid references public.bag_allocations(id),
  product_id text not null references public.products(id),
  product_name text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  line_total numeric(14,2) not null default 0 check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists sales_receipts_branch_date_idx
on public.sales_receipts(branch_id, business_date desc, created_at desc);

create index if not exists sales_receipts_seller_date_idx
on public.sales_receipts(seller_id, business_date desc, created_at desc);

create index if not exists sales_receipt_items_receipt_idx
on public.sales_receipt_items(receipt_id);

alter table public.sales_receipts enable row level security;
alter table public.sales_receipt_items enable row level security;

drop policy if exists "branch users read sales receipts" on public.sales_receipts;
create policy "branch users read sales receipts" on public.sales_receipts
for select to authenticated using (
  branch_id = (public.current_profile()).branch_id
  or public.can_manage_branch(branch_id)
);

drop policy if exists "branch users create sales receipts" on public.sales_receipts;
create policy "branch users create sales receipts" on public.sales_receipts
for insert to authenticated with check (
  created_by = auth.uid()
  and (
    branch_id = (public.current_profile()).branch_id
    or public.can_manage_branch(branch_id)
  )
);

drop policy if exists "branch users read sales receipt items" on public.sales_receipt_items;
create policy "branch users read sales receipt items" on public.sales_receipt_items
for select to authenticated using (
  exists (
    select 1 from public.sales_receipts r
    where r.id = receipt_id
      and (
        r.branch_id = (public.current_profile()).branch_id
        or public.can_manage_branch(r.branch_id)
      )
  )
);

drop policy if exists "branch users create sales receipt items" on public.sales_receipt_items;
create policy "branch users create sales receipt items" on public.sales_receipt_items
for insert to authenticated with check (
  exists (
    select 1 from public.sales_receipts r
    where r.id = receipt_id
      and r.created_by = auth.uid()
      and (
        r.branch_id = (public.current_profile()).branch_id
        or public.can_manage_branch(r.branch_id)
      )
  )
);

do $$
begin
  alter publication supabase_realtime add table public.sales_receipts;
exception
  when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
