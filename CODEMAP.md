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

`Role = 'admin' | 'manager' | 'supmt' | 'shift_leader' | 'staff' | 'cashier' | 'kitchen'` (`src/types.ts`)

- `supmt` (Giám sát SUP MT, thêm 2026-08-04, §47): CHỈ XEM để đối chiếu lương/bảng công toàn hệ thống + trả lời phản hồi lương. Không thao tác nghiệp vụ, không sửa lương (chỉ admin sửa). `canReviewPayroll = admin | supmt` (`access.ts`).
- `cashier` (Thu ngân POS): chỉ bán hàng tại chi nhánh được gán.

`src/lib/access.ts` — các hàm kiểm tra quyền:
- `canUseAdmin` → chỉ `admin`
- `canUseSales` → `admin | manager | shift_leader | staff` (ca trưởng cũng dùng POS)
- `canUseOperations` → `shift_leader` (chỉ ca trưởng/phó vận hành ca)
- `canUseManagement` → `admin | manager`
- `canUseKitchen` → `admin | manager | kitchen`
- `normalizeRole` → **hiện là no-op** (return chính nó). Trước đây map admin→manager, đã gỡ. ĐỪNG xóa hàm, nhiều nơi gọi.

**Lưu ý nghiệp vụ:** "Ca phó" KHÔNG phải role riêng — dùng chung role `shift_leader` với ca trưởng. Phân biệt qua `positionTitle` (`isDeputyShiftLeader` trong `operationalShiftAssignment.ts`; chức danh RỖNG = ca trưởng).

**Chủ ca luôn là CA TRƯỞNG** (sửa 2026-07-28): ca phó vẫn chấm công, nhập kho, chế biến, bán hàng trong ca nhưng KHÔNG đứng tên `bag_shift_sessions.leader_id`.
- Ca phó không bao giờ TỰ mở ca khi có ca trưởng được xếp đúng phiên ca đó (`blockedAsDeputy` trong `shiftAutoOpen.ts`).
- Ca trưởng vắng → ca phó bấm tay "Mở ca thay ca trưởng" ở màn Bàn giao, ghi `[CA PHÓ ĐỨNG THAY]` vào `discrepancy_note`.
- Ca trưởng vào app → `reclaimShiftForPrimaryLeader` chuyển quyền chủ ca về đúng người (`transferBagShiftLeadership`), chỉ giành lại từ ca phó, KHÔNG bao giờ chiếm ca của ca trưởng khác.
- Trước bản vá: ai check-in trước thì thành chủ ca → 28/07 Gold Coast ca phó bấm sớm hơn 67 giây, cả Ca 1 mang tên ca phó, KPI ca tính theo chỉ tiêu ca phó. Test: `scripts/test-shift-owner-must-be-leader.mjs`.

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
| `management` | `pages/AdminPage.tsx` (`ManagementPage`) | manager/admin | Trang quản trị đa-section (xem mục 4). Section `commission` = **Thi đua nhân viên**, đã gộp về một bảng duy nhất ở §53 |
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
| `shiftAutoOpen.ts` | **Bộ dò ca — nguồn sự thật duy nhất cho việc MỞ ca vận hành.** `reconcileOperationalShift` (chạy trong `App.tsx` mỗi 60s cho mọi `shift_leader`, ở BẤT KỲ trang nào — idempotent, thoát sớm khi ca đã mở/đủ 2 ca/ngày đã chốt), `openShiftAfterLeaderCheckIn` (đường check-in), `findOwnOpenShift`, `markShiftLeftWithoutHandover`. **Tồn đầu ca luôn đọc lại bằng `fetchMovements`** — đừng tin `movements` của trang gọi (trang Bán hàng không tải movement → sẽ ghi tồn đầu ca = 0). Xem BUG-112. |
| `inventoryEntry.ts` | **Số học màn nhập/xuất/sửa tồn kho** (hàm thuần, không React). Hiển thị đủ 3 chữ số như DB (`formatQuantity`/`formatStockAmount`), `STOCK_EPSILON=0.0005`, đổi kg↔g + quy cách bao (`convertEntryToStockQuantity`), `planOutbound` (tự khớp về đúng tồn khi lệch ≤5 g ⇒ xuất hết là sạch kho), `planStockReset` (sửa tồn bằng movement `count`). Xem §5 + BUG-133 |
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
- Dòng có `created_at` **trùng đúng** mốc count được tính là TRƯỚC mốc (`<=`). Trùng dấu thời gian là chuyện thường: một lệnh INSERT nhiều dòng thì Postgres gán `now()` giống hệt nhau. Bản cũ dùng `<` và `>` nên dòng trùng mốc biến mất khỏi bảng tồn (BUG-135).
- **`count` không thuộc cột Nhập lẫn cột Xuất** ⇒ mọi bảng cộng-trừ theo loại phiếu phải có thêm cột "Điều chỉnh", lấy từ `stockAdjustmentDeltas`/`sumStockAdjustments` (`store.ts`) = số khai − tồn cộng dồn ngay trước phiếu. Truyền TOÀN BỘ lịch sử của MỘT chi nhánh vào hàm này rồi mới lọc theo kỳ bằng `shiftDate`. Bất biến: `Tồn đầu + Nhập − Xuất − Hao + Điều chỉnh = Tồn cuối`. Đã áp ở sổ kho theo kỳ + đối soát ca (`AdminPage`, cả Excel) và báo cáo ngày (`ReportPage`). Test: `scripts/test-stock-adjustment-consistency.mjs`.
- **Phiếu `count` KHÔNG được đóng dấu `created_at` từ máy khách** — mốc reset đặt sai vị trí thời gian là tồn tính sai. Để trống cho `default now()` / `coalesce(x.created_at, now())` của RPC (BUG-135).
- `waste` có `sourceProductId` = hao hụt chế biến (thông tin, KHÔNG trừ tồn 2 lần — `informationalProcessingLoss`).
- Ghi nhiều movement qua RPC `create_stock_movements_checked` (kiểm tra đủ tồn). Lỗi "Không đủ tồn" (P0001) với sale/waste/count/adjustment thì bypass insert thẳng.

### Độ chính xác số lượng + màn nhập liệu kho (thiết kế lại 2026-08-05, BUG-133)
- `quantity` là `numeric(14,3)` ⇒ tồn có tới **3 chữ số lẻ**. Lớp hiển thị kho phải dùng `formatQuantity`/`formatStockAmount` (`lib/inventoryEntry.ts`), **đừng làm tròn 2 số**: bản cũ `toFixed(2)` biến 5.123 kg thành "5.12 kg", ca trưởng xuất theo số nhìn thấy nên kho luôn dư ~3 g và phải xuất đi xuất lại.
- **MỌI màn hiển thị số lượng kho dùng chung bộ hàm này, không tự `toFixed`** (BUG-134): `formatQuantity` viết kiểu Việt `5,123` / `1.234,5`; `formatStockAmount` thêm đơn vị + dưới 1 kg đọc theo gram. Riêng số ĐỔ VÀO Ô NHẬP (*Xuất hết*, *Đúng tồn*) phải dùng `quantityInputValue` — bản hiển thị quay lại `sanitizeQuantityInput` sẽ thành số khác (`1.234,5` → `1,2345`). Đã áp ở InventoryPage, AdminPage (kể cả cột Excel), ReportPage, ShiftHandoverPage, ControlCenterPage, admin/DashboardPage, RestaurantPage. Test: `scripts/test-inventory-display-consistency.mjs`.
- Mốc "coi như hết" dùng chung: `STOCK_EPSILON = 0.0005` (nửa đơn vị cuối của DB).
- `InventoryPage` không còn "phiếu nhiều dòng + dropdown". Cả 3 việc dùng chung `StockEntryBoard`: **Nhập hàng** (`inbound`), **Xuất kho** (`sale_out`, có nút *Hết* lấy đúng tồn thật), **Sửa tồn** (tab ② trong Xuất kho — ghi `count` để đặt lại tồn, note gắn `[SỬA TỒN]`). Bảng có tìm kiếm không dấu + lọc nhóm hàng.
- Bảng là **dạng dòng dày, KHÔNG phải card**: 1 SKU = 1 dòng ~54px (desktop) / ~101px (mobile), có hàng tiêu đề cột `.stock-entry-head`, ghi chú dòng ẩn sau nút ✎. Đầu màn (`.inventory-crm-*`) cũng đã ép chiều cao — đừng phình lại thành thẻ cao, ca trưởng thao tác trên 30+ SKU mỗi ca.
- Xuất kho tự khớp về đúng tồn khi số gõ lệch ≤ 0,005 (`OUTBOUND_SNAP_TOLERANCE`) ⇒ không sinh số dư lẻ và không hỏi "không đủ tồn" vì gõ thừa vài gram; lệch lớn hơn vẫn cảnh báo như cũ.
- Test: `scripts/test-inventory-entry-redesign.mjs`.
- **KHÔNG dùng `window.confirm` trần cho thao tác ghi/xoá kho** (BUG-137 — thủ phạm thật của "kho không đồng bộ"). Trong Android WebView, `confirm()` chỉ chạy khi app chủ tự cài `WebChromeClient.onJsConfirm()`; Zalo/Facebook không cài nên nó **trả `false` ngay lập tức, không hiện hộp thoại nào** — đúng cùng cơ chế đã giết `getCurrentPosition()` ở BUG-107, trên đúng nhóm máy đó (`auth.sessions.user_agent`: SM-A235F chạy WebView trong Zalo). Với `if (!window.confirm(...)) return`, màn Kho thoát ra **không ghi, không gọi mạng, không báo gì** → ca trưởng tưởng đã lưu, máy khác vẫn hiện số cũ. Khớp với bằng chứng: phiếu `[SỬA TỒN]` bằng 0 ở **cả** Supabase lẫn kho LAN, tức hỏng TRƯỚC khi gọi mạng. Nay dùng `confirmRisky()` + `confirmBlockedMessage()` (`lib/deviceReadiness.ts`) — phân biệt "người bấm Hủy" với "máy nuốt hộp thoại" và **luôn** hiện thông báo. Test: `scripts/test-inventory-confirm-in-webview.mjs`.
- **Drift DB↔repo:** RPC `create_stock_movements_checked` trên prod đang là **SECURITY INVOKER** (thân hàm có `pg_advisory_xact_lock` = bản `20260624`/`schema.sql`), trong khi `20260701_inventory_dashboard_handover_repair.sql` khai `security definer` và **thân hàm của migration đó chưa từng được áp** (các policy của nó thì đã áp). Invoker nghĩa là INSERT trong RPC vẫn chịu RLS — an toàn hơn, và ca trưởng ghi đúng chi nhánh mình vẫn qua. **Đừng đổi sang definer nếu chưa cân nhắc**: sẽ bỏ luôn kiểm tra vai trò/chi nhánh ở tầng DB.

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

## 8. Realtime & hiệu năng đồng bộ (sửa 2026-07-28)
- Sales đồng bộ qua Supabase channel `sales-v2`.
- Lịch/chấm công có realtime (`20260622_realtime_schedule_geotag.sql`).
- **Sổ kho — đồng bộ theo gia số:** `App.tsx` giữ `movementSyncRef` (dòng mới nhất + tổng số dòng). Nhịp 15s gọi `fetchMovementsDelta` (chỉ `created_at >` mốc, kèm `count exact`); lệch tổng ⇒ có xoá/sửa quá khứ ⇒ `fetchMovements` đầy đủ. Cứ 10 nhịp (~2,5 phút) tải đầy đủ một lần; **không chạy khi `document.hidden`**. Realtime `DELETE` ⇒ tải đầy đủ, `INSERT/UPDATE` ⇒ gia số.
  - Trước đó: tải TOÀN BỘ lịch sử kho mỗi 15s (500 dòng/trang → 4 lượt gọi, ~1.700 dòng/chi nhánh và tăng ~90 dòng/ngày) ⇒ app càng dùng càng ì.
- **Realtime `stock_movements` KHÔNG được đặt `filter: branch_id=eq...`** (sửa 2026-08-06, BUG-136). Supabase so khớp `filter` với chính dòng vừa đổi; với DELETE dòng cũ chỉ còn cột thuộc REPLICA IDENTITY, mà bảng này để mặc định (`relreplident = 'd'` — đã kiểm trên DB prod) nên payload chỉ có `id`. Filter theo `branch_id` không bao giờ khớp ⇒ **event xoá bị bỏ rơi, máy khác không biết phiếu đã bị xoá**. Nay nghe không filter rồi tự lọc phía client: INSERT/UPDATE so `payload.new.branch_id`, DELETE thì tải đầy đủ (không biết chi nhánh, nhưng xoá phiếu là việc hiếm). Gộp burst bằng `burstGuard` 600ms. ManagerDashboardPage/AdminPage vốn đã nghe không filter nên không dính lỗi này.
- **Ghi/xoá kho phải đọc số dòng máy chủ trả về** (BUG-136). PostgREST trả `error = null` cho lệnh khớp 0 dòng (RLS lọc sạch, hoặc `branchId` không phải chi nhánh của phiếu) ⇒ lớp cũ báo "Đã xóa…/Đã lưu…" trong khi DB không đổi: máy vừa thao tác hiện số mới (tự tính lại tại chỗ), mọi máy khác vẫn hiện số cũ — đúng triệu chứng "kho không đồng bộ". Nay `deleteMovements` + `insertStockRowsDirect` dùng `.select('id')` và đối chiếu số dòng; đường RPC `create_stock_movements_checked` (trả `void`) được `assertMovementsPersisted` đếm lại sau khi ghi. Test: `scripts/test-stock-write-and-delete-sync.mjs`.
- Nhịp gia số lỗi (mạng rớt/timeout) không còn nuốt im lặng: `fetchMovementsDelta` lỗi ⇒ quay về `fetchMovements` đầy đủ thay vì đứng ở số cũ.
- **`calculateStock` gom theo `productId` một lần** (Map) thay vì `.filter()+.sort()` toàn mảng cho từng SKU: ~1,5ms → ~0,16ms với 1.700 movement × 60 SKU. Kết quả tồn/lệch giữ nguyên — khoá bằng `scripts/test-stock-and-sync-performance.mjs` (đối chiếu thuật toán cũ).
- **`burstGuard` (`lib/browser.ts`)** gộp burst realtime. Bảng `sales_receipt_items` KHÔNG có `branch_id` nên không lọc được ⇒ mọi chi nhánh đều nhận event; một hoá đơn = 1 + n event. Đã áp ở SalesPage, ShiftHandoverPage, TodayPage (600ms) và ManagerDashboardPage (1.5s, nghe 7 bảng toàn hệ thống).
- Nhịp nền của TodayPage (8s) chỉ chạy khi tab đang hiện.

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
## 39. Ca sáng không gửi báo cáo Zalo khi ca trưởng làm xuyên ca (BUG-109) (2026-07-21, đợt 4)

