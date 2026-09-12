# Supabase egress review — 2026-09-12

Chỉ review; chưa sửa ứng dụng/SQL/config/deploy. Diff dưới đây chưa áp dụng hoặc kiểm thử. Source React19/Vite/SupabaseJS; package.json không có React Query/SWR, source không có refetchInterval/refreshInterval. Không tìm thấy timer cloud cố định 2–3s hoặc effect chắc chắn fetch vô hạn. Chưa có HAR/trace production để quy log cho caller; Realtime burst/nhiều thiết bị hoặc deploy khác có thể giải thích nhịp đó. Không đo byte egress, không gọi production để thử tải.

## 1. Timer và đề xuất từng vị trí

| ID | File:dòng | Nhịp / dữ liệu | Đề xuất |
|---|---|---|---|
| P01 | src/App.tsx:179–186 | 15s stock delta + count3ngày; mỗi10tick full lịch sử150s; visible | Đã Realtime:298; cloud120s, full15phút, single-flight; giữ DELETE/full và delta failure fallback. LAN giữ15s. |
| P02 | src/App.tsx:216 | 60s reconcileOperationalShift: sessions/day, có thể shifts/branches/registrations/attendance/kho | Giữ60s vì tự mở/nhận lại ca; visible/online guard + event check-in; không bỏ nghiệp vụ. |
| P03 | src/App.tsx:234 | 45s flush outbox; API khi có bằng chứng chờ | Retry ghi chấm công, giữ reliability, không phải polling list. |
| P04 | src/pages/TodayPage.tsx:133 | 8s sessions + receipts ngày, song song Realtime | Cloud120s/LAN8s; single-flight, tách datasets. |
| P05 | src/pages/TodayPage.tsx:164–172 | 30s registrations/attendance chi nhánh/ngày, cả hidden | Realtime2bảng theo branch, fallback cloud120s/LAN30s visible; nhắc giờ tính cục bộ. |
| P06 | src/pages/KitchenPage.tsx:71 | 8s full supply history + Realtime:80, hidden vẫn chạy | Cloud120s/LAN8s, debounce800ms, single-flight, active list và history page50 riêng. |
| P07 | src/pages/AdminPage.tsx:649 | 30s toàn dataNeeds của section + Realtime:662, hidden vẫn chạy | Cloud120s/LAN30s visible, debounce1s; invalidate theo bảng. |
| P08 | src/pages/AdminPage.tsx:637 | 30s active_user_sessions | Giữ30s visible; Realtime mỗi heartbeat có thể nhiều hơn polling. |
| P09 | src/pages/ManagerDashboardPage.tsx:126 | cloud30s/LAN5s, reloadTick tải full kho/snapshots/allocations/employees và receipts/sessions kỳ | Cloud120s visible; tách dirty datasets. |
| P10 | src/pages/AttendancePage.tsx:183 | cloud60s/LAN15s dataNeeds, hidden vẫn chạy | Giữ60s visible; cache master data, tách refresh. |
| P11 | src/pages/AttendancePage.tsx:1293 | 10s onChanged chỉ khi !supabase | LAN/local, không bằng chứng cloud polling; giữ hoặc30s sau review LAN. |
| P12 | src/components/AppShell.tsx:276 | 30s own slips limit24 + Realtime |120s visible, shared cache/page subscription; badge projection nhẹ. |
| P13 | src/components/AppShell.tsx:343 | 30s heartbeat write, immediate khi đổi page | Dừng hidden, beat khi visible; giữ30s tương thích onlineWindow2phút. |
| P14 | src/components/AppShell.tsx:413 | cloud60s/LAN30s registrations+dated records+own open records, focus/storage/events/Realtime | Giữ60s visible/single-flight, storage key allowlist; nhắc giờ từ cache. |
| P15 | src/pages/OrdersPage.tsx:120 |30s full requests+Realtime; đã visible guard | Cloud120s/LAN30s; active/history riêng. |
| P16 | src/pages/MessagesPage.tsx:51,99 | Hai timer10s inbox/history RPC, hai subscription cùng sender/recipient | Realtime chính, fallback60s visible; chỉ refresh thread đúng peer; shared event scheduler. History đã cursor. |
| P17 | src/pages/MyPayslipsPage.tsx:51 |30s own slips limit24, shell cũng30s |120s shared cache/Realtime; vẫn reconcile revoke/delete. |
| P18 | src/pages/SalesPage.tsx:133 |5s chỉ !supabase; cloud Realtime:143 | Không coi là cloud polling; LAN có thể15s, cloud sửa full-group refresh. |
| P19 | src/pages/ShiftHandoverPage.tsx:269 |5s khi không cloud client (!supabase/authToken) | LAN có thể15s; cloud đã Realtime, thêm single-flight. |
| P20 | src/pages/ReportPage.tsx:341–346 |5s chỉ LAN/local (!supabase/authToken) | LAN có thể15s; cloud gộp6callbacks:353–389. |

