select
  s.branch_id,
  s.id as session_id,
  s.business_date,
  s.sequence,
  s.status,
  s.started_at,
  s.ended_at,
  count(a.id) as allocations,
  count(a.id) filter (where coalesce(a.sold_quantity, 0) > 0) as sold_allocations,
  count(a.id) filter (where a.posted_at is null and coalesce(a.sold_quantity, 0) > 0) as sold_unposted,
  coalesce(sum(a.sold_quantity) filter (where a.posted_at is null), 0) as unposted_sold_qty,
  count(m.id) filter (where m.movement_type = 'sale_out') as sale_movements,
  count(m.id) filter (where m.movement_type = 'count') as count_movements
from public.bag_shift_sessions s
left join public.bag_allocations a on a.shift_id = s.id
left join public.stock_movements m on m.document_id = s.id
where s.started_at >= now() - interval '14 days'
group by s.branch_id, s.id, s.business_date, s.sequence, s.status, s.started_at, s.ended_at
order by s.status desc, s.started_at desc
limit 50;
