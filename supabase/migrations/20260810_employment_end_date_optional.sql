-- Bỏ bắt buộc "Ngày nghỉ việc" khi chuyển hồ sơ sang trạng thái Nghỉ việc.
--
-- Bản cũ chặn cứng ở tầng DB:
--     if p_employment_status = 'ended' and p_end_date is null then
--       raise exception 'Employment end date is required';
-- Cộng thêm thuộc tính `required` ở ô nhập trên giao diện, kết quả là Admin
-- KHÔNG chuyển nổi một hồ sơ sang "Nghỉ việc" nếu chưa nhớ ra ngày nghỉ chính xác.
--
-- Chủ hệ thống yêu cầu bỏ ràng buộc này. Không khai ngày thì lấy NGÀY HÔM NAY
-- theo giờ Việt Nam làm mốc, vì các báo cáo theo kỳ cần một mốc để biết người này
-- còn đi làm tới đâu (`wasEmployedDuring` trong `src/lib/employmentStatus.ts`):
-- có mốc thì tháng cũ vẫn giữ nguyên số liệu, chỉ các kỳ SAU mốc mới ẩn họ đi.
-- Không có mốc nào thì hoặc mất sạch lịch sử, hoặc không bao giờ ẩn được.

create or replace function public.admin_update_employee_crm(
  p_employee_id uuid,
  p_employment_status text,
  p_start_date date,
  p_probation_end_date date,
  p_end_date date,
  p_note text
)
returns public.profiles
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor public.profiles;
  result public.profiles;
  resolved_end_date date;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.role is distinct from 'admin'::public.app_role then
    raise exception 'Only system Admin can update employee CRM data';
  end if;
  if p_employment_status not in ('probation', 'working', 'ended') then
    raise exception 'Invalid employment status';
  end if;
  if p_probation_end_date is not null and p_start_date is not null
     and p_probation_end_date < p_start_date then
    raise exception 'Probation end date cannot precede start date';
  end if;
  if p_end_date is not null and p_start_date is not null and p_end_date < p_start_date then
    raise exception 'Employment end date cannot precede start date';
  end if;

  -- Không khai ngày nghỉ ⇒ lấy hôm nay theo giờ Việt Nam (UTC+7), không chặn nữa.
  if p_employment_status = 'ended' then
    resolved_end_date := coalesce(p_end_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
    -- Ngày bắt đầu làm muộn hơn hôm nay (hồ sơ nhập sai) thì lấy chính ngày bắt đầu
    -- để không tạo ra khoảng làm việc âm.
    if p_start_date is not null and resolved_end_date < p_start_date then
      resolved_end_date := p_start_date;
    end if;
  else
    resolved_end_date := null;
  end if;

  update public.profiles
  set employment_status = p_employment_status,
      employment_start_date = p_start_date,
      probation_end_date = p_probation_end_date,
      employment_end_date = resolved_end_date,
      employment_note = left(coalesce(p_note, ''), 2000)
  where id = p_employee_id
  returning * into result;

  if result.id is null then
    raise exception 'Employee not found';
  end if;
  return result;
end;
$function$;

notify pgrst, 'reload schema';
