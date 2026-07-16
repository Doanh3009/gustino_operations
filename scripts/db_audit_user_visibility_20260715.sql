begin transaction read only;

with profile_counts as (
  select
    count(*) as total,
    count(*) filter (where active is true) as active,
    count(*) filter (where active is false) as inactive,
    count(*) filter (where role = 'admin') as admins,
    count(*) filter (where role = 'manager') as managers,
    count(*) filter (where role = 'shift_leader') as shift_leaders,
    count(*) filter (where role = 'staff') as staff
  from public.profiles
), branch_counts as (
  select
    count(*) as total,
    count(*) filter (where active is true) as active,
    count(*) filter (where active is false) as inactive
  from public.branches
), auth_counts as (
  select count(*) as total from auth.users
), today_profiles as (
  select
    p.branch_id,
    count(*) filter (where p.active is true) as active_profiles,
    count(*) filter (where p.active is false) as inactive_profiles,
    count(*) filter (where p.role = 'staff') as staff,
    count(*) filter (where p.role = 'shift_leader') as shift_leaders
  from public.profiles p
  group by p.branch_id
), today_rows as (
  select
    b.id as branch_id,
    coalesce(tp.active_profiles, 0) as active_profiles,
    coalesce(tp.inactive_profiles, 0) as inactive_profiles,
    coalesce(tp.staff, 0) as staff,
    coalesce(tp.shift_leaders, 0) as shift_leaders,
    (select count(*) from public.shift_registrations r where r.branch_id = b.id and r.work_date = date '2026-07-15') as registrations,
    (select count(*) from public.attendance_records a where a.branch_id = b.id and a.check_in_time >= timestamptz '2026-07-15 00:00:00+07' and a.check_in_time < timestamptz '2026-07-16 00:00:00+07') as attendance,
    (select count(*) from public.sales_receipts s where s.branch_id = b.id and s.business_date = date '2026-07-15') as receipts
  from public.branches b
  left join today_profiles tp on tp.branch_id = b.id
  order by b.id
)
select jsonb_pretty(jsonb_build_object(
  'profiles', (select to_jsonb(profile_counts) from profile_counts),
  'auth_users', (select to_jsonb(auth_counts) from auth_counts),
  'branches', (select to_jsonb(branch_counts) from branch_counts),
  'per_branch', (select jsonb_agg(to_jsonb(today_rows)) from today_rows)
)) as user_visibility_audit;

rollback;
