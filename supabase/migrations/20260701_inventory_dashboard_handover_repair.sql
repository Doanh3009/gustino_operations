-- Unblock branch-scoped dashboard/inventory testing for admin/manager and make
-- shift closing safe to retry after a partial failed submit.

drop policy if exists "shift leaders insert movements" on public.stock_movements;
drop policy if exists "management and shift leaders insert movements" on public.stock_movements;
create policy "management and shift leaders insert movements" on public.stock_movements
for insert to authenticated with check (
  (public.current_profile()).role in ('shift_leader', 'manager', 'admin')
  and public.can_manage_branch(branch_id)
  and created_by = auth.uid()
);

drop policy if exists "shift leaders delete movements" on public.stock_movements;
drop policy if exists "management and shift leaders delete movements" on public.stock_movements;
create policy "management and shift leaders delete movements" on public.stock_movements
for delete to authenticated using (
  (public.current_profile()).role in ('shift_leader', 'manager', 'admin')
  and public.can_manage_branch(branch_id)
);

drop policy if exists "shift leaders insert inventory reports" on public.inventory_reports;
drop policy if exists "management and shift leaders insert inventory reports" on public.inventory_reports;
create policy "management and shift leaders insert inventory reports" on public.inventory_reports
for insert to authenticated with check (
  (public.current_profile()).role in ('shift_leader', 'manager', 'admin')
  and public.can_manage_branch(branch_id)
  and created_by = auth.uid()
);

create or replace function public.create_stock_movements_checked(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requested record;
  available_qty numeric;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Phiếu không có dòng dữ liệu';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as x(
      branch_id text,
      created_by uuid
    )
    where x.created_by <> auth.uid()
      or not public.can_manage_branch(x.branch_id)
      or (public.current_profile()).role not in ('shift_leader', 'manager', 'admin')
  ) then
    raise exception 'Không có quyền ghi kho của chi nhánh này.';
  end if;

  for requested in
    with items as (
      select
        item->>'branch_id' as branch_id,
        item->>'product_id' as product_id,
        item->>'movement_type' as movement_type,
        coalesce((item->>'quantity')::numeric, 0) as quantity
      from jsonb_array_elements(p_items) as item
    ),
    outgoing as (
      select branch_id, product_id, sum(quantity) as requested_qty
      from items
      where movement_type in ('processing_out', 'packing_out', 'sale_out')
        or (movement_type = 'waste' and product_id is not null)
      group by branch_id, product_id
    ),
    incoming as (
      select branch_id, product_id, sum(quantity) as incoming_qty
      from items
      where movement_type in ('opening', 'inbound', 'processing_in', 'packing_in', 'adjustment', 'count')
      group by branch_id, product_id
    )
    select
      outgoing.branch_id,
      outgoing.product_id,
      outgoing.requested_qty,
      coalesce(incoming.incoming_qty, 0) as incoming_qty
    from outgoing
    left join incoming
      on incoming.branch_id = outgoing.branch_id
     and incoming.product_id = outgoing.product_id
  loop
    select coalesce(sum(
      case
        when movement_type in ('opening', 'inbound', 'processing_in', 'packing_in', 'adjustment') then quantity
        when movement_type in ('processing_out', 'packing_out', 'sale_out') then -quantity
        when movement_type = 'waste' and source_product_id is null then -quantity
        when movement_type = 'count' then 0
        else 0
      end
    ), 0)
    into available_qty
    from public.stock_movements
    where branch_id = requested.branch_id
      and product_id = requested.product_id;

    if requested.requested_qty > available_qty + requested.incoming_qty + 0.0001 then
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
  )
  on conflict (id) do nothing;
end;
$$;

grant execute on function public.create_stock_movements_checked(jsonb) to authenticated;

create or replace function public.close_bag_shift_safe(
  p_session_id uuid,
  p_closing_balances jsonb,
  p_discrepancy_note text,
  p_movements jsonb default '[]'::jsonb,
  p_posted_allocation_ids jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.bag_shift_sessions%rowtype;
  ended timestamptz := now();
begin
  select * into session_row
  from public.bag_shift_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'Không tìm thấy ca bàn giao.';
  end if;

  if (public.current_profile()).role not in ('shift_leader', 'manager', 'admin')
    or not public.can_manage_branch(session_row.branch_id) then
    raise exception 'Không có quyền chốt ca của chi nhánh này.';
  end if;

  if session_row.status <> 'open' then
    return;
  end if;

  if jsonb_typeof(coalesce(p_movements, '[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(p_movements, '[]'::jsonb)) > 0 then
    insert into public.stock_movements (
      id, branch_id, product_id, movement_type, quantity, shift_date, note,
      source_product_id, source_quantity, document_id, measured_weight_kg, created_by, created_at
    )
    select
      x.id,
      session_row.branch_id,
      x.product_id,
      x.movement_type::public.stock_movement_type,
      x.quantity,
      x.shift_date,
      coalesce(x.note, ''),
      x.source_product_id,
      x.source_quantity,
      coalesce(x.document_id, p_session_id),
      x.measured_weight_kg,
      auth.uid(),
      coalesce(x.created_at, ended)
    from jsonb_to_recordset(p_movements) as x(
      id uuid,
      product_id text,
      movement_type text,
      quantity numeric,
      shift_date date,
      note text,
      source_product_id text,
      source_quantity numeric,
      document_id uuid,
      measured_weight_kg numeric,
      created_at timestamptz
    )
    on conflict (id) do nothing;
  end if;

  update public.bag_shift_sessions
  set
    status = 'closed',
    closing_balances = coalesce(p_closing_balances, '{}'::jsonb),
    discrepancy_note = nullif(trim(coalesce(p_discrepancy_note, '')), ''),
    ended_at = ended
  where id = p_session_id
    and status = 'open';

  if jsonb_typeof(coalesce(p_posted_allocation_ids, '[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(p_posted_allocation_ids, '[]'::jsonb)) > 0 then
    update public.bag_allocations
    set posted_at = ended
    where id in (
      select value::uuid
      from jsonb_array_elements_text(p_posted_allocation_ids)
    )
    and posted_at is null;
  end if;
end;
$$;

grant execute on function public.close_bag_shift_safe(uuid, jsonb, text, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