Các interval mới là đề xuất độ trễ để review, chưa phải tối ưu đã đo. Giữ refresh focus/online/visible/SUBSCRIBED và cleanup. Visibility/version guard không thay thế single-flight: request cũ vẫn tốn egress dù không được ghi vào state.

## 2. Realtime/effect/fetch thừa có bằng chứng

| ID | Vị trí | Bằng chứng | Sửa đề xuất |
|---|---|---|---|
| R01 | AdminPage:552–565,662 | Mỗi event gọi toàn dataNeeds, không debounce. In-flight+queued rerun vẫn nối batch liên tục | Debounce1s + dirty map table→dataset; receipt không refetch employees/shifts. |
| R02 | ReportPage:353–389,263–268 | Mỗi event tải ledger6datasets, không debounce/in-flight; snapshots full history | Debounce1s, single-flight; refresh đúng dataset và snapshot đúng ngày. |
| R03 | AttendancePage:203-220,1307-1318 | Parent Board listens registrations; child Board listens entries/people/shifts without branch/week filter. Entries callback loadEntries+onChanged reloads parent master/registrations | Entries event only reload entries; people/shifts invalidate corresponding master data; scope INSERT/UPDATE by branch and preserve DELETE reconciliation. Parent registration listener remains. |
| R04 | SalesPage:96–100,143–146 | Sale/items event reload receipts+registrations+attendance+employees nếu quản lý; items toàn hệ thống | Tách receipt/attendance/staff refresh; items kiểm tra receipt scope khi payload cho phép, unknown dùng scoped reconciliation. |
| R05 | TodayPage:100–105,120–125 | Mỗi setBagSessions mảng mới, kể cả không đổi dữ liệu, effect bagSessions tải snapshots toàn lịch sử | Dependency semantic session key; snapshot đúng ngày, subscribe snapshots để bắt report đổi. |
| R06 | ManagerDashboardPage:65–118,141–147 |7bảng toàn hệ thống; debounce1500ms nhưng reloadTick tải full nhóm | Dirty sets, master cache, snapshots/allocation scope kỳ; kho giữ đủ. |
| R07 | attendance.ts:118,132,152,240,242 | activeBranchIdSet đọc branches ở nhiều helpers; fetchSchedulePeople còn fetchEmployees+branches, trùng parent | Shared in-flight branches, TTL60s invalidate branches/auth; employees dedupe theo user/scope/includeInactive hoặc truyền kết quả batch. |
| R08 | branches.ts:270–287 | Mỗi useConfiguredBranches mount có fetch+subscription riêng | Shared store/subscription scope-safe; notify chỉ đọc cache, không phải vòng fetch vô hạn. |
| R09 | Today:106,144; Sales:114,148; Handover:252,283; Report:293,391 | Initial fetch+SUBSCRIBED cùng tải; reconnect cần tải bù | Single-flight/dirty timestamp, giữ reconnect reconciliation. |
| R10 | MyTimesheet:117–119; Kitchen:38–68 | deps user object/callback; App hiện giữ user trong state | Chưa có bằng chứng infinite loop. Nếu làm stable deps phải giữ đủ role/branchIds/authToken, không chỉ user.id. |
| R11 | Attendance:1182–1196 | deps callback/branches reference nhưng có bootstrappedBranches guard; dispatch event+onChanged có thể duplicate | Dedupe triggers, giữ bootstrap; không báo bug loop. |
| R12 | AppShell:419; MyTimesheet:122–132 và page focus/visibility/online | Nhiều trigger gần nhau; AppShell storage mọi key | Cùng scheduler, visible/online guard, filter storage key. |
| R13 | App:298–314 | Realtime delta/full chạy cùng timer; operation_days callback không debounce | Single-flight scheduler; giữ DELETE full và correctness UPDATE/đối soát. |

