# CODEMAP — Bản đồ kỹ thuật & nghiệp vụ Gustino

> Tài liệu để **kế thừa giữa các phiên làm việc**. Đọc file này TRƯỚC khi sửa code — không cần đọc lại toàn bộ source.
> Cập nhật file này mỗi lần thay đổi cấu trúc/nghiệp vụ. Changelog chi tiết theo đợt nằm ở memory `project_gustino_overhaul.md`.
> Lần đọc code gần nhất: **2026-07-02**.

---

## 1. Công nghệ (Stack)

| Lớp | Công nghệ |
|---|---|
| Frontend | React 19 + TypeScript, Vite 6, SPA |
| Routing | **Tự viết bằng hash** (`window.location.hash`), KHÔNG dùng react-router. Xem `src/App.tsx` `pageFromHash()` + `navigate()` |
| Styling | CSS thuần (`src/styles.css` → import `src/sidebar.css`) + Tailwind **chỉ cho report** (`tailwind.report.config.cjs` → `public/report-tailwind.css`) |
| Backend chính | **Supabase** (PostgreSQL + RLS + Auth + Storage + RPC + Realtime) |
| Backend dự phòng (LAN) | Khi `supabase == null`: gọi REST `/api/*` qua `scripts/lan-server.mjs`. Mọi lib đều có nhánh `if (!supabase) { lanApi(...) }` |
| Export | `exceljs` (Excel), `jspdf` + `html2canvas` (PDF/ảnh infographic) |
| Build | `npm run build` = build report CSS → `tsc -b` → `vite build` |
| Deploy | Vercel (`vercel.json`, `.vercel/`). Hiện chạy local là chính, không deploy thường xuyên |

**Cấu hình môi trường:** `.env.local` chứa `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. Nếu thiếu → `supabase` là `null` → tự chuyển sang chế độ LAN.

### Màu thương hiệu (giữ nguyên)
- Navy `#0f1f33` (`--navy`), Green `#a8d12d` (`--green`)

---

## 2. Phân quyền (Roles & Access)

`Role = 'admin' | 'manager' | 'shift_leader' | 'staff' | 'kitchen'` (`src/types.ts`)

`src/lib/access.ts` — các hàm kiểm tra quyền:
- `canUseAdmin` → chỉ `admin`
- `canUseSales` → `admin | manager | shift_leader | staff` (ca trưởng cũng dùng POS)
- `canUseOperations` → `shift_leader` (chỉ ca trưởng/phó vận hành ca)
- `canUseManagement` → `admin | manager`
- `canUseKitchen` → `admin | manager | kitchen`
- `normalizeRole` → **hiện là no-op** (return chính nó). Trước đây map admin→manager, đã gỡ. ĐỪNG xóa hàm, nhiều nơi gọi.

**Lưu ý nghiệp vụ:** "Ca phó" KHÔNG phải role riêng — dùng chung role `shift_leader` với ca trưởng (chức năng giống nhau). Phân biệt qua `positionTitle`/`employmentType` nếu cần.

`EmploymentType = 'leader' | 'full_time' | 'part_time'`

### Routing theo role (`App.tsx` `defaultPageForRole`)
- `kitchen` → `kitchen`
- `staff` → `sales`
- `admin/manager` → `dashboard` (Manager Dashboard)
- `shift_leader` → `today`
- còn lại → `attendance`

`canAccessPage()` chặn truy cập trang không đúng quyền (redirect về default).

---

## 3. Bản đồ Pages (route → file → vai trò chính)

Route lưu ở hash, danh sách hợp lệ trong `pageFromHash()`. Alias: `#history → orders`, `#admin → management`.

| Page (hash) | File | Dùng cho | Ghi chú |
|---|---|---|---|
| `launcher` | `pages/LauncherPage.tsx` | mọi role | Màn chọn nhanh, thường bị skip (redirect thẳng theo role) |
| `dashboard` | `pages/ManagerDashboardPage.tsx` | manager/admin | Dashboard doanh thu — **trang chủ quản lý** |
| `today` | `pages/TodayPage.tsx` | shift_leader | Trang vận hành "Hôm nay" của ca trưởng |
| `sales` | `pages/SalesPage.tsx` | staff/leader/manager | POS bán hàng nội bộ (đã viết lại đợt 2) |
| `restaurant` | `pages/RestaurantPage.tsx` | — | (nhỏ, ít dùng) |
| `report` | `pages/ReportPage.tsx` | leader | Báo cáo cuối ca/cuối ngày + xuất infographic. **Đã thiết kế lại 2026-06-29** (xem mục 12) |
| `inventory` | `pages/InventoryPage.tsx` | leader | Kho: nhập/chế biến/đóng gói/kiểm kê (tab) |
| `handover` | `pages/ShiftHandoverPage.tsx` | leader | Bàn giao ca + phát túi (bag allocation) |
| `orders` | `pages/OrdersPage.tsx` | leader | Đặt hàng / yêu cầu (supplyRequests) |
| `attendance` | `pages/AttendancePage.tsx` | tất cả trừ kitchen | Chấm công + đăng ký lịch (selfie + GPS) |
| `management` | `pages/AdminPage.tsx` (`ManagementPage`) | manager/admin | Trang quản trị đa-section (xem mục 4) |
| `manager-*` | `AdminPage.tsx` với `focused` + section cố định | manager/admin | revenue/business/inventory/attendance/payroll/requests |
| `admin-accounts` | `AdminPage.tsx` section `accounts` | admin | Quản lý tài khoản |
| `control` | `pages/ControlCenterPage.tsx` | admin | Control center |
| `kitchen` | `pages/KitchenPage.tsx` | kitchen | Màn bếp nhận đơn |

Khung layout: `src/components/AppShell.tsx` — sidebar trái (desktop) / bottom-nav (mobile ≤900px). Collapse lưu `localStorage['gustino_sidebar_collapsed']`.

`AdminPage.tsx` (1594 dòng) là file lớn nhất — gom nhiều "section" (revenue, commission/business, inventory, attendance, payroll, requests, accounts, overview). `AttendancePage.tsx` (1161) và `ReportPage.tsx` (1062) là 2 file lớn tiếp theo.

---

## 4. Lớp dữ liệu (Lib layer) — `src/lib/`

Mọi lib theo pattern: **ưu tiên Supabase, fallback LAN `/api`**. Header LAN qua `authHeaders/userHeaders` (X-User-Id/Role/Branch...).

| File | Trách nhiệm |
|---|---|
| `supabase.ts` | Khởi tạo client (null nếu thiếu env) |
| `store.ts` | **Kho + báo cáo + ngày vận hành.** `fetchMovements/addMovement(s)/deleteMovements`, `calculateStock`, `saveReportSnapshot`, `inventory_reports`, `operation_days` (mở/chốt ngày), draft báo cáo (LAN) |
| `shiftLedger.ts` | **Sổ túi theo ca.** `bag_shift_sessions` (mở/đóng ca) + `bag_allocations` (phát túi/đối soát). Bán: `recordBagSale` (RPC `record_bag_sale`), chốt ca: `closeBagShift` (RPC `close_bag_shift_safe`) |
| `salesReceipts.ts` | **Hóa đơn POS nội bộ.** `sales_receipts` + `sales_receipt_items`. Mã hóa đơn `code` để đối soát Lotte. `PaymentMethod` tồn tại nhưng nghiệp vụ KHÔNG thu tiền |
| `commission.ts` | **Giá + hoa hồng.** `PRODUCT_PRICES` (hardcode), `commissionPerBag` (bậc thang 1k/2k/3k theo giá), `COMMISSION_MIN_BAGS=15` (bán >15 túi mới được hoa hồng), `summarizeEmployeeBagSales`, `commission_rules` |
| `revenue.ts` | **Tổng hợp doanh thu** từ 3 nguồn ưu tiên: report snapshot > live allocation > movement sale_out. `buildDailyRevenueRows` |
| `supplyRequests.ts` | **Đặt hàng/yêu cầu bếp.** `supply_requests`, status pending→acknowledged→fulfilled→cancelled |
| `reportSync.ts` | Đồng bộ dữ liệu báo cáo |
| `attendance.ts` | **Chấm công (905 dòng, lớn nhất lib).** GPS bắt buộc (`getAttendanceLocation` THROW nếu từ chối), selfie, check-in/out window, đăng ký ca, lịch chia sẻ |
| `constants.ts` | **Master data hardcode:** `BRANCHES` (3 chi nhánh), `PRODUCTS` (SKU), định mức chế biến `PROCESS_OUTPUT_BY_INPUT`, đóng gói `PACKING_OPTIONS_BY_OUTPUT`, `MOVEMENT_LABELS` |
| `i18n.ts` | Đa ngôn ngữ (vi/en), `T[lang]`, `getLang()` |
| `dates.ts`, `browser.ts`, `voice.ts`, `authIdentity.ts` | Tiện ích (ngày, localStorage/id, đọc giọng nói thông báo, identity) |

### Chi nhánh (hardcode trong `constants.ts`)
`gold-coast` (Gold Coast Nha Trang), `lotte-2310` (Lotte Mart 23/10), `lotte-vt` (Lotte Mart Vũng Tàu).

---

## 5. Mô hình dữ liệu kho — quan trọng

**Không có bảng "tồn kho".** Tồn = tính toán từ `stock_movements` (event sourcing).

`MovementType` + dấu trong `calculateStock` (`store.ts`):
```
opening:+1  inbound:+1  processing_out:-1  processing_in:+1
packing_out:-1  packing_in:+1  sale_out:-1  waste:-1  adjustment:+1  count:0
```
- `count` (kiểm kê) là mốc reset: tồn sau count = số đếm thực tế + các movement sau count.
- `variance` = số đếm − tồn kỳ vọng tại thời điểm count.
- `waste` có `sourceProductId` = hao hụt chế biến (thông tin, KHÔNG trừ tồn 2 lần — `informationalProcessingLoss`).
- Ghi nhiều movement qua RPC `create_stock_movements_checked` (kiểm tra đủ tồn). Lỗi "Không đủ tồn" (P0001) với sale/waste/count/adjustment thì bypass insert thẳng.

### Luồng chế biến/đóng gói (constants.ts)
- Nhập kho: chỉ `INBOUND_PRODUCT_IDS` (hạt dẻ rang/tuyết/tươi, khoai lang mật, bánh sống).
- Chế biến: input → output theo `PROCESS_OUTPUT_BY_INPUT` / `PROCESS_OUTPUT_OPTIONS_BY_INPUT`.
- Đóng gói: output kg → túi theo `PACKING_OPTIONS_BY_OUTPUT` (vd `chestnut-cooked-kg` → 110g/330g/500g/1kg với `sourceQuantity` kg/túi).

---

## 6. Luồng nghiệp vụ chính (state machine vận hành ngày)

```
Ca trưởng ca 1:
  check-in (attendance, GPS+selfie) ──▶ mở operation_day (ensureOperationDay: bắt buộc đã check-in)
   ──▶ nhập kho (inbound) ──▶ chế biến (processing_out/in, ghi hao hụt waste)
   ──▶ đóng gói (packing_out/in) ──▶ startBagShift (mở bag_shift_session)
   ──▶ phát túi cho NV (issueBags → bag_allocations)   [lặp nhiều lần trong ca]
   ──▶ NV bán: recordBagSale / tạo sales_receipt (trừ số đang giữ)
   ──▶ cuối ca: settleBagAllocation (đối soát bán/trả/hỏng) ──▶ closeBagShift
        (tồn cuối ca 1 = tồn đầu ca 2)
Ca 2: lặp lại, cuối ngày bấm xuất báo cáo (ReportPage) ──▶ saveReportSnapshot ──▶ closeOperationDay
```

### Phát túi ↔ Bán hàng (điểm dễ lệch dữ liệu) — ĐÃ CHẨN ĐOÁN 2026-06-28
- Ca trưởng phát túi (`handover`) gắn `employeeId = registration.userId` (= `profiles.id`, FK `shift_registrations_user_id_fkey`).
- **Root cause (chắc chắn):** RLS trong `20260625_sales_module.sql` buộc staff chỉ ĐỌC + bán được allocation khi `employee_id = auth.uid()` (hoặc `can_manage_branch`). `record_bag_sale` cũng chặn y hệt. → Ca trưởng (quản lý branch) thấy hết, nhưng staff đăng nhập bằng tài khoản ≠ profile được phát thì bị RLS giấu sạch → "chưa nhận túi". `user.id` (login) = `auth.uid()` = `profiles.id`, nên khớp ĐÚNG chỉ khi staff đăng nhập đúng tài khoản đã đăng ký ca.
- **Lỗi phụ:** `SalesPage` cũ lọc `business_date = today` (qua join session) → loại oan túi `!settledAt` khi ca qua đêm/lệch ngày.
- **Đã sửa (SalesPage):** staff KHÔNG lọc theo ngày nữa (tin RLS), khi có Supabase thì không lọc lại theo tên; thông báo rỗng nhắc khả năng lệch tài khoản. `bag_allocations` không có cột `business_date` (lấy từ join `bag_shift_sessions`).
- **Đã sửa tận gốc (handover, 2026-06-29):** màn Phát túi giờ cho ca trưởng chọn nhân viên từ `issuableEmployees` = người đăng ký ca hôm nay (optgroup "Trong ca") + **mọi tài khoản nhân viên thật của chi nhánh** (`fetchEmployees`, role staff/shift_leader, optgroup "Nhân viên khác"). `employee_id` luôn là `profiles.id` = một tài khoản login → khớp `auth.uid()` khi PG đăng nhập. Không còn buộc phải đăng ký ca mới phát được túi. `fetchEmployees` lỗi RLS thì fallback về danh sách đăng ký (không regression).
- **Truy cập DB:** `.env.local` chỉ có **anon/publishable key** (RLS chặn đọc khi chưa đăng nhập). KHÔNG có service_role key → không chạy được diagnostic/cleanup admin trực tiếp. Muốn dọn dữ liệu cũ (allocation gắn sai account) cần service_role key hoặc chạy SQL trong Supabase dashboard.
- **CÒN LẠI (data cũ):** allocation đã phát trước bản vá có thể vẫn gắn `employee_id` sai → PG cũ không thấy. Chỉ ảnh hưởng dữ liệu lịch sử; phát mới đã đúng.


## 7. Supabase — Migrations & Edge Functions

`supabase/migrations/` (chạy theo thứ tự ngày). Mốc quan trọng:
- `20260618_attendance_module.sql` — chấm công
- `20260619_shift_bag_handover.sql` — sổ túi theo ca
- `20260620_role_permissions.sql`, `20260620_admin_role_management.sql` — RBAC
- `20260622_commission_rules.sql`, `20260622_merge_admin_into_manager.sql`
- `20260624_safe_close_bag_shift.sql` + `20260624_relax_close_bag_shift_safe.sql` — RPC `close_bag_shift_safe`
- `20260624_kitchen_orders.sql` — đơn bếp
- `20260625_sales_module.sql`, `20260627_sales_receipts.sql` — POS
- `20260627_pos_sales_rpc_repair.sql` — RPC `record_bag_sale` (nếu thiếu → `updateBagSaleDirect` fallback)
- `20260627_restore_system_admin.sql`

**RPC quan trọng:** `create_stock_movements_checked`, `record_bag_sale`, `close_bag_shift_safe`.

Edge Functions (`supabase/functions/`): `manage-employee`, `bootstrap-manager`, `reset-manager-password` (quản trị tài khoản).

