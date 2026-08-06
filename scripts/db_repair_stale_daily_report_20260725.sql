-- SỬA DỮ LIỆU MỘT NGÀY BỊ LỆCH (ca tối 0đ / doanh thu lệch sau khi bấm nhầm bàn
-- giao ca tối rồi mở lại ngày). Chạy SAU khi đã xem db_diag_report_revenue_mismatch.
--
-- Cách sửa an toàn nhất KHÔNG viết tay số liệu: gỡ snapshot đã chốt lệch (doanh thu
-- lập tức quay về đọc theo HÓA ĐƠN POS THẬT) + mở lại ngày, rồi để ca trưởng/quản lý
-- vào app bấm "Chốt báo cáo" một lần nữa — báo cáo Zalo và kho báo cáo sẽ được tạo
-- lại đúng số. Hóa đơn, kho, chấm công KHÔNG bị đụng tới.
--
-- BƯỚC 1: thay __BRANCH__ và __DATE__ bằng đúng chi nhánh/ngày ở kết quả chẩn đoán.
--         Ví dụ: 'lotte-vt' và '2026-07-24'.
-- BƯỚC 2: chạy nguyên khối. Câu SELECT đầu để xác nhận đúng dòng trước khi ghi.

begin;

-- Xác nhận đang nhắm đúng ngày (in ra doanh thu snapshot vs POS thật):
select 'TRUOC KHI SUA' as buoc,
       (select nullif(payload->'summary'->>'revenue','')::numeric
          from public.report_snapshots
         where branch_id = '__BRANCH__' and report_date = '__DATE__') as snapshot_revenue,
       (select coalesce(sum(total_amount), 0)
          from public.sales_receipts
         where branch_id = '__BRANCH__' and business_date = '__DATE__') as pos_revenue_that;

-- 1) Gỡ snapshot đã chốt lệch (doanh thu quay về đọc theo hóa đơn POS thật ngay).
delete from public.report_snapshots
where branch_id = '__BRANCH__' and report_date = '__DATE__';

-- 2) Mở lại ngày vận hành để app cho chốt & gửi lại báo cáo đúng.
update public.operation_days
set status = 'open', closed_by = null, closed_at = null
where branch_id = '__BRANCH__' and business_date = '__DATE__';

-- Nếu ca tối đã đóng và cần bán/đếm lại: KHÔNG mở ở đây. Ca trưởng dùng nút
-- "Mở lại ca" trong màn Bàn giao (RPC reopen_bag_shift) để hoàn tác đúng số liệu kho.

-- Xem lại kết quả rồi mới quyết định commit/rollback.
select 'SAU KHI SUA' as buoc,
       (select count(*) from public.report_snapshots
         where branch_id = '__BRANCH__' and report_date = '__DATE__') as snapshot_con_lai,
       (select status from public.operation_days
         where branch_id = '__BRANCH__' and business_date = '__DATE__') as trang_thai_ngay;

-- Đúng ý thì: COMMIT;   —   Sai thì: ROLLBACK;
commit;
