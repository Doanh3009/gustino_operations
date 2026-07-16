-- 2026-07-03: Dọn dữ liệu vận hành còn treo từ giai đoạn test tháng 6.
-- 1) Allocation chưa đối soát nhưng ca đã đóng và thuộc ngày cũ (nhân viên được phát
--    đã bị xóa profile trong đợt purge) → tự đối soát: trả lại phần chưa bán/chưa hỏng.
-- 2) operation_days ngày cũ còn status='open' → đóng lại để không hiện "ngày chưa chốt".
-- Chỉ đụng dữ liệu NGÀY CŨ (business_date < current_date); ngày hôm nay giữ nguyên.

update public.bag_allocations a
set returned_quantity = greatest(0, a.issued_quantity - a.sold_quantity - a.damaged_quantity),
    settlement_shift_id = a.shift_id,
    settled_at = now()
where a.settled_at is null
  and exists (
    select 1
    from public.bag_shift_sessions s
    where s.id = a.shift_id
      and s.status = 'closed'
      and s.business_date < current_date
  );

update public.operation_days
set status = 'closed',
    closed_at = now()
where status = 'open'
  and business_date < current_date;