`supabase/schema.sql` = schema tổng hợp. `api/reverse-geocode.ts` = đổi GPS→địa chỉ cho chấm công.

---

## 8. Realtime
- Sales đồng bộ qua Supabase channel `sales-v2`.
- Lịch/chấm công có realtime (`20260622_realtime_schedule_geotag.sql`).
- `App.tsx` poll `fetchMovements` mỗi 15s khi ở trang cần movements.

---

## 9. Backlog / việc còn lại (từ memory đợt 2, chưa xong)

> Chi tiết & lý do: memory `project_gustino_overhaul.md` mục "CÒN LẠI (8 mục)". User đã duyệt "cứ làm hết lần lượt".

1. ~~**Bug phát túi "NV chưa nhận được"**~~ — ĐÃ CHẨN ĐOÁN + sửa lỗi phụ (SalesPage, 2026-06-28). Root cause = RLS `employee_id = auth.uid()` (xem mục 6). Còn lại: verify dữ liệu tài khoản trên DB thật.
2. Couple chấm công ↔ mở ca (chụp quầy đầu ca trước; chặn mở ca sau khi đã check-out).
3. Ca 2 tối → báo cáo cuối ngày, đồng bộ realtime ca 1; cho nhập kho/làm mẻ lần 2.
4. Trang Hôm nay: bổ sung nhập hàng/làm mẻ bên dưới; kiểm kê cuối ca cho ca 1.
5. Thay nút **Lịch sử** bằng **Đặt hàng** (đã có `orders` route + `supplyRequests.ts`).
6. Báo cáo cuối ca đồng bộ từ bán hàng + ca trưởng; verify đường đi hoa hồng >15 túi.
7. ~~**Bảng lương** theo vai trò~~ — ĐÃ LÀM 2026-06-29 (xem mục 13).
8. ~~Trang Quản lý: bỏ cuộn ngang báo cáo chi nhánh~~ — ĐÃ SỬA 2026-06-29: section `revenue` trong `AdminPage.tsx` đổi bảng rộng `.data-table` (min-width 760px, cuộn ngang) → danh sách thẻ dọc `.rev-day-list` (CSS sau khối `.rev-overview` trong styles.css). `ManagerDashboardPage` (trang `dashboard`) vốn đã ổn (bar so sánh + pie + cột giờ). **Đã chuyển tiếp 2026-06-29:** 4 bảng còn lại trong AdminPage (Bảng công, Hoa hồng, Kho, Đặt hàng) đổi từ `.table-scroll`/`.data-table` sang thẻ dọc dùng chung class **`.adm-list` / `.adm-row` / `.adm-row-head` / `.adm-metrics`** (CSS sau khối `.rev-day-chips` trong styles.css). Tone metric: `.warn/.ok/.amber`. **Chỉ còn 1 bảng `table-scroll`** = Bảng lương (`payroll-table`, có ô nhập editable) — cố ý giữ, thuộc phần làm lại bảng lương sau.

### Khoảng trống so với BA.md (chưa triển khai đầy đủ)
- **Dynamic RBAC** (tick quyền theo module) — BA mô tả, code hiện chỉ RBAC tĩnh theo role.
- **Đối soát Lotte** (`lotte_reconciliation_*`) — có trong BA + đề xuất bảng, chưa thấy lib/page.
- **Bảng lương** (`payroll_*`) — chưa có model.
- **Audit log** (`audit_logs`) — BA yêu cầu, chưa thấy triển khai xuyên suốt.
- **Master data editable trên web** (sản phẩm/định mức) — hiện hardcode trong `constants.ts`, chưa sửa được từ UI.

---

## 10. Quy ước UI/UX user yêu cầu (bắt buộc tuân thủ)
- Cảm giác như **app**: chuyển trang thật, KHÔNG popup bật ra/hiện ra tại chỗ cho chức năng chính.
- Thanh công cụ **dọc**; chức năng quan trọng đặt ở **đáy trang** (mobile bottom-nav).
- **Tuyệt đối tránh cuộn ngang** — luôn ưu tiên cuộn dọc.
- Mobile-first (đa số dùng điện thoại), realtime, nhiều thiết bị đồng bộ.
- Tham khảo CRM/POS: CukCuk, KiotViet, Sapo.
- Input ép `font-size:16px` để chặn iOS auto-zoom (đã làm trong styles.css).

---

## 12. Báo cáo cuối ca — POSTER infographic (rewrite 2026-06-29)
- **Trước:** `ReportInfographicSheet` render **2 lần** (1 bản ẩn 1600px để xuất ảnh `.report-infographic-export` + 1 bản hiển thị `.report-visible-card`) → ~700 dòng CSS responsive trùng lặp.
- **Sau:** 1 component `ReportPoster` render **một lần** trong `.rp-stage`, `infographicRef` trỏ thẳng vào `.rp-poster` để `html2canvas` xuất (scale 2.5, bg `#fff7ea`). Mobile-first, `max-width:760px`, dùng `clamp()` nên cùng layout cả khi xem lẫn khi xuất ảnh.
- **Bố cục:** header (tên chi nhánh HUGE + ca sáng/tối + badge xếp loại, gradient đổi theo grade `rp-tone-*`) → hero **TỔNG DOANH THU** (số khổng lồ, nền xanh lá tươi) → 5 stat chip (phát/bán/tồn/hao hụt/hủy) → **BẢNG THI ĐUA NHÂN VIÊN** (`rp-racers`, huy chương 🥇🥈🥉, thanh so sánh số bán, badge "Đạt hoa hồng") → bán theo sản phẩm → hao hụt+ảnh quầy → footer.
- **Dữ liệu:** giữ nguyên `buildDailyReport` (không đổi logic). Chỉ thay phần trình bày.
- **CSS:** toàn bộ namespace `.rp-*` ở CUỐI `src/styles.css`. Class cũ `.report-info-*`/`.report-visible-card`/`.report-infographic-*`/`.daily-report-*` giờ **không còn render** (dead, chưa xóa để giảm rủi ro — có thể dọn sau).
- Đã xóa helper chết trong ReportPage: `buildInfographicInventoryRows`, `sumEmployeeProducts`, `isChestnutBag`, và các component `Infographic*`/`ProofPanel`/`TextPanel`.
- **Chuẩn màu + giãn ngang khi đông NV (2026-07-04):** Ảnh xuất bị "vằn/ô pixel" do **html2canvas render gradient vùng lớn thành các dải/khối** + **scale=1 (độ phân giải thấp)**. Sửa: (1) **bỏ gradient ở các vùng lớn, chuyển SOLID**: header `.rp-head`/`.rp-tone-*` (navy `#14304f`, great `#2f8f2a`, good `#17694c`, warn `#c5860f`, muted `#1e3555`), hero doanh thu `.rp-revenue` (`#8ed11f`), thanh `.rp-bar`, thẻ podium `.rp-place-*` — tất cả solid; chỉ nền poster ngoài cùng còn gradient (chỉ hiện trên màn, bản xuất ép solid `#fff8ec`). (2) **html2canvas `scale: 1 → 2`** (bg `#fff8ec`) cho ảnh nét, hết pixel. (3) badge `.rp-grade` nền kính tối `rgba(9,20,38,.32)` để chữ lime đọc rõ. (4) density theo số NV: `ReportPoster` gắn `rp-dense` (>5) / `rp-dense rp-dense-3` (>10) → `.rp-board`+`.rp-products` full-width, `.rp-racers`/`.rp-product-list` xổ 2–3 cột (cả bản màn lẫn `.rp-poster-export`) để poster giãn ngang, bớt dài. **Quy tắc:** ĐỪNG dùng gradient cho vùng lớn trong poster xuất — html2canvas sẽ làm vằn.

## 14. Đăng ký ca — bảng DỌC (rewrite 2026-06-29)
- **Trước:** `SharedScheduleBoard` (`AttendancePage.tsx`) render 3 layout: `vertical-shift-grid` (đọc-chỉ), `weekly-schedule-matrix` trong `schedule-sheet-scroll` (**ma trận cuộn ngang**, hiện trên cả desktop+mobile), và `mobile-schedule-list` (bị CSS `@media 720px` tắt). → bảng cuộn ngang, khó đăng ký.
- **Sau:** 1 layout duy nhất `.schedule-vboard` — grid thẻ `repeat(auto-fill, minmax(300px,1fr))`, mỗi người 1 `.schedule-vcard`, 7 ngày xếp **dọc** (`.schedule-vday`), mỗi ngày 1 `<select>` chọn ca. KHÔNG cuộn ngang ở mọi kích thước. Khi `sheetShiftOptions` rỗng hiện `.schedule-vboard-empty` nhắc tạo khung ca trước.
- Gỡ state `selectedPersonId` + effect set nó (chỉ dùng cho ma trận cũ). Logic đăng ký (`changeCell`/`displayEntries`) **không đổi**.
- CSS mới namespace `.schedule-v*` ngay sau khối `@media 720px` của `.mobile-schedule-*` trong styles.css. Class cũ (`weekly-schedule-matrix`, `mobile-schedule-list`, `vertical-shift-grid`, `schedule-sheet-scroll`, `schedule-scroll-hint`) **không còn render** (dead CSS, chưa xóa).
- **Bug thứ tự toán tử (đã sửa 2026-06-29):** nhiều chỗ viết `user.role === 'manager' || user.role === 'admin' && <X>` → JS hiểu là `manager || (admin && X)` nên **với manager** ra `true` và X KHÔNG render (nút "⚙ Thiết lập nhân sự & ca", panel thiết lập, nút xóa). Đã bọc ngoặc `(manager || admin) && X` tại 4 chỗ trong AttendancePage. CẢNH BÁO: pattern này dễ tái xuất hiện ở các file khác — luôn bọc ngoặc khi trộn `||` với `&&`.
- **Admin sửa được bảng lịch (2026-06-29):** trước đây chỉ `manager` chỉnh được (RLS + RPC check `role = 'manager'`, frontend lib `attendance.ts` + AttendancePage gate `role !== 'manager'`). `can_manage_branch()` vốn đã trả true cho admin nên chỉ cần nới các check role sang `('manager','admin')`. Migration `20260629_admin_edit_schedule.sql` re-create: policy "managers manage schedule people", `list_schedule_people()`, `set_schedule_entry()`, `set_schedule_registration()`, `add_manual_shift_registration()`. Frontend: lib `attendance.ts` (create/deleteSchedulePerson, create/archiveWorkShift, set/createManual…), AttendancePage `changeCell` guard + overtime selector. **User cần chạy migration** trong Supabase SQL Editor.
- **schedule_people ↔ accounts:** board chỉ hiện `schedule_people` (RPC `list_schedule_people`); bảng này được **trigger DB `sync_profile_schedule_person` tự đồng bộ từ profiles** (migration `20260624_schedule_roster.sql`). Account mẫu KHÔNG hiện nếu: (a) migration chưa chạy, hoặc (b) profile `branch_id = null` (cả trigger lẫn `fetchEmployees` đều bỏ qua null branch). **Frontend đã thêm lưới an toàn (2026-06-29):** `SharedScheduleBoard` nhận thêm prop `employees` và `mergedPeople` (useMemo) gộp account thật vào danh sách (key theo `profileId`, ưu tiên row schedule_people sẵn có). `employees` chỉ fetch cho manager/admin → staff vẫn dựa vào fallback của `fetchSchedulePeople`. Lưu ý: account chỉ-gộp-từ-frontend (chưa có row schedule_people) thì manager bấm sửa ô sẽ lỗi `set_schedule_entry` "Nhân sự không hợp lệ" → cần chạy migration để trigger tạo row thật.

## 13. Bảng lương (build 2026-06-29)
- **Trước:** lương lưu localStorage (`gustino_payroll_drafts_v1`), KHÔNG theo tháng, không đồng bộ.
- **Sau:** `src/lib/payroll.ts` — lưu Supabase, **theo từng tháng** (`period='YYYY-MM'`), có fallback localStorage khi bảng chưa tạo (`cloudReady` flag + `tableMissing()`).
  - `fetchPayrollEntries/upsertPayrollEntry` (bảng `payroll_entries`, unique `employee_id,period`): lương giờ/cứng/thưởng/trừ/ghi chú của từng người 1 tháng. `hourly_rate`/`fixed_salary` = null → dùng mặc định vai trò.
  - `fetchRoleSalaryDefaults/upsertRoleSalaryDefault` (bảng `payroll_role_defaults`, PK `branch_id,role`): admin nhập lương mặc định theo **vai trò × chi nhánh**.
- **Migration:** `supabase/migrations/20260629_payroll.sql` (RLS `can_manage_branch`). **User cần chạy trong Supabase SQL Editor** để bật lưu cloud; chưa chạy thì app tự dùng localStorage.
- **AdminPage section `payroll`:** chọn tháng (`<input type=month>` → set from/to), bảng "Lương mặc định theo vai trò" (`payroll-default-grid`, suy từ `payrollRoleSlots`), thẻ lương từng người (`.payroll-card` dạng `.adm-list` + ô nhập `.payroll-inputs`). Lưu debounce 600ms (`payrollSaveTimers`/`roleDefaultTimers`).
- **Lương hiệu lực** (`buildPayrollRows`): override người > mặc định vai trò. `basePay = fixedSalary>0 ? fixedSalary : giờ×hourlyRate`. `grossPay = basePay + hoa hồng + thưởng − trừ`. Chỉ tính `PAYROLL_ROLES = manager|shift_leader|staff` (trừ admin & bếp). Hoa hồng tự lấy từ `commissionRows` (sổ túi).

## 11. Lệnh hữu ích
```bash
npm run dev          # scripts/dev.mjs (Vite + LAN api)
npm run build        # report-css + tsc -b + vite build
npm run preview      # scripts/preview.mjs
npm run serve:lan    # LAN server (scripts/lan-server.mjs)
npm run qa:roles     # QA phân quyền (scripts/qa-roles.mjs)
```
QA scripts khác: `scripts/qa-*.mjs` (admin, attendance, handover, app-navigation, shared-schedule-accounts).

## 15. Đồng bộ/chốt báo cáo/đặt hàng (2026-07-01)
- **Kho quản lý:** nav/dashboard của manager/admin đổi từ route `inventory` (màn vận hành ca trưởng, chỉ fetch `user.branchId`) sang `manager-inventory` (AdminPage section inventory, fetch mọi chi nhánh được phân quyền). `#inventory` giờ chỉ cho `shift_leader` để tránh quản lý/admin nhìn thiếu dữ liệu.
- **Chốt báo cáo:** thêm `finalizeDailyReport()` trong `src/lib/store.ts` và migration `20260701_finalize_daily_report_rpc.sql` với RPC `finalize_daily_report(branch,date,payload)` để upsert `report_snapshots` + đóng `operation_days` trong một giao dịch. Frontend fallback về đường cũ nếu RPC chưa chạy.
- **Đặt hàng:** `OrdersPage` bỏ dải gợi ý tồn thấp, thêm phiếu báo cáo đặt hàng `.order-report-sheet` và nút **Xuất báo cáo** tải JPG bằng `html2canvas`.
- **Ngôn ngữ:** `i18n.ts` dịch lại cả node/attribute sinh sau khi đã bật EN, dịch placeholder/title/aria/alt/value button, và fallback khử dấu để không còn text tiếng Việt có dấu khi bấm EN.
- **POS/doanh thu/chốt ca:** `SalesPage` lấy `businessDate` từ `bag_allocations`/`bag_shift_sessions` của túi trong giỏ, chặn một hóa đơn trộn nhiều ngày vận hành, và dùng RPC `create_pos_receipt_with_sales` (migration `20260701_pos_transaction_close_repair.sql`) để trừ `sold_quantity` + lưu `sales_receipts` trong một transaction. `ManagerDashboardPage` không cộng doanh thu nhân viên hai lần khi đã có allocation và receipt. `closeBagShift()` giờ gửi `movements` cho LAN close và chỉ fallback đóng ca Supabase khi thiếu RPC; nếu RPC lỗi nghiệp vụ thì không đóng rỗng làm mất `sale_out/count`.

