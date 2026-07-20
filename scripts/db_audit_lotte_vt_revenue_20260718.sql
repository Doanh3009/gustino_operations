begin transaction read only;

select current_timestamp as audited_at;

select
  business_date,
  count(*) as receipt_count,
  sum(total_amount) as header_revenue,
  min(created_at) as first_receipt_at,
  max(created_at) as last_receipt_at
from public.sales_receipts
where branch_id = 'lotte-vt'
  and business_date >= current_date - 14
group by business_date
order by business_date desc;

select
  r.business_date,
  count(distinct r.id) as receipts,
  count(i.id) as item_lines,
  sum(r.total_amount) as repeated_header_total,
  sum(i.quantity * i.unit_price) as item_revenue
from public.sales_receipts r
left join public.sales_receipt_items i on i.receipt_id = r.id
where r.branch_id = 'lotte-vt'
  and r.business_date >= current_date - 14
group by r.business_date
order by r.business_date desc;

select
  r.id,
  r.code as receipt_code,
  r.business_date,
  r.created_at,
  r.seller_id,
  r.seller_name,
  r.total_amount,
  coalesce(sum(i.quantity * i.unit_price), 0) as item_total
from public.sales_receipts r
left join public.sales_receipt_items i on i.receipt_id = r.id
where r.branch_id = 'lotte-vt'
  and r.business_date >= current_date - 3
group by r.id
order by r.business_date desc, r.created_at desc;

select
  business_date,
  count(*) as receipt_count,
  sum(total_quantity) as sold_quantity,
  sum(total_amount) as header_revenue
from public.sales_receipts
where branch_id = 'lotte-vt'
  and business_date >= current_date - 7
group by business_date
order by business_date desc;

rollback;
