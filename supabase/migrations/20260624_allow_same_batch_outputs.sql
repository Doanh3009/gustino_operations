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
