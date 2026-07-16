begin transaction read only;

with
target as (
  select date '2026-07-15' as business_date
),
active_branches as (
  select id
  from public.branches
  where active is distinct from false
),
receipt_summary as (
  select
    branch_id,
    count(*)::bigint as receipts,
    coalesce(sum(total_quantity), 0) as quantity,
    coalesce(sum(total_amount), 0) as revenue
  from public.sales_receipts receipt, target
  where receipt.business_date = target.business_date
  group by branch_id
),
movement_summary as (
  select branch_id, count(*)::bigint as movements
  from public.stock_movements movement, target
  where movement.shift_date = target.business_date
  group by branch_id
),
session_summary as (
  select
    branch_id,
    count(*)::bigint as sessions,
    count(*) filter (where status = 'open')::bigint as open_sessions,
    count(*) filter (where status = 'closed')::bigint as closed_sessions
  from public.bag_shift_sessions session, target
  where session.business_date = target.business_date
  group by branch_id
),
attendance_summary as (
  select
    branch_id,
    count(*)::bigint as attendance_records,
    count(*) filter (where check_out_time is null)::bigint as open_attendance
  from public.attendance_records attendance, target
  where (attendance.check_in_time at time zone 'Asia/Bangkok')::date = target.business_date
  group by branch_id
),
registration_summary as (
  select branch_id, count(*)::bigint as registrations
  from public.shift_registrations registration, target
  where registration.work_date = target.business_date
  group by branch_id
),
operation_summary as (
  select branch_id, status
  from public.operation_days operation, target
  where operation.business_date = target.business_date
),
report_summary as (
  select branch_id, count(*)::bigint as reports
  from public.report_snapshots report, target
  where report.report_date = target.business_date
  group by branch_id
),
branch_summary as (
  select
    branch.id as branch_id,
    coalesce(receipt.receipts, 0) as receipts,
    coalesce(receipt.quantity, 0) as sold_quantity,
    coalesce(receipt.revenue, 0) as revenue,
    coalesce(movement.movements, 0) as stock_movements,
    coalesce(session.sessions, 0) as sessions,
    coalesce(session.open_sessions, 0) as open_sessions,
    coalesce(session.closed_sessions, 0) as closed_sessions,
    coalesce(attendance.attendance_records, 0) as attendance_records,
    coalesce(attendance.open_attendance, 0) as open_attendance,
    coalesce(registration.registrations, 0) as registrations,
    operation.status as operation_status,
    coalesce(report.reports, 0) as report_snapshots
  from active_branches branch
  left join receipt_summary receipt on receipt.branch_id = branch.id
  left join movement_summary movement on movement.branch_id = branch.id
  left join session_summary session on session.branch_id = branch.id
  left join attendance_summary attendance on attendance.branch_id = branch.id
  left join registration_summary registration on registration.branch_id = branch.id
  left join operation_summary operation on operation.branch_id = branch.id
  left join report_summary report on report.branch_id = branch.id
)
select jsonb_pretty(jsonb_build_object(
  'business_date', (select business_date from target),
  'database_now', now(),
  'branches', coalesce((select jsonb_agg(to_jsonb(branch_summary) order by branch_id) from branch_summary), '[]'::jsonb),
  'required_tables', jsonb_build_object(
    'sales_receipts', to_regclass('public.sales_receipts') is not null,
    'stock_movements', to_regclass('public.stock_movements') is not null,
    'bag_shift_sessions', to_regclass('public.bag_shift_sessions') is not null,
    'attendance_records', to_regclass('public.attendance_records') is not null,
    'shift_registrations', to_regclass('public.shift_registrations') is not null,
    'operation_days', to_regclass('public.operation_days') is not null,
    'report_snapshots', to_regclass('public.report_snapshots') is not null
  )
)) as today_sync_audit;

rollback;
