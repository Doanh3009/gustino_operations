-- Admin-only removal of one erroneous authoritative attendance record.
-- Keep the shift registration intact so only the mistaken check-in/out evidence
-- is removed. Preserve the complete record in the shared audit log first.

create or replace function public.admin_delete_attendance_record(
  p_record_id uuid,
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
  v_reason text;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid();

  if v_actor.role is distinct from 'admin'::public.app_role then
    raise exception 'Chỉ Admin hệ thống được xóa ca công';
  end if;

  v_reason := trim(coalesce(p_reason, ''));
  if p_record_id is null then
    raise exception 'Thiếu bản ghi chấm công cần xóa';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Lý do xóa phải có ít nhất 3 ký tự';
  end if;

  select * into v_record
  from public.attendance_records
  where id = p_record_id
  for update;

  if not found then
    raise exception 'Không tìm thấy bản ghi chấm công';
  end if;

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
    'admin_delete_attendance',
    'Xóa ca công nhân viên ' || v_record.user_id::text || ' tại chi nhánh ' || v_record.branch_id,
    jsonb_build_object(
      'record_id', v_record.id,
      'attendance_record', to_jsonb(v_record)
    )::text,
    null,
    v_reason
  );

  delete from public.attendance_records
  where id = v_record.id;

  return jsonb_build_object(
    'record_id', v_record.id,
    'user_id', v_record.user_id,
    'branch_id', v_record.branch_id,
    'shift_registration_id', v_record.shift_registration_id,
    'deleted_at', now()
  );
end;
$$;

revoke all on function public.admin_delete_attendance_record(uuid, text) from public;
grant execute on function public.admin_delete_attendance_record(uuid, text) to authenticated;

notify pgrst, 'reload schema';