## 16. Nối tiếp Claude - dashboard, lịch sử & dọn dữ liệu (2026-07-02)
- **Navigation quản lý:** `AppShell.tsx` tách nav manager/admin thành các route trực tiếp: `dashboard`, `manager-business`, `manager-inventory`, `manager-attendance`, `manager-payroll`, `manager-requests`, `my-records`, `admin-accounts`, `control`. Route `report` không còn đứng riêng trên toolbar vận hành; kho báo cáo được đặt chung trong `my-records`.
- **Lịch sử & kho báo cáo:** `ReportArchivePage.tsx` được tách để nhúng lại trong `MyRecordsPage.tsx`; `MyRecordsPage` có tab lịch sử cá nhân và kho báo cáo đã chốt. `App.tsx` thêm route `my-records` và `report-archive`.
- **Admin xóa dữ liệu test:** thêm migration `supabase/migrations/20260702_admin_purge_test_data.sql` với RPC `admin_purge_business_data(p_branch_id,p_from,p_to,p_targets)`. UI nằm ở `ControlCenterPage.tsx` tab `cleanup`, cho chọn chi nhánh, khoảng ngày và nhóm dữ liệu (`sales`, `ledger`, `stock`, `reports`, `requests`, `attendance`). RPC đã được apply lên DB từ phiên Claude; thao tác xóa thật vẫn yêu cầu user xác nhận 2 lớp trong UI.
- **Dashboard doanh thu:** thêm dependency `recharts@3.9.1`. `ManagerDashboardPage.tsx` thay chart tự vẽ bằng `AreaChart` doanh thu theo ngày, `PieChart` tỷ trọng nhân viên, `BarChart` hóa đơn theo giờ; thêm `reloadTick`, nút reload thủ công và Supabase realtime channel cho `sales_receipts`, `sales_receipt_items`, `bag_allocations`, `bag_shift_sessions`, `stock_movements`, `operation_days`, `report_snapshots`.
- **CSS dashboard:** `styles.css` thêm các block `.revenue-area-chart`, `.employee-pie-chart`, `.hourly-bill-chart`, `.dashboard-reload-button`; đã sửa lỗi còn sót sau khi đổi sang Recharts: `.hourly-bill-chart` không còn grid 15 cột kiểu cũ, nên chart mới không bị ép hẹp. Mobile filter dashboard cho nút reload chiếm nguyên hàng để tránh tràn.
- **Mobile overflow hardening:** cuối `styles.css` có lớp khóa tràn ngang cho nhiều màn hình vận hành (`.admin-filter-bar`, `.manager-dashboard-filter`, `.inventory-manager-date-filter`, bảng/report/action bar). Cẩn thận khi thêm component mới: kiểm tra ở width 380/640/760 vì các override cuối file dùng `!important`.
- **QA đã chạy:** `npx.cmd tsc -b` pass; `npm.cmd run build` pass. Dev server chạy bằng `node scripts/dev.mjs`, app trả HTTP 200 tại `http://127.0.0.1:5173/`, LAN health trả `{"ok":true}` tại `http://127.0.0.1:5177/api/health`. Browser in-app của Codex không khả dụng trong phiên này (`agent.browsers.list()` rỗng), nên chưa chụp screenshot UI.

## 18. Vá lỗi hệ thống + đồng bộ menu cloud + deploy (2026-07-02, phiên 2)
- **Menu/SKU đồng bộ cloud (hết localStorage-per-device):** lib mới `src/lib/products.ts` — `fetchConfiguredProducts` (kéo `public.products` về, merge base+local-custom+cloud, ghi PRODUCTS_KEY, bắn event `gustino-products-updated`), `syncConfiguredProducts` (admin upsert), `deleteConfiguredProduct`, `subscribeConfiguredProducts` (realtime). `App.tsx` fetch + subscribe khi đăng nhập. `ControlCenterPage` fetch khi mở, `saveProducts` đẩy cloud + báo lỗi nếu fail, `updateLowStock` debounce 800ms sync.
- **Migration `20260702_shift_proofs_and_master_products.sql` — ĐÃ APPLY lên DB thật qua `npx supabase db query --linked --file`** (CLI đã login, KHÔNG cần password DB): (a) cột `opening/closing_photo_url` + bucket `shift-proofs` + policy (bản 20260625 trước đó CHƯA từng chạy trên DB thật — đây là gốc lỗi "không có hình"); (b) mở rộng `public.products` (price, source, recipe jsonb, weight_kg, inbound_*, updated_*) + RLS đọc-authenticated/ghi-admin + realtime publication.
- **`supabase db query` là đường chạy SQL trực tiếp lên DB prod** (đọc + ghi) — dùng cho audit/vá dữ liệu. Đã xóa dữ liệu test kẹt: branch `test` ngày 2026-07-02 (2 ca, 3 allocation, 5 movement, 1 report, operation_day). Còn ngày `open` cũ của branch `-q`/`123`/`test` ngày 01/07 chưa đóng (bị chặn permission, user tự đóng qua UI cleanup nếu cần).
- **uploadBagShiftPhoto (shiftLedger.ts):** bỏ short-circuit `shiftProofPhotoCloudReady` (trước đây 1 lần lỗi là mọi ảnh sau bị nuốt im lặng); giờ lỗi update cột sẽ THROW với message rõ để UI hiện.
- **ReportPage:** thêm confirm khi còn ca đang mở trước khi chốt ngày (RPC finalize tự đóng ca mở — từng "giết" ca 2 vừa mở); sau khi chốt hiện nút **Mở lại ngày** (`ensureOperationDay reopenClosed`) thay vì nút chết gây cảm giác treo.
- **Thêm món menu bắt buộc NVL:** `ControlCenterPage.addMenuItem` chặn nếu không có (thành phẩm nguồn + lượng) hoặc ≥1 dòng NVL; feedback qua `masterFeedback` (trước đây silent return). Class `.menu-recipe-required` trong styles.css.
- **Nút "Báo cáo cuối ngày" chỉ ca trưởng:** MyRecordsPage ẩn nút với role khác (route `report` vốn đã chỉ shift_leader qua `canAccessPage`).
- **Download/Excel mobile:** helper `downloadBlob` trong `lib/browser.ts` (append link vào DOM + revoke sau 4s — Safari/Chrome mobile fail im lặng nếu revoke ngay). AdminPage/ControlCenter/AttendancePage dùng chung. AttendancePage `exportXlsx` thêm busy + báo lỗi.
- **Chi nhánh:** `branches.ts mergeConfiguredRows` bỏ override `active=false` từ local — cloud là nguồn sự thật, hết lệch danh sách giữa máy.
- **CSS:** xóa 148 rule chết (report-info-*/daily-report-*/weekly-schedule-matrix/mobile-schedule-list/vertical-shift-grid/schedule-sheet-scroll…, styles.css 12027→11267 dòng, script postcss); bảng SKU Control Center gọn lại (form auto-fit, list max-height 520px cuộn trong khung, font 13px).
- **Deploy:** `npm run build` pass; `npx vercel deploy --prod --yes` → **https://gustino-operations.vercel.app** (Vercel CLI đã login user khadoanh329-6740; env VITE_SUPABASE_* đã có trên Production).

## 17. Sửa sự cố dữ liệu/KPI/lương/Excel (2026-07-02)
- **Không tự xóa cache nghiệp vụ:** `App.tsx` đã bỏ `clearLocalBusinessCache()` khỏi login/logout. Trước đó nếu app rơi vào LAN/local, đăng nhập/đăng xuất có thể làm người dùng tưởng "mất dữ liệu". Từ giờ chỉ chức năng Admin cleanup mới được xóa dữ liệu.
- **Không tự chuyển Supabase sang LAN rỗng:** `src/lib/supabase.ts` đổi `shouldUseLanApi()` để Supabase-authenticated session luôn đọc Supabase. Lỗi mạng tạm thời phải hiện lỗi thật, không âm thầm render local/LAN rỗng.
- **Xuất Excel chấm công:** `AdminPage.exportAttendance()` dùng `uniqueSheetName()` để tránh lỗi ExcelJS `Worksheet name already exists` khi DB có nhiều chi nhánh trùng tên như `test`.
- **KPI/lương đúng vai trò:** `PAYROLL_ROLES` chỉ còn `shift_leader | staff`. `manager/admin/kitchen` không tham gia KPI/lương doanh số; quản lý chỉ giám sát doanh thu, doanh số, kho.
- **KPI theo ngày:** màn KPI bỏ ô chỉnh KPI theo chi nhánh/nhân viên. KPI nhân viên lấy từ bảng công thức ngày theo vị trí/chi nhánh trong `commission.ts` (`POSITION_KPI_FORMULAS`). Thưởng KPI tháng đã về 0; bảng lương tháng cộng tự động thưởng ngày + thưởng tuần từ KPI ngày.
- **Chặn dữ liệu lệch chi nhánh:** bảng công, KPI và lương chỉ tính nhân viên active, vai trò staff/shift_leader, có `branch_id` hợp lệ, thuộc chi nhánh active và thuộc 3 điểm bán có công thức KPI (`gold-coast`, `lotte-vt`, `lotte-2310`). Allocation không khớp đúng nhân viên/chi nhánh thì không tính vào KPI.
- **Audit DB đọc-only:** DB thật còn dữ liệu, không mất: 7 branches, 4 active branches, 46 profiles, 7 active profiles, 18 attendance_records, 10 sales_receipts, 34 bag_allocations. Có 13 profile staff/shift_leader thiếu hoặc lệch active branch; branch `test` vẫn active và có active staff/shift_leader nên có thể làm màn "Tất cả chi nhánh" nhiễu nếu chưa dọn dữ liệu test.
- **QA:** `npx.cmd tsc -b` pass; `npm.cmd run build` pass. Chưa chạy thao tác xóa/cập nhật DB thật.

## 19. Vá nghiệp vụ chi nhánh/ca/kho trước deploy (2026-07-02, phiên 3)
- **Đọc/ràng buộc quy trình:** `CLAUDE.md` yêu cầu đọc `CODEMAP.md` trước khi code, cập nhật codemap sau khi sửa, chạy `npx.cmd tsc -b` + `npm.cmd run build`, migration mới phải apply bằng `supabase db query --linked --file`.
- **Chi nhánh bị xóa khóa nghiệp vụ thật:** thêm migration `supabase/migrations/20260702_branch_deactivate_accounts.sql` (ĐÃ APPLY DB thật) re-create RPC `set_config_branch_active`. Khi admin tắt/xóa chi nhánh, DB tự `active=false` cho `profiles` role `shift_leader|staff`, `schedule_people`, và `shifts` thuộc chi nhánh đó. `src/lib/branches.ts` có fallback trực tiếp nếu RPC chưa có.
- **Không cho account/branch inactive tiếp tục hoạt động:** `LoginPage.tsx` chặn đăng nhập nếu `profiles.active=false`, thiếu profile, nhân viên thiếu `branch_id`, hoặc chi nhánh của staff/shift_leader inactive. `App.tsx` kiểm tra lại user khôi phục từ localStorage/Supabase session và tự sign out nếu profile/branch đã bị khóa.
- **Lịch/chấm công không hiện dữ liệu đã xóa:** `src/lib/attendance.ts` thêm `activeBranchIdSet()`, lọc active branch cho `fetchWorkShifts`, `fetchEmployees` mặc định, `fetchSchedulePeople`, `fetchShiftRegistrations`, `fetchAttendanceRecords`; registrations/records của profile inactive hoặc chi nhánh inactive không còn vào bảng lịch/bảng công thường ngày.
- **Nhận ca phải đúng nghiệp vụ chấm công:** `ShiftHandoverPage.tsx` chỉ cho nhận ca khi user có ca `approved` hôm nay và có attendance record khớp ca, chưa check-out. Không còn `reopenClosed` khi nhận ca; ngày đã chốt thì chặn phát sinh.
- **Ca 1 vs ca 2:** nút cuối ca trong `ShiftHandoverPage.tsx` đổi theo `openSession.sequence`: ca 1 hiển thị **Chốt & bàn giao ca**; ca 2 hiển thị **Báo cáo cuối ngày** nhưng vẫn gọi `handleCloseShift()` trước rồi mới điều hướng report. Ca cuối ngày bắt buộc thu/đối soát hết túi nhân viên trước khi lập báo cáo.
- **Kho chỉ còn nghiệp vụ kho:** `InventoryPage.tsx` bỏ tab/gợi ý **Phát túi nhân viên** khỏi workflow kho; sau chế biến gợi ý **Kiểm kê kho**. Kho không hiển thị/điều hướng vận hành ngày/phát túi; phát túi nằm riêng ở `handover`.
- **QA:** `npx.cmd tsc -b` pass; `npm.cmd run build` pass. DB verify sau migration: các chi nhánh inactive `-q`, `1`, `123` có `active_ops_accounts=0`; branch `test` vẫn active và còn 4 tài khoản vận hành active theo lựa chọn trước đó của user.

## 20. Sửa xung đột lưu/xóa chi nhánh + dọn DB (2026-07-02, phiên 4)
- **Root cause lỗi "không lưu chi nhánh":** `ControlCenterPage.addBranch()` có thể thêm lại một chi nhánh đã từng xóa/tạm ngưng bằng cùng `id`, tạo 2 row cùng ID trong local state/localStorage: row mới `active=true` và row cũ `active=false`. `syncConfiguredBranchRows()` loop tuần tự nên upsert active trước rồi `set_config_branch_active(false)` chạy sau, làm DB tắt lại chi nhánh. Đây là lý do DB thật có lúc cả 3 chi nhánh thật `active=false`.
- **Code chống trùng ID:** `src/lib/branches.ts` thêm `canonicalizeBranchRows()` và áp dụng cho `readConfiguredBranchRows`, `writeConfiguredBranchRows`, `mergeConfiguredRows`, `syncConfiguredBranchRows`; mỗi branch id chỉ còn 1 row. Nếu cùng payload có cả active/inactive thì **active thắng** để thao tác "thêm lại/mở lại" không bị bản xóa cũ đè.
- **UI thêm/mở lại chi nhánh:** `ControlCenterPage.tsx` thêm `canonicalizeControlBranches()`. Khi nhập mã chi nhánh đã tồn tại (kể cả inactive), form sẽ cập nhật/mở lại row cũ thay vì prepend row trùng. `saveBranches()` cũng canonicalize trước khi set state/localStorage/sync.
- **Dọn DB thật:** thêm và ĐÃ APPLY `supabase/migrations/20260702_branch_data_cleanup.sql`: bật lại `gold-coast`, `lotte-2310`, `lotte-vt`; tắt `-q`, `1`, `123`, `test`; seed/mở lại `shifts` cho 3 chi nhánh thật; khóa profile/schedule/shifts thuộc branch test/rác.
- **DB verify sau dọn:** `public.branches`: active=true cho `gold-coast`, `lotte-2310`, `lotte-vt`; active=false cho `-q`, `1`, `123`, `test`.
- **QA:** `npx.cmd tsc -b` pass; `npm.cmd run build` pass.

