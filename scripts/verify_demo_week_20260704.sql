select
  (
    select count(*)
    from public.shift_registrations
    where note = 'Demo week seed'
      and work_date between date '2026-06-27' and date '2026-07-03'
  ) as demo_week_registrations,
  (
    select count(*)
    from public.attendance_records record
    join public.shift_registrations registration on registration.id = record.shift_registration_id
    where registration.note = 'Demo week seed'
      and registration.work_date between date '2026-06-27' and date '2026-07-03'
  ) as demo_week_attendance_records,
  (
    select count(*)
    from public.bag_shift_sessions
    where discrepancy_note = 'Demo week seed'
      and business_date between date '2026-06-27' and date '2026-07-03'
  ) as demo_week_bag_sessions,
  (
    select count(*)
    from public.bag_allocations allocation
    join public.bag_shift_sessions session on session.id = allocation.shift_id
    where session.discrepancy_note = 'Demo week seed'
      and session.business_date between date '2026-06-27' and date '2026-07-03'
  ) as demo_week_allocations,
  (
    select count(*)
    from public.sales_receipts
    where code like 'DEMO-WEEK-%'
      and business_date between date '2026-06-27' and date '2026-07-03'
  ) as demo_week_receipts,
  (
    select coalesce(sum(total_amount), 0)
    from public.sales_receipts
    where code like 'DEMO-WEEK-%'
      and business_date between date '2026-06-27' and date '2026-07-03'
  ) as demo_week_revenue;
