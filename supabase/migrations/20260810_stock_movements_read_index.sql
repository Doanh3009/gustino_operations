-- Chỉ mục cho lệnh đọc sổ kho nóng nhất của app.
--
-- Đo trên production 10/08/2026 bằng `pg_stat_statements`: truy vấn
--   select * from stock_movements where branch_id = $1
--   order by created_at desc, id desc limit $2 offset $3
-- chạy **114.680 lần, trung bình 685 ms, tổng 78.538 giây ≈ 21,8 giờ CPU** —
-- đứng đầu toàn hệ thống và là lý do chính app mở lâu.
--
-- Bảng chỉ có 8.128 dòng nên không phải do dữ liệu lớn: chỉ mục duy nhất dùng
-- được là `(branch_id, shift_date DESC)`, trong khi câu lệnh sắp xếp theo
-- `created_at DESC, id DESC`. Postgres phải quét toàn bộ dòng của chi nhánh rồi
-- SORT lại từ đầu cho mỗi lần gọi — và `App.tsx` gọi nó mỗi 15 giây trên mọi
-- máy đang mở màn Kho/Hôm nay/Báo cáo/Bàn giao/Đặt hàng.
--
-- Chỉ mục dưới đây khớp ĐÚNG mệnh đề ORDER BY nên lệnh đọc thành index scan có
-- LIMIT: đọc đúng số dòng cần rồi dừng, không còn bước sort.
create index concurrently if not exists stock_movements_branch_created_idx
  on public.stock_movements (branch_id, created_at desc, id desc);

-- Nhịp đồng bộ gia số (`fetchMovementsDelta`) lọc theo `created_at > mốc` trong
-- cùng một chi nhánh nên dùng chung được chỉ mục trên.
