-- Make POS checkout atomic: update bag allocation sales and persist the
-- internal receipt in one transaction. This prevents "sale recorded but
-- receipt missing" and keeps revenue, handover, and reports on one ledger.

create extension if not exists unaccent;

create or replace function public.normalized_vi_name(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(regexp_replace(unaccent(trim(coalesce(p_value, ''))), '\s+', ' ', 'g'))
$$;

create or replace function public.create_pos_receipt_with_sales(
  p_receipt jsonb,
  p_lines jsonb
)
returns setof public.bag_allocations
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  receipt_id uuid := (p_receipt->>'id')::uuid;
  receipt_branch text := p_receipt->>'branch_id';
  receipt_date date := (p_receipt->>'business_date')::date;
  seller_id uuid := nullif(p_receipt->>'seller_id', '')::uuid;
  seller_name text := trim(coalesce(p_receipt->>'seller_name', ''));
  payment_method text := coalesce(nullif(p_receipt->>'payment_method', ''), 'cash');
  created_at timestamptz := coalesce((p_receipt->>'created_at')::timestamptz, now());
  line jsonb;
  allocation_row public.bag_allocations%rowtype;
  updated_ids uuid[] := '{}';
  quantity numeric;
  actor_matches_name boolean;
begin
  select * into actor
  from public.profiles
  where id = auth.uid()
    and coalesce(active, true);

  if actor.id is null then
    raise exception 'Tai khoan chua san sang de tao hoa don.';
  end if;

  if receipt_branch is null or receipt_date is null or seller_name = '' then
    raise exception 'Hoa don POS thieu chi nhanh, ngay van hanh hoac nhan vien.';
  end if;

  if actor.role not in ('staff', 'shift_leader', 'manager', 'admin') then
    raise exception 'Tai khoan nay khong co quyen tao hoa don POS.';
  end if;

  if actor.role = 'staff' and actor.branch_id <> receipt_branch then
    raise exception 'Nhan vien chi duoc ban tai chi nhanh cua minh.';
  end if;

  if actor.role in ('shift_leader', 'manager', 'admin')
    and actor.branch_id <> receipt_branch
    and not public.can_manage_branch(receipt_branch) then
    raise exception 'Ban khong co quyen ban tai chi nhanh nay.';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Hoa don POS chua co mat hang.';
  end if;

  for line in select * from jsonb_array_elements(p_lines)
  loop
    quantity := (line->>'quantity')::numeric;
    if quantity is null or quantity <= 0 or quantity <> trunc(quantity) then
      raise exception 'So tui ban phai la so nguyen lon hon 0.';
    end if;

    select * into allocation_row
    from public.bag_allocations
    where id = (line->>'allocation_id')::uuid
    for update;

    if not found then
      raise exception 'Khong tim thay dong tui duoc phat.';
    end if;

    if allocation_row.branch_id <> receipt_branch then
      raise exception 'Hoa don dang tron tui khac chi nhanh.';
    end if;

    if allocation_row.product_id <> line->>'product_id' then
      raise exception 'Mat hang tren hoa don khong khop voi so tui.';
    end if;

    if allocation_row.settled_at is not null then
      raise exception 'Dong tui nay da doi soat, ca truong can sua trong ban giao.';
    end if;

    actor_matches_name := actor.branch_id = allocation_row.branch_id
      and public.normalized_vi_name(actor.full_name) = public.normalized_vi_name(allocation_row.employee_name);

    if allocation_row.employee_id is distinct from auth.uid()
      and not actor_matches_name
      and not public.can_manage_branch(allocation_row.branch_id) then
      raise exception 'Ban chi duoc ghi ban tui da phat cho tai khoan cua minh.';
    end if;

    if allocation_row.sold_quantity + quantity + allocation_row.returned_quantity + allocation_row.damaged_quantity > allocation_row.issued_quantity then
      raise exception 'So tui ban vuot qua so tui da phat.';
    end if;

    update public.bag_allocations
    set sold_quantity = sold_quantity + quantity,
        employee_id = case when actor_matches_name then auth.uid() else employee_id end
    where id = allocation_row.id
    returning * into allocation_row;

    updated_ids := array_append(updated_ids, allocation_row.id);
  end loop;

  insert into public.sales_receipts (
    id,
    code,
    branch_id,
    business_date,
    seller_id,
    seller_name,
    payment_method,
    total_quantity,
    total_amount,
    created_by,
    created_at
  )
  values (
    receipt_id,
    p_receipt->>'code',
    receipt_branch,
    receipt_date,
    seller_id,
    seller_name,
    payment_method,
    coalesce((p_receipt->>'total_quantity')::numeric, 0),
    coalesce((p_receipt->>'total_amount')::numeric, 0),
    auth.uid(),
    created_at
  );

  insert into public.sales_receipt_items (
    receipt_id,
    allocation_id,
    product_id,
    product_name,
    quantity,
    unit_price,
    line_total,
    created_at
  )
  select
    receipt_id,
    (item->>'allocation_id')::uuid,
    item->>'product_id',
    item->>'product_name',
    (item->>'quantity')::numeric,
    coalesce((item->>'unit_price')::numeric, 0),
    coalesce((item->>'line_total')::numeric, 0),
    created_at
  from jsonb_array_elements(p_lines) as item;

  return query
  select *
  from public.bag_allocations
  where id = any(updated_ids);
end;
$$;

grant execute on function public.create_pos_receipt_with_sales(jsonb, jsonb) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.sales_receipts;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.sales_receipt_items;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
