-- CHƯƠNG TRÌNH KHUYẾN MÃI / GIẢM GIÁ SẢN PHẨM
--
-- Vì sao cần: bảng `products` chỉ có MỘT cột `price`. Muốn hạ giá một món trong
-- một giai đoạn thì hoặc sửa cột đó (mất giá gốc, và mọi báo cáo cũ vẫn giữ giá
-- cũ nên số liệu lệch nhau), hoặc sửa tay `sales_receipt_items` như đợt bánh hạt
-- dẻ 06-13/08/2026 — đúng thứ không bao giờ nên phải làm bằng tay.
--
-- Bảng này là LỚP GHI ĐÈ có thời hạn đặt trên `products.price`. Không đụng tới
-- giá gốc, nên hết chương trình là giá tự quay về mức niêm yết.
--
-- Nguyên tắc quan trọng: khuyến mãi chỉ quyết định giá TẠI THỜI ĐIỂM BÁN. Hóa
-- đơn đã ghi giữ nguyên `unit_price` đã chốt — đó mới là số kế toán đúng, và nhờ
-- vậy không chương trình nào có thể làm đổi doanh thu của quá khứ.

create table if not exists public.product_promotions (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  -- NULL = áp dụng cho mọi chi nhánh. Có giá trị = chỉ chi nhánh đó.
  -- (Thực tế 08/2026: bánh hạt dẻ 71% doanh số nằm ở Lotte Vũng Tàu, nên chạy
  --  chương trình cho riêng một chi nhánh là nhu cầu có thật.)
  branch_id text references public.branches (id) on delete cascade,
  name text not null default '',
  -- Đúng MỘT trong hai: giá cố định, hoặc giảm theo phần trăm.
  promo_price numeric(12, 2),
  discount_percent numeric(5, 2),
  starts_on date not null,
  -- NULL = chạy tới khi tắt bằng tay.
  ends_on date,
  active boolean not null default true,
  note text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint product_promotions_one_kind check (
    (promo_price is not null and discount_percent is null)
    or (promo_price is null and discount_percent is not null)
  ),
  constraint product_promotions_price_positive check (promo_price is null or promo_price >= 0),
  constraint product_promotions_percent_range check (
    discount_percent is null or (discount_percent > 0 and discount_percent <= 100)
  ),
  constraint product_promotions_range_valid check (ends_on is null or ends_on >= starts_on)
);

create index if not exists product_promotions_lookup_idx
  on public.product_promotions (product_id, active, starts_on desc);

comment on table public.product_promotions is
  'Giá khuyến mãi có thời hạn, ghi đè products.price tại thời điểm bán. Không sửa hóa đơn đã ghi.';

alter table public.product_promotions enable row level security;

-- ĐỌC: mọi tài khoản đã đăng nhập. POS của nhân viên phải biết giá khuyến mãi,
-- nếu không thì nhân viên bán một giá còn hệ thống ghi một giá khác.
drop policy if exists "authenticated read promotions" on public.product_promotions;
create policy "authenticated read promotions" on public.product_promotions
  for select to authenticated using (true);

-- GHI: chỉ Admin. Đây là cấu hình giá bán, không phải thao tác vận hành.
drop policy if exists "admin writes promotions" on public.product_promotions;
create policy "admin writes promotions" on public.product_promotions
  for all to authenticated
  using ((public.current_profile()).role = 'admin')
  with check ((public.current_profile()).role = 'admin');

grant select on public.product_promotions to authenticated;
grant insert, update, delete on public.product_promotions to authenticated;
