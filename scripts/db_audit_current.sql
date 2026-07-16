select 'profiles' as table_name, count(*)::bigint as total from public.profiles
union all select 'branches', count(*)::bigint from public.branches
union all select 'products', count(*)::bigint from public.products
union all select 'sales_receipts', count(*)::bigint from public.sales_receipts
union all select 'sales_receipt_items', count(*)::bigint from public.sales_receipt_items
union all select 'stock_movements', count(*)::bigint from public.stock_movements
union all select 'inventory_reports', count(*)::bigint from public.inventory_reports
union all select 'report_snapshots', count(*)::bigint from public.report_snapshots
union all select 'operation_days', count(*)::bigint from public.operation_days
union all select 'bag_shift_sessions', count(*)::bigint from public.bag_shift_sessions
union all select 'bag_allocations', count(*)::bigint from public.bag_allocations
union all select 'attendance_records', count(*)::bigint from public.attendance_records
union all select 'shift_registrations', count(*)::bigint from public.shift_registrations
union all select 'schedule_entries', count(*)::bigint from public.schedule_entries
union all select 'schedule_people', count(*)::bigint from public.schedule_people
union all select 'manager_branch_assignments', count(*)::bigint from public.manager_branch_assignments
order by table_name;

select role, active, count(*)::bigint as total
from public.profiles
group by role, active
order by role, active;

select id, name, active
from public.branches
order by id;

select branch_id, count(*)::bigint as receipts, min(business_date) as first_date, max(business_date) as last_date
from public.sales_receipts
group by branch_id
order by branch_id;

select branch_id, count(*)::bigint as movements, min(shift_date) as first_date, max(shift_date) as last_date
from public.stock_movements
group by branch_id
order by branch_id;

select branch_id, count(*)::bigint as reports, min(report_date) as first_date, max(report_date) as last_date
from public.report_snapshots
group by branch_id
order by branch_id;