Timer không phải polling list: Attendance:419/Today:87 clock15s; Sales:56/Handover:57/Report:256 clock30s; App:266 session expiry5phút; Kitchen:92 bell60s. setTimeout: GlobalLoadingOverlay:50,69 UI; App:538 route; Attendance:1334 join retry tối đa3×500ms/:1462 UI; attendance:1144 deadline/:1170 retry350ms/:2467 retry250ms/:2490 abort; attendanceOutbox:82 IDB deadline; browser:28 debounce600ms/:41 cleanup; ControlCenter:564 autosave800ms; Admin:2246 autosave rule; Report:770 poster retry400ms; Today:402 modal; Sales:731 cleanup; Kitchen:441 audio cleanup; n8nReports:68 timeout/:138 gap/:144 bounded retry; n8nShiftPhoto:39 timeout. api và lan-server timers là abort/grace timeout. Không có setTimeout đệ quy polling Supabase list vô hạn được tìm thấy.

## 3. Pagination/limit: thiếu và đã có

| Query/caller | Hiện trạng và đề xuất |
|---|---|
| attendance.ts:118/133/153; branches.ts:106 | branches/shifts/profiles không range/limit; master/config cần đọc đủ, cache/dedupe. Directory UI page50 riêng, report/schedule nguồn đầy đủ range500. |
| attendance.ts:273 | schedule_entries branch+tuần nhưng không range; range500 order(work_date,id), không cap làm mất ca/người. |
| attendance.ts:599/1041; attendanceAdjustments:61 | Đã range500 loop full scope. AttendancePage:126 schedule chỉ userId không date, có thể toàn lịch sử; phải bảo toàn own-open/overdue trước khi thu hẹp ngày. |
| store.ts:136/187 | movements đã range, full lịch sử vì calculateStock; giảm full refresh bằng delta/cache, không limit đầu vào tính tồn. |
| salesReceipts.ts:82/107 | Đã range500 full ngày/kỳ+nested items. Summary cho Today/dashboard; UI history cursor50 riêng, aggregate giữ đủ. |
| supplyRequests.ts:166 | Đã range500 nhưng full history mỗi refresh; active(pending/acknowledged) đầy đủ + history page50/server date/status filter. |
| store.ts:571 | snapshots không range/limit, JSON lớn. Today:101/Report:268/store:602 chỉ đọc đúng ngày. Archive:52 đã month scope nhưng cần pagination; Admin:564/Manager:72/Restaurant:21 cần scope/summary/history page. |
| store.ts:646 | inventory_reports full branch không range/date; thêm filters+range500, UI page50; không cắt report cũ khi phần tồn cần nó. |
| shiftLedger.ts:59/84/93/103 | sessions/allocations không range; range500 stable order+id. Allocation branch-only full lịch sử ở Payroll:57/MyTimesheet:101/Admin:561/Manager:73/Restaurant:22; scope kỳ qua sessionIDs hoặc join phù hợp schema, giữ settlement/ownership rule. |
| payroll.ts:74/82 | entries tháng+branch/fixed config active không range; entries range500, config đủ/cache. Own slips:148 đã limit24. |
| activeUsers.ts:30 | cutoff2phút không range/limit; giữ đầy đủ số online, projection6cột/visible30s. |
| commission.ts:324/446 | KPI targets/rules không range/limit; scope/cache, targets range khi lớn; rules đọc đủ. |
| ControlCenter:244/256/227 | Lotte branch+date thiếu range: đầy đủ range500 cho đối soát/UIpage50 riêng. Audit đã limit300; permissions config đọc đủ. |
| api/n8n/revenue.ts:111/193/209 | snapshots/sessions/allocations thiếu range; IN chunk200 không bảo đảm <1000 allocations; range500 từng query, giữ tổng report. Receipts:152/movements:264 đã range. |
| api/auto-close-day.ts:120/131/206/291 | REST lists chưa có pagination ở sessions/allocations/receipts; attendance cần scoped paging; limit500+offset+stable order, không cap chốt ngày. Days:83 đã batchlimit100, snapshot:160 limit1. |
| functions/manage-employee/index.ts:293/298/345/394 | Admin/delete ID reads thiếu range; range500+chunk, không test xóa production; không polling frontend. |