**Hiện tượng:** ca trưởng Lotte Vũng Tàu (`lotte-vt`) kết ca sáng nhưng nhóm Zalo không nhận báo cáo Ca 1; các chi nhánh khác vẫn gửi bình thường. Báo cáo Ca 2 + Tổng ngày của chính chi nhánh đó vẫn gửi được.

**Không phải lỗi Zalo/n8n.** Kiểm tra `report_snapshots` prod: ngày 21/07 `lotte-vt` **không hề có bản ghi `shiftReports` cho Ca 1** (gold-coast và lotte-2310 có, đã `queued=true`). Báo cáo chưa từng được tạo thì không có gì để gửi.

**Chuỗi nhân quả:**
1. Lịch của ca trưởng hôm đó là **một đăng ký 07:15–22:15 với `shift_id = NULL`** (xuyên ca, không gắn khung "Ca 1"/"Ca 2"). Đối chiếu cả tuần: chỉ 3 đăng ký kiểu này tồn tại, và 2 ngày `lotte-vt` dính đúng là 2 ngày mất báo cáo Ca sáng (17/07, 21/07). Danh mục `shifts` của 3 chi nhánh **giống hệt nhau** — khác biệt nằm ở dữ liệu xếp lịch, không phải cấu hình chi nhánh.
2. `scheduledOperationalSequences()` (`src/lib/operationalShiftAssignment.ts`) khi `shiftId` rỗng thì so khớp theo khung giờ; 07:15–22:15 **phủ cả Ca 1 (07:15–15:15) lẫn Ca 2 (14:15–22:15)** → trả `[1, 2]`.
3. Vì vậy effect tự nhận ca ở `ShiftHandoverPage` **mở Ca 2 ngay khi Ca 1 vừa đóng** (sổ ca prod: Ca 1 đóng 14:48:16, Ca 2 mở 14:48:17, cùng một người).
4. `ReportPage` lấy ca cần chốt bằng `latestOwnedBagShiftSession()` — **sắp xếp theo `sequence` giảm dần** → trả về Ca 2 vừa mở, không phải Ca 1 vừa đóng.
5. Yêu cầu chốt báo cáo do màn Bàn giao đẩy sang (shiftId = Ca 1) lệch với ca đó → bị `clearHandoverReportRequest()` **hủy im lặng**. Không lưu snapshot, không gọi `/api/n8n-report-image`, không báo lỗi cho ca trưởng.

**Đã sửa:**
- Tách yêu cầu chốt báo cáo sau bàn giao ra `src/lib/handoverReportRequest.ts` (trước đây key `gustino:handover-report` bị viết/đọc rải rác ở hai màn).
- `ReportPage.resolveLeaderShiftSession()`: **ưu tiên đúng ca ghi trong yêu cầu bàn giao** (có kiểm tra ngày + quyền sở hữu qua `ownsBagShiftSession`), chỉ fallback `latestOwnedBagShiftSession()` khi không có yêu cầu. Dùng cho cả `leaderShiftSession` (UI) lẫn `freshLeaderShiftSession` trong `saveCloud()`.
- `ShiftHandoverPage.handleCloseShift()` ghi yêu cầu **ngay sau khi đóng ca, TRƯỚC `refresh()`** — vì chính `refresh()` kích hoạt effect tự mở ca kế tiếp.
- Trường hợp thật sự không khớp thì báo ra màn hình thay vì hủy im lặng (yêu cầu sót từ ngày cũ vẫn bỏ qua im lặng).

**QUY TẮC:** ca cần chốt báo cáo là ca **VỪA bàn giao**, không phải "ca có sequence lớn nhất mà mình sở hữu" — một ca trưởng có thể sở hữu cả hai ca trong ngày. QA `scripts/qa-handover-cross-shift.mjs` (`CROSS_SHIFT_HANDOVER_QA_OK`) dựng đúng kịch bản này: đăng ký xuyên ca không gắn `shiftId`, làm chậm lượt đọc sổ ca để Ca 2 kịp mở trước khi màn Báo cáo đọc, rồi khẳng định báo cáo Ca 1 vẫn được chốt. **Đã kiểm tra ngược: test đỏ trên code trước khi sửa.**

**Đã ghi nhận nhưng CHƯA sửa:** 18/07 và 19/07 `lotte-vt` thiếu báo cáo **Ca 2** — `operation_days` hai hôm đó bị cron `api/auto-close-day.ts` đóng lúc 00:10–00:13 hôm sau chứ không phải ca trưởng chốt; ngày đã `closed` thì `saveCloud()` thoát sớm ("Ngày đã kết thúc"). Cần xử lý riêng.

## 40. Tiêu đề section bị chữ dọc trên điện thoại (2026-07-21, đợt 5)

**Hiện tượng:** màn "KPI doanh thu" (`#manager-business`, ManagementPage section `commission`) trên điện thoại hiển thị tiêu đề "Tổng kết bán hàng theo nhân viên" **mỗi dòng một ký tự** chạy dọc suốt màn hình.

**Nguyên nhân:** trong `@media (max-width: 760px)` của `src/styles.css`, `.section-title` được ép `display: grid; grid-template-columns: 1fr auto`. Cột `auto` lấy trọn **max-content** của `.section-actions` — ở section này là chip "N người đạt KPI" + 2 nút rộng "Xuất Excel bằng chứng" / "Xuất ảnh thi đua" (≈380px). Không còn chỗ, cột `1fr` (min = min-content) tụt về bề rộng **1 ký tự**; cộng thêm rule chống tràn `.page strong/b/small/p { overflow-wrap: anywhere }` (mục "Owner UX overflow hardening") thì chữ bẻ theo từng ký tự → chạy dọc. Các section khác không lộ vì cụm bên phải chỉ có một chip nhỏ.

**Đã sửa:** đổi `.section-title` mobile sang **flex-wrap**: cột tiêu đề `flex: 1 1 120px; min-width: 0`, `.section-actions` `flex: 0 1 auto; max-width: 100%; justify-content: flex-start`. Cụm nút nào không đủ chỗ thì rơi xuống hàng dưới (canh trái thẳng tiêu đề); chip nhỏ vẫn nằm cùng hàng như trước — đã đối chiếu ảnh chụp trước/sau ở `#management`, `#manager-revenue`, `#manager-inventory`, `#manager-payroll`, `#manager-business` tại 320/360/390px, không trang nào tràn ngang.

**QUY TẮC:** trên mobile **đừng dùng `grid-template-columns: 1fr auto`** cho hàng "tiêu đề + cụm nút" khi cụm nút có thể rộng — cột `auto` không bao giờ nhường, cột `1fr` sẽ bị bóp về min-content. Dùng `flex-wrap` + `flex-basis` tối thiểu cho phần chữ. QA `scripts/test-section-title-mobile-wrap.mjs` (`SECTION_TITLE_MOBILE_WRAP_OK`) chặn việc quay lại grid cột cố định.

## 41. Bán hàng POS trừ kho theo công thức món (BUG-115) (2026-07-24)

**Trước bản này POS KHÔNG trừ kho.** Control Center bắt admin gán công thức cho từng món ("Bắt buộc chọn nguyên vật liệu … để hệ thống trừ tồn kho khi bán") nhưng `recipe` chỉ được dùng cho dropdown chia mẻ (`getPackingOptionsByOutput`) — không có một dòng code nào biến hóa đơn thành phiếu kho. Hệ quả: giữa ca, tồn thành phẩm trên màn hình luôn cao hơn thực tế; số chỉ đúng lại khi ca trưởng kiểm đếm cuối ca (phiếu `count` là mốc reset).

**Luồng mới:** `create_cashier_pos_receipt` (RPC bán hàng) gọi `post_pos_receipt_stock(receipt_id)` **trong cùng transaction** với hóa đơn → bung `products.recipe` của từng dòng hóa đơn (cả 3 role `source`/`ingredient`/`packaging` đều là "trừ"), nhân số lượng bán, gom theo SKU, ghi một dòng `sale_out` mỗi SKU với `document_id = id hóa đơn`. `delete_pos_receipt` gỡ đúng nhóm đó nên xóa hóa đơn là hoàn kho.

**Ba quy tắc bắt buộc nhớ:**
1. **Kho không được chặn bán.** Không kiểm tra đủ tồn, không raise exception. Tồn âm là tín hiệu thiếu phiếu nhập/mẻ chế biến, không phải lý do chặn quầy. Món **chưa gán công thức vẫn bán bình thường**, chỉ là không trừ được gì — Control Center hiện khối cảnh báo `menu-norecipe-alert` + badge "Trừ kho khi bán" trên từng món để admin bổ sung.
2. **Doanh thu KHÔNG được đọc lại nhóm phiếu này.** Phiếu do POS sinh có ghi chú mở đầu `POS_STOCK_NOTE_PREFIX = '[POS '`; `liveMovementRows()` trong `src/lib/revenue.ts` lọc bỏ chúng bằng `isPosGeneratedSaleMovement()`. Không lọc thì `RestaurantPage` (gọi `buildDailyRevenueRows` **không truyền receipts**) sẽ cộng kg nguyên liệu vào "số lượng bán".
3. **LAN không có danh mục sản phẩm** nên không tự suy ra công thức: client gửi kèm `stockMovements` (dựng bằng `buildPosStockMovements` → `posStockDeductionByProduct`) trong body `POST /api/sales-receipts`, và `DELETE` gỡ theo `documentId`. Hai đường phải cho ra cùng kết quả.

**Không đụng tới:** `count` cuối ca vẫn là mốc reset nên không có cộng đôi với kiểm đếm; `buildShiftInventoryReconciliation` tính `officialOut = đầu ca + nhập − cuối ca − hao` (không trừ `sale_out`) nên phần đối chiếu POS vẫn đúng như cũ. Phiếu "Xuất bán" ca trưởng tự lập giữ nguyên ý nghĩa.

QA `scripts/test-pos-sale-stock-deduction.mjs` (`POS_SALE_STOCK_DEDUCTION_OK`) khoá cả logic bung công thức, nội dung migration và hai đường LAN/doanh thu. **Đã kiểm tra ngược:** bỏ bộ lọc `isPosGeneratedSaleMovement` là test đỏ đúng chỗ.

## 42. Ca trưởng trước bỏ ca đang mở → cả chi nhánh kẹt (2026-07-24)

Chuỗi BUG-112 đã lo được ca *của chính mình* (bộ dò ca, nút "Nhận ca ngay", "Nhận tiếp Ca N", chặn mềm ở check-out, "Mở lại ca"). Còn đúng một lối kẹt: ca trưởng ca trước **về mà không bấm "Chốt & bàn giao ca"**. Ca vẫn `open` → chi nhánh không mở được ca mới; `ShiftHandoverPage` chỉ hiện một dòng chữ thụ động *"Đang chờ ca trưởng trước bàn giao"* và **không có nút nào** để thoát → treo tới khi cron `/api/auto-close-day` chạy lúc 00:00.

**Điều quan trọng:** máy chủ **chưa bao giờ chặn** — `close_bag_shift_safe` cho phép `leader_id = auth.uid()` **hoặc** `can_manage_branch(branch_id)`, mà `can_manage_branch` đã bao gồm `shift_leader` cùng chi nhánh. Nút bị thiếu ở giao diện, không phải ở quyền.

**Đã mở đúng một lối, không nới quyền:** `coverArmed` → `coveringSession` → `openSession`, tức là chốt thay đi qua **đúng biểu mẫu đếm tồn** của bàn giao. Điều kiện: có ca của người khác đang mở, ngày chưa chốt, và người bấm là manager/admin **hoặc** ca trưởng **đang check-in + có lịch hôm nay**. Phải bấm + xác nhận (không tự động, giữ nguyên BUG-100), **bắt buộc ghi lý do**, và ghi chú chốt ca được đóng dấu `[CHỐT THAY <tên người mở> bởi <tên người chốt>]`.

**QUY TẮC:** mọi trạng thái "đang chờ người khác" trong luồng vận hành phải có lối thoát cho người đang đứng tại quầy — nếu không, một người quên bấm nút là cả chi nhánh dừng. QA: phần 7 của `scripts/test-handover-shift-recovery.mjs`.

## 43. Đóng hành chính ca quên check-out — không được bịa bằng chứng (2026-07-24)

`attendance_records` có ràng buộc `attendance_records_checkout_evidence_required`: hễ có `check_out_time` là **bắt buộc** đủ ảnh + lat/lng + độ chính xác + địa chỉ. Đúng cho check-out thật, nhưng nó khiến **không ai đóng nổi một ca quên check-out**: `admin_update_attendance_record` chỉ ghi giờ nên luôn vi phạm ràng buộc → bản ghi treo vĩnh viễn, bảng công thiếu ngày công, nhân viên mãi thấy thẻ đỏ "Quá hạn check-out".

**Cách chữa KHÔNG PHẢI là bịa toạ độ/ảnh** — làm vậy là tạo bằng chứng có mặt giả trong hồ sơ chấm công. Ràng buộc nay có **nhánh hợp lệ thứ hai**: bản ghi đóng hành chính thì `check_out_selfie_url`/`latitude`/`longitude`/`accuracy` đều **NULL** và `check_out_address` **phải** mở đầu bằng `[CHỐT HÀNH CHÍNH]`. Nhìn báo cáo là biết ngay ca nào không được xác minh vị trí.

