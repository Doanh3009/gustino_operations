-- BUG-121: "chấm công không thành công" — máy không lấy được GPS (WebView trong
-- app khác, quyền bị chặn, hết 25 giây) thì check-out bị ràng buộc
-- `attendance_records_checkout_evidence_required` chặn đứng: nhánh 1 đòi đủ
-- lat/lng/accuracy, nhánh 2 (chốt hành chính) lại đòi KHÔNG có ảnh.
--
-- Mở đúng MỘT nhánh hợp lệ thứ ba theo pattern tự khai sẵn có: check-out có ẢNH
-- thật (bằng chứng gốc) nhưng KHÔNG có GPS, và địa chỉ phải mở đầu bằng
-- '[KHÔNG CÓ GPS]' để mọi báo cáo nhìn là biết ngay bản ghi này thiếu định vị.
-- KHÔNG bịa toạ độ, KHÔNG nới ảnh — ảnh vẫn bắt buộc với check-out của nhân viên.
--
-- An toàn dữ liệu: chỉ THAY ĐỔI ĐỊNH NGHĨA ràng buộc (NOT VALID — không quét lại
-- dữ liệu cũ), không UPDATE/DELETE dòng nào.

alter table public.attendance_records
  drop constraint if exists attendance_records_checkout_evidence_required;

alter table public.attendance_records
  add constraint attendance_records_checkout_evidence_required
  check (
    check_out_time is null
    -- 1. Check-out thật đầy đủ: ảnh + GPS + địa chỉ.
    or (
      check_out_selfie_url is not null
      and length(trim(both from check_out_selfie_url)) > 0
      and check_out_latitude is not null
      and check_out_longitude is not null
      and check_out_accuracy is not null
      and check_out_address is not null
      and length(trim(both from check_out_address)) > 0
    )
    -- 2. Đóng hành chính (Admin/cron/check-out bù): KHÔNG ảnh, KHÔNG GPS, tự khai rõ.
    or (
      check_out_selfie_url is null
      and check_out_latitude is null
      and check_out_longitude is null
      and check_out_accuracy is null
      and check_out_address like '[CHỐT HÀNH CHÍNH]%'
    )
    -- 3. Check-out thật nhưng máy không lấy được GPS (BUG-121): CÓ ảnh, KHÔNG toạ
    --    độ, địa chỉ tự khai rõ ràng.
    or (
      check_out_selfie_url is not null
      and length(trim(both from check_out_selfie_url)) > 0
      and check_out_latitude is null
      and check_out_longitude is null
      and check_out_accuracy is null
      and check_out_address like '[KHÔNG CÓ GPS]%'
    )
  ) not valid;
