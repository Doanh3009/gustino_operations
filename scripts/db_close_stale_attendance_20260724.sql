-- Chốt các ca chấm công còn treo của NGÀY CŨ (chủ sở hữu duyệt 2026-07-24).
--
-- KHÔNG động tới ca của hôm nay: người đang trong ca vẫn phải tự check-out.
-- KHÔNG xóa gì. Chỉ điền `check_out_time` cho bản ghi đang bỏ trống.
--
-- Giờ ra được chọn theo thứ tự:
--   1. Giờ kết ca THEO LỊCH của chính đăng ký đó (ca qua đêm thì cộng sang hôm sau).
--   2. Nếu giờ đó không sau giờ vào (dữ liệu lệch: check-in muộn hơn cả giờ tan ca)
--      thì lấy giờ vào + 1 phút — cố tình KHÔNG tự bịa thêm giờ công.
-- Chủ quán chỉnh lại giờ thật sau bằng màn Chỉnh công (có ghi nhật ký).
--
-- ĐẢO NGƯỢC: bảng `_attendance_closed_20260724` giữ nguyên trạng thái trước khi sửa.
--   update public.attendance_records a
--   set check_out_time = null
--   from public._attendance_closed_20260724 b
--   where a.id = b.record_id;

begin;

create table if not exists public._attendance_closed_20260724 (
  record_id uuid primary key,
  user_name text,
  branch_id text,
  work_date date,
  check_in_time timestamptz,
  check_out_before timestamptz,
  check_out_after timestamptz,
  rule text,
  closed_at timestamptz not null default now()
);

-- Bảng lưu vết chứa tên nhân viên + giờ làm: khoá lại, không để lộ qua PostgREST.
alter table public._attendance_closed_20260724 enable row level security;
revoke all on public._attendance_closed_20260724 from anon, authenticated;

with cham_cong_treo as (
  select a.id,
         a.check_in_time,
         p.full_name,
         a.branch_id,
         r.work_date,
         r.start_time,
         r.end_time,
         case
           when r.id is null then null
           else (r.work_date + r.end_time)::timestamp
                at time zone 'Asia/Ho_Chi_Minh'
                + case when r.end_time <= r.start_time then interval '1 day' else interval '0' end
         end as gio_tan_ca
  from public.attendance_records a
  left join public.profiles p on p.id = a.user_id
  left join public.shift_registrations r on r.id = a.shift_registration_id
  where a.check_out_time is null
    and (a.check_in_time at time zone 'Asia/Ho_Chi_Minh')::date
        < (now() at time zone 'Asia/Ho_Chi_Minh')::date
),
quyet_dinh as (
  select id,
         full_name,
         branch_id,
         work_date,
         check_in_time,
         case
           when gio_tan_ca is not null and gio_tan_ca > check_in_time then gio_tan_ca
           else check_in_time + interval '1 minute'
         end as gio_ra,
         case
           when gio_tan_ca is not null and gio_tan_ca > check_in_time then 'gio tan ca theo lich'
           else 'gio vao + 1 phut (du lieu lech, can chinh tay)'
         end as rule
  from cham_cong_treo
)
insert into public._attendance_closed_20260724 (
  record_id, user_name, branch_id, work_date, check_in_time, check_out_before, check_out_after, rule
)
select id, full_name, branch_id, work_date, check_in_time, null, gio_ra, rule
from quyet_dinh
on conflict (record_id) do nothing;

-- Đóng theo diện HÀNH CHÍNH: không có ảnh và GPS lúc ra vì người đó không hề bấm
-- check-out. Tuyệt đối không bịa toạ độ/ảnh; địa chỉ tự khai rõ để báo cáo nhìn là biết.
update public.attendance_records a
set check_out_time = b.check_out_after,
    check_out_selfie_url = null,
    check_out_latitude = null,
    check_out_longitude = null,
    check_out_accuracy = null,
    check_out_address = '[CHỐT HÀNH CHÍNH] Quên check-out, đóng theo giờ ca ngày '
      || to_char(b.work_date, 'DD/MM/YYYY') || ' - chờ chủ quán chỉnh giờ thật',
    updated_at = now()
from public._attendance_closed_20260724 b
where a.id = b.record_id
  and a.check_out_time is null;

-- Báo cáo lại đúng những gì vừa chốt.
select b.user_name as nhan_vien,
       b.branch_id as chi_nhanh,
       b.work_date::text as ngay_lam,
       to_char(b.check_in_time at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') as gio_vao,
       to_char(b.check_out_after at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI') as gio_ra_da_chot,
       round(extract(epoch from (b.check_out_after - b.check_in_time)) / 3600, 2) as so_gio,
       b.rule as cach_chon
from public._attendance_closed_20260724 b
order by b.work_date desc, b.user_name;

-- Còn sót ca treo nào của ngày cũ không? Phải bằng 0.
select count(*) as con_treo_ngay_cu
from public.attendance_records a
where a.check_out_time is null
  and (a.check_in_time at time zone 'Asia/Ho_Chi_Minh')::date
      < (now() at time zone 'Asia/Ho_Chi_Minh')::date;

commit;