## 21. Hard-delete account/branch + kho tong + dong bo SKU (2026-07-02, phien 5)
- **Xoa tai khoan la xoa that:** `deleteEmployeeAccount()` trong `src/lib/attendance.ts` khong goi soft-delete nua; LAN dung `/employees/:id?hard=1`, Supabase invoke `manage-employee` action `hard_delete`. `AdminPage.tsx` doi copy nut xoa thanh xoa vinh vien va cho phep xoa ca account inactive.
- **Xoa chi nhanh la xoa that:** `src/lib/branches.ts` them `hardDeleteConfiguredBranch()`, `ControlCenterPage.deleteBranch()` confirm 2 lop roi invoke Edge Function `manage-employee` action `delete_branch`; sau khi DB xoa xong moi xoa local row va audit. Khong con luong "an chi nhanh" de account/schedule van song.
- **Edge Function `manage-employee`:** da deploy lai. Them helper `hardDeleteEmployee()` va `hardDeleteBranch()` de go FK theo dung thu tu: sales receipts, bag sessions/allocations, stock movements, reports, operation days, supply requests, schedule, attendance, payroll/KPI/commission, manager assignments, profiles va auth users. Cac FK audit bat buoc duoc re-home sang admin active; cac FK nullable duoc set null.
- **Purge du lieu an tren DB that:** da APPLY `supabase/migrations/20260702_purge_hidden_accounts_branches.sql`. Migration xoa branch inactive voi branch-owned data, xoa profile inactive va auth.users sau khi go FK. Verify sau purge: `inactive_branches=0`, `inactive_profiles=0`.
- **Menu/SKU dong bo cho moi role:** da APPLY `20260702_products_sync_policy_repair.sql` de dam bao `public.products` RLS cho authenticated read, admin manage, va realtime publication. `InventoryPage`, `SalesPage`, `ShiftHandoverPage`, `OrdersPage` goi `fetchConfiguredProducts(user)` khi mount/event de staff thay menu moi sau khi admin sua.
- **Danh sach dat hang lay tu SKU:** `OrdersPage.tsx` dung `getProducts().filter(active)` lam datalist, cap nhat don vi theo `inboundUnit || unit` khi chon SKU/ten mon. Khong con danh sach hardcode/local cu.
- **Sua menu tren UI:** `ControlCenterPage.tsx` co `editingMenuId`, nut `Sua` tren tung mon menu, form menu doi sang `Luu mon/Huy sua` khi dang sua. Luu mon giu nguyen `id/source/active` cua product cu de khong dut lien ket voi stock/bag allocation, roi `syncConfiguredProducts` day len `public.products`.
- **POS nhan vien chi hien mon da phat:** `getSaleProducts()` chi tra mon finished khong-kg, active, co gia > 0. `SalesPage.sellerMenuProducts` chi render product co `bag_allocations` trong nhan vien/nguoi ban dang chon; khong con hien ca menu nen khong con loat card "Chua phat". Mon da phat nhung het so luong hien "Da het"; neu khong co allocation thi hien empty state cho ca staff va ca truong.
- **Kho hien ton tong:** `InventoryPage.tsx` bo thanh workflow/tab van hanh ngay trong overview, bo date toolbar o man ton kho, va dung `stock.filter(isVisibleStockLine)` toan bo lich su thay vi ton theo ngay. Copy doi sang "Tong kho luy ke"; cac phieu/so lieu kho la noi luu tru tong kho, khong phai chi ton hom nay.
- **QA/deploy DB:** `npx.cmd tsc -b` pass; `npm.cmd run build` pass. `20260702_products_sync_policy_repair.sql` va `20260702_purge_hidden_accounts_branches.sql` da apply bang `npx.cmd supabase db query --linked --file`. Edge Function `manage-employee` da deploy bang `npx.cmd supabase functions deploy manage-employee`.

## 22. Lich lam staff va poster bao cao tu dai (2026-07-02, phien 6)
- **Lich lam khong con chi thay "Toi":** `fetchSchedulePeople()` trong `src/lib/attendance.ts` van loc active branch/profile cho admin/manager, nhung khong dung `fetchEmployees()` lam filter bat buoc voi staff/shift_leader. Ly do: RLS profile cua nhan vien co the chi tra ve chinh minh, neu lay lam nguon loc thi roster RPC `list_schedule_people` bi cat con 1 nguoi. Staff/ca truong gio tin roster active theo branch tu RPC de xem du lich cua ca chi nhanh.
- **Poster bao cao khong bi che doanh thu:** `src/styles.css` bo `aspect-ratio: 4/5` va `overflow:hidden` tren `.rp-poster`, bo cat tren `.rp-revenue`, tang line-height doanh thu va cho wrap so tien neu qua dai. Poster duoc phep cao len theo noi dung thay vi ep khung lam stat chip de len so doanh thu.
- **Bang thi dua hien du nhan vien:** `ReportPoster` trong `src/pages/ReportPage.tsx` bo `.slice(0, 4)` o `racers`, nen neu co nhieu nhan vien thi danh sach dai ra trong anh bao cao, khong an bot top 4.
## 23. Tổng kiểm tra deploy + vá crash realtime + rò ca ngày cũ (2026-07-03)
- **Xác nhận mô hình lưu trữ dài hạn (audit code + DB thật):** mọi dữ liệu nghiệp vụ lưu vĩnh viễn trên Supabase theo `business_date`/`shift_date`/`report_date` — KHÔNG có job xóa theo ngày. `fetchMovements` lấy toàn bộ lịch sử (tồn kho lũy kế), `revenue.ts` tổng hợp theo khoảng `from/to`, Dashboard mặc định tháng hiện tại, Kho có bộ lọc ngày/tháng/năm/tất cả + tự nhảy về ngày gần nhất có dữ liệu, POS có ô chọn ngày xem lại (chỉ tạo hóa đơn cho hôm nay). Các trang "hôm nay" (Today/Report/Handover) chỉ là màn vận hành, không phải nơi lưu.
- **BUG NẶNG đã sửa — crash trắng trang manager/admin:** supabase-js bị nâng lên 2.108 (package.json ghi ^2.50), bản mới `client.channel(topic)` TÁI SỬ DỤNG channel cũ khi trùng topic, và `.on('postgres_changes')` trên channel đã subscribe sẽ THROW → `useConfiguredBranches` (mount đồng thời ở App + page với topic tĩnh `configured-branches`) làm React unmount cả cây → dashboard quản lý trắng trang. **Fix:** helper `uniqueChannelName(base)` trong `src/lib/supabase.ts`; áp cho MỌI channel postgres_changes (branches.ts, products.ts, App app-stock, AdminPage admin-live, KitchenPage, ManagerDashboardPage, ReportPage, SalesPage, ShiftHandoverPage) + try/catch ở 2 lib hook. Riêng `schedule:company` (AttendancePage) dùng presence nên topic PHẢI chung giữa các client → giữ tên, thêm cơ chế gỡ channel cũ + retry tối đa 3 lần. **QUY TẮC MỚI: channel chỉ-nghe postgres_changes luôn đặt tên qua `uniqueChannelName()`; channel presence giữ topic chung + retry.**
- **BUG nghiệp vụ đã sửa — ca mở ngày cũ rò sang hôm nay:** `ShiftHandoverPage` lấy `openSession = sessions.find(status==='open')` không lọc ngày (fetch cũng không lọc) → ca quên chốt hôm trước chiếm màn hình "Ca N đang mở", chặn nhận ca mới và nếu chốt sẽ ghi movement `shiftDate` hôm nay (trộn ngày). Fix: `openSession` chỉ nhận ca `businessDate === today`; ca cũ còn mở hiện banner cảnh báo (túi chưa thu vẫn tự chuyển vào danh sách thu túi như thiết kế). Backend vốn đã đúng: cả RPC Supabase lẫn LAN đều tự đóng ca cũ khi mở ca ngày mới.
- **BUG thiết kế đã sửa — quản lý không lập được lịch:** tab `board` (SharedScheduleBoard — nơi DUY NHẤT lập/sửa lịch tuần) bị `show: !isManager` ẩn với manager/admin dù nhãn tab là "Bảng lịch" cho manager và heading hứa "Lập lịch theo tuần". Đổi thành `show: true`.
- **QA scripts đại tu — cả 7 script pass:** các script cũ dùng key `gustino_demo_user_v1` KHÔNG có `authToken` nên bị App sign-out (đúng thiết kế bảo mật mục 19) và bám selector UI đã thay. Đã cập nhật: `qa-roles` (pass sẵn 14/14 sau fix crash), `qa-app-navigation` (nút TodayPage mới, xác nhận Kho không còn nút phát túi), `qa-admin` (card-menu quản lý + manager-attendance + dashboard), `qa-attendance` (ca ôm giờ hiện tại vì check-in chỉ mở 30' trước giờ vào, check-out 30' trước giờ ra), `qa-handover` (trọn vòng đời: seed đăng ký + chấm công qua LAN API → nhận Ca sáng → phát túi matrix → thu túi/hỏng → chốt → carry-over Ca tối → Báo cáo cuối ngày; nhãn ca giờ là "Ca sáng/Ca tối" không phải "Ca 1/2"), `qa-shared-schedule-accounts` (API tạo account cần `username`; board dọc `.schedule-vboard`; port LAN 5177), `qa-mobile-shift-setup` (bấm tab "Bảng lịch" trước; sửa race ghi localStorage TRƯỚC khi app boot xong bị callback getSession dọn mất — luôn ghi user bằng `addInitScript` hoặc sau khi app boot xong).
- **DB thật (audit 2026-07-03):** dữ liệu nghiệp vụ còn nguyên (98 movements, 11 sessions, 18 allocations, 5 receipts, 2 snapshots). Tồn đọng: 3 `operation_days` cũ còn `open` (gold-coast 26–27/06, lotte-vt 24/06) + 2 allocation tháng 6 chưa đối soát thuộc ca đã đóng (nhân viên đã bị purge). **Migration `20260703_settle_stale_ledger_days.sql` đã viết sẵn nhưng CHƯA apply** (bị chặn permission phiên này — cần user chạy `npx supabase db query --linked --file supabase/migrations/20260703_settle_stale_ledger_days.sql`). Lưu ý: user đã tạo lại 2 chi nhánh test active (`1`=test, `2`=NHÀ HÀNG TEST 2) — dữ liệu test sẽ lẫn vào màn "Tất cả chi nhánh" nếu không tắt/xóa khi dùng thật.
- **QA/deploy:** `tsc -b` + `npm run build` pass; deploy `npx vercel deploy --prod --yes` thành công, https://gustino-operations.vercel.app đang serve bundle mới (`index-BHLzLvqb.js`).

Dữ liệu không nên “gộp mất ngày”. Cách đúng là lưu dài hạn theo business_date/shift_date trên Supabase, rồi giao diện cho xem theo ngày / tháng / năm / tất cả. Trước đó app mặc định nhìn “hôm nay”, nên dữ liệu ngày cũ trông như mất.
Mình đã sửa:
Admin đăng nhập sẽ tự lấy tất cả chi nhánh active.
Thêm thanh “Dữ liệu đang xem” để đổi chi nhánh ở app.
Màn Kho có bộ lọc Theo ngày / tháng / năm / tất cả và tự nhảy về ngày gần nhất có dữ liệu nếu hôm nay trống.
Màn POS có bộ chọn ngày để xem lại hóa đơn/túi ngày cũ; chỉ tạo hóa đơn mới cho hôm nay để tránh ghi nhầm ngày.
Dữ liệu vẫn lưu dài hạn trong Supabase, không lưu nghiệp vụ trên trình duyệt.
Build đã pass và production đã deploy:
https://gustino-operations.vercel.app
Lưu ý nhỏ: tài khoản manager hiện chưa được gán branch 1, nên nếu muốn manager thấy dữ liệu branch 1 thì cần cấp quyền branch đó. Mình không tự mở rộng quyền manager bằng SQL vì đó là thay đổi phân quyền production khá nhạy; admin thì sau khi đăng xuất/đăng nhập lại sẽ thấy các chi nhánh active để chọn.

## 24. Worklog 2026-07-03 - audit DB, kho bao cao, check-out geotag
- **Migration stale ledger da chay tren Supabase:** `supabase/migrations/20260703_settle_stale_ledger_days.sql` da apply thanh cong bang `npx.cmd supabase db query --linked --file ...`. Migration chi dong/nghiem thu ca/ngay cu, khong xoa du lieu.
- **Audit DB doc-only:** tao `scripts/db_audit_current_compact.sql` de gom counts/ranges vao 1 SELECT. Ket qua Supabase linked: 7 profiles active (admin 1, manager 1, kitchen 1, shift_leader 2, staff 2), 5 branches active, 5 sales_receipts, 98 stock_movements, 2 report_snapshots, 3 attendance_records. Du lieu khong mat khoi DB nhung bi it/le nhom ngay-chi nhanh: branch `1` co receipt/report ngay 2026-07-02, `gold-coast` co du lieu thang 6, manager co the thay trong neu chua duoc gan branch co du lieu hoac range mac dinh khong trung ngay.
- **Admin/manager khong con vao lich su ca nhan:** `AppShell.tsx` doi nav quan ly tu `my-records` sang `report-archive`; `ManagerDashboardPage.tsx` action "Kho bao cao" di thang `report-archive`; `MyRecordsPage.tsx` chan role admin/manager chi xem kho bao cao, khong hien tab "Lich su cua toi".
- **Bang kho admin doi sang danh sach ledger:** `AdminPage.tsx` them `inventoryLedgerRows` tu `rangeMovements`, hien cot ngay, chi nhanh, loai phat sinh, thanh pham/SKU, so luong, nguoi nhap, ghi chu. `styles.css` them `.admin-inventory-ledger*` de desktop la bang gon va mobile la dong compact co label, khong phai card lon.
- **Check-out bat buoc anh + GPS + dia chi:** them migration `supabase/migrations/20260703_attendance_checkout_geotag.sql` va da apply Supabase. `attendance_records` co cac cot `check_out_selfie_url`, `check_out_latitude`, `check_out_longitude`, `check_out_accuracy`, `check_out_address` + constraint not valid cho ban ghi moi. `checkOut()` trong `src/lib/attendance.ts` lay GPS/reverse geocode, dong dau anh CHECK-OUT, upload Supabase Storage, roi update DB. `AttendancePage.tsx` bat chon anh check-out truoc khi bam check-out.
- **Dia chi dinh vi giam sai quan:** `api/reverse-geocode.ts` uu tien parse thanh phan hanh chinh VN (`Phuong/Xa`, `Quan/Huyen/Thi xa`, `Thanh pho/Tinh`) tu display name va luon kem GPS lat/lng trong address de doi chieu khi nha cung cap map tra boundary sai.
- **Xuat bang cong co bang chung check-out:** `AttendancePage.tsx` va `AdminPage.tsx` them cot dia chi/toa do check-out vao Excel; link anh check-out van duoc ky URL tu bucket `attendance-selfies`.
- **QA/deploy:** `npm.cmd run build` pass local; migration checkout columns verify bang `scripts/db_audit_attendance_checkout_columns.sql`; deploy production thanh cong `dpl_Fg2kscVCjeE68TgVdW5z7fCGC798`, alias `https://gustino-operations.vercel.app`, HEAD 200 OK.
- **Chua thuc hien thao tac xoa/seed lai du lieu test:** can xac nhan rieng vi day la destructive. Khuyen nghi chi reset sau khi user xac nhan ro scope giu admin/manager/kitchen, xoa staff/shift_leader test, xoa data van hanh test, va tao lai bo seed 1 tuan bang account co auth login that.

