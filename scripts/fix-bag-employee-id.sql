-- ============================================================================
-- DỌN DỮ LIỆU CŨ: túi đã phát bị gắn sai/thiếu tài khoản (employee_id)
-- khiến nhân viên không thấy/không bán được túi.
--
-- Cách dùng: Supabase Dashboard -> SQL Editor -> New query.
-- Dán & Run TỪNG BƯỚC theo thứ tự 1 -> 2 -> 3.
-- Chỉ động vào túi CHƯA đối soát (settled_at is null) cho an toàn.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- BƯỚC 1 — CHẨN ĐOÁN (chỉ xem, không sửa gì). Chạy để biết tình hình.
-- ----------------------------------------------------------------------------
create extension if not exists unaccent;

select
  s.business_date                                   as ngay,
  s.sequence                                        as ca,
  a.employee_name                                   as ten_tren_tui,
  a.employee_id,
  p_now.full_name                                   as ten_tai_khoan_hien_tai,
  (a.employee_id is null)                           as thieu_tai_khoan,
  (a.employee_id is not null and p_now.id is null)  as tai_khoan_khong_ton_tai,
  (select count(*) from profiles p
     where p.branch_id = a.branch_id
       and p.role in ('staff','shift_leader')
       and coalesce(p.active, true)
       and lower(regexp_replace(unaccent(trim(p.full_name)), '\s+', ' ', 'g'))
         = lower(regexp_replace(unaccent(trim(a.employee_name)), '\s+', ' ', 'g'))
  )                                                 as so_tai_khoan_trung_ten
from bag_allocations a
join bag_shift_sessions s on s.id = a.shift_id
left join profiles p_now on p_now.id = a.employee_id
where a.settled_at is null
order by s.business_date desc, a.employee_name;

-- Đọc kết quả:
--   thieu_tai_khoan = true  HOẶC  tai_khoan_khong_ton_tai = true  -> túi mồ côi, cần gắn lại.
--   so_tai_khoan_trung_ten = 1 -> Bước 2 sẽ tự gắn đúng.
--   so_tai_khoan_trung_ten = 0 -> nhân viên này CHƯA có tài khoản đúng tên (nhờ Admin tạo/sửa tên tài khoản rồi chạy lại).
--   so_tai_khoan_trung_ten > 1 -> trùng tên nhiều tài khoản, phải xử lý tay (xem Bước 3b).


-- ----------------------------------------------------------------------------
-- BƯỚC 2 — TỰ SỬA AN TOÀN: chỉ gắn lại túi mồ côi khi tên khớp DUY NHẤT 1 tài khoản.
-- (Không đụng tới túi đã có tài khoản hợp lệ, không đụng túi đã đối soát.)
-- ----------------------------------------------------------------------------
with orphan as (
  select a.id, a.branch_id,
         lower(regexp_replace(unaccent(trim(a.employee_name)), '\s+', ' ', 'g')) as nname
  from bag_allocations a
  where a.settled_at is null
    and (a.employee_id is null or a.employee_id not in (select id from profiles))
),
matched as (
  select o.id as allocation_id,
         (select p.id from profiles p
            where p.branch_id = o.branch_id
              and p.role in ('staff','shift_leader')
              and coalesce(p.active, true)
              and lower(regexp_replace(unaccent(trim(p.full_name)), '\s+', ' ', 'g')) = o.nname
            limit 1) as new_employee_id,
         (select count(*) from profiles p
            where p.branch_id = o.branch_id
              and p.role in ('staff','shift_leader')
              and coalesce(p.active, true)
              and lower(regexp_replace(unaccent(trim(p.full_name)), '\s+', ' ', 'g')) = o.nname
         ) as match_count
  from orphan o
)
update bag_allocations a
set employee_id = m.new_employee_id
from matched m
where a.id = m.allocation_id
  and m.match_count = 1
  and m.new_employee_id is not null;
-- Postgres sẽ báo "UPDATE n" = số dòng đã sửa.


-- ----------------------------------------------------------------------------
-- BƯỚC 3 — KIỂM TRA LẠI: chạy lại Bước 1. Những dòng còn thieu_tai_khoan = true
-- là các trường hợp tên không khớp tài khoản nào -> cần Admin tạo/sửa tài khoản.
-- ----------------------------------------------------------------------------


-- ----------------------------------------------------------------------------
-- BƯỚC 3b (TÙY CHỌN, làm tay) — gắn 1 dòng cụ thể cho đúng tài khoản.
-- Lấy <profile_id> trong bảng profiles (cột id) của đúng nhân viên, rồi:
--
--   update bag_allocations
--   set employee_id = '<profile_id>'
--   where id = '<allocation_id>';
--
-- (lấy <allocation_id> ở cột employee_id... thực ra là cột id của dòng túi trong Bước 1)
-- ----------------------------------------------------------------------------
