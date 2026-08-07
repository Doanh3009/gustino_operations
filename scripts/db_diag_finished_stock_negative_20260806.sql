-- CHẨN ĐOÁN (CHỈ ĐỌC) — vì sao tồn THÀNH PHẨM cứ âm / cứ vọt số lớn dù bán đã trừ kho.
--
-- Chạy:
--   npm_config_cache=/d/gustino/.npm-cache npx --yes supabase@2.109.1 \
--     db query --linked --file scripts/db_diag_finished_stock_negative_20260806.sql
-- KHÔNG ghi gì, an toàn tuyệt đối.

-- Tồn tính y hệt `calculateStock` (store.ts): mốc `count` gần nhất là reset,
-- dòng trùng đúng dấu thời gian mốc được coi là TRƯỚC mốc, `waste` có
-- source_product_id là hao hụt chế biến nên không trừ lần hai.
create temporary view diag_stock as
with val as (
  select branch_id, product_id, created_at, movement_type,
         case movement_type
           when 'opening' then quantity
           when 'inbound' then quantity
           when 'processing_in' then quantity
           when 'packing_in' then quantity
           when 'adjustment' then quantity
           when 'processing_out' then -quantity
           when 'packing_out' then -quantity
           when 'sale_out' then -quantity
           when 'waste' then case when source_product_id is not null then 0 else -quantity end
           else 0
         end as v
  from public.stock_movements
),
lastc as (
  select distinct on (branch_id, product_id)
         branch_id, product_id, created_at as count_at, quantity as count_qty
  from public.stock_movements
  where movement_type = 'count'
  order by branch_id, product_id, created_at desc
)
select v.branch_id,
       v.product_id,
       c.count_at,
       c.count_qty,
       case when c.count_at is null then sum(v.v)
            else c.count_qty + coalesce(sum(v.v) filter (where v.created_at > c.count_at), 0)
       end as expected,
       count(*) as movement_rows,
       max(v.created_at) as last_movement_at
from val v
left join lastc c on c.branch_id = v.branch_id and c.product_id = v.product_id
group by v.branch_id, v.product_id, c.count_at, c.count_qty;

-- 1) TỒN ÂM hoặc TỒN LỚN BẤT THƯỜNG đang hiển thị trên app.
select s.branch_id,
       s.product_id,
       p.name,
       p.unit,
       p.category,
       round(s.expected, 3) as ton_hien_tai,
       s.count_at           as moc_kiem_ke_gan_nhat,
       round(s.count_qty, 3) as so_dem_moc,
       s.movement_rows,
       s.last_movement_at
from diag_stock s
left join public.products p on p.id = s.product_id
where s.expected < -0.0005 or s.expected > 500
order by s.expected asc
limit 60;

-- 2) SKU CHƯA TỪNG ĐƯỢC KIỂM ĐẾM (không có mốc count) — tồn cộng dồn từ đầu lịch sử,
--    chỉ cần một phiếu sai là sai vĩnh viễn. Đây là nhóm dễ âm/dễ phình nhất.
select s.branch_id,
       s.product_id,
       p.name,
       p.unit,
       p.category,
       round(s.expected, 3) as ton_hien_tai,
       s.movement_rows
from diag_stock s
left join public.products p on p.id = s.product_id
where s.count_at is null
  and abs(s.expected) > 0.0005
order by abs(s.expected) desc
limit 40;

-- 3) 30 NGÀY GẦN NHẤT: mỗi SKU vào/ra bao nhiêu theo từng đường, để thấy đường nào lệch.
--    pos_out = phiếu do hóa đơn POS tự sinh; manual_out = ca trưởng tự lập phiếu xuất.
--    manual_out > 0 cùng lúc pos_out > 0 trên cùng SKU = nguy cơ TRỪ ĐÔI.
select m.branch_id,
       m.product_id,
       p.name,
       round(sum(m.quantity) filter (where m.movement_type = 'inbound'), 3)        as nhap,
       round(sum(m.quantity) filter (where m.movement_type = 'processing_in'), 3)  as che_bien_ra,
       round(sum(m.quantity) filter (where m.movement_type = 'packing_in'), 3)     as dong_goi_vao,
       round(sum(m.quantity) filter (where m.movement_type = 'packing_out'), 3)    as dong_goi_ra,
       round(sum(m.quantity) filter (where m.movement_type = 'sale_out' and m.note like '[POS %'), 3) as pos_out,
       round(sum(m.quantity) filter (where m.movement_type = 'sale_out' and (m.note is null or m.note not like '[POS %')), 3) as manual_out,
       round(sum(m.quantity) filter (where m.movement_type = 'waste'), 3)          as hao,
       count(*) filter (where m.movement_type = 'count')                           as so_lan_kiem_ke
from public.stock_movements m
left join public.products p on p.id = m.product_id
where m.created_at >= now() - interval '30 days'
group by m.branch_id, m.product_id, p.name
having sum(m.quantity) filter (where m.movement_type = 'sale_out') > 0
    or sum(m.quantity) filter (where m.movement_type = 'packing_in') > 0
order by m.branch_id, pos_out desc nulls last
limit 60;

-- 4) CÔNG THỨC MÓN có khả năng trừ sai đơn vị (khai gram vào SKU tính bằng kg).
--    Ví dụ sai kinh điển: túi 110g khai quantity = 110 thay vì 0.11 ⇒ bán 1 túi trừ 110 kg.
select menu.id            as mon_ban,
       menu.name          as ten_mon,
       menu.unit          as don_vi_ban,
       line->>'productId' as sku_bi_tru,
       comp.name          as ten_sku_bi_tru,
       comp.unit          as don_vi_sku,
       line->>'role'      as vai_tro,
       (line->>'quantity')::numeric as luong_tru_moi_don_vi_ban
from public.products menu
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(menu.recipe) = 'array' then menu.recipe else '[]'::jsonb end
) as line
left join public.products comp on comp.id = line->>'productId'
where coalesce(line->>'quantity', '') ~ '^[0-9]+(\.[0-9]+)?$'
  and (
    (comp.unit = 'kg' and (line->>'quantity')::numeric >= 2)   -- trừ ≥2 kg cho 1 đơn vị bán
    or (line->>'quantity')::numeric >= 20                       -- hoặc trừ ≥20 đơn vị bất kỳ
  )
order by (line->>'quantity')::numeric desc
limit 40;

-- 5) MÓN ĐANG BÁN NHƯNG CHƯA GÁN CÔNG THỨC ⇒ bán ra không trừ kho được (tồn chỉ tăng).
select id, name, unit, price, active
from public.products
where coalesce(active, true)
  and category = 'finished'
  and unit <> 'kg'
  and coalesce(price, 0) > 0
  and (jsonb_typeof(recipe) <> 'array' or jsonb_array_length(coalesce(recipe, '[]'::jsonb)) = 0)
order by name
limit 40;

-- 6) HÓA ĐƠN POS KHÔNG SINH ĐƯỢC PHIẾU TRỪ KHO trong 30 ngày (đối chiếu 1-1 hóa đơn ↔ phiếu).
select r.branch_id,
       r.business_date,
       count(*)                                             as hoa_don,
       count(*) filter (where sm.document_id is null)       as hoa_don_khong_tru_kho
from public.sales_receipts r
left join lateral (
  select 1 as document_id
  from public.stock_movements m
  where m.document_id = r.id and m.movement_type = 'sale_out'
  limit 1
) sm on true
where r.business_date >= current_date - 30
group by r.branch_id, r.business_date
having count(*) filter (where sm.document_id is null) > 0
order by r.business_date desc, r.branch_id
limit 40;
