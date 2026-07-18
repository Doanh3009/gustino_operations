-- GUSTINO Operations - PostgreSQL schema for Supabase
create extension if not exists "pgcrypto";

create type public.app_role as enum ('admin', 'manager', 'shift_leader', 'staff', 'kitchen');
create type public.stock_movement_type as enum (
  'opening', 'inbound', 'processing_out', 'processing_in',
  'packing_out', 'packing_in', 'sale_out', 'waste', 'adjustment', 'count'
);
create type public.supply_request_status as enum ('pending', 'acknowledged', 'fulfilled', 'cancelled');

create table public.branches (
  id text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.app_role not null default 'shift_leader',
  branch_id text references public.branches(id),
  created_at timestamptz not null default now()
);

create table public.products (
  id text primary key,
  sku text unique not null,
  name text not null,
  unit text not null,
  category text not null,
  low_stock numeric(14,3) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches(id),
  product_id text not null references public.products(id),
  movement_type public.stock_movement_type not null,
  quantity numeric(14,3) not null check (quantity >= 0),
  shift_date date not null default current_date,
  note text not null default '',
  source_product_id text references public.products(id),
  source_quantity numeric(14,3),
  document_id uuid,
  measured_weight_kg numeric(14,3),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.inventory_reports (
  id uuid primary key default gen_random_uuid(),
  report_no text not null,
  branch_id text not null references public.branches(id),
  report_date date not null,
  department text not null default '',
  location text not null default '',
  shift_name text not null default '',
  reporter text not null default '',
  lines jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.operation_days (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches(id),
  business_date date not null,
  status text not null check (status in ('open', 'closed')) default 'open',
  opened_by uuid not null references auth.users(id),
  opened_at timestamptz not null default now(),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  unique (branch_id, business_date)
);

create table public.report_snapshots (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches(id),
  report_date date not null,
  payload jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.supply_requests (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches(id),
  product_name text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null default 'kg',
  note text not null default '',
  requested_delivery_date date,
  requested_delivery_period text check (
    requested_delivery_period is null
    or requested_delivery_period in ('morning', 'noon', 'afternoon')
  ),
  requested_by uuid references auth.users(id),
  requested_by_name text not null default '',
  status public.supply_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stock_movements_branch_date_idx on public.stock_movements(branch_id, shift_date desc);
create index report_snapshots_branch_date_idx on public.report_snapshots(branch_id, report_date desc);
create index supply_requests_branch_created_idx on public.supply_requests(branch_id, created_at desc);

alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.report_snapshots enable row level security;
alter table public.inventory_reports enable row level security;
alter table public.operation_days enable row level security;
alter table public.supply_requests enable row level security;

create or replace function public.current_profile()
returns public.profiles
language sql stable security definer set search_path = public
as $$ select * from public.profiles where id = auth.uid() $$;

create policy "authenticated read branches" on public.branches for select to authenticated using (true);
create policy "authenticated read products" on public.products for select to authenticated using (true);
create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid());

create policy "branch users read supply requests" on public.supply_requests
for select to authenticated using (
  branch_id = (public.current_profile()).branch_id
  or (public.current_profile()).role in ('admin', 'manager')
);
create policy "shift leaders create supply requests" on public.supply_requests
for insert to authenticated with check (
  requested_by = auth.uid()
  and (public.current_profile()).role in ('shift_leader', 'manager', 'admin')
  and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('manager', 'admin')
  )
);
create policy "kitchen users update supply requests" on public.supply_requests
for update to authenticated using (
  (
    (public.current_profile()).role = 'kitchen'
    and branch_id = (public.current_profile()).branch_id
  )
  or (public.current_profile()).role in ('admin', 'manager')
) with check (
  (
    (public.current_profile()).role = 'kitchen'
    and branch_id = (public.current_profile()).branch_id
  )
  or (public.current_profile()).role in ('admin', 'manager')
);

create policy "branch users read movements" on public.stock_movements
for select to authenticated using (
  branch_id = (public.current_profile()).branch_id
  or (public.current_profile()).role in ('admin', 'manager')
);
create policy "branch users insert movements" on public.stock_movements
for insert to authenticated with check (
  created_by = auth.uid() and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('admin', 'manager')
  )
);
create policy "branch users delete movements" on public.stock_movements
for delete to authenticated using (
  branch_id = (public.current_profile()).branch_id
  or (public.current_profile()).role in ('admin', 'manager')
);

create or replace function public.create_stock_movements_checked(p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  requested record;
  available_qty numeric;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Phiếu không có dòng dữ liệu';
  end if;

  for requested in
    with item_rows as (
      select
        item->>'branch_id' as branch_id,
        item->>'product_id' as product_id,
        item->>'movement_type' as movement_type,
        (item->>'quantity')::numeric as quantity
      from jsonb_array_elements(p_items) item
    ),
    outgoing as (
      select branch_id, product_id, sum(quantity) as requested_qty
      from item_rows
      where movement_type in ('processing_out', 'packing_out', 'sale_out')
      group by branch_id, product_id
    ),
    incoming as (
      select branch_id, product_id, sum(quantity) as incoming_qty
      from item_rows
      where movement_type in ('opening', 'inbound', 'processing_in', 'packing_in', 'adjustment', 'count')
      group by branch_id, product_id
    )
    select
      outgoing.branch_id,
      outgoing.product_id,
      outgoing.requested_qty,
      coalesce(incoming.incoming_qty, 0) as incoming_qty
    from outgoing
    left join incoming using (branch_id, product_id)
  loop
    perform pg_advisory_xact_lock(hashtextextended(requested.branch_id || ':' || requested.product_id, 0));

    with latest_count as (
      select quantity, created_at
      from public.stock_movements
      where branch_id = requested.branch_id
        and product_id = requested.product_id
        and movement_type = 'count'
      order by created_at desc
      limit 1
    )
    select
      case
        when exists (select 1 from latest_count) then
          (select quantity from latest_count) + coalesce(sum(
            case
              when movement_type in ('opening', 'inbound', 'processing_in', 'packing_in', 'adjustment') then quantity
              when movement_type in ('processing_out', 'packing_out', 'sale_out') then -quantity
              when movement_type = 'waste' and source_product_id is null then -quantity
              else 0
            end
          ) filter (where created_at > (select created_at from latest_count)), 0)
        else coalesce(sum(
          case
            when movement_type in ('opening', 'inbound', 'processing_in', 'packing_in', 'adjustment') then quantity
            when movement_type in ('processing_out', 'packing_out', 'sale_out') then -quantity
            when movement_type = 'waste' and source_product_id is null then -quantity
            else 0
          end
        ), 0)
      end
    into available_qty
    from public.stock_movements
    where branch_id = requested.branch_id
      and product_id = requested.product_id;

    if requested.requested_qty > available_qty + requested.incoming_qty then
      raise exception 'Không đủ tồn sản phẩm %. Khả dụng %, yêu cầu %',
        requested.product_id, available_qty + requested.incoming_qty, requested.requested_qty;
    end if;
  end loop;

  insert into public.stock_movements (
    id, branch_id, product_id, movement_type, quantity, shift_date, note,
    source_product_id, source_quantity, document_id, measured_weight_kg, created_by, created_at
  )
  select
    x.id, x.branch_id, x.product_id, x.movement_type::public.stock_movement_type,
    x.quantity, x.shift_date, coalesce(x.note, ''), x.source_product_id,
    x.source_quantity, x.document_id, x.measured_weight_kg, x.created_by, coalesce(x.created_at, now())
  from jsonb_to_recordset(p_items) as x(
    id uuid,
    branch_id text,
    product_id text,
    movement_type text,
    quantity numeric,
    shift_date date,
    note text,
    source_product_id text,
    source_quantity numeric,
    document_id uuid,
    measured_weight_kg numeric,
    created_by uuid,
    created_at timestamptz
  );
end;
$$;

grant execute on function public.create_stock_movements_checked(jsonb) to authenticated;

create policy "branch users read reports" on public.report_snapshots
for select to authenticated using (
  branch_id = (public.current_profile()).branch_id
  or (public.current_profile()).role in ('admin', 'manager')
);
create policy "branch users insert reports" on public.report_snapshots
for insert to authenticated with check (
  created_by = auth.uid() and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('admin', 'manager')
  )
);

create policy "branch users read inventory reports" on public.inventory_reports
for select to authenticated using (
  branch_id = (public.current_profile()).branch_id
  or (public.current_profile()).role in ('admin', 'manager')
);
create policy "branch users insert inventory reports" on public.inventory_reports
for insert to authenticated with check (
  created_by = auth.uid() and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('admin', 'manager')
  )
);

