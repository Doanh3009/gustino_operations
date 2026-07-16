begin transaction read only;

with target as (
  select (timezone('Asia/Bangkok', now()))::date as business_date
),
receipt_lines as (
  select
    receipt.branch_id,
    count(distinct receipt.id)::bigint as receipts,
    count(item.id)::bigint as item_lines,
    count(item.id) filter (where item.allocation_id is not null)::bigint as linked_allocation_lines,
    coalesce(sum(item.quantity), 0) as sold_quantity,
    coalesce(sum(item.line_total), 0) as revenue
  from public.sales_receipts receipt
  join public.sales_receipt_items item on item.receipt_id = receipt.id
  cross join target
  where receipt.business_date = target.business_date
  group by receipt.branch_id
),
sessions as (
  select
    session.branch_id,
    count(*)::bigint as sessions,
    count(*) filter (where session.status = 'open')::bigint as open_sessions
  from public.bag_shift_sessions session
  cross join target
  where session.business_date = target.business_date
  group by session.branch_id
),
allocations as (
  select
    allocation.branch_id,
    count(*)::bigint as allocations,
    coalesce(sum(allocation.sold_quantity), 0) as allocated_sold_quantity
  from public.bag_allocations allocation
  cross join target
  where coalesce(
    allocation.settled_at::date,
    allocation.issued_at::date
  ) = target.business_date
  group by allocation.branch_id
),
sale_out as (
  select
    movement.branch_id,
    count(*)::bigint as sale_out_lines,
    coalesce(sum(movement.quantity), 0) as sale_out_quantity
  from public.stock_movements movement
  cross join target
  where movement.shift_date = target.business_date
    and movement.movement_type = 'sale_out'
  group by movement.branch_id
)
select jsonb_pretty(jsonb_build_object(
  'business_date', (select business_date from target),
  'receipt_lines', coalesce((select jsonb_agg(to_jsonb(receipt_lines) order by branch_id) from receipt_lines), '[]'::jsonb),
  'sessions', coalesce((select jsonb_agg(to_jsonb(sessions) order by branch_id) from sessions), '[]'::jsonb),
  'allocations', coalesce((select jsonb_agg(to_jsonb(allocations) order by branch_id) from allocations), '[]'::jsonb),
  'sale_out', coalesce((select jsonb_agg(to_jsonb(sale_out) order by branch_id) from sale_out), '[]'::jsonb)
)) as sale_out_link_audit;

rollback;
