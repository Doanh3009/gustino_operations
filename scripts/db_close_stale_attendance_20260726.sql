-- BUG-113 — ĐÓNG 5 CA TREO CÒN LẠI (chạy tay, KHÔNG tự động).
--
-- Bối cảnh: 5 bản ghi chấm công của 24–25/07/2026 chưa bao giờ được check-out
-- (`updated_at = created_at`, tức lệnh check-out chưa từng tới máy chủ). Bản vá
-- mới cho chính nhân viên tự khai bù giờ về ngay trên màn Chấm công, nên CÁCH TỐT
-- NHẤT là để họ tự đóng — họ mới biết thực sự về lúc mấy giờ.
--
-- Chỉ dùng script này khi nhân viên không thể tự làm (nghỉ, mất tài khoản...).
-- Nó đóng ca theo GIỜ TAN CA THEO LỊCH, tức giả định làm đủ ca. Nếu thực tế họ về
-- sớm hơn thì đây là trả dư giờ công — hãy xác nhận với quản lý chi nhánh trước.
--
-- Bản ghi được đóng theo diện HÀNH CHÍNH (không ảnh, không GPS, địa chỉ mở đầu
-- '[CHỐT HÀNH CHÍNH]') đúng nhánh 2 của ràng buộc
-- `attendance_records_checkout_evidence_required` — không bịa bằng chứng có mặt.

begin;

-- 1) Xem trước những gì sắp bị sửa. Đọc kỹ rồi mới chạy phần 2.
select
  p.full_name,
  a.id                                            as record_id,
  a.branch_id,
  r.work_date,
  r.start_time,
  r.end_time,
  a.check_in_time at time zone 'Asia/Ho_Chi_Minh' as check_in_local,
  (r.work_date + r.end_time
    + case when r.end_time <= r.start_time then interval '1 day' else interval '0' end)
                                                  as se_dong_luc_local
from public.attendance_records a
join public.shift_registrations r on r.id = a.shift_registration_id
left join public.profiles p on p.id = a.user_id
where a.check_out_time is null
  and r.work_date < current_date
order by r.work_date, p.full_name;

-- 2) Đóng ca theo giờ tan ca của lịch. Giữ nguyên các chốt an toàn:
--    - chỉ ca của những ngày TRƯỚC hôm nay (ca hôm nay để nhân viên tự check-out),
--    - không đóng ca dài quá 18 giờ,
--    - không ghi giờ ra trong tương lai.
update public.attendance_records a
set check_out_time = (
      (r.work_date + r.end_time
        + case when r.end_time <= r.start_time then interval '1 day' else interval '0' end)
      at time zone 'Asia/Ho_Chi_Minh'
    ),
    check_out_selfie_url = null,
    check_out_latitude = null,
    check_out_longitude = null,
    check_out_accuracy = null,
    check_out_address = '[CHỐT HÀNH CHÍNH] Quên check-out; đóng theo giờ tan ca của lịch đăng ký (BUG-113).',
    updated_at = now()
from public.shift_registrations r
where r.id = a.shift_registration_id
  and a.check_out_time is null
  and r.work_date < current_date
  and (
    (r.work_date + r.end_time
      + case when r.end_time <= r.start_time then interval '1 day' else interval '0' end)
    at time zone 'Asia/Ho_Chi_Minh'
  ) > a.check_in_time
  and (
    (r.work_date + r.end_time
      + case when r.end_time <= r.start_time then interval '1 day' else interval '0' end)
    at time zone 'Asia/Ho_Chi_Minh'
  ) <= now()
  and (
    (r.work_date + r.end_time
      + case when r.end_time <= r.start_time then interval '1 day' else interval '0' end)
    at time zone 'Asia/Ho_Chi_Minh'
  ) - a.check_in_time <= interval '18 hours';

-- 3) Kiểm tra lại rồi COMMIT. Nếu số dòng hoặc giờ không như mong đợi thì ROLLBACK.
select
  p.full_name,
  a.check_in_time  at time zone 'Asia/Ho_Chi_Minh' as vao,
  a.check_out_time at time zone 'Asia/Ho_Chi_Minh' as ra,
  round(extract(epoch from (a.check_out_time - a.check_in_time)) / 3600.0, 2) as so_gio,
  a.check_out_address
from public.attendance_records a
left join public.profiles p on p.id = a.user_id
where a.check_out_address like '[CHỐT HÀNH CHÍNH]%'
order by a.check_in_time desc;

-- commit;
-- rollback;