## 25. Worklog 2026-07-03 - go phan du thua va sua top avatar
- **Go thanh branch scope du thua:** xoa `BranchScopeBar`, `changeWorkingBranch`, import `useConfiguredBranches` khoi `src/App.tsx`; xoa CSS `.branch-scope-bar`. Ly do: thanh "Du lieu dang xem" o dau app lam user/manager de hieu sai va co rui ro doi `user.branchId` ngoai ngu can thiet. Branch scope nen nam trong tung man co bo loc rieng, khong ep toan app.
- **Sua dashboard quan ly khong trong do range:** `ManagerDashboardPage.tsx` doi default range tu thang hien tai sang 30 ngay gan nhat de du lieu cuoi thang truoc khong bien mat khoi man dashboard ngay dau thang.
- **Audit scope manager doc-only:** tao/chay `scripts/db_audit_manager_branch_scope_compact.sql`. Ket qua: manager `Quan ly` co profile branch `gold-coast`, assigned `gold-coast`, `lotte-2310`, `lotte-vt`; data dang nam nhieu o branch test `1` (manager khong co quyen), `lotte-2310` hien khong co receipt/report/stock. Trang quan ly trong khong phai do mat DB ma do scope branch + du lieu test lech chi nhanh.
- **Top nhan vien co avatar dong bo profile:** `ManagerDashboardPage.tsx` fetch `fetchEmployees(user)`, map avatar/name theo `employeeKey/employeeName/branchId`, hien avatar trong KPI top va bang leaderboard nhan vien. `AdminPage.tsx` them `avatarUrl` vao `buildCompetitionRows()` tu `payrollEmployees`, hien avatar trong bang thi dua. `styles.css` them `.employee-top-avatar`, chinh grid desktop/mobile.
- **QA/deploy:** `npm.cmd run build` pass; deploy production thanh cong, alias `https://gustino-operations.vercel.app`, HEAD 200 OK.

## 26. Worklog 2026-07-03 - cap quyen manager xem branch test co du lieu
- **Cap quyen hep theo xac nhan cua user:** da insert `manager_branch_assignments` cho manager `Quản lý` (`ba1c1577-5dfd-4f51-9522-ef6f69d567dc`) vao branch `1`. Khong cap tat ca manager vao tat ca branch, khong xoa/sua du lieu van hanh.
- **Audit sau cap quyen:** `scripts/db_audit_manager_branch_scope_compact.sql` xac nhan manager nay hien co `assigned_branch_ids`: `1`, `gold-coast`, `lotte-2310`, `lotte-vt`. Branch `1` dang co 4 receipts, 52 stock movements, 1 report snapshot; `gold-coast` co 1 receipt, 41 stock movements, 1 report snapshot.
- **Repo hygiene:** script cap quyen mot lan da xoa khoi repo sau khi chay de khong de lai cong cu du thua. `npm.cmd run build` pass sau thay doi.

## 27. QA phân quyền toàn diện + đại tu (dashboard CukCuk) — 2026-07-03 phiên 7
> User yêu cầu: (1) UI quản lý/admin theo bố cục CukCuk nhưng giữ màu navy/xanh lá; (2) test toàn bộ vận hành giả lập 3 nhà hàng/30 nhân viên, mọi phân quyền; (3) phân loại kho (dropdown); (4) tính lương linh động + đồng bộ bảng công. Ưu tiên user chọn: **ổn định trước, đẹp sau**.

### Phase 1 — QA + ổn định (ĐÃ XONG)
- **7 script QA cũ pass lại.** Sửa 3 script bị stale (KHÔNG phải lỗi app):
  - `qa-admin.mjs`: bỏ assert `DỮ LIỆU ĐANG XEM` (BranchScopeBar đã gỡ ở §25); giờ assert `BIỂU ĐỒ DOANH THU` + `DOANH THU THEO NGÀY` ở `#management`.
  - `qa-attendance.mjs`: check-out §24 bắt buộc chụp ảnh trước → set file vào `.checkout-selfie-button input` trước khi bấm; dùng **user id duy nhất mỗi lần chạy** để không đụng record chấm công lần trước (LAN lưu bền).
  - `qa-handover.mjs`: **tự seed** nhân viên nhận túi (`qa-handover-staff`, POST registration bằng header của chính staff — LAN chặn ca trưởng tạo ca hộ) thay vì phụ thuộc `qa-attendance-user` còn sót; cần LAN store sạch trong ngày.
- **2 script QA mới:**
  - `qa-permission-matrix.mjs` — **110 kiểm tra** (5 vai trò × 22 trang), mirror chính xác `canAccessPage`/`defaultPageForRole`, assert theo `location.hash` cuối cùng + bắt trắng trang + lỗi runtime. **Tất cả đúng, không rò quyền.** (Phát hiện CODEMAP §2 ghi sai `canUseSales` — đã vá.)
  - `qa-multi-branch-load.mjs` — mở **30 phiên đồng thời** trên 3 chi nhánh (2 manager + 1 admin + mỗi chi nhánh 2 ca trưởng/1 bếp/6 staff), xác nhận không crash/trắng trang (đúng lớp bug realtime §23). **Pass.**
- **LAN store (`data/lan-store.json`) là scratch local cho QA/offline — KHÔNG phải DB thật (dữ liệu thật ở Supabase).** Khi QA lifecycle bị kẹt do data cũ: backup rồi reset các mảng giao dịch (`movements/operationDays/reportSnapshots/inventoryReports/reportDrafts/shiftRegistrations/attendanceRecords/bagShiftSessions/bagAllocations/supplyRequests`), GIỮ roster (`profiles/branches/shifts/commissionRules/employeeKpiTargets`), rồi **khởi động lại dev server** (store nạp vào RAM lúc boot, sửa file khi server chạy sẽ bị đè). Có backup `data/lan-store.backup-*.json`.
- **Kết luận Phase 1:** lớp phân quyền/điều hướng/đồng thời SẠCH, không có bug chặn phát hành. Thêm vào danh sách QA trước deploy: `qa-permission-matrix.mjs`, `qa-multi-branch-load.mjs`.

### Phase 2 — Dashboard kiểu CukCuk giữ màu navy/xanh lá (ĐÃ XONG)
- `src/pages/ManagerDashboardPage.tsx` (trang `dashboard`, chung cho manager+admin) thêm **3 khối CukCuk** phía trên các chart cũ (giữ nguyên chart/leaderboard/drilldown):
  1. **Preset chips** `.ck-presets` (Hôm nay / 7 ngày / 30 ngày / Tháng này) — set `from/to`; `presetKey` tự nhận preset đang chọn.
  2. **Hero doanh thu** `.ck-hero-card` (gradient navy `#16304f→#0f1f33`, số khổng lồ xanh lá nhạt) — TỔNG DOANH THU + 2 dòng so sánh %: vs kỳ trước & vs cùng kỳ tuần trước. Khi range = 1 ngày (`isSingleDay`) nhãn đổi thành "So với hôm qua / ngày này tuần trước".
  3. **Thẻ chi nhánh** `.ck-branch-cards` (ẩn khi đã lọc 1 chi nhánh) — mỗi chi nhánh: tên + chevron, doanh thu + badge số túi, 2 dòng so sánh %. Bấm vào = drilldown (`setDrilldownBranchId`).
- **Dữ liệu so sánh:** effect fetch receipts mở rộng về `compareFrom = from - max(windowDays, 7)` để có kỳ trước + cùng kỳ tuần trước. Helper `sumRevenue(winFrom,winTo,branchId?)` gọi lại `buildDailyRevenueRows` cho từng cửa sổ; `pctChange`, `daysInWindow`, `addDays`, `formatFullMoney` (số đầy đủ + đ) ở cuối file. Logic doanh thu gốc KHÔNG đổi.
- **Màu so sánh:** tăng = xanh lá (`.ck-up`), giảm = đỏ (`.ck-down`), 0 = gạch ngang. Trên hero (nền tối) override sang tông sáng hơn.
- **CSS:** namespace `.ck-*` ở CUỐI `src/styles.css` (sau khối `.admin-inventory-ledger`), mobile-first, không cuộn ngang, desktop `.ck-branch-cards` là grid `auto-fill minmax(320px,1fr)`.
- **QA:** `tsc -b` + `npm run build` pass; `qa-permission-matrix` (110), `qa-multi-branch-load` (30 phiên), `qa-admin` đều pass lại sau redesign. Ảnh: `artifacts/cukcuk-dashboard/{mobile,desktop}{,-today}.png`.
- **CÒN LẠI (polish, chưa làm):** các section chi tiết trong `AdminPage.tsx` (`#management`, revenue list…) chưa đổi sang phong cách hero/thẻ CukCuk — trang dashboard là ưu tiên đã xong. Có thể áp `.ck-*` cho section revenue của AdminPage ở phiên sau. Lưu ý LAN store demo chỉ hiện 2 chi nhánh có id khớp (gold-coast, lotte-vt); DB thật đủ 3.

### Phase 3 — Phân loại kho bằng dropdown (ĐÃ XONG)
- `SmartStockList` trong `src/pages/InventoryPage.tsx` thêm **dropdown lọc phân loại** (`.stock-category-filter`): Tất cả / Nguyên liệu (`raw`) / Bao bì (`packaging`) / Thành phẩm (`finished`), kèm số lượng mỗi loại. `presentCategories` chỉ hiện các loại có trong stock; dropdown **tự ẩn khi chỉ 1 loại**. Bọc lại trong `.smart-stock-wrap` để giữ nguyên style `.smart-stock-list`. `categoryLabel(value:string)` map nhãn (product.category là string).
- Sản phẩm đã sẵn trường `category` (`constants.ts` + `products.ts`), không cần migration. `isVisibleStockLine` chỉ ẩn dòng số dư 0 (không lọc theo loại) nên bộ lọc dùng được cho cả overview lẫn phiếu kiểm kê khi kho có ≥2 loại.
- Text mới: `categoryFilter`/`allCategories` (vi+en). CSS `.stock-category-filter` cuối `styles.css` (font 16px chặn iOS zoom, `max-width:320px`, không cuộn ngang).
- **QA:** `tsc -b` + `npm run build` pass; kiểm chứng chức năng: All=19, Nguyên liệu=2 (đúng nhãn), Bao bì=2 (đúng nhãn) — lọc đúng; `qa-app-navigation` pass.

### Phase 4 — Khôi phục BẢNG LƯƠNG (đồng bộ bảng công → lương) (ĐÃ XONG)
- **Gốc vấn đề:** block "BẢNG LƯƠNG" trong `AdminPage.tsx` (section `payroll`, route `manager-payroll`) từng bị **tắt bằng `{false && activeSection === 'payroll' && (...)}`** ở phiên trước — thay bằng bảng KPI theo ngày kèm ghi chú "Bảng này thay cho chức năng lương". User yêu cầu khôi phục chức năng tính lương → **bỏ `false &&`** để bật lại.
- **Bố cục mới của section `payroll`:** (1) **BẢNG LƯƠNG tháng** lên đầu = tổng (Lương công/Hoa hồng/Thưởng-trừ/Thực nhận) + lưới **Lương mặc định theo vai trò × chi nhánh** (input `hourlyRate`/`fixedSalary`) + thẻ từng người `.payroll-card` với input **linh động** Lương giờ/Lương cứng/Thưởng/Trừ/Ghi chú; (2) **CHI TIẾT KPI THEO NGÀY** xuống dưới (nguồn thưởng cộng vào lương). Đã di dời bảng KPI xuống sau bảng lương.
- **Đồng bộ bảng công:** `buildPayrollRows` lấy `totalHours` từ `buildAttendanceReport` (chấm công), `basePay = fixedSalary>0 ? fixedSalary : round(totalHours × hourlyRate)`. Thêm **dòng công thức hiện rõ** `.payroll-basepay-formula` trên mỗi thẻ: "Lương công = X giờ công × Yđ/giờ = Zđ" (hoặc "= lương cứng"). Đã kiểm chứng: seed chấm công 8 giờ → nhập 20.000đ/giờ → hiện "= 160.000đ".
- **Nhãn discoverability:** dashboard CRM + AppShell nav `manager-payroll` đổi từ "KPI nhân viên/Staff KPI" → **"Lương & KPI / Payroll & KPI"** (shortLabel "Lương"). Không QA script nào phụ thuộc nhãn cũ.
- **Lưu trữ:** `src/lib/payroll.ts` (đã có) lưu Supabase `payroll_entries`/`payroll_role_defaults`/`payroll_fixed`, fallback localStorage nếu chưa chạy migration `20260629_payroll.sql`. PAYROLL_ROLES = `shift_leader|staff` (admin/manager/kitchen không tính lương doanh số).
- **QA:** `tsc -b` + `npm run build` pass; `qa-permission-matrix` (110), `qa-admin`, `qa-app-navigation` pass lại. Ảnh: `artifacts/payroll-sync/mobile.png`.
### Phase 5 — Audit DB đầy đủ + DEPLOY (2026-07-03)
- **User yêu cầu:** chạy hết DB còn thiếu, đảm bảo KHÔNG còn gì lưu local/tạm, rồi mới deploy.
- **Audit định danh code ↔ DB thật (đọc-only):** trích mọi `.from('table')` (28 bảng) + `.rpc('fn')` (17 hàm) trong `src/`, query `information_schema`/`pg_class` trên prod. **KẾT QUẢ: 28/28 bảng + 17/17 hàm ĐỀU TỒN TẠI.** Payroll (`payroll_entries/payroll_role_defaults/payroll_fixed`) đủ cột + **RLS bật + policy** (nên ghi trực tiếp cloud, không lưu tạm). Cột migration gần đây đều có: `products.deleted_at`, `attendance_records.check_out_*`, `bag_shift_sessions.opening/closing_photo_url`. → **Migration 20260629_payroll.sql thực ra ĐÃ được apply ở phiên trước** (ghi chú "user cần chạy" ở §13 là stale). **Không migration nào còn thiếu.**
- **Không có đường lưu nghiệp vụ vào localStorage:** `store.saveLocalMovements`/`salesReceipts.saveLocalReceipts` = no-op (`[]`/`void`); `payroll.upsert*` THROW khi thiếu bảng (không âm thầm lưu tạm); `products.writeLocalProducts` chỉ là cache, cloud là nguồn sự thật. localStorage chỉ giữ: phiên user, ngôn ngữ, sidebar collapse, cache sản phẩm.
- **DEPLOY production:** `npm run build` pass → `npx vercel deploy --prod --yes` **thành công**, alias `https://gustino-operations.vercel.app` (dpl_AXiwke2yq1NHDWKUREYw8dUq4R5H, readyState READY), live HTTP 200. Deploy gồm cả 4 Phase (dashboard CukCuk, lọc kho, khôi phục bảng lương, QA hardening).