Thiếu pagination có nguy cơ thiếu kết quả do giới hạn response, chưa chứng minh tải toàn bảng thực tế. Loop range vẫn tải đủ scope nên giảm page size đơn thuần không giảm tổng bytes. Không thêm limit vào tính kho/doanh thu/KPI/lương/export/chốt ca.

## 4. Diff refetch và pagination (fragments chưa áp dụng)

```diff
--- src/pages/TodayPage.tsx:133
- const timer = window.setInterval(reloadWhenVisible, 8000)
+ const timer = window.setInterval(reloadWhenVisible, user.authToken || !supabase ? 8000 : 120000)
--- src/pages/KitchenPage.tsx:71
- const timer = window.setInterval(() => void refresh().catch(() => {}), 8000)
+ const timer = window.setInterval(() => {
+   if (!document.hidden && navigator.onLine) void refresh().catch(() => {})
+ }, user.authToken || !supabase ? 8000 : 120000)
--- src/pages/AdminPage.tsx:649
- const timer = window.setInterval(refreshWhenActive, 30000)
+ const timer = window.setInterval(refreshWhenActive, user.authToken || !supabase ? 30000 : 120000)
--- src/pages/ManagerDashboardPage.tsx:126
- const timer = window.setInterval(refreshWhenActive, client ? 30000 : 5000)
+ const timer = window.setInterval(refreshWhenActive, client ? 120000 : 5000)
--- src/pages/OrdersPage.tsx:120
- const timer = window.setInterval(refreshSilently, 30000)
+ const timer = window.setInterval(refreshSilently, user.authToken || !supabase ? 30000 : 120000)
--- src/pages/MessagesPage.tsx:51,99
- const timer = window.setInterval(refreshInbox, 10000)
+ const timer = window.setInterval(refreshInbox, 60000)
- const timer = window.setInterval(refresh, 10000)
+ const timer = window.setInterval(refresh, 60000)
--- src/components/AppShell.tsx:276
- const payslipTimer = window.setInterval(refreshPayslips, 30000)
+ const payslipTimer = window.setInterval(refreshPayslips, 120000)
--- src/pages/MyPayslipsPage.tsx:51
- const timer = window.setInterval(refresh, 30000)
+ const timer = window.setInterval(refresh, 120000)
```

P07/P09/P12/P16/P17: thêm visible/online guard vào trigger interval, giữ event dirty khi hidden để reconcile visible. P08/P10/P14 giữ interval, guard tương tự. P13 beat guard+visibility beat giữ30s. P02 attempt guard+online/visibility listeners giữ60s. P03 giữ. P01 cloud120s và full timestamp15phút, LAN15s/full150s; single-flight cho mọi trigger. P05 dùng một reloadAttendance single-flight cho initial/2subscriptions branch registrations+attendance/visible/online/focus; cloud120s/LAN30s, cleanup removeChannel. P11/P18–20 không đổi LAN trước review, hoặc10s→30s/5s→15s nếu chấp nhận độ trễ.

