begin transaction read only;
select
  id, branch_id, report_date, created_at,
  payload -> 'summary' ->> 'revenue' as snapshot_revenue,
  payload -> 'summary' ->> 'totalSold' as snapshot_total_sold
from public.report_snapshots
where branch_id = 'lotte-vt'
  and report_date >= current_date - 3
order by report_date desc, created_at desc;
rollback;