## 28. Go-live thật: sửa UI theo feedback + xóa data ảo + tạo 31 account thật (2026-07-04)
### Giải thích 2 "lỗi" user hỏi (không phải bug)
- **Lỗi 400 `auth/v1/token`** = đăng nhập sai (sai user/mật khẩu hoặc account chưa tồn tại). `LoginPage` thử email thật rồi thử legacy email → 1 lần sai hiện 2 dòng 400. Hết khi có account đúng.
- **"Sai số" doanh thu:** (a) "30 ngày" vs "tháng này" khác khoảng ngày (ngày 4 → tháng này chỉ 1–4/7); (b) tổng gồm cả chi nhánh test (1,2) còn số liệu; đã xóa data test → khớp lại. Không double-count (đã verify).
### Sửa UI (đã deploy)
- **Manager KHÔNG xem lương & bảng công:** `manager-payroll` + `manager-attendance` giờ chỉ `canUseAdmin` (nav `AppShell.tsx`, `canAccessPage`+render guard `App.tsx`, nút CRM dashboard). Manager chỉ còn: Doanh thu, Kinh doanh, Kho, Đặt hàng, Kho báo cáo.
- **Bỏ thẻ "Chưa có dữ liệu"** (Chuyển đổi, Điểm dịch vụ) ở KPI business section (`AdminPage buildCoreKpiCards`) — chỉ còn Doanh số + Hao hụt.
- **Bỏ "hoa hồng" → gọi "Thưởng KPI"** khắp AdminPage (section labels, payroll card/summary, competition hero, Excel sheet). `commission` value thực chất = KPI bonus (daily+weekly) nên chỉ đổi NHÃN, giữ giá trị vào grossPay. Bỏ dòng "Thưởng tháng" (monthlyBonus vốn đã =0). KPI **chỉ theo ngày**.
- **Xếp loại báo cáo theo KPI:** `ReportPage` grade dùng `kpiScore = max(teamKpi, averageEmployeeKpi)`; tầng thấp nhất đổi "Thiếu dữ liệu" → **"Cần cố gắng"** (luôn có xếp loại theo KPI).
- **Poster thi đua hết tràn mobile:** thêm `@media (max-width:640px)` thu nhỏ font/đổi podium 1 cột (cuối styles.css).
- **Bỏ lưới shortcut ở TodayPage** (`.shift-action-grid`, image 5) — trùng bottom-nav.
### DB thật — go-live (qua `supabase db query --linked`, KHÔNG có service_role key/JWT admin nên tạo account bằng SQL trực tiếp)
- **Cơ chế tạo account bằng SQL (đã verify login + đổi mật khẩu OK):** insert `auth.users` (instance_id zero, aud/role='authenticated', `encrypted_password=crypt('123456',gen_salt('bf'))`, email_confirmed_at=now, token cols='', raw_user_meta_data có full_name/role/branch_id/employment_type/position_title) + `auth.identities` (provider='email', **provider_id = user.id::text**, identity_data{sub,email,email_verified,phone_verified}). Trigger `on_auth_user_created`→`handle_new_auth_user()` TỰ tạo `public.profiles` từ metadata. Email = `<2 tên cuối, bỏ dấu, liền>@accounts.gustino.vn` (vd Nguyễn Ngọc Bảo Linh→`baolinh`). pgcrypto có sẵn.
- **Đã XÓA sạch data vận hành** (movements/receipts/sessions/alloc/attendance/shiftreg/schedule_entries/reports/opdays/inventory_reports/supply_requests/payroll_entries/bonus/kpi/employee_kpi_targets/lotte_recon = 0). **Deactivate** chi nhánh test `1`,`2` + toàn bộ staff/shift_leader cũ (giữ admin/manager/kitchen). Không hard-delete account cũ (tránh vỡ FK auth production) — chúng inactive nên app ẩn + chặn login.
- **Đã tạo 31 account thật** (GC 11, 23/10 11, VT 9), mật khẩu `123456`, role Ca trưởng/Ca phó→shift_leader(leader), Full/Part-time→staff. Upsert idempotent (reset pw + active nếu email đã có). Verify 5 login OK đúng role/branch. Danh sách username=2 tên cuối.
- **Deploy:** build pass, `npx vercel deploy --prod --yes` OK, https://gustino-operations.vercel.app HTTP 200.
### CÒN LẠI (phiên sau) — user đã được báo
- Thiết kế lại KHO ca trưởng thành 4 chức năng rõ (Nhập / Xuất / Kiểm kê / Tồn kho); card báo cáo hao hụt-tồn theo chi nhánh+ngày; Báo cáo (ledger + infographic) **thu gọn theo ngày, bấm mới xổ**; review UX đăng ký ca; **bảng KPI user sẽ gửi để rà lại công thức** (hiện KPI theo `commission.ts POSITION_KPI_FORMULAS`). → **ĐÃ LÀM HẾT ở §29.**

## 29. Kho 4 chức năng + card hao hụt-tồn + ledger/báo cáo thu gọn theo ngày + UX đăng ký ca + rà KPI (2026-07-04, phiên 8)
> 5 việc CÒN LẠI ở §28. Ưu tiên: giữ mobile-first, không cuộn ngang, không phá dữ liệu dài hạn.
- **(1) KHO ca trưởng gom về ĐÚNG 4 chức năng** (`src/pages/InventoryPage.tsx`): `InventoryCrmMode` giờ chỉ còn `stock | inbound | outbound | count` (bỏ `loss` khỏi thanh CRM `BranchInventoryCrm` → 5 nút xuống 4: **Tồn kho / Nhập hàng / Xuất bán / Kiểm kê**). Bỏ state `tab` + component `InventorySmartReport` (đã xóa); điều hướng lái hoàn toàn bằng `crmMode`. **Nhập** có sub-toggle `.inventory-subtabs` (`inboundSub: material | processing`) gộp *Nhập nguyên liệu* (`VoucherEditor`) + *Chế biến & đóng gói* (`ProcessingBatchEditor`) — cả hai đều "đưa hàng vào kho bán". `crmModeFromTab()` map `initialTab` (overview/inbound/processing_out/count từ TodayPage/ReportPage `onOpenInventory`) sang crmMode+inboundSub, nên nút ở TodayPage vẫn nhảy đúng bước. Hao hụt không còn là "chức năng" — hiện trong lịch sử mẻ chế biến + card quản lý (mục 2). Grid `.inventory-crm-actions` desktop đổi `repeat(5→4)`. Component `StockTable`/`DailyLossPanel` còn định nghĩa nhưng KHÔNG render (dead, giữ để giảm rủi ro; tsconfig không bật noUnusedLocals).
- **(2) Card hao hụt–tồn kho theo chi nhánh** (`src/pages/AdminPage.tsx` section `inventory`, route `manager-inventory`): thêm `branchInventorySummaries` (mỗi chi nhánh: tồn kho, sắp hết, nhập kỳ, xuất kỳ, hao hụt qty + %). Render `.branch-loss-stock-cards` (grid `auto-fill minmax(280px,1fr)`) ở đầu section, mỗi chi nhánh 1 thẻ `.loss-stock-card` (badge hao hụt good/warn/bad theo % = wasteQty/sourceQty, top-3 SP hao hụt). **Bộ lọc "chi nhánh + ngày / tất cả" DÙNG CHUNG `admin-filter-bar`** sẵn có (dropdown "Tất cả chi nhánh" + from/to + quick-range Hôm nay/Tháng này/Tháng trước) — không thêm filter riêng để tránh lệch state.
- **(3a) Sổ kho thu gọn theo ngày** (AdminPage ledger): `inventoryLedgerByDay` group `inventoryLedgerRows` theo `shiftDate`; render mỗi ngày 1 `<details className="admin-ledger-day">` (summary = ngày + số phát sinh + số chi nhánh), chỉ ngày mới nhất `open`. Tránh danh sách phẳng 100+ dòng.
- **(3b) Kho báo cáo infographic thu gọn theo ngày** (`src/pages/ReportArchivePage.tsx`): `groupedByDay` group `filtered` theo `reportDate`; mỗi ngày 1 `<details className="report-archive-day">` (summary = ngày + số báo cáo + tổng doanh thu), `open` nếu là ngày đầu HOẶC chứa bản đang chọn. Row con bỏ ngày (đã ở header), chỉ hiện chi nhánh + grade. CSS collapse dùng chung `.admin-ledger-day, .report-archive-day` (marker ▸/▾) cuối `styles.css` trước `.admin-inventory-ledger`.
- **(4) UX đăng ký ca mượt hơn** (`src/pages/AttendancePage.tsx` `SharedScheduleBoard`): thêm cụm nút `.schedule-week-nav` (‹ Tuần trước / Tuần này / Tuần sau ›) cạnh input "Tuần bắt đầu" — `moveWeek(±7)` (clamp không cho non-manager lùi trước hôm nay), `resetWeek()`. Sửa copy stale ("Chọn tên ở cột trái…" → "Thẻ của bạn được ghim lên đầu…"), heading "Ai đã đăng ký ca nào?" → **"Đăng ký ca trong tuần"**. Thẻ "Tôi" VỐN đã được `schedulePeople` sort lên đầu (không đổi logic).
- **(5) Rà công thức KPI:** `POSITION_KPI_FORMULAS` (`commission.ts`) **KHỚP CHÍNH XÁC** bảng KPI user gửi (GC/VT/23-10 × PG part-time 4h / full-time 8h / Ca trưởng-phó, weekday & weekend). Monthly target = 20 ngày thường + 6 cuối tuần (đúng). `isWeekend` = CN(0)/T7(6) khớp cột "Cuối Tuần (T7–CN)". **KHÔNG cần đổi code.**
- **QA (dev server LAN):** `tsc -b` + `npm run build` pass. Cả 9 script pass: qa-roles, qa-app-navigation (thêm assert kho đúng 4 chức năng), qa-admin (đổi kiểm tra manager-attendance→**manager-inventory** vì §28 khóa attendance/payroll khỏi manager; assert card hao hụt-tồn), qa-permission-matrix (mirror §28: manager-attendance/payroll = canUseAdmin — sửa 2 kỳ vọng stale), qa-shared-schedule-accounts (đổi heading), qa-attendance, qa-handover, qa-mobile-shift-setup, qa-multi-branch-load. **3 script bị stale do §28/§27 (không phải lỗi app):** qa-app-navigation (selector TodayPage grid đã gỡ), qa-admin & qa-permission-matrix (quyền manager). Ảnh: `artifacts/inventory-4func/`.
- **Deploy:** `npm run build` pass → `npx vercel deploy --prod --yes` OK (dpl_5uxWx2pTSkgAoHueKX7Bw1LfJEUa), alias https://gustino-operations.vercel.app trả HTTP 200.

## 30. Chạy DB thật cho ca mặc định + dữ liệu demo video (2026-07-04)
- **Đã chạy production bằng `supabase db query --linked --file`, KHÔNG dùng `db push`** vì repo có nhiều migration local pending/untracked. Chỉ chạy đúng 2 file SQL hẹp phạm vi:
  - `supabase/migrations/20260704_default_shifts_demo_prep.sql`
  - `scripts/seed_demo_video_20260704.sql`
- **Khung ca thật đã đổi cho 3 chi nhánh** `gold-coast`, `lotte-2310`, `lotte-vt`: `Ca 1` 07:15-15:15, `Ca 2` 14:15-22:15, `Ca PT sang` 09:00-13:00, `Ca PT chieu` 16:00-21:00. `src/lib/attendance.ts` `DEFAULT_WORK_SHIFT_TEMPLATES` cũng đã khớp 4 ca này.
- **Seed demo ngày 2026-07-03**: đăng ký ca cho toàn bộ 31 account thật đang active ở 3 chi nhánh + 12 hóa đơn demo code prefix `DEMO-YD-*`.
- **Verify production sau khi chạy** (`scripts/verify_demo_video_20260704.sql`): `active_target_shifts=12`, `demo_registrations=31`, `demo_receipts=12`, `demo_revenue=4,290,000`.
- **Lưu ý:** dữ liệu demo idempotent theo prefix `DEMO-YD-*` và note `Demo video seed`; chạy lại script sẽ xóa/chèn lại nhóm demo này, không nhân đôi.

## 31. Fix desktop poster xếp hạng + seed demo 1 tuần + deploy (2026-07-04)
- **UI desktop xếp hạng nhân viên:** sửa `EmployeeCompetitionPoster` trong `src/pages/AdminPage.tsx` + CSS `.competition-poster-list`/`.employee-leaderboard` trong `src/styles.css`. Desktop không còn bị tách rank/avatar/tiền bên trái và tên/progress dạt phải; list giờ có 4 cột gọn: rank, avatar, thông tin nhân viên + progress, doanh thu. Mobile override đã cập nhật theo 4 cột nhỏ.
- **DB thật demo 1 tuần:** chạy `scripts/seed_demo_week_20260704.sql` bằng `npx supabase db query --linked --file` (không dùng `db push`). Script dọn nhóm demo cũ `DEMO-YD-*`/`Demo video seed`, rồi seed range `2026-06-27..2026-07-03`.
- **Verify production:** `scripts/verify_demo_week_20260704.sql` trả `demo_week_registrations=217`, `demo_week_attendance_records=217`, `demo_week_bag_sessions=42`, `demo_week_allocations=217`, `demo_week_receipts=217`, `demo_week_revenue=83,970,000`.
- **Idempotent:** dữ liệu tuần dùng code prefix `DEMO-WEEK-*` + note/discrepancy `Demo week seed`; chạy lại script sẽ xóa/chèn lại nhóm demo, không nhân đôi.
- **Deploy:** build pass, Vercel production `dpl_DYubJux9drZ2hpjbb4W9kMACw62c`, alias `https://gustino-operations.vercel.app` HTTP 200.

## 32. Đồng bộ xếp hạng + fix mobile/report/export công (2026-07-04)
- **Top ca trưởng đồng bộ với bảng nhân viên:** `src/pages/ManagerDashboardPage.tsx` đổi `leaderRows` từ cách cộng doanh thu theo phiên `bag_shift_sessions.leader_id` sang lấy trực tiếp từ `employeeRows` rồi lọc hồ sơ ca trưởng/ca phó (`role=shift_leader`, `employmentType=leader`, hoặc `positionTitle` chứa "ca trưởng"/"ca phó"). Nhờ vậy nếu Minh Lý là nhân viên/ca trưởng đứng top doanh thu thì khối "top ca trưởng" không còn lệch sang người chỉ được gán làm trưởng phiên.
- **Xếp hạng nhân viên/Kinh doanh:** `src/pages/AdminPage.tsx` sort poster/bảng thi đua theo `revenue -> progress -> soldQuantity -> totalHours -> name`, bỏ việc điểm phụ `score` làm đảo thứ tự khi doanh thu bằng/khác.
- **Dashboard admin:** ẩn hẳn shortcut grid `.manager-crm-actions` trên dashboard admin/manager theo feedback user ("Bỏ bảng chức năng này").
- **Mobile polish:** `src/styles.css` khóa kích thước `.employee-top-avatar` ở KPI/leaderboard để ảnh đại diện không phình ra trên điện thoại; `.report-archive-filters` chuyển layout gọn, 1 cột trên mobile để bộ lọc kho báo cáo không tràn CSS.
- **Xuất Excel bảng công:** `selfieEvidenceUrl()` bỏ qua đường dẫn ảnh demo/missing (`demo/`, `sample/`, `mock/`) và bắt lỗi ký Supabase Storage URL. File `bang-cham-cong-*.xlsx` vẫn xuất đầy đủ dữ liệu công; ảnh chấm công không tồn tại sẽ để trống link thay vì làm export lỗi/console 400.
- **QA:** `npm.cmd run build` pass.