```diff
--- src/pages/AdminPage.tsx:660–662
+ const reloadSoon = burstGuard(refreshWhenActive, 1000) // gộp import browser hiện có
- channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => void refresh(false))
+ channel.on('postgres_changes', { event: '*', schema: 'public', table }, reloadSoon)
@@ cleanup
+ reloadSoon.cancel()
--- src/pages/ReportPage.tsx:353–389
+ const reloadLedgerSoon = burstGuard(() => {
+   if (!document.hidden) void refreshLedger().catch(() => null)
+ }, 1000)
+ const reloadDaySoon = burstGuard(() => {
+   if (!document.hidden) void refreshFinalizationState().catch(() => null)
+ }, 1000)
@@ từng callback sessions/allocations/receipts/attendance/snapshots
- }, () => void refreshLedger().catch(() => null))
+ }, reloadLedgerSoon)
@@ callback operation_days
- }, () => void refreshFinalizationState().catch(() => null))
+ }, reloadDaySoon)
@@ cleanup
+ reloadLedgerSoon.cancel()
+ reloadDaySoon.cancel()
--- src/pages/TodayPage.tsx:100–105
+ const sessionReportKey = bagSessions.map((s) => [s.id,s.status,s.endedAt].join(':')).sort().join('|')
- void fetchReportSnapshots(user.branchId, user).then((snapshots) => {
+ void fetchReportSnapshots(user.branchId, user, { from: todayKey, to: todayKey }).then((snapshots) => {
- }, [todayKey, user.id, user.branchId, bagSessions])
+ }, [todayKey, user.id, user.branchId, sessionReportKey])
--- src/pages/ReportPage.tsx:268
- fetchReportSnapshots(user.branchId, user),
+ fetchReportSnapshots(user.branchId, user, { from: businessDate, to: businessDate }),
--- src/lib/store.ts:602
- const existing = (await fetchReportSnapshots(user.branchId, user))
+ const existing = (await fetchReportSnapshots(user.branchId, user, { from: businessDate, to: businessDate }))
```

Today phải thêm subscription snapshots branch để report thay đổi dù session không đổi vẫn cập nhật. Board R03: một owner invalidation, entries callback chỉ scheduler loadEntries; không bỏ refresh people/shifts. R04/R06: map table→dirty receipts/attendance/master; scheduler chỉ fetch dirty set, full refresh khi scope/ngày/reconnect. R07/R08: shared in-flight theo session/scope, TTL60s invalidate branches/write/logout; fetchSchedulePeople nhận employees batch thay gọi lần nữa, giữ activeProfile/branchless filtering. Không cache chung kết quả khác user/role/scope/includeInactive. R09/R12/R13 cùng single-flight dirty scheduler cho focus/timer/events; mutation cần await dữ liệu mới không trả stale.

Pagination cho từng query thiếu ở mục3: helper readAllPages page500, query mới mỗi page giữ filters, stable order+PK, throw errors/dừng page<500, dedupe ID khi ghi đồng thời. Ví dụ:

```diff
--- src/lib/shiftLedger.ts:59–66
- const { data, error } = await request
- if (error) throw error
- return (data || []).map(mapBagShiftSession)
+ const rows = await readAllPages((from, to) => buildScopedSessionsQuery()
+   .order('started_at', { ascending: false }).order('id', { ascending: false }).range(from,to))
+ return rows.map(mapBagShiftSession)
```

Helper mới cần implement/test, chưa phải patch hoàn chỉnh. Áp dụng tương tự snapshots/inventoryReports/scheduleEntries/allocations/Lotte/payroll/backend ID reads, dùng order field phù hợp. REST thêm limit500/offset theo loop thay cap500. UI page riêng limit51 render50+hasMore, cursor(created_at,id), filter server; summary mapper riêng không giả lines rỗng cho aggregate. Supply active đọc đủ bằng range, history cursor50. Không đổi RPC contract/schema ở review này.

## 5. Kiểm chứng sau khi duyệt