create policy "branch users read operation days" on public.operation_days
for select to authenticated using (
  branch_id = (public.current_profile()).branch_id
  or (public.current_profile()).role in ('admin', 'manager')
);
create policy "branch users insert operation days" on public.operation_days
for insert to authenticated with check (
  opened_by = auth.uid() and (
    branch_id = (public.current_profile()).branch_id
    or (public.current_profile()).role in ('admin', 'manager')
  )
);
create policy "branch users update operation days" on public.operation_days
for update to authenticated using (
  branch_id = (public.current_profile()).branch_id
  or (public.current_profile()).role in ('admin', 'manager')
);

insert into public.branches (id, name) values
  ('gold-coast', 'Gold Coast Nha Trang'),
  ('lotte-2310', 'Lotte Mart 23/10'),
  ('lotte-vt', 'Lotte Mart Vũng Tàu')
on conflict (id) do update set
  name = excluded.name,
  active = true;

insert into public.products (id, sku, name, unit, category, low_stock) values
  ('chestnut-roasted-bulk', 'NL-HD-RANG', 'Hạt dẻ rang', 'kg', 'raw', 10),
  ('chestnut-snow', 'NL-HD-TUYET', 'Hạt dẻ tuyết', 'kg', 'raw', 10),
  ('chestnut-fresh', 'NL-HD-TUOI', 'Hạt dẻ tươi', 'kg', 'raw', 20),
  ('chestnut-pre', 'NL-HD-SC', 'Hạt dẻ sơ chế', 'kg', 'raw', 8),
  ('potato-honey', 'NL-KL-MAT', 'Khoai lang mật', 'kg', 'raw', 10),
  ('sugar', 'NL-DUONG', 'Đường', 'kg', 'raw', 5),
  ('bag-110', 'BB-110', 'Bao bì 110g', 'cái', 'packaging', 100),
  ('bag-330', 'BB-330', 'Bao bì 330g', 'cái', 'packaging', 50),
  ('bag-500', 'BB-500', 'Bao bì 500g', 'cái', 'packaging', 50),
  ('chestnut-cooked-kg', 'BC-HD-CHIN', 'Thành phẩm hạt dẻ rang', 'kg', 'finished', 0),
  ('chestnut-snow-finished', 'BC-HD-TUYET', 'Thành phẩm hạt dẻ tuyết', 'kg', 'finished', 0),
  ('chestnut-grilled-finished', 'BC-HD-NUONG', 'Thành phẩm hạt dẻ nướng', 'kg', 'finished', 0),
  ('potato-cooked-kg', 'BC-KL-CHIN', 'Khoai lang chín chưa chia túi', 'kg', 'finished', 0),
  ('chestnut-110', 'TP-HD-110', 'Hạt dẻ rang 110g', 'túi', 'finished', 20),
  ('chestnut-330', 'TP-HD-330', 'Hạt dẻ rang 330g', 'túi', 'finished', 12),
  ('chestnut-500', 'TP-HD-500', 'Hạt dẻ rang 500g', 'túi', 'finished', 10),
  ('chestnut-1kg', 'TP-HD-1KG', 'Hạt dẻ rang 1kg', 'túi', 'finished', 5),
  ('potato-500', 'TP-KL-500', 'Khoai lang mật 500g', 'túi', 'finished', 10),
  ('potato-1kg', 'TP-KL-1KG', 'Khoai lang mật 1kg', 'túi', 'finished', 5),
  ('cake-raw', 'NL-BANH', 'Bánh hạt dẻ', 'cái', 'raw', 20),
  ('cake-ready', 'BC-BANH', 'Bánh hạt dẻ thành phẩm', 'cái', 'finished', 0),
  ('cake-box', 'TP-BANH-HOP4', 'Bánh hạt dẻ hộp 4 cái', 'hộp', 'finished', 5),
  ('chestnut-milk', 'TP-SUA-HD', 'Sữa hạt dẻ', 'chai', 'finished', 6),
  ('pepper-bun', 'TP-TIEU-LB', 'Tiêu long bao', 'phần', 'finished', 6),
  ('dumpling', 'TP-SUI-CAO', 'Sủi cảo', 'phần', 'finished', 6)
on conflict (id) do update set
  sku = excluded.sku,
  name = excluded.name,
  unit = excluded.unit,
  category = excluded.category,
  low_stock = excluded.low_stock,
  active = true;