## 33. Danh-sách-hóa nhiều màn + phiếu đặt hàng tự điền + dashboard gọn (2026-07-04, phiên 9)
- **Phiếu đặt hàng (`OrdersPage.tsx`):** phiếu xuất ảnh (`order-report-sheet`) giờ **tự điền tên hàng từ ĐƠN ĐÃ GỬI** (bảng `.order-report-table` liệt kê `activeRequests`), KHÔNG lấy từ ô đang nhập trên màn (đã bỏ `reportDraftLines`). Đơn đã gửi hiển thị **danh sách gọn gom theo ngày** (`<details className="orders-day">`, bấm ngày mới xổ) thay cho card to; class `.supply-request-list.compact` cho hàng thấp. Xem lại đơn theo ngày/tháng/năm qua nhóm ngày (`requestsByDate`).
- **Dashboard (`ManagerDashboardPage.tsx`):** (1) **bỏ panel "SO SÁNH CỬA HÀNG · Doanh số theo chi nhánh"** (`.branch-revenue-bars`), `.dashboard-two-column` → `.dashboard-single-column` chỉ còn pie tỷ trọng NV (gỡ luôn `maxRevenue`); (2) **bảng xếp hạng NV chỉ còn top 3** (`.modern-leaderboard` slice 12→3) — trang Kinh doanh (AdminPage) GIỮ NGUYÊN top đầy đủ; (3) **hóa đơn chi nhánh gom theo ngày, thu gọn được** (`groupReceiptsByDate` → `<details className="manager-receipt-day">`, mặc định chỉ mở ngày mới nhất).
- **Kho quản lý (`AdminPage.tsx` section inventory):** card tồn kho–hao hụt theo chi nhánh (`.branch-loss-stock-cards`) → **danh sách gọn `<details className="loss-stock-item">`**, bấm mới xổ metric + top hao hụt. Ledger phát sinh kho vốn đã là `<details>` theo ngày (giữ nguyên).
- **Kho báo cáo (`ReportArchivePage`):** thêm lớp chống tràn ngang CSS (`min-width:0` cho grid/flex con, ellipsis cho tên chi nhánh/dòng NV) — hết lỗi tràn nhẹ.
- **Nghiệp vụ:** rà `revenue.ts` — doanh thu theo chi nhánh-ngày chọn nguồn ưu tiên snapshot > receipt > allocation > movement (dedup, không cộng đôi) ✓. CSS mới: `.order-report-table`, `.orders-history/.orders-day`, `.manager-receipt-days/.manager-receipt-day`, `.dashboard-single-column`, `.branch-loss-stock-list/.loss-stock-item/.loss-tag`.
- **Xóa dữ liệu doanh số test:** dùng RPC `admin_purge_business_data` (ControlCenter tab Dọn dữ liệu) — chờ user chốt phạm vi (targets/chi nhánh/khoảng ngày) vì thao tác không hồi phục. Account/nhân viên KHÔNG nằm trong target nên luôn được giữ.
- **Ngày vận hành: nhập kho KHÔNG bắt buộc (2026-07-04):** `saveProcessing`/`saveOutboundVoucher` (`InventoryPage.tsx`) bỏ chặn cứng "Không đủ tồn" → đổi thành `window.confirm` "vẫn tiếp tục?"; nếu đồng ý, `addMovements(rows, user, { allowInsufficientStock: true })` cho ghi thẳng dù RPC báo thiếu tồn (`store.ts` thêm tham số `options.allowInsufficientStock` — bypass insert cả processing/packing khi user đã xác nhận). Dùng khi ngày đó không nhập kho nhưng vẫn muốn ghi mẻ.
- **Dropdown kho lấy từ SKU admin (2026-07-04):** `constants.ts` thêm `getInboundProducts()` (raw active), `getProcessInputProducts()`, `getFinishedBulkProducts()` (finished unit kg). `InventoryPage`: dropdown **nhập kho + nguyên liệu chế biến** dùng `inboundProducts`/`processInputProducts` (config), dropdown **thành phẩm khi chia mẻ** dùng `outputOptions()` = map mặc định `PROCESS_OUTPUT_OPTIONS_BY_INPUT`, nếu nguyên liệu (admin thêm) chưa map thì fallback `finishedBulkProducts`. Lookup đổi `PRODUCTS.find(...)!` → `productById()` an toàn. ⇒ Admin sửa SKU nguyên liệu ở Control Center phản ánh vào dropdown nhập kho của ca trưởng; SKU thành phẩm (kg) phản ánh vào dropdown chia mẻ.
- **Hóa đơn đã bán (`SalesPage.tsx`):** khối `receipt-history` đổi sang **danh sách gom theo ngày** (`<details className="receipt-history-day">`, bấm ngày mới xổ). Ca trưởng/quản lý (`canManageSales`) xem hóa đơn **mọi nhân viên cùng chi nhánh** (kèm tên người bán); nhân viên xem của mình.
- **QA:** `npx tsc -b` + `npm run build` pass.

## 34. Tối ưu vận hành sau khi bỏ chia túi: chấm công/ảnh/xóa hóa đơn/kg/menu (2026-07-07)
> Feedback user: luồng lộn xộn, nút chấm công xoay mãi, ảnh đầu ca hiện lung tung + 2 nút, NV không xóa được hóa đơn, KPI Excel trống, menu NV lệch admin. Vẫn **giữ bàn giao ca** (bỏ chia túi), bàn giao **kg 4 số lẻ**. Làm 4 đợt.
- **(1a) Nút chấm công không còn "xoay mãi"** (`src/lib/attendance.ts`): `getAttendanceLocation` gọi reverse-geocode qua helper mới `fetchWithTimeout` (AbortController 5s) cho cả `/api/reverse-geocode` lẫn fallback `reverseGeocodeFromBrowser` (bigdatacloud) → không treo khi mạng chậm. `getBestGeolocationPosition` chốt sau **7s** (trước 9s), chấp nhận accuracy ≤50 (trước 35), `maximumAge:15000` để lần thử lại nhanh. `checkIn`/`checkOut` thêm callback `onPhase('locating'|'saving')`; `AttendancePage` có state `busyPhase` + `busyLabel()` đổi nhãn nút theo giai đoạn ("Đang định vị… → Đang lưu ảnh…") + dòng `.attendance-busy-hint` trấn an. Lỗi → surface message + nút tự bật lại (retry).
- **(1b + 3b) Ảnh ca — 1 nút gộp + tổng giờ:** component dùng chung `src/components/ShiftPhotoButton.tsx` (1 nút → chọn **Chụp ảnh** `capture=environment` / **Tải ảnh lên**). `ShiftHandoverPage.PhotoPickers` giờ chỉ render `ShiftPhotoButton` (giữ interface cũ). **Ảnh đầu ca chuyển lên `TodayPage`** (thẻ `#today-opening-photo`, `saveOpeningPhoto` → `uploadBagShiftPhoto(...,'opening')`; chưa mở ca thì nút dẫn sang `handover`); gỡ dải ảnh đầu ca trong luồng mở của handover (hết "lung tung"). Helper ảnh `imageFileToDataUrl`/`readFileAsDataUrl` chuyển vào `src/lib/browser.ts` (dùng chung). `stampAttendancePhoto` thêm dòng **"Tổng giờ làm: X.XXh"** đóng dấu lên ảnh CHECK-OUT (tính từ check-in→out).
- **(1c) Xóa hóa đơn POS bấm nhầm:** RPC `delete_pos_receipt(p_receipt_id)` (migration `20260707_delete_pos_receipt.sql`, **ĐÃ APPLY DB thật**, SECURITY DEFINER) — **staff xóa hóa đơn của mình + `business_date=hôm nay`**, ca trưởng/QL/admin xóa mọi hóa đơn chi nhánh (`can_manage_branch`, vốn cover cả shift_leader). Items cascade khi xóa receipt. Lib `salesReceipts.deleteSalesReceipt` (Supabase rpc / LAN `DELETE /api/sales-receipts/:id` mới trong `lan-server.mjs`). `SalesPage`: `canDeleteReceipt()` + nút **Xóa** đỏ mỗi hóa đơn trong `receipt-history` (hàng `.receipt-history-row` = nút xem + nút xóa), confirm 1 lớp, refetch. **Lưu ý mô hình:** bán POS hiện chỉ insert `sales_receipts(+items)`, KHÔNG ghi movement/allocation (tồn thành phẩm chốt bằng kiểm kê cuối ca; doanh thu tính từ receipts) → xóa hóa đơn chỉ cần xóa receipt, không phải đảo tồn.
- **(1d) Bàn giao ca tối → đóng ngày:** VERIFIED không đổi — ca 2 bấm "Báo cáo cuối ngày" gọi `closeBagShift` rồi điều hướng `ReportPage`; **`operation_day` đóng ở bước "Chốt báo cáo"** (`finalizeDailyReport` → RPC `finalize_daily_report` gộp snapshot + đóng ngày; fallback gọi `closeOperationDay`). Đúng thiết kế.
- **(2a) Bàn giao thành phẩm theo kg 4 số lẻ:** ô chốt tồn `ShiftHandoverPage` đổi `step="1"`→`step="0.0001"` + `inputMode="decimal"`; `formatNumber` đổi `.toFixed(2)`→`.toFixed(4)` (số nguyên vẫn hiện nguyên). **Migration `20260707_stock_movements_4_decimals.sql` (ĐÃ APPLY DB thật):** nới `stock_movements.quantity/source_quantity/measured_weight_kg` từ `numeric(14,3)`→`(14,4)`.
- **(2b) Thứ tự bước:** `TodayPage` thêm nhắc **"Chụp ảnh quầy đầu ca"** vào panel gợi ý (`needsOpeningPhoto` = đã check-in + ca mở + chưa có ảnh → action cuộn tới thẻ `#today-opening-photo`), sau chấm công, trước khi bán. Các trang thao tác vốn đã có nút bước kế (`InventoryPage.nextStepHint`, `SalesPage` "Chốt tồn ca", handover nút ca → báo cáo).
- **(3a) KPI Excel = doanh thu NV theo ngày:** `AdminPage.exportAttendance` thêm sheet **"Doanh thu NV theo ngày"** (helper `buildDailyEmployeeRevenueRows`: gom `sales_receipts` theo ngày×NV×chi nhánh trong khoảng lọc). Sheet "KPI doanh thu" cũ vốn đã có cột Doanh thu (từ `buildCommissionRows` — CÓ cộng doanh thu POS receipt trực tiếp, không chỉ allocation).
- **(3c) Export theo bộ lọc:** VERIFIED — mọi export (AdminPage attendance/inventory/KPI/daily-revenue + AttendancePage) dùng `from/to` (rangeRecords/rangeRegistrations/stockRows/salesReceipts đều lọc theo khoảng); mặc định = tháng hiện tại (`monthRange()`). Không dump toàn bộ lịch sử.
- **(3d) Menu NV = menu admin:** `getSaleProducts()` (`constants.ts`) **bỏ điều kiện chặn** `(sku bắt đầu 'TP-' || source==='custom')` → menu POS = mọi `finished` + `active` + `unit≠kg` + `price>0` = đúng những gì admin bật/đặt giá ở Control Center (`isMenuProduct` = finished+non-kg khớp). `ControlCenterPage` thêm badge **"Menu POS: Hiển thị / Ẩn (cần bật + có giá)"** mỗi món để admin thấy rõ.
- **(4) DB:** audit thật — public schema ~**2.9 MB / 1.546 dòng** (gồm data demo), bảng lớn nhất `profiles` 704 kB. Lưu event-sourcing theo `business_date` là ĐÚNG thiết kế, không phình; chưa cần nén/lưu-trữ-lạnh.
- **(follow-up) Cột "Vị trí" trong Excel công:** helper dùng chung `employeePositionLabel()` (`src/lib/access.ts`) — ưu tiên `positionTitle` (Ca trưởng/Ca phó/Full-time/Part-time), fallback `employmentType`→role. Thêm cột **"Vị trí"** vào sheet Tổng hợp + Chi tiết + branch sheets ở **cả** `AdminPage.exportAttendance` và `AttendancePage.exportXlsx` (resolver `positionByUser`/`positionByName` từ `employees`). `attendanceDetailColumns()`/`addAttendanceDetailRow(sheet,row,position)` (2 bản, mỗi file) đã thêm cột.
- **QA:** `tsc -b` + `npm run build` pass. QA pass: `qa-roles`, `qa-app-navigation`, `qa-attendance` (flaky 1 lần do race check-out→mục "đã chấm xong", chạy lại pass), `qa-admin`. `qa-handover` fail ở **bước seed** (`Không được thêm ca cho người khác` — LAN chặn leader tạo ca hộ staff; script stale posts 2 ca cùng 1 header, KHÔNG phải lỗi app; cần LAN store sạch + seed staff bằng header staff như §27). Chưa deploy (chờ user xác nhận).

