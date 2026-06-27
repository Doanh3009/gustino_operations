-- Đồng bộ mốc hoa hồng với báo cáo cuối ca: từ 15 túi.
-- Cột commission_per_unit được giữ để tương thích dữ liệu cũ; ứng dụng tính theo giá từng loại túi.

alter table public.commission_rules
alter column target_quantity set default 15;

update public.commission_rules
set target_quantity = 15,
    updated_at = now()
where target_quantity <> 15;
