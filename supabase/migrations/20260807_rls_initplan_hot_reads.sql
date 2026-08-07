-- ════════════════════════════════════════════════════════════════════════════
-- RLS: tính quyền MỘT LẦN mỗi truy vấn thay vì một lần mỗi DÒNG (07/08/2026)
-- ────────────────────────────────────────────────────────────────────────────
-- Vấn đề đo được trên prod (pg_stat_statements):
--   · SELECT stock_movements của một chi nhánh: 84.087 lượt × 909 ms = 21 giờ CPU
--   · Đếm dòng stock_movements:                 15.482 lượt × 2.025 ms = 8,7 giờ
--   · SELECT sales_receipts + items:            26.818 lượt × 1.060 ms = 7,9 giờ
--
-- Cùng một truy vấn lấy sổ kho Gold Coast (2.774 dòng):
--   · chạy KHÔNG qua RLS ............................  5,6 ms
--   · chạy QUA RLS hiện tại ......................... 1.242 ms
--   · gọi can_manage_branch() 2.774 lần khi cache được  21,7 ms
-- Kế hoạch thực thi chỉ đúng một dòng đáng ngờ:
--   Index Scan ... Filter: can_manage_branch(branch_id)
--                  (actual time=1.999..1238.718 rows=2774)
--
-- NGUYÊN NHÂN: policy truyền `branch_id` CỦA TỪNG DÒNG vào `can_manage_branch()`.
-- Đối số đổi theo dòng nên Postgres không cache được kết quả của hàm STABLE, mà
-- thân hàm lại gọi `current_profile()` ba lần — mỗi lần một lượt tra `profiles`.
-- Hàm còn khai `SET search_path` nên Postgres KHÔNG inline được (đây là điều
-- kiện chặn inline của SQL function) ⇒ bắt buộc gọi thật, ~2.800 lần mỗi truy vấn.
--
-- CÁCH SỬA: viết lại vị từ sao cho phần tra hồ sơ KHÔNG phụ thuộc dòng nào cả.
-- `(select (public.current_profile()).role)` là truy vấn con không tương quan ⇒
-- Postgres nâng thành InitPlan, chạy đúng MỘT lần cho cả câu; phần còn lại chỉ là
-- so sánh cột `branch_id` — gần như miễn phí.
--
-- LUẬT PHÂN QUYỀN KHÔNG ĐỔI. Biểu thức mới là bản khai triển nguyên văn thân hàm
-- `can_manage_branch`:
--     role in ('admin','manager')
--     or (role = 'shift_leader' and profiles.branch_id = <branch của dòng>)
-- Vai trò `supmt` vẫn KHÔNG được cấp quyền ở đây, đúng như bản cũ.
--
-- PHẠM VI: chỉ các policy SELECT của 6 bảng bị quét nhiều dòng nhất. Policy
-- INSERT/UPDATE/DELETE giữ nguyên — chúng chỉ chạm vài dòng nên không phải chỗ
-- nghẽn, và đổi ít thì rủi ro ít. `can_manage_branch()` KHÔNG bị xoá: hơn 30
-- policy khác vẫn dùng.
--
-- HOÀN TÁC: xem khối cuối file.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Sổ kho — nguồn tốn CPU số 1 ─────────────────────────────────────────
alter policy "management and shift leaders read movements"
  on public.stock_movements
  using (
    (select (public.current_profile()).role) in ('admin'::public.app_role, 'manager'::public.app_role)
    or (
      (select (public.current_profile()).role) = 'shift_leader'::public.app_role
      and branch_id = (select (public.current_profile()).branch_id)
    )
  );

-- ── 2. Hóa đơn POS ─────────────────────────────────────────────────────────
alter policy "branch users read sales receipts"
  on public.sales_receipts
  using (
    branch_id = (select (public.current_profile()).branch_id)
    or (select (public.current_profile()).role) in ('admin'::public.app_role, 'manager'::public.app_role)
    or (
      (select (public.current_profile()).role) = 'shift_leader'::public.app_role
      and branch_id = (select (public.current_profile()).branch_id)
    )
  );

-- ── 3. Dòng hàng của hóa đơn ───────────────────────────────────────────────
alter policy "branch users read sales receipt items"
  on public.sales_receipt_items
  using (
    exists (
      select 1
      from public.sales_receipts r
      where r.id = sales_receipt_items.receipt_id
        and (
          r.branch_id = (select (public.current_profile()).branch_id)
          or (select (public.current_profile()).role) in ('admin'::public.app_role, 'manager'::public.app_role)
          or (
            (select (public.current_profile()).role) = 'shift_leader'::public.app_role
            and r.branch_id = (select (public.current_profile()).branch_id)
          )
        )
    )
  );

-- ── 4. Sổ túi theo ca ──────────────────────────────────────────────────────
alter policy "branch users read bag allocations"
  on public.bag_allocations
  using (
    (select (public.current_profile()).role) in ('admin'::public.app_role, 'manager'::public.app_role)
    or (
      (select (public.current_profile()).role) = 'shift_leader'::public.app_role
      and branch_id = (select (public.current_profile()).branch_id)
    )
  );

alter policy "assigned employees read their bag allocations"
  on public.bag_allocations
  using (
    employee_id = (select auth.uid())
    or (select (public.current_profile()).role) in ('admin'::public.app_role, 'manager'::public.app_role)
    or (
      (select (public.current_profile()).role) = 'shift_leader'::public.app_role
      and branch_id = (select (public.current_profile()).branch_id)
    )
  );

alter policy "branch users read bag shifts"
  on public.bag_shift_sessions
  using (
    (select (public.current_profile()).role) in ('admin'::public.app_role, 'manager'::public.app_role)
    or (
      (select (public.current_profile()).role) = 'shift_leader'::public.app_role
      and branch_id = (select (public.current_profile()).branch_id)
    )
  );

-- ── 5. Chấm công ───────────────────────────────────────────────────────────
alter policy "employee reads own attendance"
  on public.attendance_records
  using (
    user_id = (select auth.uid())
    or (select (public.current_profile()).role) in ('admin'::public.app_role, 'manager'::public.app_role)
    or (
      (select (public.current_profile()).role) = 'shift_leader'::public.app_role
      and branch_id = (select (public.current_profile()).branch_id)
    )
  );

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- HOÀN TÁC — dán nguyên khối này để quay lại đúng biểu thức cũ:
--
-- begin;
-- alter policy "management and shift leaders read movements" on public.stock_movements
--   using (can_manage_branch(branch_id));
-- alter policy "branch users read sales receipts" on public.sales_receipts
--   using ((branch_id = (current_profile()).branch_id) or can_manage_branch(branch_id));
-- alter policy "branch users read sales receipt items" on public.sales_receipt_items
--   using (exists (select 1 from sales_receipts r
--                  where r.id = sales_receipt_items.receipt_id
--                    and ((r.branch_id = (current_profile()).branch_id) or can_manage_branch(r.branch_id))));
-- alter policy "branch users read bag allocations" on public.bag_allocations
--   using (can_manage_branch(branch_id));
-- alter policy "assigned employees read their bag allocations" on public.bag_allocations
--   using ((employee_id = auth.uid()) or can_manage_branch(branch_id));
-- alter policy "branch users read bag shifts" on public.bag_shift_sessions
--   using (can_manage_branch(branch_id));
-- alter policy "employee reads own attendance" on public.attendance_records
--   using ((user_id = auth.uid()) or can_manage_branch(branch_id));
-- commit;
-- ════════════════════════════════════════════════════════════════════════════
