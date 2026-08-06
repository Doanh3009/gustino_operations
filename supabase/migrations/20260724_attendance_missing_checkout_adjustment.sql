-- Ca quá hạn check-out không được đóng bằng giờ bấm nút nữa (BUG-113).
-- Nhân viên gửi đơn "Quên check-out" để Admin ghi giờ ra thật bằng chức năng
-- chỉnh công, nên loại đơn cần thêm giá trị mới.

alter table public.attendance_adjustment_requests
  drop constraint if exists attendance_adjustment_requests_kind_check;

alter table public.attendance_adjustment_requests
  add constraint attendance_adjustment_requests_kind_check
  check (kind in ('late_arrival', 'early_leave', 'missing_checkout'));

notify pgrst, 'reload schema';