## 35. Vá lỗi vận hành thật + chấm công bù 04-10/07 + dashboard Hôm nay (2026-07-10)
> Feedback vận hành thật: lỗi xóa mẻ rang / xóa đặt hàng (cả khi đăng nhập máy khác), bếp tiếng Việt hỏng chữ, bánh hạt dẻ thành phẩm không thấy SKU/menu, nút "Hôm nay" dashboard hỏng, và chấm công bù cho NV chưa quen chấm.
- **(1) Xóa đặt hàng — GỐC: OrdersPage KHÔNG có nút xóa/hủy** (`OrderRequestItem` chỉ hiện badge trạng thái; `deleteSupplyRequest` là dead code). RLS `supply_requests` DELETE trên prod ĐÃ CÓ policy (`role in shift_leader/manager/admin AND can_manage_branch`) — verify bằng transaction rollback: shift_leader xóa được đơn chi nhánh mình. → Thêm nút **Hủy** (updateSupplyRequestStatus→cancelled) + **Xóa** (deleteSupplyRequest) vào mỗi đơn trong `OrdersPage`, confirm 1 lớp, refresh. "Đăng nhập máy khác không xóa được" = vì không có nút, không phải lỗi RLS. CSS `.supply-request-tail/.supply-request-actions`.
- **(2) Xóa mẻ rang — verify TỪNG LỚP: RLS/trigger/id/realtime đều OK**, shift_leader xóa được movement chi nhánh mình (test rollback: xóa 2 dòng document_id OK). RPC `create_stock_movements_checked` GIỮ client id (delete-by-id chuẩn). Realtime app-stock disable khi có `authToken` (prod). Không tái hiện lỗi cứng. → Làm `deleteMovementGroup` (`InventoryPage`) ROBUST: bỏ dead-end chặn cứng khi sinh âm (giờ luôn force-able với confirm cho MỌI loại phiếu, không chỉ mẻ); tách lỗi xóa khỏi lỗi refresh (xóa thành công thì lỗi tải lại mạng chập chờn KHÔNG hiện như "lỗi xóa"). Lưu ý: batch history vẫn lọc `shiftDate === today` (UTC) — mẻ ngày khác không hiện để xóa (by design).
- **(3) Bếp tiếng Việt hỏng — 2 loại lỗi trong `KitchenPage.tsx` (i18n.ts SẠCH):** (a) **mojibake** (UTF-8→CP1252) ở literal manager `QUẢN LÝ ĐẶT BẾP`/`Toàn bộ đơn đặt bếp`/dòng theo dõi + separator `·` (dòng 156-159, 256); (b) **Việt không dấu** ở literal inline (dòng 136-143: `Da huy don dat bep`→`Đã hủy đơn đặt bếp`, `CO ... DON BEP MOI`→`CÓ ... ĐƠN BẾP MỚI`, v.v.). Sửa mojibake bằng Node latin1/CP1252 roundtrip + set trực tiếp dòng bể; sửa không-dấu bằng Edit. **QUY TẮC:** đừng lưu `.tsx` bằng editor CP1252 — literal tiếng Việt sẽ mojibake (i18n.ts UTF-8 sạch nên không dính).
- **(4) Bánh hạt dẻ thành phẩm không có SKU/menu → sale trừ NVL:** DB prod: `cake-ready` (BC-BANH, finished, "cái") `active=false` + menu `cake-box` (hộp 4) có `recipe=[{cake-raw, ingredient}]` = **trừ NGUYÊN LIỆU thô**. Picker "thành phẩm nguồn" `recipeSourceProducts` (ControlCenterPage) lọc `!isMenuProduct` nên loại thành phẩm theo "cái" (cake-ready là finished non-kg = menu product) → user không gán được. **Sửa:** (a) code broaden `recipeSourceProducts` gồm thành phẩm là ĐẦU RA chế biến (`PROCESS_OUTPUT_OPTIONS_BY_INPUT` values, kể cả non-kg) → cake-ready chọn được làm nguồn; (b) prod data: `update products set active=true` cho cake-ready; rebind `cake-box.recipe=[{cake-ready, quantity:4, role:'source'}]` = trừ THÀNH PHẨM. (Recipe role: `source`=Trừ từ mẻ, `ingredient`=Trừ NVL, `packaging`=Trừ bao bì.)
- **(5) Nút "Hôm nay" dashboard hỏng + mặc định phải là Hôm nay** (`ManagerDashboardPage.tsx`): GỐC `rollingRange(1)` dùng `Math.max(1, days-1)` → from = hôm qua, nên "Hôm nay" thành hôm qua→hôm nay, nút không active (`presetKey` không khớp 'today'), `isSingleDay` sai. Sửa `Math.max(0, days-1)` (days=1 → hôm nay→hôm nay). Đổi `initialRange` từ `rollingRange(30)` → `rollingRange(1)` (mặc định vào là HÔM NAY theo yêu cầu; đảo lại §25).
- **(6) Chấm công bù 04-10/07 (user: nhiều NV chưa quen chưa chấm):** nguồn = `shift_registrations` approved (user chỉ định "xem đăng ký ca"). **Phase A (06-10/07, reg CÓ SẴN, đáng tin):** insert `attendance_records` cho mọi reg approved CHƯA có record (không đè check-in thật của NV đã chấm); check_in=start, check_out=end, evidence placeholder (`sample/backfill-*.png` + toạ độ chi nhánh + địa chỉ "Chấm công bù…"). **Phase B (04-05/07, KHÔNG có reg — Sat=04):** đọc từ ảnh lịch tuần 1 (user chọn "nhập từ ảnh, tên khớp"), tạo reg thủ công (shift_id null, approved, note backfill) + attendance; chỉ tài khoản TÊN KHỚP DB (bỏ Mai Thị Thu/Nguyễn Phụng Quỳnh… không phải account; 23/10 độ tin thấp hơn do tên/vị trí lệch ảnh, GC ảnh không ghi tuần). Kết quả: 04-10 phủ đủ 3 chi nhánh (39 record cho 04-05). SQL ở scratchpad (backfill_attendance_A/B.sql), idempotent theo (user,date)/reg. **Ràng buộc:** `attendance_records.shift_registration_id` NOT NULL+UNIQUE, `selfie_url` non-empty, và `checkout_evidence_required` (NOT VALID) buộc đủ check_out_* khi có check_out_time → placeholder thoả hết.
- **QA/deploy:** `tsc -b` + `npm run build` pass; `qa-roles`/`qa-app-navigation`/`qa-admin` pass (dev server LAN). Deploy `npx vercel deploy --prod --yes` OK (dpl_Fah3Kp2hRu4LtwoqTsVyX4Z4QTG8), alias https://gustino-operations.vercel.app HTTP 200, bundle `index-z9TKzHqA.js`.

## 36. Vá check-in/check-out treo vô hạn (bug tài khoản Cao Bảo Trân) (2026-07-21)

**Triệu chứng:** nhân viên bấm Check-in → nút quay vòng mãi, **KHÔNG hiện lỗi nào**, không có bản ghi. Đã loại trừ toàn bộ phía server: auth/phiên OK (refresh token đều đặn tới hôm nay), RLS `attendance_records` INSERT/UPDATE + storage policy đều thỏa, không trigger, `/api/reverse-geocode` và `/api/server-time` production trả 200 nhanh, và production ĐÃ có bản vá BUG-093/095.

**Root cause — thiếu timeout ở TOÀN BỘ luồng ghi chấm công (`src/lib/attendance.ts`).** `withAttendanceWriteRetry` chỉ retry khi có **exception**; một promise treo thì không bao giờ ném → không retry, không lỗi, spinner vĩnh viễn. 5 điểm treo:
1. `canvas.toBlob(cb)` trong `stampAttendancePhoto()` — máy thiếu bộ nhớ thì callback KHÔNG BAO GIỜ chạy.
2. `createImageBitmap()`/`image.decode()` trong `decodeImageForCanvas()` (`src/lib/browser.ts`) — không timeout.
3. `supabase.storage...upload()` — supabase-js không đặt timeout.
4. `supabase.from('attendance_records').insert()/.update()` — postgrest-js không đặt timeout.
5. `blobToDataUrl()` (ảnh xem trước) chắn ngang luồng dù chỉ để hiển thị.

**Cơ chế mới:** `withAttendanceDeadline(action, ms, message, retryableStatus?)` + `AttendanceStepTimeoutError`. Hạn chót: vị trí 25s (`ATTENDANCE_LOCATION_DEADLINE_MS`), ảnh 20s, upload 25s, ghi DB 20s. **Quy tắc bất di bất dịch: hết hạn phải NÉM LỖI tiếng Việt cụ thể, KHÔNG được bỏ qua ảnh/GPS/địa chỉ** — mọi ràng buộc bằng chứng (selfie bắt buộc, GPS ≤150m, địa chỉ cụ thể, quyền sở hữu ca) giữ nguyên. Timeout ở upload/ghi DB mang `status = 408` để `isRetryableAttendanceWriteError` nhận ra và retry đúng một lần. Ngoại lệ duy nhất: `blobToDataUrl` chỉ tạo **ảnh xem trước** (không phải bằng chứng) nên hết hạn thì `.catch(() => '')` bỏ preview, không chặn check-in.

Lưu ý khi bọc lệnh Supabase: query builder của supabase-js là **thenable chứ không phải Promise thật**, phải viết `async () => await supabase!...` (không phải `() => supabase!...`) nếu không `tsc` báo TS2739/TS2339.

**Phụ:** `locationPermissionHelpText()` — trước đây MỌI thiết bị bị từ chối quyền GPS đều nhận hướng dẫn riêng của **Safari/iPhone**; máy Android đọc xong không biết làm gì. Nay tách hướng dẫn theo iPhone / Android / desktop dựa trên `navigator.userAgent`.

**QA:** sửa 2 assertion lỗi thời trong `scripts/qa-attendance.mjs` (không liên quan bug): sidebar ở khổ 390px nằm ngoài viewport nên click nút "Chấm công" luôn timeout → điều hướng bằng hash `#attendance` (dạng hash là `#page`, KHÔNG phải `#/page`); và sau check-out ca chuyển sang `renderCompletedRow` class `.completed-shift-row` với chữ "Ra" **không có dấu hai chấm**, không còn là `.shift-card` + `/Ra:/`.

**Trạng thái:** `tsc -b` + `npm run build` pass; `ATTENDANCE_QA_OK`, `ROLE_ACCESS_QA_OK`, `APP_NAVIGATION_QA_OK`, `HANDOVER_QA_OK`, `SHARED_SCHEDULE_ACCOUNTS_QA_OK`. `qa-admin`/`qa-mobile-shift-setup` HỎNG SẴN do đợt sửa dashboard đang dở chưa commit (mọi symbol phiên này thêm/sửa đều private trong `attendance.ts`, dashboard/POS không dùng). **CHƯA DEPLOY** — cây làm việc còn nhiều thay đổi dở dang, deploy nguyên trạng sẽ đẩy cả trang dashboard đang hỏng lên production. Chi tiết ở `docs/testing/BUG_TRACKER.md` mục BUG-106.

**Môi trường:** ổ C: đầy (~0.2GB) → `npx` và `esbuild` chết với ENOSPC. Chạy được nhờ: `npm_config_cache=/d/gustino/.npm-cache npx --yes supabase@2.109.1 db query --linked --file <f.sql>` (SQL nhiều dòng PHẢI qua `--file`) và `TMPDIR=/d/gustino-tmp npm run build`.

## 37. Máy Samsung không chấm công được + đồng bộ sidebar quyền quản lý (2026-07-21, đợt 2)

**Nguyên nhân BUG-107 (có bằng chứng, không phải suy đoán):** `auth.sessions.user_agent` của tài khoản Cao Bảo Trân cho thấy chiếc "điện thoại Samsung" là **SM-A235F (Galaxy A23) chạy trong Android WebView** (`Build/UP1A…` + `Version/4.0` — Chrome thật không còn 2 token này), tức app được mở bằng **trình duyệt nhúng trong app khác (Zalo)**, không phải Chrome. Trong WebView, quyền định vị do **app chủ** cấp (`onGeolocationPermissionsShowPrompt` + quyền OS của chính app đó); app chủ không cài thì `getCurrentPosition()` **không gọi callback nào** → trước §36 là quay vô tận, sau §36 là báo hết hạn 25s. Cùng tài khoản mở bằng Chrome/Safari thì chạy bình thường → đúng mô tả "đổi điện thoại thì chấm được". **Web không sửa được từ bên trong WebView, chỉ phát hiện + hướng dẫn thoát ra.** Cộng hưởng: A23 có camera 50MP, `decodeImageForCanvas` cũ giải mã full-res (~200MB RAM) mới thu nhỏ → máy 4GB treo/bị OS giết ở `createImageBitmap`/`canvas.toBlob`.

- **`src/lib/deviceReadiness.ts` (MỚI):** `detectDeviceEnvironment()` (WebView Android/iOS, tên app chủ, dòng máy, HTTPS), `readGeolocationPermission()` (Permissions API), `deviceReadinessIssues()`, `openInSystemBrowser()` (`intent://…package=com.android.chrome`), `copyAttendanceLink()` (có nhánh `execCommand` cho WebView cũ).
- **`src/components/AttendanceDeviceCheck.tsx` (MỚI):** đặt đầu tab "Hôm nay" của màn chấm công. Máy vướng → cảnh báo lớn nêu đúng nguyên nhân + nút "Mở bằng trình duyệt điện thoại"/"Sao chép link app"; máy ổn → dải trạng thái gọn 1 dòng, bấm mới xổ, có nút "Kiểm tra vị trí ngay" gọi `probeAttendanceLocation()` (export mới ở `attendance.ts`, chạy ĐÚNG code luồng chấm công thật).
- **`src/lib/attendance.ts`:** `locationPermissionHelpText()` + thông báo hết hạn định vị nay nhận biết WebView (nói "bạn đang mở trong <app>" thay vì bảo bật GPS vốn đã bật); ảnh giải mã theo `ATTENDANCE_PHOTO_DECODE_MAX_EDGE = 2560` (ảnh đóng dấu vẫn xuất 1280px, KHÔNG đổi chất lượng).
- **`src/lib/browser.ts`:** `decodeImageForCanvas(blob, { maxSize })` đọc kích thước từ header (JPEG SOF / PNG IHDR) rồi ép `createImageBitmap` giải mã THẲNG về cỡ đích (`resizeWidth/Height`), không bao giờ dựng khung hình gốc; nhận diện HEIC/HEIF theo `ftyp` brand → báo "tắt Ảnh hiệu suất cao trong Camera" thay vì lỗi chung chung. `imageFileToDataUrl` dùng chung `maxSize: 1280`.
- **CSS `.devchk-*`** ở cuối `src/styles.css` — mobile-first, `overflow-wrap: anywhere`, nút `flex: 1 1 200px`; không tràn ngang ở 390px.
- **Sidebar quyền quản lý:** đã GỠ khối `.legacy-manager-workspace .app-sidebar/.sidebar-*` (nền navy tối riêng cho role `manager`) — thanh công cụ của manager trước đây khác hẳn hệ thống (chữ mờ, mất mascot). Nay manager/admin/ca trưởng dùng chung sidebar sáng. **ĐỪNG thêm lại theme sidebar riêng theo role.** Vẫn giữ `.legacy-manager-workspace` cho nền vùng nội dung + ẩn `crm-desktop-header`. Manager ít mục hơn admin là ĐÚNG nghiệp vụ (§ manager không xem lương/bảng công), không phải lỗi.
- **QA mới `scripts/qa-device-readiness.mjs`** (marker `DEVICE_READINESS_QA_OK`): mô phỏng đúng UA Samsung SM-A235F/WebView lấy từ DB — Chrome không bị chặn; WebView bị chặn + đủ nút; WebView có tên app thì gọi đúng tên; quyền bị chặn thì hướng dẫn bật lại; cả 4 ca đều assert không tràn ngang. Ảnh ở `artifacts/device-readiness/`.
- **Backlog nghiệp vụ (chủ quán chọn để sau):** check-in KHÔNG kiểm tra khoảng cách tới chi nhánh (chỉ sai số GPS ≤150m) nên chấm công được từ bất kỳ đâu — bằng chứng bản ghi 21/07 14:56 ghi địa chỉ TP.HCM cho chi nhánh Nha Trang (chủ quán xác nhận là thao tác thử của chính mình). Muốn chặn phải thêm toạ độ chi nhánh (`constants.ts` hiện KHÔNG có toạ độ nào) + ngưỡng khoảng cách.

## 38. Excel kho: bỏ dấu chấm thừa sau số nguyên (2026-07-21, đợt 3)

`AdminPage.tsx` từng dùng `INVENTORY_EXCEL_QUANTITY_FORMAT = '0.####'` cho mọi cột số lượng. Excel **in nguyên văn dấu chấm thập phân** trong mã định dạng, `#` sau nó không in gì khi số nguyên → bảng xuất ra đầy `0.`, `148.`, `270.` (BUG-108). Đã đổi sang `'General'` + **làm tròn 4 số lẻ khi ghi ô** (tránh đuôi dấu phẩy động và ký hiệu khoa học), gom vào helper `applyInventoryQuantityFormat(sheet, keys)` dùng cho cả 7 sheet xuất kho/đặt hàng. Cột tiền giữ `'0'`.

**QUY TẮC:** đừng dùng mã định dạng có dạng `0.##…` cho cột có thể là số nguyên — chọn `General` (số lẻ thay đổi) hoặc số chữ số cố định như `#,##0.00`. QA `scripts/qa-inventory-export.mjs` (`INVENTORY_EXPORT_QA_OK`) tải file .xlsx thật và chặn mọi mã định dạng kết thúc bằng `.#*`; đã kiểm tra ngược là test bắt được lỗi cũ.
