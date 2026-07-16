begin transaction read only;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select id::text from public.profiles where role = 'shift_leader' and branch_id = 'gold-coast' and active is true order by id limit 1),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;
select jsonb_pretty(jsonb_build_object(
  'actor', 'gold-coast shift_leader',
  'own_profile_visible', (select count(*) from public.profiles),
  'branches_visible', (select count(*) from public.branches),
  'today_sessions_visible', (select count(*) from public.bag_shift_sessions where branch_id = 'gold-coast' and business_date = date '2026-07-15'),
  'today_receipts_visible', (select count(*) from public.sales_receipts where branch_id = 'gold-coast' and business_date = date '2026-07-15'),
  'today_registrations_visible', (select count(*) from public.shift_registrations where branch_id = 'gold-coast' and work_date = date '2026-07-15'),
  'today_attendance_visible', (select count(*) from public.attendance_records where branch_id = 'gold-coast' and check_in_time >= timestamptz '2026-07-15 00:00:00+07' and check_in_time < timestamptz '2026-07-16 00:00:00+07'),
  'stock_movements_visible', (select count(*) from public.stock_movements where branch_id = 'gold-coast')
)) as shift_leader_rls_visibility;
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select id::text from public.profiles where role = 'manager' and active is true order by id limit 1),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;
select jsonb_pretty(jsonb_build_object(
  'actor', 'manager',
  'profiles_visible', (select count(*) from public.profiles),
  'branches_visible', (select count(*) from public.branches),
  'today_receipts_visible', (select count(*) from public.sales_receipts where business_date = date '2026-07-15'),
  'today_registrations_visible', (select count(*) from public.shift_registrations where work_date = date '2026-07-15'),
  'today_attendance_visible', (select count(*) from public.attendance_records where check_in_time >= timestamptz '2026-07-15 00:00:00+07' and check_in_time < timestamptz '2026-07-16 00:00:00+07')
)) as manager_rls_visibility;

rollback;
