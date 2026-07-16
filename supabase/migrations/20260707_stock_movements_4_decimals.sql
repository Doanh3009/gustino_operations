-- Bàn giao ca tính thành phẩm theo kg tới 4 số lẻ.
-- Nới scale cột lượng kho từ 3 -> 4 số lẻ (mở rộng, không mất dữ liệu cũ).

alter table public.stock_movements
  alter column quantity type numeric(14,4),
  alter column source_quantity type numeric(14,4),
  alter column measured_weight_kg type numeric(14,4);
