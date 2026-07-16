with counts as (
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
),
profile_roles as (
  select role, active, count(*)::bigint as total
  from public.profiles
  group by role, active
),
receipt_ranges as (
  select branch_id, count(*)::bigint as receipts, min(business_date) as first_date, max(business_date) as last_date
  from public.sales_receipts
  group by branch_id
),
movement_ranges as (
  select branch_id, count(*)::bigint as movements, min(shift_date) as first_date, max(shift_date) as last_date
  from public.stock_movements
  group by branch_id
),
report_ranges as (
  select branch_id, count(*)::bigint as reports, min(report_date) as first_date, max(report_date) as last_date
  from public.report_snapshots
  group by branch_id
)
select jsonb_pretty(jsonb_build_object(
  'counts', (select jsonb_agg(to_jsonb(counts) order by table_name) from counts),
  'profile_roles', (select jsonb_agg(to_jsonb(profile_roles) order by role, active) from profile_roles),
  'branches', (select jsonb_agg(to_jsonb(branches) order by id) from (select id, name, active from public.branches) branches),
  'receipt_ranges', coalesce((select jsonb_agg(to_jsonb(receipt_ranges) order by branch_id) from receipt_ranges), '[]'::jsonb),
  'movement_ranges', coalesce((select jsonb_agg(to_jsonb(movement_ranges) order by branch_id) from movement_ranges), '[]'::jsonb),
  'report_ranges', coalesce((select jsonb_agg(to_jsonb(report_ranges) order by branch_id) from report_ranges), '[]'::jsonb)
)) as audit;
