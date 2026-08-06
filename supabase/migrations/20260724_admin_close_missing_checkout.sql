-- Cho phép ĐÓNG HÀNH CHÍNH một ca quên check-out, mà KHÔNG bịa bằng chứng (BUG-113).
--
-- Ràng buộc `attendance_records_checkout_evidence_required` bắt buộc mọi bản ghi có
-- `check_out_time` phải kèm ảnh + GPS + độ chính xác + địa chỉ. Đúng cho check-out
-- thật, nhưng nó khiến **không ai đóng được ca quên check-out**: `admin_update_attendance_record`
-- chỉ ghi giờ nên luôn vi phạm ràng buộc. Hậu quả thực tế: bản ghi treo vĩnh viễn,
-- bảng công thiếu ngày công, nhân viên mãi thấy thẻ đỏ "Quá hạn check-out".
--
-- Cách chữa KHÔNG PHẢI là bịa toạ độ/ảnh — làm vậy là tạo bằng chứng có mặt giả.
-- Ở đây mở đúng một nhánh hợp lệ thứ hai: bản ghi đóng hành chính thì **không có**
-- ảnh và GPS, và địa chỉ phải mở đầu bằng '[CHỐT HÀNH CHÍNH]' để mọi báo cáo nhìn là
-- biết ngay ca này không được xác minh vị trí.

alter table public.attendance_records
  drop constraint if exists attendance_records_checkout_evidence_required;

alter table public.attendance_records
  add constraint attendance_records_checkout_evidence_required
  check (
    check_out_time is null
    -- 1. Check-out thật do nhân viên bấm: đủ ảnh + GPS + địa chỉ.
    or (
      check_out_selfie_url is not null
      and length(trim(both from check_out_selfie_url)) > 0
      and check_out_latitude is not null
      and check_out_longitude is not null
      and check_out_accuracy is not null
      and check_out_address is not null
      and length(trim(both from check_out_address)) > 0
    )
    -- 2. Đóng hành chính: KHÔNG ảnh, KHÔNG GPS, và tự khai rõ trong địa chỉ.
    or (
      check_out_selfie_url is null
      and check_out_latitude is null
      and check_out_longitude is null
      and check_out_accuracy is null
      and check_out_address like '[CHỐT HÀNH CHÍNH]%'
    )
  ) not valid;

-- Chỉnh công của Admin: nếu bản ghi chưa từng có bằng chứng check-out thì đóng theo
-- diện hành chính (ghi rõ lý do vào địa chỉ). Bản ghi đã có bằng chứng thật thì giữ
-- nguyên bằng chứng, chỉ sửa giờ như trước.
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
  v_administrative boolean;
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

  -- Chưa từng có ảnh/GPS lúc ra ⇒ đây là ca quên check-out, đóng theo diện hành chính.
  v_administrative := v_record.check_out_selfie_url is null
    or v_record.check_out_latitude is null
    or v_record.check_out_longitude is null;

  if v_administrative then
    update public.attendance_records
    set check_in_time = v_check_in,
        check_out_time = v_check_out,
        check_out_selfie_url = null,
        check_out_latitude = null,
        check_out_longitude = null,
        check_out_accuracy = null,
        check_out_address = '[CHỐT HÀNH CHÍNH] ' || left(v_reason, 300),
        updated_at = now()
    where id = v_record.id;
  else
    update public.attendance_records
    set check_in_time = v_check_in,
        check_out_time = v_check_out,
        updated_at = now()
    where id = v_record.id;
  end if;

  insert into public.control_audit_entries (
    actor_id, actor_name, module, action, detail, before_value, after_value, reason
  ) values (
    v_actor.id,
    v_actor.full_name,
    'attendance',
    case when v_administrative then 'admin_close_missing_checkout' else 'admin_correct_attendance' end,
    'Chỉnh công nhân viên ' || v_record.user_id::text || ' tại chi nhánh ' || v_record.branch_id,
    jsonb_build_object(
      'record_id', v_record.id,
      'check_in_time', v_record.check_in_time,
      'check_out_time', v_record.check_out_time
    )::text,
    jsonb_build_object(
      'record_id', v_record.id,
      'check_in_time', v_check_in,
      'check_out_time', v_check_out,
      'administrative_close', v_administrative
    )::text,
    v_reason
  );

  return jsonb_build_object(
    'record_id', v_record.id,
    'check_in_time', v_check_in,
    'check_out_time', v_check_out,
    'administrative_close', v_administrative,
    'updated_at', now()
  );
end;
$$;

revoke all on function public.admin_update_attendance_record(uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.admin_update_attendance_record(uuid, timestamptz, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
