with clock as (
  select
    now() as server_now,
    now() at time zone 'Asia/Ho_Chi_Minh' as local_now,
    (now() at time zone 'Asia/Ho_Chi_Minh')::date as local_date
)
select jsonb_pretty(jsonb_build_object(
  'server_now', clock.server_now,
  'local_now', clock.local_now,
  'invalid_future_supplements', (
    select count(*)
    from public.attendance_records invalid_record
    where invalid_record.check_out_time > invalid_record.created_at
      and abs(extract(epoch from (invalid_record.updated_at - invalid_record.created_at))) < 1
  ),
  'registrations', coalesce(jsonb_agg(jsonb_build_object(
    'registration_id', registration.id,
    'user_id', registration.user_id,
    'employee_name', profile.full_name,
    'profile_active', profile.active,
    'role', profile.role,
    'branch_id', registration.branch_id,
    'branch_active', branch.active,
    'work_date', registration.work_date,
    'start_time', registration.start_time,
    'end_time', registration.end_time,
    'status', registration.status,
    'note', registration.note,
    'has_check_in', record.id is not null,
    'check_in_time', record.check_in_time,
    'check_out_time', record.check_out_time,
    'record_created_at', record.created_at,
    'record_updated_at', record.updated_at,
    'selfie_marker', case
      when record.selfie_url like '%admin-supplement/%' then 'admin-supplement'
      when record.selfie_url like 'demo/%' then record.selfie_url
      when record.selfie_url is null then null
      else 'uploaded-selfie'
    end
  ) order by registration.start_time, profile.full_name) filter (where registration.id is not null), '[]'::jsonb)
)) as audit
from clock
left join public.shift_registrations registration
  on registration.work_date = clock.local_date
left join public.profiles profile
  on profile.id = registration.user_id
left join public.branches branch
  on branch.id = registration.branch_id
left join public.attendance_records record
  on record.shift_registration_id = registration.id
group by clock.server_now, clock.local_now;
