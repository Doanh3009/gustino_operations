-- Tiền thưởng KPI ngày do Admin tự đặt trong giao diện.
--
-- Trước bản này, chỉ tiêu doanh thu đã chỉnh được trên màn Cấu hình hệ thống →
-- tab Mức KPI, nhưng SỐ TIỀN THƯỞNG vẫn nằm cứng trong `src/lib/commission.ts`
-- (`dailyKpiBonus`): PG đạt 100–109% → 20.000đ/ca, từ 110% → 40.000đ/ca, Ca
-- trưởng/Ca phó đạt KPI → 30.000đ/ca. Muốn đổi một con số là phải sửa mã nguồn
-- rồi build + deploy lại — đúng cái bất tiện mà bảng `branch_kpi_formulas` sinh
-- ra để chấm dứt.
--
-- Tiền thưởng KPI chỉ có MỘT nguồn là thưởng theo ngày (không thưởng tuần,
-- không thưởng tháng — xem CODEMAP §56), nên hai cột này là toàn bộ tiền KPI của
-- một (chi nhánh, vị trí).
--
-- Để NULL = chưa đặt riêng ⇒ chạy đúng mức mặc định trong mã nguồn. Nhờ vậy mọi
-- dòng override đã có từ trước KHÔNG bị tụt thưởng về 0 khi apply migration này.

alter table public.branch_kpi_formulas
  add column if not exists daily_bonus_100 numeric(14,0) check (daily_bonus_100 >= 0),
  add column if not exists daily_bonus_110 numeric(14,0) check (daily_bonus_110 >= 0);

comment on column public.branch_kpi_formulas.daily_bonus_100 is
  'Tien thuong ngay (d/ca) khi dat 100-109% chi tieu cua ngay. NULL = dung muc mac dinh trong ma nguon.';
comment on column public.branch_kpi_formulas.daily_bonus_110 is
  'Tien thuong ngay (d/ca) khi dat tu 110% chi tieu cua ngay. NULL = dung muc mac dinh trong ma nguon.';

notify pgrst, 'reload schema';