Ưu tiên debounce/dirty refresh và snapshot đúng ngày, sau đó polling/cache, projection rồi pagination. Regression POS→kho→bàn giao→report, ca qua đêm/outbox/nhắc giờ, payroll/KPI, chat/unread/revoke/delete. Đo5phút idle+burst cùng user/route/branch, requests/responsebytes theo caller/table; hidden không polling, visible/reconnect tải bù, socket lỗi fallback. Test >1000rows/same timestamp cursor và thay scope/role/stale response. Chưa có % tiết kiệm thực tế; riêng timer Today8s→120s từ450 xuống30nhịp/giờ/tab (~93%), không phải93% tổng egress.

Realtime cần publication/RLS đúng; DELETE không thể coi branch filter như INSERT/UPDATE, giữ reconciliation. Chưa đổi publication/schema. Nguồn: [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes). Realtime vẫn truyền dữ liệu; chuyển sang subscription nhưng callback full-refetch liên tục vẫn tốn.

## 6. Select wildcard: danh sách và diff từng vị trí

Phụ lục bên dưới lấy projection từ mapper hiện có; không bỏ cột lịch sử chỉ vì UI mới ít dùng. Attendance có fallback check_out_selfie_url/checkout_selfie_url, payroll có cột mới/fixed_salary: explicit select cột không tồn tại sẽ lỗi, cần xác minh schema hiện hành/chọn projection theo schema trước release. Không tự apply migration. Field ảnh dataURL/JSON vẫn nặng nếu giữ select; summary/detail riêng khi phù hợp.

### S01 - src/lib/activeUsers.ts:30 - active_user_sessions

```diff
- .select('*')
+ .select('user_id,user_name,role,branch_id,page,last_seen_at')
```

### S02 - src/lib/attendance.ts:133 - shifts

```diff
- .select('*')
+ .select('id,branch_id,name,start_time,end_time,grace_minutes,recommended_staff,employment_types,active')
```

### S03 - src/lib/attendance.ts:273 - schedule_entries

```diff
- .select('*')
+ .select('id,person_id,branch_id,work_date,shift_id,start_time,end_time,note')
```

### S04 - src/lib/attendance.ts:599 - shift_registrations

```diff
- .select('*, profiles!shift_registrations_user_id_fkey(full_name, active, employment_type, position_title)')
+ .select('id,user_id,employment_type,position_title,branch_id,work_date,start_time,end_time,shift_id,status,note,reviewed_by,reviewed_at,rejection_reason,created_at, profiles!shift_registrations_user_id_fkey(full_name, active, employment_type, position_title)')
```

### S05 - src/lib/attendance.ts:1041 - attendance_records

```diff
- .select('*, profiles!attendance_records_user_id_fkey(full_name, active), shift_registrations!inner(work_date)')
+ .select('id,user_id,branch_id,shift_registration_id,check_in_time,check_out_time,selfie_url,check_out_selfie_url,check_in_latitude,check_in_longitude,check_in_accuracy,check_in_address,check_out_latitude,check_out_longitude,check_out_accuracy,check_out_address,created_at,updated_at, profiles!attendance_records_user_id_fkey(full_name, active), shift_registrations!inner(work_date)')
```

### S06 - src/lib/attendance.ts:1072 - attendance_records

```diff
- .select('*, profiles!attendance_records_user_id_fkey(full_name, active)')
+ .select('id,user_id,branch_id,shift_registration_id,check_in_time,check_out_time,selfie_url,check_out_selfie_url,check_in_latitude,check_in_longitude,check_in_accuracy,check_in_address,check_out_latitude,check_out_longitude,check_out_accuracy,check_out_address,created_at,updated_at, profiles!attendance_records_user_id_fkey(full_name, active)')
```

### S07 - src/lib/attendance.ts:1547 - attendance_records

```diff
- .select('*, profiles!attendance_records_user_id_fkey(full_name, active)')
+ .select('id,user_id,branch_id,shift_registration_id,check_in_time,check_out_time,selfie_url,check_out_selfie_url,check_in_latitude,check_in_longitude,check_in_accuracy,check_in_address,check_out_latitude,check_out_longitude,check_out_accuracy,check_out_address,created_at,updated_at, profiles!attendance_records_user_id_fkey(full_name, active)')
```

