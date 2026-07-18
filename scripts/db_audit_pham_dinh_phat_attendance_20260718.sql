begin transaction read only;

with target_profiles as (
  select id, full_name, email, active, branch_id
  from public.profiles
  where lower(unaccent(full_name)) like lower(unaccent('%Pham Dinh Phat%'))
     or lower(full_name) like '%phạm đình phát%'
), target_registrations as (
  select registration.*
  from public.shift_registrations registration
  join target_profiles profile on profile.id = registration.user_id
  where registration.work_date between date '2026-07-17' and date '2026-07-20'
), target_records as (
  select record.*
  from public.attendance_records record
  join target_profiles profile on profile.id = record.user_id
  where (record.check_in_time at time zone 'Asia/Bangkok')::date between date '2026-07-17' and date '2026-07-20'
)
select jsonb_pretty(jsonb_build_object(
  'profiles', coalesce((select jsonb_agg(to_jsonb(profile)) from target_profiles profile), '[]'::jsonb),
  'registrations', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', registration.id,
      'branch_id', registration.branch_id,
      'work_date', registration.work_date,
      'start_time', registration.start_time,
      'end_time', registration.end_time,
      'status', registration.status,
      'note', registration.note,
      'created_at', registration.created_at
    ) order by registration.work_date, registration.start_time, registration.created_at)
    from target_registrations registration
  ), '[]'::jsonb),
  'attendance_records', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', record.id,
      'branch_id', record.branch_id,
      'shift_registration_id', record.shift_registration_id,
      'check_in_time', record.check_in_time,
      'check_in_local', record.check_in_time at time zone 'Asia/Bangkok',
      'check_out_time', record.check_out_time,
      'created_at', record.created_at,
      'updated_at', record.updated_at
    ) order by record.check_in_time)
    from target_records record
  ), '[]'::jsonb)
)) as pham_dinh_phat_attendance_audit;

rollback;
