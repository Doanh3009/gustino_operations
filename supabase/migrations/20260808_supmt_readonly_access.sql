-- SUP MT (Supervisor Market Trade): quyền GIÁM SÁT chỉ đọc trên toàn hệ thống.
--
-- Nghiệp vụ: SUP MT theo dõi doanh thu, doanh số, lịch ca/đăng ký ca và chấm công của
-- mọi chi nhánh để đối chiếu; họ KHÔNG thao tác nghiệp vụ (không nhập kho, không bán
-- hàng, không chỉnh công, không tạo/sửa tài khoản). Việc duy nhất họ ghi dữ liệu là
-- chấm công của CHÍNH họ — đi giám sát chi nhánh nào thì đăng ký ca ở chi nhánh đó.
--
-- CÁCH LÀM: thêm policy PERMISSIVE riêng cho `supmt` thay vì sửa policy đang chạy.
-- Postgres OR các policy permissive lại với nhau, nên luật của admin/manager/ca trưởng
-- giữ nguyên từng chữ — không có rủi ro sửa nhầm quyền của vai trò khác.
--
-- Biểu thức viết dạng `(select (current_profile()).role)` để Postgres nâng thành InitPlan
-- (đánh giá MỘT lần cho cả câu lệnh) — cùng kỹ thuật với `20260807_rls_initplan_hot_reads.sql`.
--
-- KHÔNG cấp INSERT/UPDATE/DELETE nào cho `supmt` ngoài đăng ký ca của chính họ. Lớp ẩn
-- nút bên frontend (`isReadOnlyConsoleRole` trong `src/lib/access.ts`) chỉ là tiện dụng;
-- chặn thật nằm ở đây.

-- ===== ĐỌC: hồ sơ nhân sự =====
drop policy if exists "supmt reads all profiles" on public.profiles;
create policy "supmt reads all profiles" on public.profiles
  for select using ((select (public.current_profile()).role) = 'supmt'::public.app_role);

-- ===== ĐỌC: lịch ca + chấm công =====
drop policy if exists "supmt reads all shift registrations" on public.shift_registrations;
create policy "supmt reads all shift registrations" on public.shift_registrations
  for select using ((select (public.current_profile()).role) = 'supmt'::public.app_role);

drop policy if exists "supmt reads all attendance" on public.attendance_records;
create policy "supmt reads all attendance" on public.attendance_records
  for select using ((select (public.current_profile()).role) = 'supmt'::public.app_role);

drop policy if exists "supmt reads attendance adjustments" on public.attendance_adjustment_requests;
create policy "supmt reads attendance adjustments" on public.attendance_adjustment_requests
  for select using ((select (public.current_profile()).role) = 'supmt'::public.app_role);

-- ===== ĐỌC: doanh thu và doanh số =====
drop policy if exists "supmt reads all sales receipts" on public.sales_receipts;
create policy "supmt reads all sales receipts" on public.sales_receipts
  for select using ((select (public.current_profile()).role) = 'supmt'::public.app_role);

drop policy if exists "supmt reads all sales receipt items" on public.sales_receipt_items;
create policy "supmt reads all sales receipt items" on public.sales_receipt_items
  for select using ((select (public.current_profile()).role) = 'supmt'::public.app_role);

drop policy if exists "supmt reads all bag allocations" on public.bag_allocations;
create policy "supmt reads all bag allocations" on public.bag_allocations
  for select using ((select (public.current_profile()).role) = 'supmt'::public.app_role);

drop policy if exists "supmt reads all bag shifts" on public.bag_shift_sessions;
create policy "supmt reads all bag shifts" on public.bag_shift_sessions
  for select using ((select (public.current_profile()).role) = 'supmt'::public.app_role);

drop policy if exists "supmt reads commission rules" on public.commission_rules;
create policy "supmt reads commission rules" on public.commission_rules
  for select using ((select (public.current_profile()).role) = 'supmt'::public.app_role);

drop policy if exists "supmt reads employee KPI targets" on public.employee_kpi_targets;
create policy "supmt reads employee KPI targets" on public.employee_kpi_targets
  for select using ((select (public.current_profile()).role) = 'supmt'::public.app_role);

-- ===== ĐỌC: kho, báo cáo, đơn hàng (trang Quản trị dùng chung nguồn với admin) =====
drop policy if exists "supmt reads all movements" on public.stock_movements;
create policy "supmt reads all movements" on public.stock_movements
  for select using ((select (public.current_profile()).role) = 'supmt'::public.app_role);

drop policy if exists "supmt reads inventory reports" on public.inventory_reports;
create policy "supmt reads inventory reports" on public.inventory_reports
  for select using ((select (public.current_profile()).role) = 'supmt'::public.app_role);

drop policy if exists "supmt reads operation days" on public.operation_days;
create policy "supmt reads operation days" on public.operation_days
  for select using ((select (public.current_profile()).role) = 'supmt'::public.app_role);

drop policy if exists "supmt reads report snapshots" on public.report_snapshots;
create policy "supmt reads report snapshots" on public.report_snapshots
  for select using ((select (public.current_profile()).role) = 'supmt'::public.app_role);

drop policy if exists "supmt reads supply requests" on public.supply_requests;
create policy "supmt reads supply requests" on public.supply_requests
  for select using ((select (public.current_profile()).role) = 'supmt'::public.app_role);

-- ===== GHI: chỉ chấm công của chính SUP MT =====
-- SUP MT không gắn `profiles.branch_id`, nên policy "employee adds own active shift"
-- (đòi `branch_id = branch của chính mình` hoặc `can_manage_branch`) không bao giờ khớp
-- ⇒ không đăng ký được ca ⇒ không check-in được (policy "employee checks in" đòi có
-- đăng ký ca tương ứng). Policy dưới đây mở đúng phần đó: dòng của CHÍNH họ, tại bất kỳ
-- chi nhánh nào — vai trò đi thị trường, hôm nay ở Gold Coast, mai ở Lotte.
--
-- Check-in/check-out KHÔNG cần policy mới: "employee checks in"/"employee checks out"
-- vốn chỉ xét `user_id = auth.uid()`, không xét vai trò.
drop policy if exists "supmt adds own shift anywhere" on public.shift_registrations;
create policy "supmt adds own shift anywhere" on public.shift_registrations
  for insert with check (
    user_id = (select auth.uid())
    and (select (public.current_profile()).role) = 'supmt'::public.app_role
    and status = 'approved'::public.shift_registration_status
  );
