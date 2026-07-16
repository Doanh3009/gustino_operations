select
  p.id as manager_id,
  p.full_name as manager_name,
  p.branch_id as profile_branch_id,
  coalesce(jsonb_agg(distinct mba.branch_id) filter (where mba.branch_id is not null), '[]'::jsonb) as assigned_branch_ids
from public.profiles p
left join public.manager_branch_assignments mba on mba.manager_id = p.id
where p.role = 'manager'
group by p.id, p.full_name, p.branch_id
order by p.full_name;

select
  b.id,
  b.name,
  b.active,
  count(distinct sr.id) as receipts,
  count(distinct sm.id) as stock_movements,
  count(distinct rs.id) as report_snapshots
from public.branches b
left join public.sales_receipts sr on sr.branch_id = b.id
left join public.stock_movements sm on sm.branch_id = b.id
left join public.report_snapshots rs on rs.branch_id = b.id
group by b.id, b.name, b.active
order by b.id;
