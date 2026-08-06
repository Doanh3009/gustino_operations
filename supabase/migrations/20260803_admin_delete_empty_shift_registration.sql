-- Nút "Xóa dòng" trên dòng "Vắng / Chưa có bản ghi": Admin xóa một đăng ký ca
-- chưa hề phát sinh chấm công. Bắt buộc kiểm tra không tồn tại attendance_records
-- trước khi xóa vì FK shift_registration_id có on delete cascade — thiếu kiểm tra
-- này thì xóa registration sẽ xóa lan cả bằng chứng chấm công. Ghi audit trước.

create or replace function public.admin_delete_empty_shift_registration(
  p_registration_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_registration public.shift_registrations%rowtype;
  v_reason text;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid();

  if v_actor.role is distinct from 'admin'::public.app_role then
    raise exception 'Chỉ Admin hệ thống được xóa dòng đăng ký ca';
  end if;
  if v_actor.active is distinct from true then
    raise exception 'Tài khoản Admin đang bị khóa, không thể xóa dòng đăng ký ca';
  end if;

  v_reason := trim(coalesce(p_reason, ''));
  if p_registration_id is null then
    raise exception 'Thiếu dòng đăng ký ca cần xóa';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Lý do xóa phải có ít nhất 3 ký tự';
  end if;

  select * into v_registration
  from public.shift_registrations
  where id = p_registration_id
  for update;

  if not found then
    raise exception 'Không tìm thấy dòng đăng ký ca';
  end if;

  if exists (
    select 1
    from public.attendance_records
    where shift_registration_id = v_registration.id
  ) then
    raise exception 'Ca này đã có bản ghi chấm công nên không thể xóa dòng trống';
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
    'admin_delete_empty_shift_registration',
    'Xóa dòng đăng ký ca chưa chấm công của nhân viên ' || v_registration.user_id::text || ' tại chi nhánh ' || v_registration.branch_id,
    jsonb_build_object(
      'registration_id', v_registration.id,
      'shift_registration', to_jsonb(v_registration)
    )::text,
    null,
    v_reason
  );

  delete from public.shift_registrations
  where id = v_registration.id;

  return jsonb_build_object(
    'registration_id', v_registration.id,
    'user_id', v_registration.user_id,
    'branch_id', v_registration.branch_id,
    'work_date', v_registration.work_date,
    'deleted_at', now()
  );
end;
$$;

revoke all on function public.admin_delete_empty_shift_registration(uuid, text) from public;
grant execute on function public.admin_delete_empty_shift_registration(uuid, text) to authenticated;

notify pgrst, 'reload schema';