### S08 - src/lib/attendanceAdjustments.ts:61 - attendance_adjustment_requests

```diff
- .select('*, profiles!attendance_adjustment_requests_user_id_fkey(full_name)')
+ .select('id,user_id,branch_id,kind,work_date,scheduled_time,actual_time,reason,evidence_note,created_by,created_at, profiles!attendance_adjustment_requests_user_id_fkey(full_name)')
```

### S09 - src/lib/commission.ts:324 - employee_kpi_targets

```diff
- .select('*')
+ .select('branch_id,employee_key,employee_id,employee_name,target_revenue,updated_at')
```

### S10 - src/lib/commission.ts:373 - employee_kpi_targets

```diff
- .select()
+ .select('branch_id,employee_key,employee_id,employee_name,target_revenue,updated_at')
```

### S11 - src/lib/commission.ts:446 - commission_rules

```diff
- .select('*')
+ .select('id,branch_id,target_quantity,commission_per_unit,updated_at')
```

### S12 - src/lib/commission.ts:477 - commission_rules

```diff
- .select()
+ .select('id,branch_id,target_quantity,commission_per_unit,updated_at')
```

### S13 - src/lib/payroll.ts:74 - payroll_entries

```diff
- .select('*')
+ .select('id,employee_id,branch_id,period,base_salary,responsibility_allowance,attendance_allowance,meal_transport_allowance,agreed_salary,fixed_salary,daily_rate,workday_salary,overtime_hours,kpi_bonus,net_salary,note,published_at,employee_viewed_at,employee_confirmed_at')
```

### S14 - src/lib/payroll.ts:82 - payroll_fixed

```diff
- .select('*')
+ .select('branch_id,role,employment_type,position_title,fixed_salary,responsibility_allowance,attendance_allowance,lunch_allowance,parking_allowance')
```

### S15 - src/lib/payroll.ts:99 - payroll_entries

```diff
- .select('*')
+ .select('id,employee_id,branch_id,period,base_salary,responsibility_allowance,attendance_allowance,meal_transport_allowance,agreed_salary,fixed_salary,daily_rate,workday_salary,overtime_hours,kpi_bonus,net_salary,note,published_at,employee_viewed_at,employee_confirmed_at')
```

### S16 - src/lib/payroll.ts:139 - payroll_entries

```diff
- .select('*')
+ .select('id,employee_id,branch_id,period,base_salary,responsibility_allowance,attendance_allowance,meal_transport_allowance,agreed_salary,fixed_salary,daily_rate,workday_salary,overtime_hours,kpi_bonus,net_salary,note,published_at,employee_viewed_at,employee_confirmed_at')
```

### S17 - src/lib/payroll.ts:148 - payroll_entries

```diff
- .select('*')
+ .select('id,employee_id,branch_id,period,base_salary,responsibility_allowance,attendance_allowance,meal_transport_allowance,agreed_salary,fixed_salary,daily_rate,workday_salary,overtime_hours,kpi_bonus,net_salary,note,published_at,employee_viewed_at,employee_confirmed_at')
```

### S18 - src/lib/payroll.ts:171 - payroll_entries

```diff
- .select('*')
+ .select('id,employee_id,branch_id,period,base_salary,responsibility_allowance,attendance_allowance,meal_transport_allowance,agreed_salary,fixed_salary,daily_rate,workday_salary,overtime_hours,kpi_bonus,net_salary,note,published_at,employee_viewed_at,employee_confirmed_at')
```

### S19 - src/lib/salesReceipts.ts:82 - sales_receipts

```diff
- .select('*, sales_receipt_items(*)')
+ .select('seller_id,id,code,branch_id,business_date,seller_name,payment_method,customer_paid,change_amount,total_quantity,total_amount,created_at,created_by, sales_receipt_items(allocation_id,product_id,product_name,quantity,unit_price,line_total)')
```

### S20 - src/lib/salesReceipts.ts:107 - sales_receipts

