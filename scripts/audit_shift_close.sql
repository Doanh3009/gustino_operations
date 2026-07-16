select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef as security_definer,
  left(pg_get_functiondef(p.oid), 5000) as def
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'close_bag_shift_safe',
    'create_stock_movements_checked',
    'create_pos_receipt_with_sales',
    'record_bag_sale'
  )
order by p.proname, args;

select
  schemaname,
  tablename,
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'bag_shift_sessions',
    'bag_allocations',
    'stock_movements',
    'sales_receipts',
    'sales_receipt_items',
    'inventory_reports'
  )
order by tablename, policyname;

select
  branch_id,
  status,
  count(*) as sessions,
  max(started_at) as latest_started,
  max(ended_at) as latest_ended
from public.bag_shift_sessions
where started_at >= now() - interval '14 days'
group by branch_id, status
order by branch_id, status;

select
  s.branch_id,
  s.id as session_id,
  s.business_date,
  s.sequence,
  s.status,
  s.started_at,
  s.ended_at,
  count(a.id) as allocations,
  count(a.id) filter (where a.posted_at is null and coalesce(a.sold_quantity, 0) > 0) as sold_unposted,
  count(m.id) filter (where m.movement_type = 'sale_out') as sale_movements,
  count(m.id) filter (where m.movement_type = 'count') as count_movements
from public.bag_shift_sessions s
left join public.bag_allocations a on a.shift_id = s.id
left join public.stock_movements m on m.document_id = s.id
where s.started_at >= now() - interval '14 days'
group by s.branch_id, s.id, s.business_date, s.sequence, s.status, s.started_at, s.ended_at
order by s.started_at desc
limit 30;

select
  branch_id,
  shift_date,
  document_id,
  product_id,
  movement_type,
  count(*) as rows,
  sum(quantity) as quantity,
  min(created_at) as first_created,
  max(created_at) as last_created
from public.stock_movements
where created_at >= now() - interval '14 days'
  and document_id is not null
  and movement_type in ('sale_out', 'count', 'waste')
group by branch_id, shift_date, document_id, product_id, movement_type
having count(*) > 1
order by last_created desc
limit 50;
