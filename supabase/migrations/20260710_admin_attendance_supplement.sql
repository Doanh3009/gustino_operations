-- Admin can restore a complete attendance session when the timekeeping system failed.
-- The registration and attendance record are created atomically and published realtime.

create or replace function public.admin_add_attendance_supplement(
  p_user_id uuid,
  p_branch_id text,
  p_work_date date,
  p_start_time time,
  p_end_time time,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role public.app_role;
  v_registration_id uuid;
  v_record_id uuid;
  v_check_in timestamptz;
  v_check_out timestamptz;
  v_note text;
begin
  select role into v_actor_role from public.profiles where id = auth.uid();
  if v_actor_role is distinct from 'admin'::public.app_role then
    raise exception 'Chỉ Admin hệ thống được bổ sung công';
  end if;

  if p_user_id is null or p_branch_id is null or p_work_date is null or p_start_time is null or p_end_time is null then
    raise exception 'Thiếu nhân viên, chi nhánh, ngày hoặc giờ làm';
  end if;
  if p_start_time = p_end_time then
    raise exception 'Giờ vào và giờ ra không được trùng nhau';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_user_id and active is true and branch_id = p_branch_id
  ) then
    raise exception 'Nhân viên không hoạt động hoặc không thuộc chi nhánh đã chọn';
  end if;

  v_note := 'Admin bổ sung công do lỗi hệ thống';
  if length(trim(coalesce(p_reason, ''))) > 0 then
    v_note := v_note || ' · ' || trim(p_reason);
  end if;

  select id into v_registration_id
  from public.shift_registrations
  where user_id = p_user_id
    and branch_id = p_branch_id
    and work_date = p_work_date
    and start_time = p_start_time
    and end_time = p_end_time
    and status <> 'rejected'::public.shift_registration_status
  order by created_at
  limit 1;

  if v_registration_id is null then
    insert into public.shift_registrations (
      user_id, branch_id, shift_id, work_date, start_time, end_time,
      status, note, reviewed_by, reviewed_at
    ) values (
      p_user_id, p_branch_id, null, p_work_date, p_start_time, p_end_time,
      'approved', v_note, auth.uid(), now()
    )
    on conflict (user_id, work_date, start_time, end_time)
    do update set
      branch_id = excluded.branch_id,
      status = 'approved',
      note = excluded.note,
      reviewed_by = auth.uid(),
      reviewed_at = now()
    returning id into v_registration_id;
  end if;

  if exists (select 1 from public.attendance_records where shift_registration_id = v_registration_id) then
    raise exception 'Ca này đã có bản ghi chấm công';
  end if;

  v_check_in := (p_work_date + p_start_time)::timestamp at time zone 'Asia/Bangkok';
  v_check_out := (p_work_date + p_end_time)::timestamp at time zone 'Asia/Bangkok';
  if p_end_time <= p_start_time then
    v_check_out := v_check_out + interval '1 day';
  end if;

  insert into public.attendance_records (
    user_id, branch_id, shift_registration_id,
    check_in_time, check_out_time, selfie_url,
    check_in_latitude, check_in_longitude, check_in_accuracy, check_in_address,
    check_out_selfie_url, check_out_latitude, check_out_longitude,
    check_out_accuracy, check_out_address, updated_at
  ) values (
    p_user_id, p_branch_id, v_registration_id,
    v_check_in, v_check_out, 'admin-supplement/' || v_registration_id::text || '.png',
    0, 0, 0, v_note,
    'admin-supplement/' || v_registration_id::text || '-checkout.png',
    0, 0, 0, v_note, now()
  )
  returning id into v_record_id;

  return jsonb_build_object(
    'registration_id', v_registration_id,
    'attendance_record_id', v_record_id,
    'check_in_time', v_check_in,
    'check_out_time', v_check_out
  );
end;
$$;

revoke all on function public.admin_add_attendance_supplement(uuid, text, date, time, time, text) from public;
grant execute on function public.admin_add_attendance_supplement(uuid, text, date, time, time, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.shift_registrations;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.attendance_records;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