`admin_update_attendance_record` tự chọn nhánh: bản ghi chưa từng có ảnh/GPS lúc ra → đóng hành chính và ghi lý do vào địa chỉ; bản ghi đã có bằng chứng thật → giữ nguyên bằng chứng, chỉ sửa giờ. Nhật ký `control_audit_entries` phân biệt `admin_close_missing_checkout` với `admin_correct_attendance`.

**QUY TẮC:** khi một ràng buộc toàn vẹn chặn mất đường sửa lỗi hợp lệ, hãy mở thêm một trạng thái **tự khai** cho đường đó — đừng nới ràng buộc và cũng đừng nhồi dữ liệu giả cho vừa ràng buộc.

## 44. Chống quên gửi báo cáo Tổng ngày + chống bấm nhầm bàn giao ca tối (2026-07-25)

**Gốc rễ (một chuỗi):** nút "Chốt & bàn giao ca" (`ShiftHandoverPage`) trước đây **một chạm là chốt**, không có bước xác nhận. Việc **tạo + gửi 2 ảnh báo cáo (Ca tối + Tổng ngày)** lại nằm ở `useEffect` tự động trong `ReportPage` — **chỉ chạy khi ca trưởng còn ở lại màn Báo cáo đủ lâu để poster render xong**. Bấm nhầm ca tối → tự chốt ngày + gửi báo cáo dở dang (ca tối 0đ); rời màn sớm → báo cáo Tổng ngày không bao giờ gửi, **không có lời nhắc nào**. `revenue.ts` coi snapshot đã chốt là nguồn chuẩn (BUG-104/111) nên ảnh đã gửi + kho báo cáo giữ số lệch cho tới khi ai đó nhớ chốt lại.

**Đã sửa (chỉ phòng tái phát, không đụng ngữ nghĩa doanh thu):**
- **Yêu cầu chốt báo cáo sống qua lần đóng app:** `src/lib/handoverReportRequest.ts` đổi `sessionStorage → localStorage`, bắn sự kiện `REPORT_PENDING_EVENT` khi ghi/xoá, thêm `pendingHandoverReportForToday(today)` (tự dọn yêu cầu ngày cũ). Cờ này do `ReportPage.saveCloud()` xoá khi chốt xong.
- **Bước xác nhận trước khi bàn giao (kiểu capybara hỏi lại):** `ShiftHandoverPage` thêm state `closeArmed`; nút "Chốt & bàn giao ca" giờ **mở bảng `.handover-close-confirm`** (ảnh capy + cảnh báo). Ca tối cảnh báo rõ "sẽ CHỐT NGÀY và tự gửi Ca tối + Tổng ngày lên Zalo". `closeArmed` reset khi đổi ca. CSS `.handover-close-confirm*` sau `.handover-takeover-confirm` trong `styles.css` (thẻ sáng → nền vàng nhạt).
- **Nhắc "báo cáo chưa gửi" ở MỌI trang:** `AppShell` thêm popup `report-pending-popup` (tái dùng `.sunday-shift-popup` + ảnh capy) cho **shift_leader**, ẩn khi đang ở `report`, đọc cờ localStorage (không fetch), cập nhật theo `REPORT_PENDING_EVENT`/focus/đổi trang. Ưu tiên cao hơn popup nhắc đăng ký ca Chủ nhật.
- **Mở lại ngày bật lại lời nhắc:** `ReportPage.reopenDay()` ghi lại `writeHandoverReportRequest(<ca đóng gần nhất của mình>)` — nhắc lại + để lần mở màn Báo cáo sau tự gửi bản ĐÃ SỬA, nhưng **không tự gửi ngay** ở lần render này (số có thể chưa sửa xong). Guard `automaticFinalizeAttemptRef` giữ nguyên nên không gửi trùng trong cùng một mount.
- **Định vị chấm công:** giữ nguyên (chủ quán chọn "chỉ báo trạng thái") — địa chỉ đã tới số nhà (`api/reverse-geocode.ts`, ưu tiên Nominatim), GPS ≤150m/25s, **CHƯA có kiểm tra khoảng cách tới chi nhánh** (chấm được từ mọi nơi). Máy Samsung (SM-A235F) lỗi vì mở trong WebView Zalo — `AttendanceDeviceCheck` đã phát hiện + hướng dẫn "mở bằng Chrome" (live từ 21/07, xem §37); cách chấm được là mở bằng Chrome/Safari.

**Dữ liệu đã lệch trên prod:** chẩn đoán chỉ-đọc `scripts/db_diag_report_revenue_mismatch_20260725.sql`; sửa 1 ngày bằng `scripts/db_repair_stale_daily_report_20260725.sql` (gỡ snapshot lệch + mở lại ngày để app chốt/gửi lại — KHÔNG viết tay số).

