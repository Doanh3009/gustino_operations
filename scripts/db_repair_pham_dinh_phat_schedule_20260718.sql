begin;

do $$
declare
  v_user_id uuid := '0119a432-48e4-42e3-890a-d36c3b6c3b8a';
  v_wrong_registration_id uuid := '0a054d1f-4a55-4909-83e3-bcf118ca4cef';
  v_correct_registration_id uuid := 'a2fdc682-bc53-448f-944c-61dcca1cb703';
  v_wrong_attendance_id uuid := '5c1a8847-e4d9-4ee1-9f13-9e66612c9e2a';
  v_correct_attendance_id uuid := '144a046e-0c5d-4b15-a0ea-46cae9c4f8ed';
  v_wrong_registration public.shift_registrations%rowtype;
  v_wrong_attendance public.attendance_records%rowtype;
begin
  select * into v_wrong_registration
  from public.shift_registrations
  where id = v_wrong_registration_id
    and user_id = v_user_id
    and branch_id = 'gold-coast'
    and work_date = date '2026-07-18'
    and start_time = time '09:00'
    and end_time = time '17:00'
  for update;
  if not found then raise exception 'Wrong registration guard failed; no repair applied'; end if;

  select * into v_wrong_attendance
  from public.attendance_records
  where id = v_wrong_attendance_id
    and user_id = v_user_id
    and shift_registration_id = v_wrong_registration_id
    and check_in_time = timestamptz '2026-07-18 02:02:23.674+00'
    and check_out_time is null
  for update;
  if not found then raise exception 'Wrong attendance guard failed; no repair applied'; end if;

  if not exists (
    select 1
    from public.attendance_records ar
    join public.shift_registrations sr on sr.id = ar.shift_registration_id
    where ar.id = v_correct_attendance_id
      and ar.user_id = v_user_id
      and ar.shift_registration_id = v_correct_registration_id
      and ar.check_in_time = timestamptz '2026-07-18 03:01:18.843+00'
      and ar.check_out_time is null
      and sr.branch_id = 'gold-coast'
      and sr.work_date = date '2026-07-18'
      and sr.start_time = time '09:00'
      and sr.end_time = time '13:00'
  ) then
    raise exception 'Correct registration/attendance guard failed; no repair applied';
  end if;

  insert into public.control_audit_entries (
    actor_name,
    module,
    action,
    detail,
    before_value,
    after_value,
    reason
  ) values (
    'Codex — owner authorized',
    'attendance',
    'repair_duplicate_schedule_attendance',
    'Remove duplicate 09:00-17:00 registration/attendance for Phạm Đình Phát on 2026-07-18',
    jsonb_build_object(
      'attendance_record', to_jsonb(v_wrong_attendance),
      'shift_registration', to_jsonb(v_wrong_registration)
    )::text,
    jsonb_build_object(
      'kept_attendance_record_id', v_correct_attendance_id,
      'kept_shift_registration_id', v_correct_registration_id,
      'work_date', '2026-07-18',
      'start_time', '09:00',
      'end_time', '13:00'
    )::text,
    'Owner confirmed the authoritative shift is 09:00-13:00; duplicate was created by schedule synchronization defect BUG-071.'
  );

  delete from public.attendance_records
  where id = v_wrong_attendance_id;

  delete from public.shift_registrations
  where id = v_wrong_registration_id;

  if exists (
    select 1 from public.attendance_records where id = v_wrong_attendance_id
  ) or exists (
    select 1 from public.shift_registrations where id = v_wrong_registration_id
  ) then
    raise exception 'Post-repair deletion verification failed';
  end if;

  if not exists (
    select 1
    from public.attendance_records ar
    join public.shift_registrations sr on sr.id = ar.shift_registration_id
    where ar.id = v_correct_attendance_id
      and sr.id = v_correct_registration_id
      and sr.start_time = time '09:00'
      and sr.end_time = time '13:00'
  ) then
    raise exception 'Authoritative attendance was not preserved';
  end if;
end $$;

commit;
