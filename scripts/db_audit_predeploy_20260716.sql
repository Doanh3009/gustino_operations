begin transaction read only;

with target as (
  select (timezone('Asia/Bangkok', now()))::date as business_date
),
counts as (
  select 'profiles' as name, count(*)::bigint as total from public.profiles
  union all select 'attendance_records', count(*)::bigint from public.attendance_records
  union all select 'shift_registrations', count(*)::bigint from public.shift_registrations
  union all select 'sales_receipts', count(*)::bigint from public.sales_receipts
  union all select 'sales_receipt_items', count(*)::bigint from public.sales_receipt_items
  union all select 'stock_movements', count(*)::bigint from public.stock_movements
  union all select 'inventory_reports', count(*)::bigint from public.inventory_reports
  union all select 'bag_shift_sessions', count(*)::bigint from public.bag_shift_sessions
),
today_receipts as (
  select receipt.branch_id, count(*)::bigint as receipts, coalesce(sum(receipt.total_amount), 0) as revenue
  from public.sales_receipts receipt, target
  where receipt.business_date = target.business_date
  group by receipt.branch_id
),
today_inventory as (
  select
    movement.branch_id,
    count(*)::bigint as movements,
    count(*) filter (where movement.movement_type = 'sale_out')::bigint as sale_out_lines,
    max(movement.created_at) as latest_at
  from public.stock_movements movement, target
  where movement.shift_date = target.business_date
  group by movement.branch_id
),
today_attendance as (
  select
    attendance.branch_id,
    count(*)::bigint as records,
    count(*) filter (where attendance.check_out_time is null)::bigint as open_records,
    max(attendance.updated_at) as latest_at
  from public.attendance_records attendance, target
  where (attendance.check_in_time at time zone 'Asia/Bangkok')::date = target.business_date
  group by attendance.branch_id
),
required_realtime(table_name) as (
  values
    ('attendance_records'),
    ('shift_registrations'),
    ('sales_receipts'),
    ('sales_receipt_items'),
    ('bag_allocations'),
    ('bag_shift_sessions'),
    ('stock_movements'),
    ('inventory_reports')
),
realtime_status as (
  select
    required.table_name,
    exists (
      select 1
      from pg_publication_tables publication
      where publication.pubname = 'supabase_realtime'
        and publication.schemaname = 'public'
        and publication.tablename = required.table_name
    ) as published
  from required_realtime required
)
select jsonb_pretty(jsonb_build_object(
  'business_date', (select business_date from target),
  'counts', (select jsonb_object_agg(name, total) from counts),
  'today_receipts', coalesce((select jsonb_agg(to_jsonb(today_receipts) order by branch_id) from today_receipts), '[]'::jsonb),
  'today_inventory', coalesce((select jsonb_agg(to_jsonb(today_inventory) order by branch_id) from today_inventory), '[]'::jsonb),
  'today_attendance', coalesce((select jsonb_agg(to_jsonb(today_attendance) order by branch_id) from today_attendance), '[]'::jsonb),
  'realtime', (select jsonb_object_agg(table_name, published) from realtime_status),
  'admin_attendance_rpc', to_regprocedure('public.admin_update_attendance_record(uuid,timestamp with time zone,timestamp with time zone,text)') is not null,
  'active_session_policy', exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'active_user_sessions'
      and policyname = 'admin or owner reads active sessions'
  )
)) as predeploy_audit;

rollback;
