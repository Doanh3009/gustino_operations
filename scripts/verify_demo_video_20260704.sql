select
  (
    select count(*)
    from public.shifts
    where branch_id in ('gold-coast', 'lotte-2310', 'lotte-vt')
      and active = true
      and (start_time, end_time) in (
        ('07:15'::time, '15:15'::time),
        ('14:15'::time, '22:15'::time),
        ('09:00'::time, '13:00'::time),
        ('16:00'::time, '21:00'::time)
      )
  ) as active_target_shifts,
  (
    select count(*)
    from public.shift_registrations
    where work_date = date '2026-07-03'
      and branch_id in ('gold-coast', 'lotte-2310', 'lotte-vt')
      and note = 'Demo video seed'
  ) as demo_registrations,
  (
    select count(*)
    from public.sales_receipts
    where business_date = date '2026-07-03'
      and branch_id in ('gold-coast', 'lotte-2310', 'lotte-vt')
      and code like 'DEMO-YD-%'
  ) as demo_receipts,
  (
    select coalesce(sum(total_amount), 0)
    from public.sales_receipts
    where business_date = date '2026-07-03'
      and branch_id in ('gold-coast', 'lotte-2310', 'lotte-vt')
      and code like 'DEMO-YD-%'
  ) as demo_revenue;
