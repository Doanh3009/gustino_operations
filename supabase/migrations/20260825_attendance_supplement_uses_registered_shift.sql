-- Restore attendance using an existing registration, or create a supplemental
-- registration only when Admin explicitly chooses the manual-shift option.
-- Scheduled times and actual check-in/check-out remain separate facts.

drop function if exists public.admin_add_attendance_supplement(uuid, text, date, time, time, text);
drop function if exists public.admin_add_attendance_supplement(uuid, time, time, text);

create or replace function public.admin_add_attendance_supplement(
  p_user_id uuid,
  p_branch_id text,
  p_work_date date,
  p_shift_registration_id uuid,
  p_scheduled_start_time time,
  p_scheduled_end_time time,
  p_check_in_time time,
  p_check_out_time time,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role public.app_role;
  v_registration public.shift_registrations%rowtype;
  v_registration_id uuid;
  v_record_id uuid;
  v_check_in timestamptz;
  v_check_out timestamptz;
  v_scheduled_start timestamp;
  v_scheduled_end timestamp;
  v_note text;
begin
  select role into v_actor_role
  from public.profiles
  where id = auth.uid();

  if v_actor_role is distinct from 'admin'::public.app_role then
    raise exception 'Chỉ Admin hệ thống được bổ sung công';
  end if;
  if p_user_id is null or p_branch_id is null or p_work_date is null
     or p_check_in_time is null or p_check_out_time is null then
    raise exception 'Thiếu nhân viên, chi nhánh, ngày hoặc giờ chấm công thực tế';
  end if;

  v_note := 'Admin bổ sung công do lỗi hệ thống';
  if length(trim(coalesce(p_reason, ''))) > 0 then
    v_note := v_note || ' · ' || trim(p_reason);
  end if;

  if p_shift_registration_id is not null then
    select * into v_registration
    from public.shift_registrations
    where id = p_shift_registration_id
      and user_id = p_user_id
      and branch_id = p_branch_id
      and work_date = p_work_date
      and status <> 'rejected'::public.shift_registration_status
    for update;

    if not found then
      raise exception 'Không tìm thấy ca đăng ký hợp lệ của nhân viên trong ngày đã chọn';
    end if;
  else
    if p_scheduled_start_time is null or p_scheduled_end_time is null then
      raise exception 'Hãy nhập giờ bắt đầu và kết thúc của ca bổ sung';
    end if;
    if p_scheduled_start_time = p_scheduled_end_time then
      raise exception 'Giờ bắt đầu và kết thúc ca không được trùng nhau';
    end if;
    v_scheduled_start := p_work_date + p_scheduled_start_time;
    v_scheduled_end := p_work_date + p_scheduled_end_time;
    if p_scheduled_end_time <= p_scheduled_start_time then
      v_scheduled_end := v_scheduled_end + interval '1 day';
    end if;
    if v_scheduled_end - v_scheduled_start > interval '18 hours' then
      raise exception 'Thời lượng ca bổ sung không được vượt quá 18 giờ';
    end if;

    insert into public.shift_registrations (
      user_id, branch_id, shift_id, work_date, start_time, end_time,
      status, note, reviewed_by, reviewed_at
    ) values (
      p_user_id, p_branch_id, null, p_work_date,
      p_scheduled_start_time, p_scheduled_end_time,
      'approved', v_note, auth.uid(), now()
    )
    on conflict (user_id, work_date, start_time, end_time) do nothing
    returning id into v_registration_id;

    if v_registration_id is null then
      select id into v_registration_id
      from public.shift_registrations
      where user_id = p_user_id
        and branch_id = p_branch_id
        and work_date = p_work_date
        and start_time = p_scheduled_start_time
        and end_time = p_scheduled_end_time
        and status <> 'rejected'::public.shift_registration_status
      order by created_at
      limit 1;
    end if;
    if v_registration_id is null then
      raise exception 'Không thể tạo ca bổ sung do trùng một đăng ký không hợp lệ';
    end if;

    select * into v_registration
    from public.shift_registrations
    where id = v_registration_id
    for update;
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = v_registration.user_id
      and active is true
      and branch_id = v_registration.branch_id
  ) then
    raise exception 'Nhân viên không hoạt động hoặc không thuộc chi nhánh của ca đã chọn';
  end if;
  if exists (
    select 1
    from public.attendance_records
    where shift_registration_id = v_registration.id
  ) then
    raise exception 'Ca này đã có bản ghi chấm công';
  end if;

  -- Actual timestamps come only from the explicit actual-time fields. Neither
  -- branch copies registered start_time/end_time into attendance timestamps.
  v_check_in := (v_registration.work_date + p_check_in_time)::timestamp at time zone 'Asia/Bangkok';
  v_check_out := (v_registration.work_date + p_check_out_time)::timestamp at time zone 'Asia/Bangkok';
  if p_check_out_time <= p_check_in_time then
    v_check_out := v_check_out + interval '1 day';
  end if;
  if v_check_out <= v_check_in then
    raise exception 'Giờ check-out phải sau giờ check-in';
  end if;
  if v_check_out - v_check_in > interval '18 hours' then
    raise exception 'Một ca không được vượt quá 18 giờ';
  end if;
  if v_check_out > now() then
    raise exception 'Chỉ được bổ sung công sau thời điểm check-out thực tế';
  end if;

  insert into public.attendance_records (
    user_id, branch_id, shift_registration_id,
    check_in_time, check_out_time, selfie_url,
    check_in_latitude, check_in_longitude, check_in_accuracy, check_in_address,
    check_out_selfie_url, check_out_latitude, check_out_longitude,
    check_out_accuracy, check_out_address, updated_at
  ) values (
    v_registration.user_id, v_registration.branch_id, v_registration.id,
    v_check_in, v_check_out, 'admin-supplement/' || v_registration.id::text || '.png',
    0, 0, 0, v_note,
    'admin-supplement/' || v_registration.id::text || '-checkout.png',
    0, 0, 0, v_note, now()
  )
  returning id into v_record_id;

  return jsonb_build_object(
    'registration_id', v_registration.id,
    'attendance_record_id', v_record_id,
    'scheduled_start_time', v_registration.start_time,
    'scheduled_end_time', v_registration.end_time,
    'check_in_time', v_check_in,
    'check_out_time', v_check_out
  );
end;
$$;

revoke all on function public.admin_add_attendance_supplement(uuid, text, date, uuid, time, time, time, time, text) from public;
grant execute on function public.admin_add_attendance_supplement(uuid, text, date, uuid, time, time, time, time, text) to authenticated;

notify pgrst, 'reload schema';
