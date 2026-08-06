-- BUG-115 back-fill: trừ kho cho các hóa đơn POS đã bán trước khi bật tính năng.
--
-- Chạy SAU migration 20260724_pos_sale_deducts_stock.sql.
--
-- KHÔNG XÓA, KHÔNG SỬA dữ liệu cũ — chỉ THÊM phiếu `sale_out` còn thiếu, mỗi phiếu
-- gắn `document_id = id hóa đơn`. Hàm `post_pos_receipt_stock` tự bỏ qua hóa đơn nào
-- đã có phiếu nên chạy lại nhiều lần cũng không cộng đôi.
--
-- ĐẢO NGƯỢC TOÀN BỘ bằng đúng một lệnh:
--   delete from public.stock_movements
--   where movement_type = 'sale_out' and note like '[POS %';
--
-- Ý nghĩa số liệu: phiếu kiểm đếm cuối ca (`count`) là MỐC RESET của tồn kho. Vì vậy
-- back-fill chủ yếu làm đúng lại phần "lệch" của các ca cũ — trước đây luôn âm nặng vì
-- hàng bán ra không hề bị trừ. Tồn hiện tại chỉ đổi ở phần bán ra SAU lần kiểm đếm gần
-- nhất của từng SKU.

begin;

select count(*) as hoa_don_chua_tru_kho
from public.sales_receipts r
where not exists (
  select 1 from public.stock_movements m
  where m.document_id = r.id and m.movement_type = 'sale_out'
);

select coalesce(sum(public.post_pos_receipt_stock(r.id)), 0) as so_dong_phieu_da_ghi
from (select id from public.sales_receipts order by business_date, created_at) r;

select m.branch_id as chi_nhanh,
       p.name as mat_hang,
       p.unit as don_vi,
       round(sum(m.quantity), 3) as tong_da_tru,
       count(*) as so_phieu
from public.stock_movements m
join public.products p on p.id = m.product_id
where m.movement_type = 'sale_out'
  and m.note like '[POS %'
group by m.branch_id, p.name, p.unit
order by m.branch_id, p.name;

commit;
