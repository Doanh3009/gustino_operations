begin transaction read only;

with receipt_lines as (
  select
    r.id as receipt_id,
    r.branch_id,
    r.business_date,
    r.seller_id,
    r.seller_name,
    r.total_quantity as header_quantity,
    r.total_amount as header_amount,
    r.created_at,
    count(i.id) as line_count,
    coalesce(sum(i.quantity), 0) as line_quantity,
    coalesce(sum(i.line_total), 0) as line_amount
  from public.sales_receipts r
  left join public.sales_receipt_items i on i.receipt_id = r.id
  where r.business_date = date '2026-07-15'
  group by r.id
), payment_totals as (
  select branch_id, payment_method, count(*) as receipt_count, sum(total_amount) as revenue
  from public.sales_receipts
  where business_date = date '2026-07-15'
  group by branch_id, payment_method
), duplicate_codes as (
  select branch_id, code, count(*) as duplicate_count
  from public.sales_receipts
  where business_date = date '2026-07-15'
  group by branch_id, code
  having count(*) > 1
), invalid_line_prices as (
  select count(*) as invalid_count
  from public.sales_receipt_items i
  join public.sales_receipts r on r.id = i.receipt_id
  where r.business_date = date '2026-07-15'
    and abs(i.line_total - (i.quantity * i.unit_price)) > 0.01
), day_allocations as (
  select
    a.id,
    s.branch_id,
    s.business_date,
    coalesce(a.sold_quantity, 0) as sold_quantity
  from public.bag_allocations a
  join public.bag_shift_sessions s on s.id = a.shift_id
  where s.business_date = date '2026-07-15'
), linked_item_totals as (
  select
    i.allocation_id,
    coalesce(sum(i.quantity), 0) as receipt_quantity
  from public.sales_receipt_items i
  join public.sales_receipts r on r.id = i.receipt_id
  where r.business_date = date '2026-07-15'
    and i.allocation_id is not null
  group by i.allocation_id
), registered as (
  select distinct branch_id, user_id
  from public.shift_registrations
  where work_date = date '2026-07-15'
    and status <> 'rejected'
), checked_in as (
  select distinct branch_id, user_id
  from public.attendance_records
  where check_in_time >= timestamptz '2026-07-15 00:00:00+07'
    and check_in_time < timestamptz '2026-07-16 00:00:00+07'
), sellers as (
  select distinct branch_id, seller_id
  from public.sales_receipts
  where business_date = date '2026-07-15'
    and seller_id is not null
), seller_totals as (
  select branch_id, seller_id, seller_name, count(*) as receipt_count, sum(total_amount) as revenue
  from public.sales_receipts
  where business_date = date '2026-07-15'
  group by branch_id, seller_id, seller_name
), checked_in_without_receipts as (
  select c.branch_id, p.full_name, p.role
  from checked_in c
  join public.profiles p on p.id = c.user_id
  left join sellers s on s.branch_id = c.branch_id and s.seller_id = c.user_id
  where s.seller_id is null
), branch_ids as (
  select id as branch_id
  from public.branches
  where id in ('gold-coast', 'lotte-vt', 'lotte-2310')
), branch_audit as (
  select
    b.branch_id,
    coalesce((select count(*) from receipt_lines r where r.branch_id = b.branch_id), 0) as receipt_count,
    coalesce((select sum(r.header_quantity) from receipt_lines r where r.branch_id = b.branch_id), 0) as header_quantity,
    coalesce((select sum(r.line_quantity) from receipt_lines r where r.branch_id = b.branch_id), 0) as line_quantity,
    coalesce((select sum(r.header_amount) from receipt_lines r where r.branch_id = b.branch_id), 0) as header_revenue,
    coalesce((select sum(r.line_amount) from receipt_lines r where r.branch_id = b.branch_id), 0) as line_revenue,
    coalesce((select count(*) from receipt_lines r where r.branch_id = b.branch_id and r.line_count = 0), 0) as receipts_without_lines,
    coalesce((select count(*) from receipt_lines r where r.branch_id = b.branch_id and (abs(r.header_amount - r.line_amount) > 0.01 or abs(r.header_quantity - r.line_quantity) > 0.001)), 0) as mismatched_receipts,
    coalesce((select sum(a.sold_quantity) from day_allocations a where a.branch_id = b.branch_id), 0) as allocation_sold_quantity,
    coalesce((select sum(l.receipt_quantity) from day_allocations a join linked_item_totals l on l.allocation_id = a.id where a.branch_id = b.branch_id), 0) as linked_receipt_quantity,
    coalesce((select count(*) from day_allocations a left join linked_item_totals l on l.allocation_id = a.id where a.branch_id = b.branch_id and abs(a.sold_quantity - coalesce(l.receipt_quantity, 0)) > 0.001), 0) as mismatched_allocations,
    coalesce((select count(*) from registered r where r.branch_id = b.branch_id), 0) as registered_people,
    coalesce((select count(*) from checked_in c where c.branch_id = b.branch_id), 0) as checked_in_people,
    coalesce((select count(*) from sellers s where s.branch_id = b.branch_id), 0) as sellers_with_receipts,
    coalesce((select count(*) from checked_in c left join sellers s on s.branch_id = c.branch_id and s.seller_id = c.user_id where c.branch_id = b.branch_id and s.seller_id is null), 0) as checked_in_without_receipt,
    (select max(r.created_at) from receipt_lines r where r.branch_id = b.branch_id) as latest_receipt_at
  from branch_ids b
)
select jsonb_pretty(jsonb_build_object(
  'business_date', '2026-07-15',
  'branches', (select jsonb_agg(to_jsonb(branch_audit) order by branch_id) from branch_audit),
  'chain_header_revenue', (select coalesce(sum(header_revenue), 0) from branch_audit),
  'chain_line_revenue', (select coalesce(sum(line_revenue), 0) from branch_audit),
  'chain_difference', (select coalesce(sum(header_revenue - line_revenue), 0) from branch_audit),
  'mismatched_receipt_count', (select coalesce(sum(mismatched_receipts), 0) from branch_audit),
  'mismatched_allocation_count', (select coalesce(sum(mismatched_allocations), 0) from branch_audit),
  'duplicate_receipt_code_count', (select count(*) from duplicate_codes),
  'zero_amount_receipt_count', (select count(*) from receipt_lines where header_amount <= 0),
  'invalid_line_price_count', (select invalid_count from invalid_line_prices),
  'payment_breakdown', (
    select coalesce(jsonb_agg(to_jsonb(payment_totals) order by branch_id, payment_method), '[]'::jsonb)
    from payment_totals
  ),
  'seller_totals', (
    select coalesce(jsonb_agg(to_jsonb(seller_totals) order by branch_id, revenue desc), '[]'::jsonb)
    from seller_totals
  ),
  'checked_in_without_receipt_details', (
    select coalesce(jsonb_agg(to_jsonb(checked_in_without_receipts) order by branch_id, role, full_name), '[]'::jsonb)
    from checked_in_without_receipts
  )
)) as revenue_reconciliation;

rollback;
