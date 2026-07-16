select jsonb_build_object(
  'invalid_future_supplements', count(*) filter (
    where record.check_out_time > record.created_at
      and abs(extract(epoch from (record.updated_at - record.created_at))) < 1
  ),
  'admin_supplement_path_matches', count(*) filter (
    where record.selfie_url like '%admin-supplement/%'
      and record.check_out_time > record.created_at
  ),
  'work_dates', coalesce(jsonb_agg(distinct registration.work_date) filter (
    where record.check_out_time > record.created_at
      and abs(extract(epoch from (record.updated_at - record.created_at))) < 1
  ), '[]'::jsonb)
) as audit
from public.attendance_records record
join public.shift_registrations registration
  on registration.id = record.shift_registration_id;
