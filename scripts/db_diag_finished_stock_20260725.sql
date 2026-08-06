-- CHẨN ĐOÁN (CHỈ ĐỌC) — vì sao tồn thành phẩm vẫn quá lớn dù đã back-fill trừ bán.
--
-- Cơ chế: `calculateStock` (src/lib/store.ts) lấy phiếu KIỂM ĐẾM (`count`) gần nhất
-- của mỗi SKU làm MỐC RESET. Tồn hiện tại = số kiểm kê gần nhất + các phiếu SAU nó.
-- Back-fill hôm qua chỉ thêm phiếu `sale_out` theo ngày bán; phần bán ra TRƯỚC lần
-- kiểm kê gần nhất nằm SAU mốc reset nên KHÔNG kéo tồn xuống. Thêm nữa, hồi chưa
-- bật trừ kho, ô "Dự kiến" lúc chốt ca đã bị thổi cao, ca trưởng bấm nhận là chốt
-- luôn → số kiểm kê ghi lại đã cao sẵn.
--
-- Cột "ban_ra_truoc_kiem_ke_khong_tac_dung" = lượng đã bán bị mốc kiểm kê che mất.
-- Cột "kiem_ke_gan_nhat" chính là số đang neo tồn hiện tại lên cao.
--
-- Cách chữa: KHÔNG sửa bằng SQL. Cho ca trưởng làm MỘT lần KIỂM KÊ THẬT (đếm hàng
-- trên kệ) trong Kho → Kiểm kê, nhập đúng số thực tế. Từ đó BUG-115 tự trừ mỗi lần bán.

with last_count as (
  select distinct on (branch_id, product_id)
         branch_id,
         product_id,
         quantity   as count_qty,
         created_at as count_at
  from public.stock_movements
  where movement_type = 'count'
  order by branch_id, product_id, created_at desc
)
select lc.branch_id                                                  as chi_nhanh,
       p.name                                                        as mat_hang,
       p.unit                                                        as don_vi,
       round(lc.count_qty, 3)                                        as kiem_ke_gan_nhat,
       lc.count_at::date                                             as ngay_kiem_ke,
       round(coalesce(sum(m.quantity) filter (
         where m.movement_type = 'sale_out' and m.created_at > lc.count_at), 0), 3)
                                                                     as ban_ra_sau_kiem_ke,
       round(coalesce(sum(m.quantity) filter (
         where m.movement_type = 'sale_out' and m.created_at <= lc.count_at), 0), 3)
                                                                     as ban_ra_truoc_kiem_ke_khong_tac_dung,
       round(lc.count_qty - coalesce(sum(m.quantity) filter (
         where m.movement_type = 'sale_out' and m.created_at > lc.count_at), 0), 3)
                                                                     as ton_uoc_tinh_hien_tai
from last_count lc
join public.products p           on p.id = lc.product_id
left join public.stock_movements m on m.branch_id = lc.branch_id and m.product_id = lc.product_id
group by lc.branch_id, p.name, p.unit, lc.count_qty, lc.count_at
order by lc.branch_id, ton_uoc_tinh_hien_tai desc;