```diff
- .select('*, sales_receipt_items(*)')
+ .select('seller_id,id,code,branch_id,business_date,seller_name,payment_method,customer_paid,change_amount,total_quantity,total_amount,created_at,created_by, sales_receipt_items(allocation_id,product_id,product_name,quantity,unit_price,line_total)')
```

### S21 - src/lib/shiftLedger.ts:59 - bag_shift_sessions

```diff
- .select('*')
+ .select('id,branch_id,business_date,sequence,leader_id,leader_name,status,opening_balances,closing_balances,discrepancy_note,opening_photo_url,closing_photo_url,started_at,ended_at')
```

### S22 - src/lib/shiftLedger.ts:93 - bag_allocations

```diff
- .select('*, bag_shift_sessions!bag_allocations_shift_id_fkey(business_date)')
+ .select('id,branch_id,shift_id,employee_name,employee_id,product_id,issued_quantity,sold_quantity,returned_quantity,damaged_quantity,issued_by,issued_at,settled_by,settlement_shift_id,settled_at,posted_at,posted_sold_quantity,posted_damaged_quantity, bag_shift_sessions!bag_allocations_shift_id_fkey(business_date)')
```

### S23 - src/lib/shiftLedger.ts:103 - bag_allocations

```diff
- .select('*, bag_shift_sessions!bag_allocations_shift_id_fkey(business_date)')
+ .select('id,branch_id,shift_id,employee_name,employee_id,product_id,issued_quantity,sold_quantity,returned_quantity,damaged_quantity,issued_by,issued_at,settled_by,settlement_shift_id,settled_at,posted_at,posted_sold_quantity,posted_damaged_quantity, bag_shift_sessions!bag_allocations_shift_id_fkey(business_date)')
```

### S24 - src/lib/shiftLedger.ts:458 - bag_shift_sessions

```diff
- .select('*')
+ .select('id,branch_id,business_date,sequence,leader_id,leader_name,status,opening_balances,closing_balances,discrepancy_note,opening_photo_url,closing_photo_url,started_at,ended_at')
```

### S25 - src/lib/store.ts:136 - stock_movements

```diff
- .select('*')
+ .select('id,branch_id,product_id,movement_type,quantity,shift_date,note,created_by,created_at,source_product_id,source_quantity,document_id,measured_weight_kg')
```

### S26 - src/lib/store.ts:187 - stock_movements

```diff
- .select('*')
+ .select('id,branch_id,product_id,movement_type,quantity,shift_date,note,created_by,created_at,source_product_id,source_quantity,document_id,measured_weight_kg')
```

### S27 - src/lib/store.ts:646 - inventory_reports

```diff
- .select('*')
+ .select('id,report_no,branch_id,report_date,department,location,shift_name,reporter,lines,created_by,created_at')
```

### S28 - src/lib/store.ts:671 - operation_days

```diff
- .select('*')
+ .select('id,branch_id,business_date,status,opened_by,opened_at,closed_by,closed_at')
```

### S29 - src/lib/supplyRequests.ts:166 - supply_requests

```diff
- .select('*')
+ .select('id,branch_id,product_name,quantity,unit,note,requested_delivery_date,requested_delivery_period,requested_by,requested_by_name,status,created_at,updated_at')
```

### S30 - src/pages/ControlCenterPage.tsx:244 - lotte_reconciliation_lines

```diff
- .select('*')
+ .select('id,branch_id,business_date,order_code,lotte_bill_code,quantity,amount,note,resolved,created_at')
```

### S31 - src/pages/ControlCenterPage.tsx:256 - control_audit_entries

```diff
- .select('*')
+ .select('id,actor_id,actor_name,module,action,detail,before_value,after_value,reason,created_at')
```

## 7. Script wildcard outside runtime

- `scripts/audit-live-readiness.mjs:59`: `let query = client.from(table).select('*', { count: 'exact', head: true })`

Scripts are QA/audit/fixtures, not frontend polling. HEAD count wildcard can select(id); full-row fixtures may need all fields. No literal select=* in src/api/functions REST requests. Schema compatibility of projections requires read-only confirmation before applying.