**QA:** `scripts/test-handover-report-reminder.mjs` (`HANDOVER_REPORT_REMINDER_OK`); `tsc -b` + `npm run build` pass (`PRODUCTION_SUPABASE_BUNDLE_OK`, bundle `index-DzhP_sQ-.js`). **ĐÃ deploy 2026-07-25** (`dpl_CMo51LVBbN8rLqQ7TngTJCcBrVeT`, https://gustino-operations.vercel.app) — kèm cả lô 24/07 (BUG-115 trừ kho POS, mở lại ca, đóng ca quên check-out) vốn còn treo trong cây làm việc.

**Tồn thành phẩm vẫn cao dù đã back-fill (2026-07-25):** KHÔNG phải bug trừ kho. `calculateStock` lấy phiếu `count` (kiểm đếm cuối ca) gần nhất làm MỐC RESET → tồn = kiểm kê gần nhất + phiếu sau đó; back-fill bán ra TRƯỚC lần kiểm kê gần nhất nằm sau mốc reset nên không kéo tồn xuống. Cộng thêm số kiểm kê cũ đã cao (trước BUG-115 ô "Dự kiến" bị thổi vì bán không trừ). Chữa đúng: cho ca trưởng **kiểm kê thật một lần** (Kho → Kiểm kê) để reset; từ đó BUG-115 tự trừ. Chẩn đoán chỉ-đọc: `scripts/db_diag_finished_stock_20260725.sql`. **ĐỪNG back-fill thêm** — vô tác dụng khi vướng mốc kiểm kê.

**QUY TẮC:** thao tác chốt/gửi báo cáo phải **tự chạy hoặc được nhắc dai tới khi xong** — đừng để một bước "tự động nhưng chỉ khi còn ở đúng màn" trở thành bước ngầm ai cũng quên.

## 45. Tổng rà 7 mảng: chấm công / 2 ảnh báo cáo / POS bỏ thu tiền / kiểm kê 0 / realtime (2026-07-27)

> Đợt sửa gốc rễ theo yêu cầu chủ quán. 3 migration ĐÃ APPLY prod qua `db query --linked --file`, verify từng cái. Build + 11 test/QA xanh (kể cả qa-handover trọn vòng đời).

- **Múi giờ neo Việt Nam (gốc của lớp lỗi "lấy nhầm ngày"):** `src/lib/dates.ts` — `localDateKey()` giờ tính qua `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })`, `localDayBoundsIso()`/`formatLocalDate()` neo `+07:00`; `attendance.ts localDateTime()` neo `+07:00` (VN không có DST). Máy đặt sai múi giờ không còn lệch business_date/cửa sổ ca. **QUY TẮC: đừng bao giờ tính date-key nghiệp vụ bằng getFullYear()/getMonth() của thiết bị.**
- **Chấm công — ràng buộc DB "một phiên mở/người":** migration `20260727_attendance_single_open_session.sql` (ĐÃ APPLY): unique partial index `attendance_records_one_open_per_user (user_id) where check_out_time is null` + bước đóng-hành-chính phiên mở TRÙNG (0 dòng bị đụng lúc apply — audit trước đó users_multi_open=0). `attendance.ts` dịch 23505 của index này thành thông báo VN (`isSingleOpenSessionViolation`); LAN server chặn y hệt. `AttendancePage`: guard `findOpenShift()` quét phiên mở MỌI ngày (không chỉ same-day), **bỏ hẳn nút "Vẫn check-in ca này"** (DB chặn cứng rồi); thêm fail-safe `recordsLoaded` — chưa từng tải được bản ghi chấm công thì hiện màn "Chưa tải được dữ liệu…" thay vì suy ra "chưa check-in" từ mảng rỗng (gốc lỗi "đã check-in mà vẫn hiện nút Check-in" sau reload khi fetch lỗi). Test `test-attendance-single-open-session.mjs`.
- **2 ảnh báo cáo (Ca + Tổng ngày) — hết lệch 83/81, hết quên gửi:**
  - `ReportPage`: state `frozenPosterModels` — khi chốt (`saveCloud`) hoặc gửi lại, 2 poster ẩn render từ MỘT bộ dữ liệu đóng băng đúng bằng freshLedger đã ghi snapshot (trước đây poster render từ state live bị realtime/poll cập nhật GIỮA 2 lần chụp). Gửi lại (`resendReportImages`) đóng băng từ CHÍNH snapshot đã chốt.
  - Poster ẩn chưa render → `posterRetryTick` hẹn 400ms thử lại (hết bỏ-qua-im-lặng); `saveCloud` trả `{saved, delivered}` — cờ nhắc localStorage CHỈ tắt khi `delivered`; đã chốt mà thiếu ảnh → effect tự `resendReportImages()` tối đa 2 lần/lần mở màn; nút "Gửi Zalo" = resend `force:true` sau confirm.
  - `n8nReports.ts`: gửi TỪNG ảnh độc lập (ảnh 'day' không còn chết theo ảnh 'shift-2'), retry 2 lần/ảnh, message liệt kê ảnh fail.
  - `api/n8n-report-image.ts`: `export const config = { maxDuration: 60 }` (trước đây Vercel cắt 10-15s khi webhook n8n chờ tới 20s → ảnh thứ 2 nhận 504) + idempotency THẬT: job đã `queued` chỉ gửi lại khi `force=true` (trước đây điều kiện `!sendNow` bị vô hiệu vì client luôn sendNow).
  - `businessDate`/`today` bám đồng hồ (tick 30s) ở ReportPage/SalesPage/ShiftHandoverPage — hết closure ngày cũ qua nửa đêm. Test `test-report-dual-image-consistency.mjs`.
- **POS bỏ nghiệp vụ thu tiền + giá do server quyết:** migration `20260727_pos_no_payment_server_price.sql` (ĐÃ APPLY) thay `create_cashier_pos_receipt`: bỏ validate customer_paid/payment_method (cột giữ nguyên, đơn mới ghi 'cash'/null/0), **unit_price lấy từ `products.price`** (client gửi giá nào cũng bị ghi đè; món thiếu giá bị từ chối kèm hướng dẫn — audit trước: 0 món đã bán 30 ngày thiếu giá, 0 lệch giá), **idempotent theo id** (retry cùng id → trả đơn cũ, không trừ kho lần 2). `SalesPage`: bỏ panel thanh toán/Khách đưa/Tiền thừa, nút = "Xác nhận bán hàng", `pendingReceiptIdRef` giữ id ổn định cho retry (reset khi giỏ đổi/lưu xong). `salesReceipts.ts`: paymentMethod optional (chỉ để đọc dữ liệu cũ), không gửi payment fields, tin `total_amount` server trả về. LAN POST idempotent theo id. AdminPage/kpiEvidenceWorkbook bỏ nhãn thanh toán. Migration `20260727_delete_pos_receipt_audit.sql` (ĐÃ APPLY): xóa hóa đơn ghi snapshot đầy đủ (receipt+items+phiếu kho) vào `control_audit_entries` (module 'pos') trước khi xóa — hoàn kho vẫn đúng 1 lần theo document_id.
- **Kiểm kê nhập 0:** `InventoryPage` form kiểm kê đổi state số → **chuỗi** (`InventoryCountFormLine`): rỗng = "chưa kiểm", "0" = "đã kiểm, hết hàng" (gốc lỗi là `value={line.freezerQty || ''}` nuốt số 0 + filter `> 0` loại dòng 0 khỏi movement `count`). Lưu: movement `count` ghi cho MỌI dòng đã kiểm (kể cả 0 — mốc reset tồn hoạt động đúng), chặn phiếu 0-dòng-kiểm; report lines lưu thêm cờ `counted`. `store.addMovements` guard mảng rỗng + quantity âm/NaN; LAN validate `quantity >= 0` khớp CHECK của DB. Test `test-inventory-count-zero.mjs`.
- **Realtime — reconnect là refetch:** `ReportPage`/`SalesPage`/`ShiftHandoverPage`/`TodayPage` thêm `.subscribe((status) => status === 'SUBSCRIBED' && reload())` (SUBSCRIBED bắn cả khi REJOIN sau rớt mạng) + listener `focus`/`online`/`visibilitychange` (có check `visibilityState === 'visible'`). OrdersPage sửa visibilitychange sang `document` + thêm `online`. **QUY TẮC: mọi màn nghiệp vụ dùng realtime phải có đủ 3 lưới: status-SUBSCRIBED refetch, focus/online/visibility refetch, và (nếu là màn tiền) không được chỉ dựa event.**
- **Verify trừ kho POS trên prod (chỉ đọc):** 7 ngày gần nhất **1074/1074 hóa đơn đều có phiếu `sale_out`** (document_id khớp), 0 món menu thiếu recipe → BUG-115 chạy đúng thật.
- **QA:** `tsc -b` + `npm run build` pass (`PRODUCTION_SUPABASE_BUNDLE_OK`). Test mới: `test-attendance-single-open-session`, `test-inventory-count-zero`, `test-report-dual-image-consistency`. Cập nhật `test-cashier-pos-workspace` (POS không còn ô thu tiền) + `qa-handover.mjs` (bấm qua bước xác nhận §44 — script stale, không phải lỗi app). Pass: 6 test nguồn + ATTENDANCE_QA_OK, HANDOVER_QA_OK (trọn vòng đời 2 ca + chốt ngày), ROLE_ACCESS_QA_OK, APP_NAVIGATION_QA_OK. **CHƯA deploy Vercel** (code FE mới nằm local; DB prod đã nhận 3 migration — RPC mới tương thích client cũ đang chạy: client cũ vẫn gửi payment fields, RPC mới bỏ qua).
- **CÒN LẠI (ghi nhận, chưa làm):** subscription không filter branch ở ManagerDashboard/AdminPage (bão refetch chéo chi nhánh); `useConfiguredBranches` mở 3 channel trùng/trang; poll chồng realtime (TodayPage 8s + 15s App + 30s); cache `products` localStorage không TTL (POS có thể dùng giá cũ khi cloud lỗi — đã giảm rủi ro vì server tự tra giá); snapshot chưa lưu "phiên bản logic tính toán".
- **Bổ sung cùng ngày (theo yêu cầu chủ quán) — TỰ CHỐT ca quên check-out:** cron `api/auto-close-day.ts` (00:00 VN) thêm bước `closeForgottenCheckouts()`: mọi bản ghi mở của ngày < hôm nay được đóng theo **giờ tan ca của lịch** (chốt hành chính `[CHỐT HÀNH CHÍNH] … (auto-close)`, không bịa ảnh/GPS; guard: giờ tan đã qua, > giờ vào, ≤18h, PATCH kèm `check_out_time=is.null` chống đè check-out thật; ca >18h bỏ lại cho admin). `attendance.ts buildAttendanceDetailRows` tự sinh cột **Ghi chú Excel "QUÊN CHECK-OUT — hệ thống tự chốt theo giờ tan ca"** khi địa chỉ check-out mang tiền tố `ADMIN_CLOSE_ADDRESS_PREFIX` — cả 2 file xuất (AdminPage + AttendancePage) đều hưởng. Trong ngày nhân viên vẫn tự "Check-out bù" được (giờ thật, đúng hơn); cron chỉ là lưới cuối. 2 ca treo 26/07 đã được đóng ngay bằng SQL cùng logic (open_before_today = 0). **ĐÃ DEPLOY** `dpl_FSMkduiMgcg7xEWh4zkDK5d3X7cF` (trước đó `dpl_2wbT5MzaDLiGXUDjFTENWyhDCotA` là lô chính) — verify live bundle chứa marker ghi chú Excel + thông báo một-phiên-mở; alias https://gustino-operations.vercel.app HTTP 200.

## 46. BUG-117 + BUG-118: doanh thu từng ca sai số + chấm công mất bằng chứng (2026-08-01)

> Chủ quán báo: "lỗi đồng bộ doanh thu, sai số nặng, chưa từng gặp" + "chấm công vẫn không lưu, vài tiếng sau bị bắt chấm lại". Chẩn đoán DB prod (chỉ đọc) cho thấy tổng NGÀY luôn đúng (14 ngày snapshot khớp POS 100%) — lệch nằm ở **báo cáo TỪNG CA** và ở **bằng chứng chấm công chết giữa chừng**. **Đã sửa local, CHƯA deploy** (theo yêu cầu). Chi tiết bằng chứng: BUG_TRACKER mục BUG-117/118.

- **BUG-117 — phân vùng doanh thu theo ca:** lib mới `src/lib/shiftReportScope.ts`. QUY TẮC: doanh thu từng ca KHÔNG lọc theo cửa sổ giờ phiên ca nữa; ngày được chia bằng MỘT điểm cắt giữa hai ca kề nhau = `min(giờ đóng ca trước, giờ mở ca sau)` — ca đầu nhận từ đầu ngày, ca cuối tới cuối ngày ⇒ Ca 1 + Ca 2 LUÔN = Tổng ngày (Ca 2 mở trễ 2 tiếng cũng không mất đồng nào). Áp tại `ReportPage` (poster + snapshot ca + saveCloud), `shiftCompetition.ts` (doanh thu ca trưởng), `ShiftHandoverPage.receiptsInSession`. **KHÔNG áp vào màn Đối chiếu ca của AdminPage** — ở đó phải giữ cửa sổ vật lý vì số kho neo theo 2 lần kiểm đếm đầu/cuối ca. Test: `scripts/test-shift-report-scope.mjs` (tái hiện đúng số thật 31/07: 681k→803k; đã kiểm tra ngược).
- **BUG-118 — hộp thư đi chấm công:** lib mới `src/lib/attendanceOutbox.ts` (IndexedDB, fallback bộ nhớ; age-cap 7 ngày; đếm nhanh localStorage). `checkIn`/`checkOut` cất bằng chứng (ảnh đóng dấu + GPS + GIỜ THẬT) vào outbox TRƯỚC khi upload/ghi DB; chỉ xóa khi máy chủ xác nhận; `flushAttendanceOutbox()` gửi lại idempotent với `capturedAt` gốc. `App.tsx` flush nền 45s + online/focus ở mọi trang; `AttendancePage` có banner "Chờ gửi lại" + nút Gửi lại ngay + ghi chú ⏳ trên thẻ ca (CSS `.attendance-outbox-*` cuối styles.css). Phía đọc: `fetchAttendanceRecords`/`fetchShiftRegistrations` không bao giờ lọc dòng của CHÍNH user theo active-branch. Test: `scripts/test-attendance-outbox.mjs`.
- **Sửa test stale:** `test-handover-shift-recovery.mjs` cập nhật marker theo `reclaimShiftForPrimaryLeader` (đợt 28/07 đổi code nhưng chưa cập nhật test).
- **QA phiên này:** `tsc -b` + `npm run build` pass (`PRODUCTION_SUPABASE_BUNDLE_OK`); SHIFT_REPORT_SCOPE_OK, ATTENDANCE_OUTBOX_OK, REPORT_DUAL_IMAGE_CONSISTENCY_OK, ATTENDANCE_SINGLE_OPEN_SESSION_OK, ATTENDANCE_LATE_CHECKOUT_OK, DAILY_REPORT_EMPLOYEE_ATTENDANCE_FLOW_OK, HANDOVER_SHIFT_RECOVERY_OK, test-shift-owner-must-be-leader, test-stock-and-sync-performance. KHÔNG ghi/sửa dữ liệu production.
- **Tồn đọng chờ chủ quán quyết:** (a) snapshot ca 28–29/07, 31/07 vẫn giữ số cũ (ảnh Zalo đã gửi, tổng ngày không sai) — muốn kho báo cáo hiện lại đúng từng ca phải tính lại payload, chỉ làm khi được duyệt; (b) hóa đơn xóa SAU khi ảnh ca đã chốt vẫn làm ca đó lệch với ngày (bản chất point-in-time, đã ghi nhận ở BUG-117).

### §46 bổ sung — BUG-119 + DEPLOY (2026-08-01, cùng phiên)
- **BUG-119 (gốc của "29/7 tới 13 triệu mấy, thực tế thấp hơn"):** dashboard cộng LẶP Ca 2. Từ 25/07 snapshot được TẠO lúc chốt Ca 1 (~15:17) rồi bị GHI ĐÈ payload lúc chốt Tổng ngày (~22:16) — bảng `report_snapshots` KHÔNG có `updated_at`, `created_at` đứng nguyên 15:17; lớp bù BUG-104 trong `revenue.ts` cộng "hóa đơn sau snapshot" so với `created_at` → cộng lại toàn bộ Ca 2. Verify DB: 29/07 app hiển thị 13.170.000đ vs POS thật 8.424.000đ (12/12 ngày×chi nhánh 28–31/07 đều lệch đúng bằng Ca 2). **Fix:** `snapshotStatementAt()` trong `revenue.ts` — mốc bù = max(`created_at`, `payload.finalizedAt`, `shiftReports[*].finalizedAt/n8nDelivery.updatedAt`); mọi đường ghi snapshot vốn đã đóng dấu `finalizedAt` nên KHÔNG cần migration, hiển thị tự lành cho mọi ngày cũ. Test `scripts/test-revenue-snapshot-statement-time.mjs` (số thật 29/07, đã kiểm tra ngược). **QUY TẮC: bảng nào bị UPSERT ghi đè payload thì đừng bao giờ dùng `created_at` của dòng làm mốc thời gian của NỘI DUNG.**
- **DEPLOY 2026-08-01:** `npx vercel deploy --prod --yes` → `gustino-operations-qwq0r32ix` READY, alias https://gustino-operations.vercel.app HTTP 200. Lô này gồm BUG-117 (phân vùng doanh thu ca) + BUG-118 (outbox chấm công) + BUG-119 + toàn bộ cây làm việc 28/07. Verify live: `index-Ci89EB3M.js` = đúng hash build local, `revenue-DmIf2ZO5.js` có mốc `finalizedAt`, `AttendancePage-DouwRAT7.js` có banner "CHỜ GỬI LẠI", chunk `shiftReportScope-H3WQYNbh.js` được phục vụ, `/api/server-time` + `/api/reverse-geocode` 200. **Không migration, không ghi dữ liệu** (cả phiên chỉ SELECT chỉ-đọc); rollback tức thì bằng cách trỏ alias về `iust3h2vj` (bản 28/07).

### §46 bổ sung 2 — BUG-120 "lỗi chấm công" chiều 01/08 + deploy lần 2
- **Gốc:** chốt chặn "địa chỉ cụ thể bắt buộc" (`requireConcreteAttendanceAddress`) biến sự cố nhà cung cấp bản đồ thành sự cố chấm công: `/api/reverse-geocode` lỗi (log 16:02:20) + BigDataCloud trượt ⇒ check-in/check-out bị chặn hẳn; outbox BUG-118 không cứu được vì op chỉ tạo SAU khi có vị trí. Nhóm trượt lặp lại đều ở lotte-vt; tài khoản mới Phan Thị Thanh Ngân (lotte-2310) và ca 16:00 Thuỳ Trang dính đúng thời điểm chủ quán báo.
- **Fix:** `resolveAttendanceAddress()` trong `attendance.ts` — địa chỉ cụ thể dùng như cũ; cả hai nguồn dịch cùng hỏng thì ghi **`[CHƯA DỊCH ĐƯỢC ĐỊA CHỈ] GPS <lat>, <lng> (±Xm)`** (export `UNRESOLVED_ADDRESS_PREFIX`) và cho chấm công tiếp. **QUY TẮC: ảnh + toạ độ GPS + sai số là bằng chứng gốc; địa chỉ chỉ là bản dịch — không nguồn dịch nào được phép chặn chấm công.** Test `scripts/test-attendance-address-fallback.mjs`; `test-attendance-native-camera-location.mjs` đổi hợp đồng (cấm chốt chặn cũ quay lại).
- **Deploy:** `gustino-operations-dlur4t0zr` READY, alias 200, bundle `index-fd1Ey3ux.js` có tiền tố tự khai, chuỗi lỗi chặn cũ = 0. Không migration, không ghi dữ liệu.

### §46 bổ sung 3 — BUG-121: chấm công LUÔN thành công (2026-08-01, deploy lần 3)
- Yêu cầu chủ quán: "chỉ cần sửa lỗi chấm công không thành công" — không bắt nhân viên đổi trình duyệt/thao tác lại. Gỡ nốt 2 tầng chặn vị trí: sai số GPS >150m (trong Lotte Mart rất thường) và không lấy được GPS (WebView/quyền chặn/hết 25s).
- **QUY TẮC MỚI (thang hạ cấp có đóng dấu, ảnh selfie VẪN bắt buộc):** `finalizeAttendanceLocation()` trong `attendance.ts` — GPS ≤150m như cũ; >150m giữ toạ độ + địa chỉ tiền tố `[GPS SAI SỐ LỚN] ±Xm`; không GPS → toạ độ TRỐNG + địa chỉ `[KHÔNG CÓ GPS] …lý do…` (không bịa toạ độ). Ràng buộc check-out có **nhánh 3** (migration `20260801_checkout_no_gps_selfdeclared.sql`, ĐÃ APPLY prod): ảnh CÓ + GPS null + tiền tố `[KHÔNG CÓ GPS]`. Outbox/`stampAttendancePhoto`/`AttendanceOutboxOp` nhận toạ độ null; `probeAttendanceLocation` vẫn cảnh báo thiết bị thiếu GPS.
- Test: `scripts/test-attendance-gps-fallback.mjs` (`ATTENDANCE_GPS_FALLBACK_OK`). Deploy `gustino-operations-m3oibsu2d`, bundle `index-Cl_wrddw.js`, verify 2 tiền tố có mặt + chuỗi chặn cũ = 0. Không ghi/sửa dòng dữ liệu nào (migration chỉ đổi định nghĩa CHECK, NOT VALID).

## 47. Role SUP MT + trang Bảng lương nhân viên + phiên đăng nhập 24h (2026-08-04) — CHƯA DEPLOY
> Yêu cầu chủ quán: (1) phân quyền supmt; (2) nhân viên coi được bảng lương để đối chiếu + phản hồi về kế toán, giao diện trực quan; (3) phiên đăng nhập tự hết hạn sau 1 ngày để giảm lỗi "treo đăng nhập". Không viết test theo yêu cầu; **CHƯA deploy Vercel, CHƯA apply migration**.

- **Role `supmt` (Giám sát SUP MT):** thêm vào `types.ts`, `access.ts` (`canReviewPayroll`, `roleLabel`), `permittedBranchIds` (attendance.ts — supmt thấy mọi chi nhánh như admin), `LoginPage`/`App.tsx` (branchIds = mọi chi nhánh active), `ROLE_OPTIONS` (AdminPage) + bộ lọc EmployeesPage + ma trận tham chiếu ControlCenterPage, Edge Function `manage-employee` (role hợp lệ, branchless — **cần deploy lại function khi go-live**). Routing: supmt mặc định vào `my-payroll`; nav = Bảng lương + Chấm công. supmt KHÔNG vào các trang quản trị khác.
- **Trang Bảng lương `#my-payroll`** (`src/pages/PayrollPage.tsx`, CSS namespace `.pay-*` cuối styles.css, mobile-first không cuộn ngang):
  - Nhân viên/ca trưởng: phiếu lương CHÍNH MÌNH theo tháng — hero THỰC NHẬN (navy solid + số xanh lá), thẻ cấu phần (Lương công kèm công thức "X giờ × Yđ/giờ", Thưởng KPI ngày/tuần, Thưởng khác/Khấu trừ, Thực nhận), chi tiết từng ngày (giờ công + doanh thu + % KPI + hạng + thưởng, `<details>` xổ dọc), form **gửi phản hồi về kế toán** + xem trả lời.
  - SUP MT/admin (`canReviewPayroll`): dải tổng hợp, danh sách phiếu lương từng nhân viên (bấm xổ chi tiết y hệt phiếu nhân viên thấy), hộp phản hồi với select trạng thái (Chờ xử lý/Đang xem/Đã giải quyết) + ô trả lời. Admin vào từ nav "Đối chiếu lương".
  - **Công thức nằm ở `src/lib/employeePayslip.ts`** — SAO CHÉP có chủ đích từ `AdminPage.tsx buildCommissionRows + buildPayrollRows` (giờ công buildAttendanceReport; doanh thu ngày = allocation đối soát + dòng POS không gắn allocation; thưởng ngày/tuần theo `commission.ts`; lương công = lương cứng > 0 ? lương cứng : giờ × đơn giá; thực nhận = công + KPI + thưởng − trừ). **ĐỔI CÔNG THỨC BẢNG LƯƠNG ADMIN THÌ PHẢI ĐỔI CẢ FILE NÀY** (đã ghi chú 2 chiều). `PAYSLIP_ROLES` giữ khớp `PAYROLL_ROLES` (shift_leader|staff).
  - Phản hồi lương: `src/lib/payrollFeedback.ts` (bảng `payroll_feedback`). Bảng chưa có trên DB → mọi hàm trả null/false, UI hiện ghi chú "chưa bật", KHÔNG vỡ trang.
- **Migration `supabase/migrations/20260804_supmt_role_payroll_review.sql` — CHƯA APPLY.** Nội dung: enum `app_role` + 'supmt'; helper `is_supmt()`/`is_system_admin()`; policy SELECT cho supmt trên profiles/attendance_records/shift_registrations/shifts/bag_*/sales_receipt*/payroll_*; nhân viên tự đọc `payroll_entries` của mình + đơn giá mặc định chi nhánh mình; bảng `payroll_feedback` + RLS (nhân viên gửi/đọc của mình; supmt đọc + trả lời; admin toàn quyền — KHÔNG dùng can_manage_branch vì hàm đó bao cả ca trưởng). Mọi so sánh role dùng `::text` để an toàn khi chạy chung transaction với ALTER TYPE. **Trước khi apply, nhân viên mở trang lương sẽ thấy 0đ đơn giá (RLS giấu) + cảnh báo "chưa có đơn giá lương" — đây là trạng thái chờ migration, không phải bug.**
- **Phiên đăng nhập tự hết hạn sau 24 giờ** (`src/lib/sessionExpiry.ts`): `handleLogin` ghi mốc `gustino_session_started_v1`; App.tsx kiểm tra lúc mở app + focus/visibility + mỗi 5 phút, quá 24h → `logout()` + cờ thông báo; `LoginPage` hiện `.form-notice` "Phiên đăng nhập đã quá 24 giờ…". Phiên cũ chưa có mốc được tính 24h TỪ LẦN MỞ ĐẦU TIÊN sau bản này (không đá hàng loạt ngay khi cập nhật). Đăng xuất tay cũng xóa mốc.
- **QA:** `npx tsc -b` + `npm run build` pass (`PRODUCTION_SUPABASE_BUNDLE_OK`, chunk `PayrollPage-*.js`). Không chạy QA script/test theo yêu cầu. **Việc còn khi go-live:** (1) apply migration 20260804 bằng `db query --linked --file`; (2) deploy lại Edge Function `manage-employee`; (3) deploy Vercel; (4) tạo tài khoản supmt qua màn Nhân sự; (5) qa-permission-matrix.mjs đang mirror canAccessPage CŨ — cần cập nhật khi chạy lại.

## 48. Gỡ tính năng lương + trang Xem công + Excel KPI theo tên + rà chấm công (2026-08-05) — ĐÃ DEPLOY
> Yêu cầu chủ quán: bỏ tính lương trong admin; nhân viên có màn xem công dạng lịch trên điện thoại; bỏ nút "Xem các ca của nhân viên"; kiểm tra đăng xuất 24h và độ ổn định chấm công. Bổ sung giữa phiên: sheet KPI theo tên trong Excel bảng công, sửa tràn CSS.

- **GỠ HẲN tính năng lương khỏi app** (không còn màn hình lẫn lib nào tính tiền): xóa `src/pages/PayrollPage.tsx`, `src/lib/payroll.ts`, `src/lib/employeePayslip.ts`, `src/lib/payrollFeedback.ts`, migration chưa apply `20260804_supmt_role_payroll_review.sql`, và toàn bộ khối `.pay-*` cuối `styles.css` (giữ lại `.form-notice` — màn đăng nhập vẫn dùng). `AdminPage.tsx`: bỏ section `payroll` khỏi `AdminSection`, bỏ `buildPayrollRows`/`PayrollDraft`/`roleSlotKey`/`payrollDrafts`/`roleDefaultDrafts`/2 effect tải lương/`exportPayroll`, bỏ tab "Lương thưởng" trong hồ sơ nhân viên. Bảng **CHI TIẾT KPI THEO NGÀY chuyển sang section `commission`** (Thi đua nhân viên) — vẫn còn nguyên, chỉ đổi chỗ. Route `manager-payroll` + `my-payroll` bị gỡ khỏi `App.tsx`/`AppShell.tsx`/`routeMap.ts`; `ROLE_OPTIONS` bỏ `supmt` (enum `app_role` trên prod CHƯA có giá trị này — tạo account sẽ lỗi 22P02).
  - **Role `supmt` vẫn còn trong `types.ts`/`access.ts`** (`canReviewPayroll` không còn nơi gọi) nhưng KHÔNG có trang nào dành riêng; `defaultPageForRole` cho supmt = `attendance`.
- **Trang Xem công `#my-timesheet`** (`src/pages/MyTimesheetPage.tsx`, CSS `.tsheet-*` cuối `styles.css`): nhân viên/ca trưởng/supmt xem công CỦA CHÍNH MÌNH theo tháng — lịch tháng bắt đầu Thứ Hai, mỗi ô hiện số giờ (`7g30`), tô màu theo trạng thái (đã làm / đang làm / có lịch / vắng), bấm ngày để xổ chi tiết giờ vào–ra–tổng giờ từng ca. Dải tổng: tổng giờ, ngày có làm, ngày công, số ca, đi trễ. Mobile-first, không cuộn ngang. Dữ liệu qua `buildAttendanceDetailRows` (cùng nguồn bảng công admin), mọi lệnh đọc bọc `withAttendanceReadDeadline`, giờ hiển thị neo `Asia/Ho_Chi_Minh`.
- **Excel bảng công (`AdminPage.exportAttendance`) thêm sheet "KPI theo tên từng ngày"**: gom `dailyKpiRows` THEO TÊN nhân viên — mỗi người liệt kê từng ngày (kèm cột Tháng) giờ công/SL bán/doanh thu/KPI ngày/% đạt/hạng/thưởng ngày, chốt một dòng **TỔNG in đậm**. Sheet "Doanh thu NV theo ngày" cũng đổi sang gom theo tên + dòng TỔNG. **File xuất theo ĐÚNG bộ lọc chi nhánh đang chọn** (chọn 23/10 thì chỉ có 23/10 — đúng thiết kế, không phải bug); đã ghi câu nhắc ngay dưới tiêu đề section.
- **Bỏ nút "Xem các ca của nhân viên"** trong DANH SÁCH CÔNG (AdminPage section attendance) + hàm `focusAttendanceEmployee` + CSS `.attendance-filter-shortcut` — nút này làm cụm hành động trong thẻ bị tràn trên điện thoại.
- **Chứng từ công hết bị bẻ 3–4 dòng** (`AttendanceAdjustmentArchive`): cột Lý do/Ghi chú đổi `min-width 180px → 320px` + `class="adjustment-longtext"`; ≤900px bảng 10 cột chuyển thành **thẻ dọc có nhãn** (`data-label` + `td::before`), riêng 2 cột câu dài chiếm trọn bề ngang.
- **Đăng xuất 24h — 2 lỗ đã bịt** (`sessionExpiry.ts` + `App.tsx`):
  - `sessionOverdueMs()` (mới) trả số ms ĐÃ quá hạn tính từ mốc đăng nhập. Trước đây khoảng ân hạn đo từ "lần đầu phát hiện quá hạn" nên **mỗi lần mở lại app là được cộng thêm ân hạn** ⇒ phiên không bao giờ hết.
  - Hoãn đăng xuất khi hộp thư chấm công còn bằng chứng chưa gửi (tối đa `SESSION_OUTBOX_GRACE_MS = 2h`), nhưng chỉ đếm op CÒN GỬI ĐƯỢC: `attendanceOutboxSendableFastCount()` (mới, `attendanceOutbox.ts`) bỏ qua op `needs-review` — op cách ly nằm lại vĩnh viễn, tính vào thì điều kiện chờ đúng mãi mãi.
  - **QUY TẮC:** mọi khoảng ân hạn/hết hạn phải đo từ MỐC TUYỆT ĐỐI lưu bền, không đo từ biến trong `useEffect` (effect remount mỗi lần mở app).
- **Màn chấm công không khẳng định sai khi tải lỗi:** `AttendancePage` thêm state `loadFailed`; lượt tải hỏng thì hiện "Chưa tải được lịch và dữ liệu chấm công…" thay vì "Bạn chưa đăng ký ca hôm nay nên chưa thể check-in" (mảng rỗng do lỗi mạng ≠ chưa đăng ký). KHÔNG quay lại màn khóa client — hợp đồng BUG-131 giữ nguyên.
- **Audit DB prod (chỉ đọc):** `open_before_today=0`, `multi_open_users=0`, `records_no_selfie=0`, `unresolved_address_30d=0`, `checkout_bad_accuracy_30d=0`, `checkout_no_gps_30d=3`, `admin_closed_30d=18`, bảng `attendance_records` 720 kB/790 dòng. **Tồn đọng dữ liệu:** 165 `shift_registrations` 30 ngày qua có `shift_id = NULL`, trong đó nhóm `lotte-vt 07:15–22:15` (n=8, tới 08/08) là kiểu **xuyên ca phủ cả 2 ca** — đúng gốc BUG-109; §39 đã vá phía báo cáo nhưng nên sửa cách XẾP LỊCH.
- **Rủi ro chấm công CÒN LẠI (đã rà, chưa sửa — chi tiết ở báo cáo phiên):** (1) `checkOut` chỉ hỏi `check_out_time` khác null chứ không so với giá trị vừa ghi ⇒ ca đã bị cron chốt hành chính lúc 00:00 mà nhân viên bấm check-out lúc 00:10 vẫn báo "thành công" và optimistic record hiện giờ sai; (2) `attendanceOutboxFlushBusy` có thể kẹt `true` vĩnh viễn vì `hasNewerOwnAttendanceRecord`/`fetchOwnAttendanceRow` không có hạn chót; (3) tab "Hôm nay" tải TOÀN BỘ lịch sử chấm công của nhân viên (không cửa sổ ngày) dưới một deadline 20s; (4) `accuracy = NaN` lọt qua `finalizeAttendanceLocation` ⇒ 23514 hiện nguyên văn tiếng Anh; (5) `localTimeKey`/`formatTime` ở AttendancePage/AdminPage vẫn theo múi giờ thiết bị; (6) mã chết `lateCheckOut.ts` + `withOutboxRetryNote`.
- **QA:** `tsc -b` + `npm run build` pass (`PRODUCTION_SUPABASE_BUNDLE_OK`, `index-BaDx8ix_.js`). Pass: ATTENDANCE_QA_OK, ATTENDANCE_DURATION_SEARCH_OK, ATTENDANCE_SINGLE_OPEN_SESSION_OK, ATTENDANCE_OUTBOX_OK, ATTENDANCE_GPS_FALLBACK_OK, ATTENDANCE_ADDRESS_FALLBACK_OK, SHIFT_REPORT_SCOPE_OK, APP_NAVIGATION_QA_OK, MANAGEMENT_QA_OK, ROLE_ACCESS_QA_OK, **PERMISSION_MATRIX_QA_OK (110/110)**.
  - **3 script stale đã cập nhật cho khớp hợp đồng hiện tại:** `qa-permission-matrix.mjs` (mirror sai từ trước: thiếu `cashier` trong canUseSales, thiếu luật `orders`, và **hash trang Quản trị khi bị điều hướng là `/admin/dashboard` chứ không phải `management`**), `test-attendance-single-open-session.mjs` (đòi `recordsLoaded` — lớp bảo vệ đã chuyển sang máy chủ ở BUG-131), `test-attendance-duration-search.mjs` (đòi chuỗi công thức lương).
  - **`test-attendance-realtime-next-day.mjs` VẪN ĐỎ và đã đỏ từ trước phiên này** (ở HEAD nó crash vì `addLocalDateKeyDays` không tồn tại). Test khoá hợp đồng outbox-chặn-check-in CŨ, mâu thuẫn với quyết định BUG-131 — cần viết lại, không phải lỗi app.
- **Deploy:** `dpl_6CXZiVcVzfLiLxvTXC7WSaGhC4Yv` READY, alias https://gustino-operations.vercel.app HTTP 200, live bundle `index-BaDx8ix_.js` (khớp build local, có `my-timesheet`, 0 tham chiếu `my-payroll`). Không migration, không ghi/sửa dòng dữ liệu prod nào.

## 53. Thi đua nhân viên gộp về MỘT bảng + tối ưu màn Quản trị › Kho (2026-08-07) — ĐÃ DEPLOY
> Chủ quán: "chức năng coi thi đua nhân viên đang bị tùm lum, quá nhiều danh sách nhưng chưa tối ưu và hiệu quả, hãy thiết kế lại cho chuẩn, tối ưu phần xem kho của bên admin".

### Gốc của "tùm lum": 5 danh sách CÙNG một nhóm người, 2 khoảng ngày khác nhau
Section `commission` (`#manager-business` / `#/admin/sales-performance`) trước bản này render liên tiếp:

| # | Khối | Kỳ dữ liệu | Xếp theo |
|---|---|---|---|
| 1 | Poster TOP 10 (`EmployeeCompetitionPoster`) | tháng, **bỏ qua** bộ lọc vai trò/số ca | doanh thu |
| 2 | Bảng phân loại (`CompetitionClassificationTable`) | kỳ thi đua (ngày/tháng) | doanh thu |
| 3 | Danh sách năng suất đầy đủ (`capacity-list`) | kỳ thi đua | doanh thu/ca |
| 4 | Thẻ thưởng KPI (`adm-list` ← `commissionRows`) | **bộ lọc ngày ĐẦU TRANG** | không xếp |
| 5 | Bảng KPI × ngày toàn cục (panel `payroll-section`) | **bộ lọc ngày ĐẦU TRANG** | theo ngày |

Hai kỳ dữ liệu khác nhau trong cùng một màn ⇒ khối 2 và khối 4 hiện **hai con số khác nhau cho cùng một nhân viên** mà không có gì giải thích. Khối 5 trộn mọi nhân viên × mọi ngày nên muốn đọc một người phải dò mắt qua hàng trăm dòng. Poster thì chụp tập chưa lọc nên ảnh gửi Zalo có cả người mà bảng trên màn đã lọc bỏ.

### Đã gộp — một bộ lọc, một dải tổng, một bảng
- **Thứ tự mới:** tiêu đề + 3 nút xuất → *Cách đọc KPI* → **thanh lọc duy nhất** (giữ nguyên `aria-label` cũ: Phân loại / Ngày xem / Vai trò / Loại ngày / Số ca) → dải `.competition-overview` (4 số) → **bảng xếp hạng** → biểu đồ năng suất → poster thu gọn.
- **Chip "đạt KPI" và dải tổng nay đếm trên `competitionFilteredRows`** (đúng tập của bảng), không phải trên bộ lọc đầu trang. `commissionRows` bị **xoá hẳn**.
- **Bảng xếp hạng là bảng DUY NHẤT.** Thêm cột **Năng suất** (giá trị + `±% so với TB đội`, tiêu đề đổi theo chỉ số đang chọn) — chính là nội dung của `capacity-list` cũ. Giờ công gộp vào dòng phụ cột *Kết quả*.
- **Sắp xếp bằng cột, không đẻ bảng mới:** `.competition-sort-bar` với `CompetitionSortKey = revenue | capacity | progress | reward`. `'revenue'` **giữ nguyên thứ tự gốc** của `buildCompetitionRows` (doanh thu → tiến độ → SL → giờ → tên) nên ngữ nghĩa xếp hạng cũ không đổi.
- **Xem thêm bằng nút:** mặc định 10 người (`COMPETITION_TOP_ROWS`), nút "Xem tất cả N người" thay cho việc bày sẵn danh sách toàn bộ.
- **Drill-down một người có 2 thẻ:** *Nguồn doanh thu* (hoá đơn/phiếu túi, như cũ) và **KPI theo ngày** (`competitionDailyKpiByKey`, lọc `monthlyDailyKpiRows` về đúng `competitionRangeFrom..To`) — thay cho bảng KPI toàn cục.
- **Khối năng suất chỉ còn biểu đồ** (`capacity-chart`): 4 thẻ tổng đã dời lên `.competition-overview`, danh sách đã thành cột của bảng. Đừng thêm lại.
- **Poster chỉ để xuất ảnh:** ăn `competitionPosterRows = competitionExportRows` (đúng bộ lọc đang xem), mặc định thu gọn qua `.competition-poster-stage { position:absolute; left:-10000px }`. **KHÔNG được dùng `display:none`** — html2canvas không chụp được phần tử không có layout (cùng kỹ thuật với `.wh .inventory-infographic`).
- **Hai nút Excel đứng cạnh nhau** ở tiêu đề; ghi chú nói thẳng "KPI theo ngày" xuất theo khoảng ngày ĐẦU TRANG, không theo kỳ thi đua — đây là khác biệt có chủ đích, không phải bug.

### Đã tối ưu — Quản trị › Kho (`AdminPage` section `inventory`)
- **Chi nhánh: bỏ lưới thẻ → bảng dòng** `.admin-stock-branches` / `.admin-stock-branch-row` (cùng luật "không dùng card" của §51). Thẻ cũ cao ~200px nên 3 chi nhánh chiếm trọn màn trước khi thấy được số nào. CSS `.inventory-branch-card*` đã **xoá hẳn**.
- **Bảng tồn của chi nhánh: tìm + lọc + xếp theo mức độ cần xử lý.** `inventoryStockLines` xếp `hết → sắp hết → còn hàng` rồi mới tới tên (bản cũ xếp alphabet nên hàng đã hết nằm lẫn giữa 30 dòng). Ô tìm không dấu (`normalizeName`) + 3 chip *Tất cả / Cần chú ý / Đã hết* kèm số đếm.
- **Đối chiếu ca: mặc định chỉ hiện ca CẦN XEM** (`inventoryShiftIssueRows` = ca đang mở **hoặc** có SKU lệch > 0,0005), chip đổi sang "Tất cả (N)". Chọn một tháng là hàng trăm ca mà ca khớp số thì không cần đọc.
- **Sổ phát sinh kho: phân trang thật.** `Pagination` (25/50/100, mặc định 50) + chip lọc theo loại phiếu (chỉ hiện loại có dữ liệu, kèm số đếm) + tìm không dấu theo tên/SKU/ghi chú. Bản cũ render MỌI phiếu của kỳ trong một khối — một chi nhánh ~90 phiếu/ngày.
- Thanh tìm/chip dùng chung: `.admin-stock-filterbar`, `.admin-stock-search`, `.admin-stock-chips`, `.admin-ledger-filterbar`.

### Bổ sung cùng ngày — bỏ chữ thừa + đổi mẫu số năng suất sang NGÀY/THÁNG
> Chủ quán: "bỏ đi phần mô tả rườm rà" + "khả năng bán trung bình là tính tiền nhân viên đó bán trung bình bao nhiêu trên 1 tháng… bán mỗi ngày 100, cuối tuần 200 — tính theo tháng là bao nhiêu, theo ngày là bao nhiêu".

- **Gỡ hết khối văn giải thích** trong màn Thi đua: `kpi-reading-guide` (xoá cả CSS), đoạn `<p>` dưới "Phân loại thi đua", `<p>` ở tiêu đề bảng xếp hạng, hai `commission-note`, mô tả dài của khối năng suất và `capacity-chart-note`. Thông tin thật sự cần giữ được chuyển sang chỗ đọc nhanh hơn: khác biệt kỳ dữ liệu của file "KPI theo ngày" nay là `title` của chính nút xuất; ý "thưởng chỉ có khi đạt ngưỡng" nằm ở thẻ tổng *Thưởng KPI* và dòng phụ ô thưởng từng người.
- **`SalesCapacityMetric` đổi hẳn mẫu số:** `revenuePerShift|quantityPerShift|revenuePerHour` → **`revenuePerDay|quantityPerDay|revenuePerMonth`**. Lý do nghiệp vụ: **một người trực 2 ca trong cùng một ngày vẫn chỉ bán trong MỘT ngày** — chia theo ca làm loãng số. Muốn tách ngày thường/cuối tuần thì dùng sẵn bộ lọc *Loại ngày*.
- `competitionFairness.buildCompetitionAttendanceMetrics(records, registrations?)` trả thêm `dayCount`/`monthCount` (đếm **distinct** `workDate`). **Truyền `registrations`** — ngày công lấy theo `workDate` của đăng ký ca, không suy từ `checkInTime`; ca qua nửa đêm mà suy từ giờ check-in là đếm nhầm sang hôm sau (đúng lớp lỗi BUG-109).
- Bảng **Ca trưởng theo tháng** không có bản ghi chấm công ⇒ `dayCount`/`monthCount` lấy từ **distinct `businessDate` của `bag_shift_sessions`** mà người đó đứng tên.
- Thi đua **"Theo ngày"** chỉ có một ngày trong kỳ ⇒ nút *Doanh thu / tháng* bị khoá và tự quay về *Doanh thu / ngày* (`capacityHasMonths`), giống cách `hasHours` từng khoá chỉ số theo giờ.
- Dòng phụ cột *Kết quả* đổi từ giờ công sang **số ngày** để khớp mẫu số mới.
- Test `test-employee-sales-capacity` viết lại theo mẫu số ngày/tháng, có case **4 ca / 2 ngày** khoá đúng quy tắc "mẫu số là ngày, không phải ca".

### QUY TẮC rút ra
> **Một màn = một kỳ dữ liệu.** Nếu buộc phải có khối lấy khoảng ngày khác (ở đây là nút xuất Excel theo bộ lọc đầu trang) thì phải nói thẳng ra màn hình. Và **đừng liệt kê lại cùng một nhóm người bằng danh sách thứ hai** chỉ vì cần một cách xếp khác — thêm cột hoặc thêm nút sắp xếp.

### QA
- `tsc -b --force` + `npm run build` pass (`PRODUCTION_SUPABASE_BUNDLE_OK`).
- Test mới `scripts/test-competition-single-board.mjs` (`COMPETITION_SINGLE_BOARD_OK`) khoá: đúng một danh sách nhân sự trong section, đúng một dải tổng, poster ăn tập đã lọc và không dùng `display:none`, có thanh sắp xếp + nút xem tất cả + 2 thẻ drill-down, có cột năng suất. **Đã kiểm tra ngược:** chạy trên `AdminPage.tsx` của HEAD thì đỏ đúng chỗ ("đang có: CompetitionClassificationTable, adm-list, kpi-daily-table").
- Test đã cập nhật theo hợp đồng mới: `test-employee-sales-capacity` (năng suất là cột, không còn `capacity-list`/`capacity-summary-grid`), `test-manager-inventory-workspace` (bảng dòng + tìm/lọc/phân trang thay lưới thẻ), `test-admin-erp-workspaces` (panel `payroll-section` đã gộp).
- Chạy lại **48 test có đọc `AdminPage.tsx`/`styles.css`**: 15 đỏ — **đúng bằng baseline ở HEAD, 0 đỏ mới** (đo bằng `git stash` rồi chạy lại cùng bộ). Nhóm đỏ sẵn: section-title mobile wrap, sitewide-horizontal-text, operations-ux-performance, competition-drilldown (crash do `data:` URL không resolve import tương đối), kpi-reward-reverse-audit (còn đòi `buildPayrollRows` đã gỡ ở §48)…
- Không chạm DB, không migration.

### Deploy 2026-08-07
Commit `5161e3d` trên nhánh `fix/kho-dong-bo-du-lieu` (đã push lên `origin`), deploy `dpl_4wx8SDdKEQkuDp6eHapWefbH7xW2` READY, alias https://gustino-operations.vercel.app HTTP 200.

> **BÀI HỌC — deploy từ cây làm việc CHƯA COMMIT là bẫy.** Lần deploy đầu (`dpl_3HV6FrHNere…`) lên đúng và verify đúng, nhưng **4 lượt deploy production khác đổ vào trong 15 phút sau đó và giành mất alias**; các lượt đó build từ code ĐÃ COMMIT (lúc ấy còn là bản cũ) nên trang thật quay về `index-tTzCsD6K.js`. Triệu chứng nhìn thấy: sidebar quản lý navy tối, chữ mờ. **Cách chữa gốc là commit trước rồi mới deploy** — khi đó mọi lượt deploy, kể cả nút *Redeploy* trên dashboard Vercel (nút này build lại từ nguồn cũ, không phải từ máy đang làm), đều ra đúng code.

Lô này **cuốn theo toàn bộ cây làm việc còn treo của §50/§51/§52** (viết lại màn Kho namespace `wh-`, gỡ thành phẩm khỏi kho qua `warehouseScope`, `shiftCountScope` cho bàn giao, bỏ `count exact` toàn chi nhánh ở `store.ts`/`App.tsx`, danh mục SKU không ghi localStorage). Migration RLS của §52 đã áp trước đó, lần này **không có migration mới, không ghi/sửa dòng dữ liệu prod nào**.

Verify trên bundle live:
- `index-BB8gIAiL.js` + `index-CQllBukJ.css` — đúng hash build local.
- `AdminPage-BX5fxPdX.js` có `competition-sort-bar`, `competition-poster-stage`, `competition-classification-capacity`, `admin-stock-branches`, `admin-stock-chips`; **0 tham chiếu** `kpi-daily-table` và `adm-list`.
- CSS live có `.competition-overview`, `.competition-sort-bar`, `.competition-poster-stage`, `.admin-stock-branch-row`, `.admin-stock-search`; **0 tham chiếu** `.inventory-branch-card`, `.capacity-list-head`, `.capacity-summary-grid`.
- **Ba khiếu nại "mất tính năng" ở §51 nay hết:** CSS live không còn `.legacy-manager-workspace .app-sidebar{background:navy!important}` — luật thắng giờ là `.app-sidebar{background:#fbfcf8!important;color:#64748b!important}` của khối *Fixed CRM navigation*. Sidebar quản lý sáng trở lại, kèm luôn nút xóa dòng công và khối năng suất bán trung bình.
- `public/sw.js` là service worker **tự hủy** (xóa mọi cache + `unregister()` + reload) nên không có rủi ro kẹt bản cũ; người dùng chỉ cần tải lại trang.

**Đường lùi:** trỏ alias về deployment trước (`vercel alias set <deployment-cũ> gustino-operations.vercel.app`).

## 52. "Web lag quá" — RLS chạy lại trên TỪNG DÒNG (2026-08-07) — ĐÃ ÁP DỤNG DB PROD
> Chủ quán: "được nhận xét là web lag quá" + console hiện `Failed to load resource: 500` trên một lượt gọi `...?branch_id=eq.gold-coast`.

### Bằng chứng (pg_stat_statements trên prod)
| Truy vấn | Lượt gọi | Trung bình | Tổng CPU |
|---|---|---|---|
| `select * from stock_movements where branch_id=$1 order by created_at desc limit/offset` | 84.087 | **909 ms** | **21 giờ** |
| `count exact` cùng bảng (lượt HEAD của `fetchMovements`/`fetchMovementsDelta`) | 15.482 | **2.025 ms** | **8,7 giờ** |
| `sales_receipts` + LATERAL `sales_receipt_items` | 26.818 | **1.060 ms** | **7,9 giờ** |

Cùng truy vấn lấy sổ kho Gold Coast (2.774 dòng): **không qua RLS 5,6 ms · qua RLS 1.242 ms**. Kế hoạch chỉ tố cáo đúng một dòng: `Index Scan … Filter: can_manage_branch(branch_id) (actual time=1.999..1238.718 rows=2774)`. Lỗi 500 trong console chính là lượt `count exact` chạm statement timeout.

### Nguyên nhân
Policy truyền **`branch_id` của từng dòng** vào `can_manage_branch()`. Đối số đổi theo dòng ⇒ Postgres không cache được kết quả hàm `STABLE`, mà thân hàm gọi `current_profile()` **ba lần**, mỗi lần một lượt tra `profiles`. Hàm lại khai `SET search_path` — đúng điều kiện **chặn inline** của SQL function ⇒ buộc phải gọi thật ~2.800 lần mỗi truy vấn.
- Kiểm chứng: gọi `can_manage_branch('gold-coast')` (đối số HẰNG, cache được) 2.774 lần chỉ tốn **21,7 ms**.

### Đã sửa — `supabase/migrations/20260807_rls_initplan_hot_reads.sql` (áp thẳng lên prod)
- Viết lại vị từ của **7 policy SELECT** trên 6 bảng nóng (`stock_movements`, `sales_receipts`, `sales_receipt_items`, `bag_allocations` ×2, `bag_shift_sessions`, `attendance_records`) sang dạng `(select (public.current_profile()).role)` — truy vấn con **không tương quan** nên Postgres nâng thành **InitPlan, chạy đúng một lần cho cả câu**; phần còn lại chỉ là so sánh cột.
- **Luật phân quyền không đổi** — biểu thức mới là bản khai triển nguyên văn thân hàm cũ; `supmt` vẫn không được cấp quyền ở đây.
- Policy INSERT/UPDATE/DELETE **giữ nguyên** (chỉ chạm vài dòng, không phải chỗ nghẽn). `can_manage_branch()` **không bị xoá** — 30+ policy khác vẫn dùng.
- Kết quả đo lại: sổ kho **1.242 ms → 20,3 ms** (nhanh 61×), hóa đơn + dòng hàng **~1.060 ms → 59 ms**.
- **Ma trận quyền đã kiểm lại sau khi áp:** ca trưởng Gold Coast đọc kho chi nhánh mình = 2.774 dòng; đọc kho Lotte VT = **0**; quản lý đọc Lotte VT = 2.283; nhân viên bán hàng đọc kho = **0**. Khớp y hệt trước khi sửa.
- **Đường hoàn tác** nằm ở cuối file migration (dán khối comment là quay về biểu thức cũ).
- ⚠️ Migration này áp bằng `supabase db query --file`, KHÔNG qua `db push` ⇒ bảng `supabase_migrations` không ghi nhận. Đây là drift có chủ ý, cùng kiểu với drift đã ghi ở §5.

### Đã sửa — phía app (`src/lib/store.ts`, `src/App.tsx`)
- **Bỏ hẳn `count exact` toàn chi nhánh.** `fetchMovements` không hỏi tổng số dòng nữa: `fetchMovementPagesParallel` kéo song song theo lô 4 trang × 1.000 dòng và dừng khi gặp trang chưa đầy ⇒ chi nhánh lớn nhất xong trong đúng một lượt đi-về.
- `fetchMovementsDelta` đổi hợp đồng: trả `{ rows, recentTotal, recentSince }`. Mốc phát hiện XOÁ phiếu chỉ đếm **3 ngày gần nhất** (`RECENT_DELETION_WINDOW_DAYS`, bám index `stock_movements_branch_date_idx`, ~270 dòng thay vì ~2.800) rồi so với chính danh sách đang giữ trong máy (`movementsRef`). Phiếu cũ hơn 3 ngày bị xoá thì lượt tải đầy đủ 2,5 phút vẫn nhặt được.
- `applyMovements()` giữ `movementsRef` đồng bộ với state để nhịp nền đối chiếu mà không phải đưa `movements` vào deps (đưa vào là mỗi phiếu mới lại dựng lại bộ đếm).
- Test: `scripts/test-stock-and-sync-performance.mjs` đã khoá "không được đếm exact toàn bộ sổ kho".

### Vòng 3 cùng ngày — "giao diện kho quá gớm" + cấm lưu dữ liệu ở local
- **Dòng nhập liệu đổi sang chạm-để-mở** (`wh-pickrow` + `wh-edit`, state `openId` trong `EntryList`). Bản trước bày ô nhập cao 44px ở CẢ 30 dòng ⇒ màn hình toàn hộp trống, cuộn mãi không hết, không biết đang gõ dòng nào. Nay mỗi SKU là một dòng gọn 52px (tên · tồn · nút ＋ hoặc số đã nhập); chạm mới mở stepper + đơn vị + nút Hết/= Tồn + kết quả. Một phiếu thực tế chỉ đụng 3–8 mặt hàng nên đây là ít chạm hơn, không phải nhiều hơn.
- **Danh mục SKU không còn ghi xuống localStorage** (`lib/products.ts`): bỏ `PersistedProductCatalog`, `writeLocalProducts` chỉ giữ cache TRONG BỘ NHỚ phiên và `removeItem` bản cũ còn sót trên máy người dùng. Lỗi tải cloud nay **ném lỗi** thay vì âm thầm rơi về bản localStorage có thể cũ nhiều ngày — chính là lớp lỗi "máy này thấy khác máy kia". Test khoá ở `test-processing-product-linkage`.
- **Còn lưu ở local (có chủ ý, KHÔNG được xoá):** hàng đợi chấm công offline trong IndexedDB (`attendanceOutbox` — BUG-118/131, xoá đi là mất lượt check-in khi mạng chập chờn) và con trỏ báo cáo chờ chốt (`handoverReportRequest`, 3 trường, để ca trưởng tắt app không quên gửi báo cáo ngày). Ngoài ra chỉ còn phiên đăng nhập, ngôn ngữ, trạng thái sidebar.

### Còn lại chưa xử lý
- `realtime.list_changes`: 4.011.615 lượt × 7,2 ms ≈ **8 giờ CPU**. Là hạ tầng realtime của Supabase, cần giảm số bảng/kênh đăng ký chứ không sửa bằng RLS. **Chưa đụng tới** — đây là điểm nghẽn lớn tiếp theo.
- 30+ policy còn lại (lương, báo cáo, kiểm kê…) vẫn dùng `can_manage_branch()` theo dòng. Chủ quán chọn phạm vi "6 bảng nóng nhất" trước.

## 51. Gỡ thành phẩm khỏi kho + viết lại toàn bộ màn Kho (2026-08-07) — ĐÃ DEPLOY (bundle `index-CY8pZy7_.js`, `InventoryPage-Cbd0LO47.js`, CSS `index-D3lM-dMC.css`)
> Chủ quán: "thành phẩm thường xuyên âm, hủy cuối ngày cũng không ghi nhận, chỉ có ghi nhận số chế biến của ngày hôm đó còn bao nhiêu thôi… thành phẩm sẽ không để dồn qua nhiều ngày… hay không hiển thị thành phẩm trong kho luôn, để thành phẩm cứ trừ vào sau khi bán như cũ nhưng không hiển thị nữa" + "thiết kế lại toàn bộ giao diện kho mới luôn, không sử dụng dạng card" + "dữ liệu kho bị hiển thị chậm, đôi khi mất thành 0 hết rồi một lúc sau mới hiển thị" + "vì sao lại hiển thị món trong menu bán trong khi tôi đã ẩn rồi".

### `src/lib/warehouseScope.ts` (mới, hàm thuần) — LUẬT "cái gì là hàng tồn kho"
- `isStockManagedProduct` = `active !== false` **và** không phải món menu **và** `category !== 'finished'` ⇒ kho chỉ còn **nguyên liệu + bao bì** (đúng thứ để dành được qua ngày và cần đặt lại).
- **Vì sao món đã ẩn vẫn lọt vào kho (trả lời khiếu nại):** `calculateStock` giữ mọi SKU từng có phiếu kho (`|| byProduct.has(product.id)`), còn `isMenuProduct` lọc theo `price > 0` — nên món bị ẩn bằng cách **xóa giá** rơi ngược vào nhóm "hàng kho". Nay lọc thẳng theo `active` + `category`, không phụ thuộc giá. `cake-ready` (thành phẩm, đơn vị "cái", giá 0) chính là ca đó.
- `splitWarehouseLines` trả `{ managed, hidden }`; `hidden` = SKU bị ẩn **nhưng còn |số dư| > 0,0005**. Màn *Sửa tồn* có chip "Hàng đã ẩn (N)" để mở ra — giữ đúng quy tắc §50: mặt hàng biến mất khỏi màn nhập liệu là mất luôn đường sửa.
- `summarizeFinishedToday(movements, dateKey)` = thành phẩm nhìn theo NGÀY (chế biến / đã bán / hao / còn lại), **không cộng dồn** ⇒ số âm tích lũy trong sổ không kéo vào bảng này. Hiện ở tab Tồn kho và tab Chế biến.
- **KHÔNG đụng `calculateStock`:** POS vẫn trừ kho thành phẩm y như cũ, báo cáo ngày và màn Bàn giao vẫn cần thành phẩm. Luật hiển thị chỉ nằm ở lớp trang. Test khoá điều này: `scripts/test-warehouse-hides-finished.mjs` (`WAREHOUSE_HIDES_FINISHED_OK`).

### `InventoryPage.tsx` viết lại toàn bộ — namespace `wh-`, KHÔNG dùng card
- Bỏ hẳn `section-card`/`entry-card`/`.stock-entry-*`/`.inventory-modebar`. Mọi thứ là **bảng dòng trên nền trắng, ngăn nhau bằng kẻ 1px**: `.wh-table` (tồn kho), `.wh-etable`/`.wh-etr` (nhập/xuất/sửa tồn/kiểm kê), `.wh-doclist` (nhật ký chứng từ), `.wh-batchlist` (mẻ chế biến).
- Đầu màn còn **một dòng** danh tính + **một hàng chip** dính đỉnh (`.wh-head`, `.wh-tabs`), 6 chế độ `InventoryMode = stock|inbound|processing|outbound|reset|count`.
- Dòng nhập liệu: điện thoại 2–3 hàng ngắn, máy tính ≥900px gói vào MỘT hàng 5 cột. Ô số giữ 44px/16px (iOS không tự phóng to). Thanh lưu dính đáy `.wh-savebar` né bottom-nav bằng `bottom: calc(72px + env(safe-area-inset-bottom))`.
- Phiếu kiểm kê đổi từ `<table>` sang `.wh-counttable` (5 cột, tự xuống hàng trên điện thoại); danh mục lấy `getProducts().filter(isStockManagedProduct)`.
- Giữ nguyên mọi hợp đồng cũ: `formatQuantity`/`formatStockAmount` (3 số lẻ), `quantityInputValue` cho nút Hết/= Tồn, `planOutbound`/`planStockReset`, `confirmRisky`/`confirmBlockedMessage` (BUG-137).

### Kho hiện chậm / nhảy về 0 rồi lát sau mới ra số — `App.tsx`
- **Gốc:** `movements` khởi tạo `[]` và KHÔNG có cờ trạng thái ⇒ trang Kho dựng bảng từ mảng rỗng, hiện đúng số 0 cho mọi mặt hàng. Tệ hơn, `void refreshMovements()` **nuốt lỗi**: 4G chập chờn là màn hình đứng ở toàn số 0 tới nhịp 15 giây kế tiếp mới "tự nhiên" hiện số thật.
- Thêm `movementsStatus: 'loading' | 'ready' | 'error'` truyền xuống `InventoryPage`; đang tải thì hiện `SkeletonRows`, lỗi thì hiện dải cảnh báo "số đang hiện KHÔNG phải tồn thật — đừng ghi phiếu lúc này". Tải lại lỗi mà đã từng có dữ liệu thì **giữ số cũ**, không xoá về 0.
- Vào lại trang cần sổ kho mà chi nhánh đã có dữ liệu trong phiên ⇒ chỉ `syncMovements()` (kéo phần mới) thay vì `refreshMovements()` (đếm dòng + tải lại toàn bộ ~1.700 dòng). Mở màn Kho không còn phải chờ.

### Bổ sung sau phản hồi lần 2 (cùng ngày)
- **Màn Quản trị › Kho (`AdminPage`) cũng phải lọc:** ảnh chụp "vẫn hiển thị nè" là màn của **quản lý** (`manager-inventory` → `AdminPage` section `inventory`, badge "Ổn định"), không phải màn Kho ca trưởng. `currentStockRows` nay `.filter(isStockManagedProduct)` — một chỗ này phủ cả bảng trên màn lẫn sheet Excel. **Quy tắc: mọi bảng tồn kho hiển thị đều phải đi qua `warehouseScope`, đừng lọc lẻ ở từng trang.**
- **Cột kết quả chỉ hiện khi dòng đã có số** (`{filled && <span className="wh-result">}`). Bản trước hiện `→ 200 cái` ở mọi dòng kể cả chưa gõ gì — 30 dòng như vậy là một cột số vô nghĩa chạy dọc màn hình. CSS: ô nhập chiếm trọn bề ngang khi chưa nhập (`grid-column: input-start / result-end`, gỡ bằng `.filled`). **Không dùng `:has()`** — WebView cũ trong Zalo/Facebook không hỗ trợ, mà đó đúng là nhóm máy ca trưởng dùng.

### CSS
- Khối kho cuối `styles.css` thay bằng namespace `.wh-*`. **Cảnh báo:** khối `.capacity-*` của §49 nằm NGAY SAU khối kho ở cuối file — khi thay đuôi file phải giữ lại nó (đợt này đã cắt nhầm rồi khôi phục từ git).
- Sidebar: đã thêm ghi chú "MÀU SIDEBAR — NGUỒN SỰ THẬT DUY NHẤT" ở khối *Fixed CRM navigation*. Không đổi màu — repo vốn đã đúng (xem mục dưới).

### QA
- `tsc -b` + `npm run build` pass (`PRODUCTION_SUPABASE_BUNDLE_OK`).
- Toàn bộ bộ test: **36 đỏ — đúng bằng baseline ở HEAD, 0 đỏ mới** (đo bằng cách stash rồi chạy lại). Test đã cập nhật cho hợp đồng mới: `test-inventory-mobile-and-shift-count` (đổi sang `wh-*`, thêm kiểm tra trạng thái tải), `test-owner-ux-inventory-admin-20260720`, `test-report-inventory-ux`, `test-processing-product-linkage`. Test mới: `test-warehouse-hides-finished`.

### Ba khiếu nại còn lại: KHÔNG phải lỗi code — bản trên production đang CŨ
Đối chiếu bundle live (`index-tTzCsD6K.js`, `AdminPage-CiSKP4pJ.js`, `index-CHi08Ntr.css`) với repo:
| Hiện tượng | Bằng chứng | Kết luận |
|---|---|---|
| Sidebar quản lý sai màu (tên thương hiệu tàng hình, mục điều hướng mờ) | CSS live còn `.legacy-manager-workspace .app-sidebar{background:navy!important}` — repo **đã gỡ** khối này (kèm ghi chú "ĐỪNG thêm lại theme riêng theo role"). Nền navy thắng vì `!important`, còn chữ vẫn lấy màu tối `#1f2937!important` của theme sáng ⇒ chữ tối trên nền tối. | Repo đã đúng, **chỉ cần deploy** |
| Mất nút xóa dòng công bị ghi vắng | Live **không có** chuỗi `Xóa dòng` lẫn `admin_delete_empty_shift_registration`; repo có cả hai (`AdminPage.tsx:2596`, `lib/attendance.ts:856`). RPC đã tồn tại trên DB prod (`security definer`). | Chưa deploy, **không mất code** |
| Không thấy khối năng suất bán trung bình | Live **không có** `buildEmployeeSalesCapacity` / `.capacity-*`; repo có (§49). | Chưa deploy |
- **Lưu ý phân quyền:** cả hai nút xóa nằm ở **Quản trị › Chấm công**, chỉ **admin** vào được (`App.tsx` `manager-attendance` gate `canUseAdmin`) và DB cũng chặn: `admin_delete_attendance_record` raise `'Chỉ Admin hệ thống được xóa ca công'` nếu `profiles.role <> 'admin'`. Tài khoản **manager** (sidebar 4 mục: Doanh thu / Kinh doanh / Kho / Báo cáo ngày) sẽ không thấy nút dù có deploy. Khối năng suất bán thì manager xem được ở **Kinh doanh**.

## 50. Kho thành phẩm âm triền miên + thiết kế lại màn Kho cho điện thoại (2026-08-06) — ĐÃ DEPLOY cùng §51 (07/08)
> Chủ quán: "thành phẩm đã cho trừ khi bán rồi mà vẫn âm quài, hoặc số lượng lớn luôn, hay do bàn giao không liên kết với kho?" + "chức năng kho khó dùng, thao tác lâu, thiết kế lại tối ưu điện thoại".

### Chẩn đoán DB prod (chỉ đọc, `scripts/db_diag_finished_stock_negative_20260806.sql`)
| SKU | Chi nhánh | Vào | Ra POS | Ra tay | Lần kiểm kê | Tồn |
|---|---|---|---|---|---|---|
| `chestnut-grilled-finished` (kg) | gold-coast / lotte-2310 / lotte-vt | **0 / 0 / 0** | 58,96 / 18,70 / 5,57 | 0 | **0 / 0 / 0** | −58,96 / −18,70 / −5,57 |
| `cake-ready` (cái) | lotte-vt / lotte-2310 / gold-coast | 380 / 110 / 128 | 1.312 / 208 / 268 | 0 / **70** / 0 | 1 / 0 / 0 | −1.132 / −168 / −140 |

**Ba nguyên nhân độc lập (công thức món KHÔNG sai đơn vị — đã kiểm: 0,11 kg/túi 110g, 4 cái/hộp):**
1. **Có đường RA mà không có đường VÀO:** 4 món nướng trên POS trừ đúng SKU *Thành phẩm hạt dẻ nướng*, nhưng SKU đó **chưa từng có một phiếu `processing_in` nào** — ca trưởng chế biến ra "tuyết"/"rang", không ai chọn đầu ra "nướng". Bán bao nhiêu thì âm bấy nhiêu. **CHƯA SỬA — chờ chủ quán chọn hướng** (đổi thói quen chế biến hay đổi công thức 4 món).
2. **Bàn giao ca không kiểm đếm hết kho** (đã sửa, xem dưới).
3. **Trừ đôi:** lotte-2310 còn 70 cái `cake-ready` xuất bằng phiếu tay song song với 208 cái POS đã tự trừ. Chủ quán chọn KHÔNG làm cảnh báo trừ đôi ở đợt này.
- **"Số lượng lớn" không phải lỗi tính:** Gold Coast `chestnut-cooked-kg` = 273,92 kg và sau mốc kiểm kê gần nhất không có phiếu nào ⇒ 273,92 chính là **số đổ sẵn đã được bấm chốt**.

### Đã sửa — bàn giao ca (`ShiftHandoverPage.tsx` + `src/lib/shiftCountScope.ts` mới)
- **`countProducts` phủ MỌI thành phẩm kho** (`category==='finished' && isWarehouseProduct`), không còn chỉ `getFinishedBulkProducts()` (thành phẩm **kg**) — nên bánh đơn vị "cái" mới lọt vào màn chốt ca.
- **Gỡ bẫy tự khóa:** thêm `expectedBalances` (tồn GIỮ NGUYÊN DẤU) bên cạnh `availableBalances` (`Math.max(0,…)`, chỉ dùng cho tồn đầu ca). `productsToCount()` nhận SKU có |tồn| > 0,0005 **kể cả âm** và nhận **mọi loại phiếu** phát sinh trong ca (bản cũ chỉ `processing_in` nên hàng chỉ bán ra không bao giờ lọt vào).
- **Ô đếm KHÔNG điền sẵn tồn dự kiến nữa:** `setClosingBalances({})` khi đổi ca, input `?? ''`, ô trống ≠ đã đếm 0 (`hasCountInput`). Chốt ca bị chặn kèm danh sách "Chưa đếm N mặt hàng: …". Bù lại có nút **"= dự kiến"** mỗi dòng để không làm chậm ca trưởng.
- **QUY TẮC:** đừng bao giờ để một màn nhập liệu lọc theo `> 0` trên bản đã `Math.max(0, …)` — số âm biến mất khỏi màn là mất luôn đường sửa.

### Đã sửa — màn Kho mobile-first (`InventoryPage.tsx`, CSS `.inventory-modebar` / `.stock-*`)
- **Một tầng điều hướng:** `InventoryCrmMode = stock | inbound | processing | outbound | reset | count`. Bỏ hẳn `InboundSub`/`OutboundSub` + `.inventory-subtabs` (bản cũ: 4 thẻ cao 150px → tab con → mới tới ô nhập; "sửa tồn" mất 3 chạm). Nay `InventoryModeBar` = 1 hàng chip **sticky đỉnh màn**, cuộn ngang.
- **Nhóm hay dùng:** `recentProductIds()` = SKU có phát sinh trong 7 ngày (top 10). Thứ tự dòng: đã nhập → hay dùng → còn tồn → còn lại. Mặc định **rút gọn**, nút "Hiện thêm N mặt hàng ít dùng" (không rút gọn khi đang tìm/lọc hoặc danh sách < 6 dòng).
- **Thanh lưu dính đáy** (`.stock-entry-footer` sticky + shadow): lưu được ở bất kỳ vị trí cuộn nào, nút lưu ghi luôn số dòng và **disable khi chưa có gì thay đổi**. Ghi chú phiếu thu vào nút ✎ thay vì ô luôn chiếm chỗ.
- **Dòng SKU:** thêm nút **− / +** bước thông minh (kg → 0,5; g → 100; hàng đếm/bao → 1) để khỏi bật bàn phím; nút ✎/× chỉ hiện khi dòng đã nhập; mobile xếp 3 hàng (tên+tồn / ô nhập / nút+kết quả) thay vì dồn 4 khối vào hàng hẹp. Hướng dẫn dài → `<details>` "Cách dùng nhanh".
- Giữ nguyên mọi hợp đồng cũ: `quantityInputValue` cho nút Hết/= Tồn, `confirmRisky`/`confirmBlockedMessage` (BUG-137), `planOutbound`/`planStockReset`.
- **CSS đã dọn:** khối `.inventory-crm-*` + `.inventory-subtabs` cuối `styles.css` (đợt "Đầu màn kho gọn lại" cùng ngày) bị thay bằng `.inventory-modebar`. Vẫn còn rule `.inventory-crm-*` rải rác ở các media query cũ — **chết nhưng chưa dọn**, không còn class nào render.
- **QA:** `tsc -b` + `npm run build` pass (`PRODUCTION_SUPABASE_BUNDLE_OK`, `index-C8UqE94W.js`). Test mới `scripts/test-inventory-mobile-and-shift-count.mjs` (`INVENTORY_MOBILE_AND_SHIFT_COUNT_OK`, có test bằng số cho SKU âm). Pass lại: INVENTORY_ENTRY_REDESIGN, INVENTORY_DISPLAY_CONSISTENCY_OK, INVENTORY_CONFIRM_IN_WEBVIEW_OK, OWNER_UX_INVENTORY_ADMIN_20260720_OK, HANDOVER_SHIFT_RECOVERY_OK, HANDOVER_REPORT_REMINDER_OK, STOCK_ADJUSTMENT_CONSISTENCY_OK, SHIFT_REPORT_SCOPE_OK, POS_SALE_STOCK_DEDUCTION_OK, DAILY_REPORT_EMPLOYEE_ATTENDANCE_FLOW_OK.
- **Số âm đang có KHÔNG tự hết:** phải đếm thật rồi chốt ca (hoặc dùng Sửa tồn) mới đặt lại được mốc. Không ghi số nào vào DB prod trong phiên này.

## 49. Khả năng bán trung bình của nhân viên (2026-08-06) — ĐÃ DEPLOY (`dpl_FM1zxRBCND9PuJARxKaWyv6QWcuX`, bundle `index-_-At_eSP.js`)
> Yêu cầu: thêm chức năng tính khả năng trung bình bán được của một nhân viên, hiện thành danh sách + biểu đồ so sánh, gộp chung vào màn **Thi đua nhân viên**.

- **Lý do nghiệp vụ:** bảng thi đua xếp theo TỔNG doanh thu nên ai làm nhiều ca luôn đứng trên, dù mỗi ca bán ít hơn. Khối mới trả lời câu khác: *một ca (hoặc một giờ công) của người này bán được bao nhiêu*.
- **`src/lib/employeeSalesCapacity.ts` (mới, hàm thuần):** `buildEmployeeSalesCapacity(inputs, metric)` với 3 chỉ số `revenuePerShift | quantityPerShift | revenuePerHour`. Quy tắc:
  - Mẫu số là **số ca có check-in** (`buildCompetitionAttendanceMetrics`) hoặc **giờ công thực tế**; thiếu mẫu số ⇒ `measured=false`, chỉ số để trống (KHÔNG lấy tổng doanh thu làm "trung bình") và xếp cuối danh sách.
  - **Trung bình đội = tổng/tổng (bình quân gia quyền)**, không phải trung bình của các số trung bình — một người chỉ làm 1 ca may mắn không kéo lệch mốc so sánh.
  - `diffFromTeam`/`teamRatio` = chênh lệch tuyệt đối và % so với mốc đội.
- **`AdminPage.tsx` — section `commission` (Thi đua nhân viên):** `<EmployeeSalesCapacityBoard>` đặt ngay dưới `CompetitionClassificationTable`, ăn **đúng `competitionFilteredRows`** (cùng phân loại ngày/tháng/ca trưởng, vai trò, loại ngày, khoảng số ca) nên hai bảng không bao giờ đá nhau. Gồm: nút đổi chỉ số, 4 thẻ tổng hợp, **biểu đồ thanh ngang top 8 có vạch đứt mốc trung bình đội** (xanh lá = trên mức, xám = dưới mức), danh sách đầy đủ kèm cột "So với TB đội".
  - Bảng **Ca trưởng theo tháng không có giờ công** (`totalHours=0`) ⇒ `capacityHasHours=false`, chỉ số "Doanh thu / giờ công" bị khóa và tự quay về "Doanh thu / ca" (`effectiveCapacityMetric`).
  - Chỉ có nhân sự **có doanh thu** trong kỳ (kế thừa `buildCompetitionRows` vốn `filter(revenue > 0)`).
- **CSS namespace `.capacity-*`** cuối `styles.css` (kèm breakpoint 900px/560px: bảng đổi thành thẻ có nhãn `data-label`, không cuộn ngang).
- **QA:** `tsc -b` + `npm run build` pass (`PRODUCTION_SUPABASE_BUNDLE_OK`, `AdminPage-BWZBiyRp.js`). Test mới `scripts/test-employee-sales-capacity.mjs` (`EMPLOYEE_SALES_CAPACITY_OK`). Pass lại: COMPETITION_FAIRNESS_FILTERS_OK, ADMIN_COMPETITION_WORKBOOK_CLARITY_OK, BUSINESS_COMPETITION_KPI_OK, KPI_RANKING_REWARD_CLARITY_OK, MANAGEMENT_DAILY_COMPETITION_REALTIME_OK.
  - **2 script ĐỎ SẴN từ trước phiên này (không liên quan):** `test-competition-drilldown.mjs` crash vì nạp `shiftCompetition.ts` bằng `data:` URL trong khi file này import `./shiftReportScope` (data URL không resolve được đường dẫn tương đối); `test-kpi-reward-reverse-audit.mjs` còn đòi `buildPayrollRows`/"thực nhận" đã bị gỡ ở §48.
