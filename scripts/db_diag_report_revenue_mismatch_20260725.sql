-- CHẨN ĐOÁN (CHỈ ĐỌC) — tìm ngày có báo cáo đã chốt bị lệch doanh thu, thường do
-- bấm nhầm bàn giao ca tối rồi mở lại ngày mà không chốt/gửi lại báo cáo.
--
-- Chạy:
--   npm_config_cache=/d/gustino/.npm-cache npx --yes supabase@2.109.1 \
--     db query --linked --file scripts/db_diag_report_revenue_mismatch_20260725.sql
-- hoặc dán vào Supabase SQL Editor. KHÔNG ghi gì, an toàn tuyệt đối.

-- 1) Snapshot đã chốt vs hóa đơn POS thật của cùng chi nhánh/ngày.
--    diff_revenue lớn = báo cáo đã gửi (Zalo/kho báo cáo) đang lệch so với bán thật.
--    Lưu ý: lệch nhỏ có thể do doanh thu túi cũ (allocation) không nằm trong receipts;
--    tập trung vào các dòng lệch nhiều hoặc snap_revenue = 0 mà live_revenue > 0.
with snap as (
  select branch_id,
         report_date,
         nullif(payload->'summary'->>'revenue','')::numeric   as snap_revenue,
         nullif(payload->'summary'->>'totalSold','')::numeric  as snap_sold,
         created_at
  from public.report_snapshots
  where report_date >= current_date - 30
),
rcpt as (
  select branch_id,
         business_date,
         sum(total_amount)   as live_revenue,
         sum(total_quantity) as live_sold,
         count(*)            as receipts
  from public.sales_receipts
  where business_date >= current_date - 30
  group by branch_id, business_date
)
select s.branch_id,
       s.report_date,
       s.snap_revenue,
       coalesce(r.live_revenue, 0)                              as live_revenue,
       coalesce(r.live_revenue, 0) - coalesce(s.snap_revenue,0) as diff_revenue,
       s.snap_sold,
       r.live_sold,
       r.receipts,
       s.created_at                                             as snapshot_at
from snap s
left join rcpt r on r.branch_id = s.branch_id and r.business_date = s.report_date
where coalesce(s.snap_revenue, 0) <> coalesce(r.live_revenue, 0)
order by abs(coalesce(r.live_revenue,0) - coalesce(s.snap_revenue,0)) desc
limit 40;

-- 2) Ca đã bị MỞ LẠI hoặc CHỐT THAY (dấu vết bấm nhầm + mở lại).
select branch_id,
       business_date,
       sequence,
       status,
       started_at,
       ended_at,
       left(regexp_replace(coalesce(discrepancy_note, ''), '\s+', ' ', 'g'), 180) as note
from public.bag_shift_sessions
where discrepancy_note ~* 'M(Ở|O) ?L(Ạ|A)I|CH(Ố|O)T ?THAY'
order by business_date desc, branch_id;

-- 3) Ngày đã CHỐT (operation_days.closed) nhưng vẫn còn hóa đơn tạo SAU lúc chốt
--    snapshot — dấu hiệu "chốt sớm/bấm nhầm" rồi bán tiếp.
select d.branch_id,
       d.business_date,
       d.closed_at,
       count(sr.id) filter (where sr.created_at > s.created_at) as receipts_after_snapshot,
       sum(sr.total_amount) filter (where sr.created_at > s.created_at) as revenue_after_snapshot
from public.operation_days d
join public.report_snapshots s
  on s.branch_id = d.branch_id and s.report_date = d.business_date
left join public.sales_receipts sr
  on sr.branch_id = d.branch_id and sr.business_date = d.business_date
where d.status = 'closed'
  and d.business_date >= current_date - 30
group by d.branch_id, d.business_date, d.closed_at, s.created_at
having count(sr.id) filter (where sr.created_at > s.created_at) > 0
order by d.business_date desc, d.branch_id;
