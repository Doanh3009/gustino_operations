-- Admin-only correction of an existing authoritative attendance record.
-- Payroll and attendance reports already read this same table. Every change
-- requires a reason and writes the before/after values to the shared audit log.

create or replace function public.admin_update_attendance_record(
  p_record_id uuid,
  p_check_in_time timestamptz,
  p_check_out_time timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_record public.attendance_records%rowtype;
  v_check_in timestamptz;
  v_check_out timestamptz;
  v_reason text;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid();

  if v_actor.role is distinct from 'admin'::public.app_role then
    raise exception 'Chỉ Admin hệ thống được chỉnh công';
  end if;

  v_reason := trim(coalesce(p_reason, ''));
  if p_record_id is null or p_check_in_time is null or p_check_out_time is null then
    raise exception 'Thiếu bản ghi, giờ vào hoặc giờ ra';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Lý do điều chỉnh phải có ít nhất 3 ký tự';
  end if;

  select * into v_record
  from public.attendance_records
  where id = p_record_id
  for update;

  if not found then
    raise exception 'Không tìm thấy bản ghi chấm công';
  end if;

  v_check_in := p_check_in_time;
  v_check_out := p_check_out_time;
  if v_check_out <= v_check_in then
    raise exception 'Giờ ra phải sau giờ vào';
  end if;
  if v_check_out - v_check_in > interval '18 hours' then
    raise exception 'Một ca không được vượt quá 18 giờ';
  end if;
  if v_check_out > now() then
    raise exception 'Không được chỉnh giờ ra trong tương lai';
  end if;

  update public.attendance_records
  set check_in_time = v_check_in,
      check_out_time = v_check_out,
      updated_at = now()
  where id = v_record.id;

  insert into public.control_audit_entries (
    actor_id,
    actor_name,
    module,
    action,
    detail,
    before_value,
    after_value,
    reason
  ) values (
    v_actor.id,
    v_actor.full_name,
    'attendance',
    'admin_correct_attendance',
    'Chỉnh công nhân viên ' || v_record.user_id::text || ' tại chi nhánh ' || v_record.branch_id,
    jsonb_build_object(
      'record_id', v_record.id,
      'check_in_time', v_record.check_in_time,
      'check_out_time', v_record.check_out_time
    )::text,
    jsonb_build_object(
      'record_id', v_record.id,
      'check_in_time', v_check_in,
      'check_out_time', v_check_out
    )::text,
    v_reason
  );

  return jsonb_build_object(
    'record_id', v_record.id,
    'check_in_time', v_check_in,
    'check_out_time', v_check_out,
    'updated_at', now()
  );
end;
$$;

revoke all on function public.admin_update_attendance_record(uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.admin_update_attendance_record(uuid, timestamptz, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
