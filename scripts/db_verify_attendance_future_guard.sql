with clock as (
  select
    now() at time zone 'Asia/Bangkok' as local_now,
    (now() at time zone 'Asia/Bangkok')::date as local_date
), eligible as (
  select registration.branch_id, count(*)::bigint as total
  from public.shift_registrations registration
  cross join clock
  left join public.attendance_records record
    on record.shift_registration_id = registration.id
  where registration.work_date = clock.local_date
    and registration.status <> 'rejected'::public.shift_registration_status
    and record.id is null
    and clock.local_now >= registration.work_date + registration.start_time - interval '30 minutes'
    and clock.local_now <= registration.work_date + registration.end_time
  group by registration.branch_id
)
select jsonb_build_object(
  'invalid_future_records', (
    select count(*)
    from public.attendance_records record
    where record.check_out_time > record.created_at
      and abs(extract(epoch from (record.updated_at - record.created_at))) < 1
  ),
  'eligible_unchecked_by_branch', coalesce((
    select jsonb_object_agg(branch_id, total) from eligible
  ), '{}'::jsonb),
  'database_guard_installed', position(
    'if v_check_out > now()' in lower(pg_get_functiondef(
      'public.admin_add_attendance_supplement(uuid,text,date,time without time zone,time without time zone,text)'::regprocedure
    ))
  ) > 0
) as verification;
