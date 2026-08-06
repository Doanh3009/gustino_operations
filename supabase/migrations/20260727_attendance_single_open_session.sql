-- ============================================================================
-- 20260727 — MỖI NHÂN VIÊN CHỈ ĐƯỢC CÓ TỐI ĐA MỘT PHIÊN CHẤM CÔNG ĐANG MỞ
--
-- Bối cảnh: bản ghi chấm công "treo" (check-in mà không bao giờ check-out) tái
-- diễn trên production (phải chạy tay db_close_stale_attendance 24/07 và 26/07).
-- Frontend đã có guard nhưng guard UI không chặn được đa thiết bị / race /
-- request retry. Ràng buộc phải nằm ở DB.
--
-- AN TOÀN DỮ LIỆU:
--   * KHÔNG xóa dòng nào. Bước 1 chỉ ĐÓNG các bản ghi mở TRÙNG (cùng người có
--     >1 phiên mở) theo diện "chốt hành chính" — đúng nhánh 2 của ràng buộc
--     attendance_records_checkout_evidence_required, không bịa ảnh/GPS.
--     (Tại thời điểm viết, audit prod cho thấy 0 người có >1 phiên mở → bước 1
--     dự kiến 0 dòng; vẫn giữ để migration idempotent và chạy lại an toàn.)
--   * Phiên mở DUY NHẤT của mỗi người (kể cả ca treo ngày cũ) được GIỮ NGUYÊN —
--     nhân viên tự đóng bằng "Check-out bù" trên màn Chấm công.
--
-- KIỂM TRA TRƯỚC: select user_id, count(*) from public.attendance_records
--                 where check_out_time is null group by user_id having count(*)>1;
-- KIỂM TRA SAU:   truy vấn trên phải trả 0 dòng; và
--                 select indexname from pg_indexes where indexname = 'attendance_records_one_open_per_user';
-- ROLLBACK:       drop index if exists public.attendance_records_one_open_per_user;
--                 các dòng bị đóng ở bước 1 (nếu có) nhận diện qua
--                 check_out_address like '[CHỐT HÀNH CHÍNH] Tự động đóng phiên mở trùng%'
--                 và có thể mở lại bằng: update ... set check_out_time = null,
--                 check_out_address = null where <điều kiện trên>.
-- ============================================================================

begin;

-- Bước 1: đóng hành chính các phiên mở TRÙNG (giữ lại phiên check-in mới nhất).
with ranked as (
  select id,
         row_number() over (partition by user_id order by check_in_time desc, created_at desc) as rn
  from public.attendance_records
  where check_out_time is null
)
update public.attendance_records a
set check_out_time = least(now(), a.check_in_time + interval '12 hours'),
    check_out_selfie_url = null,
    check_out_latitude = null,
    check_out_longitude = null,
    check_out_accuracy = null,
    check_out_address = '[CHỐT HÀNH CHÍNH] Tự động đóng phiên mở trùng khi tạo ràng buộc một-phiên-mở (migration 20260727).',
    updated_at = now()
from ranked r
where r.id = a.id
  and r.rn > 1
  and a.check_in_time < now();

-- Bước 2: ràng buộc cứng — một người tối đa một phiên đang mở.
-- Check-in thứ hai (đa thiết bị, retry, bấm nhiều lần) sẽ bị DB từ chối với
-- lỗi 23505 trên index này; frontend dịch thành thông báo tiếng Việt.
create unique index if not exists attendance_records_one_open_per_user
  on public.attendance_records (user_id)
  where check_out_time is null;

commit;
