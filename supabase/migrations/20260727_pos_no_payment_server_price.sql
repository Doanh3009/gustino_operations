-- ============================================================================
-- 20260727 — POS KHÔNG THU TIỀN + GIÁ DO SERVER QUYẾT ĐỊNH + IDEMPOTENT
--
-- Nghiệp vụ chốt lại: nhân viên KHÔNG trực tiếp thu tiền. Màn bán hàng chỉ ghi
-- nhận sản phẩm + số lượng; doanh thu = giá trong database × số lượng.
--
-- Thay đổi so với bản 20260724:
--   1. BỎ toàn bộ validate thu tiền (customer_paid, "Số tiền khách đưa chưa đủ",
--      payment_method bắt buộc). Cột payment_method GIỮ NGUYÊN trong bảng (dữ
--      liệu lịch sử không mất), hóa đơn mới ghi mặc định 'cash', customer_paid
--      = null, change_amount = 0.
--   2. GIÁ KHÔNG TIN CLIENT: unit_price lấy từ public.products.price theo
--      product_id. Client gửi giá nào cũng bị ghi đè. Món không có trong danh
--      mục hoặc chưa đặt giá (> 0) thì từ chối với thông báo rõ ràng — admin
--      phải đặt giá trong Trung tâm điều khiển trước.
--      Giá tại thời điểm bán được snapshot vào sales_receipt_items.unit_price /
--      line_total, nên đổi giá sau này KHÔNG làm thay đổi doanh thu lịch sử.
--   3. IDEMPOTENT theo id hóa đơn: client giữ nguyên id khi retry; nếu id đã
--      tồn tại thì trả lại hóa đơn cũ thay vì lỗi khóa chính / tạo đơn trùng
--      (chống bấm nhiều lần + request retry trừ kho 2 lần).
--
-- KHÔNG đổi: post_pos_receipt_stock (trừ kho theo công thức, cùng transaction),
-- delete_pos_receipt (hoàn kho đúng một lần nhờ delete theo document_id).
--
-- ROLLBACK: chạy lại file 20260724_pos_sale_deducts_stock.sql để trả RPC về
-- bản trước (schema bảng không đổi nên không cần rollback dữ liệu).
-- ============================================================================

create or replace function public.create_cashier_pos_receipt(
  p_receipt jsonb,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  v_id uuid := coalesce(nullif(p_receipt->>'id', '')::uuid, gen_random_uuid());
  v_existing public.sales_receipts%rowtype;
  v_branch text := p_receipt->>'branch_id';
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_date date := coalesce(nullif(p_receipt->>'business_date', '')::date, v_today);
  v_total numeric(14,2);
  v_quantity numeric(14,3);
  v_sequence integer;
  v_code text;
  v_seller_id uuid;
  v_seller_name text;
  v_stock_rows integer := 0;
  v_missing text;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and coalesce(active, true);

  if actor.id is null then raise exception 'Tài khoản chưa sẵn sàng để bán hàng.'; end if;
  if actor.role not in ('cashier', 'staff', 'shift_leader', 'manager', 'admin') then
    raise exception 'Tài khoản không có quyền tạo hóa đơn POS.';
  end if;
  if v_branch is null or not exists (select 1 from public.branches where id = v_branch and active) then
    raise exception 'Chi nhánh POS không hợp lệ hoặc đã ngừng hoạt động.';
  end if;
  if actor.role in ('cashier', 'staff') and actor.branch_id is distinct from v_branch then
    raise exception 'Thu ngân chỉ được bán tại chi nhánh được phân công.';
  end if;
  if actor.role in ('shift_leader', 'manager', 'admin')
    and actor.branch_id is distinct from v_branch
    and not public.can_manage_branch(v_branch) then
    raise exception 'Bạn không có quyền bán tại chi nhánh này.';
  end if;
  if v_date is distinct from v_today then raise exception 'POS chỉ được tạo hóa đơn cho ngày hiện tại.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Hóa đơn chưa có sản phẩm.';
  end if;

  -- Idempotency: cùng id đã lưu rồi thì trả lại kết quả cũ, không tạo đơn mới,
  -- không trừ kho lần hai (post_pos_receipt_stock cũng tự chống ghi đôi).
  select * into v_existing from public.sales_receipts where id = v_id;
  if found then
    return jsonb_build_object(
      'id', v_existing.id, 'code', v_existing.code,
      'created_at', v_existing.created_at, 'stock_rows', 0,
      'idempotent', true
    );
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) line
    where coalesce(nullif(line->>'product_id', ''), '') = ''
       or coalesce((line->>'quantity')::numeric, 0) <= 0
  ) then raise exception 'Chi tiết hóa đơn thiếu sản phẩm hoặc số lượng không hợp lệ.'; end if;

  -- Món phải có trong danh mục và có giá bán > 0 — GIÁ SERVER là giá duy nhất.
  select string_agg(distinct line->>'product_id', ', ')
  into v_missing
  from jsonb_array_elements(p_lines) line
  left join public.products product
    on product.id = line->>'product_id'
   and coalesce(product.active, true)
   and product.deleted_at is null
  where product.id is null or coalesce(product.price, 0) <= 0;
  if v_missing is not null then
    raise exception 'Món chưa có giá bán trong danh mục (%). Admin cần đặt giá ở Trung tâm điều khiển trước khi bán.', v_missing;
  end if;

  -- Tổng số lượng + doanh thu tính từ GIÁ TRONG DATABASE, bỏ qua giá client gửi.
  select coalesce(sum((line->>'quantity')::numeric), 0),
         coalesce(sum((line->>'quantity')::numeric * product.price), 0)
  into v_quantity, v_total
  from jsonb_array_elements(p_lines) line
  join public.products product on product.id = line->>'product_id';

  if v_quantity <= 0 or v_total <= 0 then raise exception 'Số lượng hoặc tổng tiền hóa đơn không hợp lệ.'; end if;

  if actor.role = 'cashier' then
    v_seller_id := actor.id;
    v_seller_name := actor.full_name;
  else
    v_seller_id := coalesce(nullif(p_receipt->>'seller_id', '')::uuid, actor.id);
    v_seller_name := coalesce(nullif(trim(p_receipt->>'seller_name'), ''), actor.full_name);
  end if;

  perform pg_advisory_xact_lock(hashtext(v_branch || '|' || v_date::text));
  select coalesce(max(nullif(regexp_replace(code, '^.*-', ''), '')::integer), 0) + 1
  into v_sequence
  from public.sales_receipts
  where branch_id = v_branch and business_date = v_date and code ~ '-[0-9]+$';
  v_code := 'HD' || to_char(v_date, 'DDMM') || '-' || lpad(v_sequence::text, 3, '0');

  -- payment_method giữ mặc định 'cash' cho tương thích cột NOT NULL cũ; nghiệp
  -- vụ không còn thu tiền nên customer_paid = null, change_amount = 0.
  insert into public.sales_receipts (
    id, code, branch_id, business_date, seller_id, seller_name, payment_method,
    total_quantity, total_amount, customer_paid, change_amount, created_by
  ) values (
    v_id, v_code, v_branch, v_date, v_seller_id, v_seller_name, 'cash',
    v_quantity, v_total, null, 0, actor.id
  );

  -- unit_price = giá database tại thời điểm bán (snapshot bất biến của hóa đơn).
  insert into public.sales_receipt_items (
    receipt_id, allocation_id, product_id, product_name, quantity, unit_price, line_total
  )
  select v_id,
         nullif(line->>'allocation_id', '')::uuid,
         line->>'product_id',
         coalesce(nullif(trim(line->>'product_name'), ''), product.name),
         (line->>'quantity')::numeric,
         product.price,
         round((line->>'quantity')::numeric * product.price, 2)
  from jsonb_array_elements(p_lines) line
  join public.products product on product.id = line->>'product_id';

  -- Trừ kho ngay trong transaction bán hàng: hóa đơn và phiếu xuất luôn đi cùng nhau.
  v_stock_rows := public.post_pos_receipt_stock(v_id);

  return jsonb_build_object(
    'id', v_id, 'code', v_code, 'created_at', now(),
    'total_amount', v_total, 'total_quantity', v_quantity,
    'stock_rows', v_stock_rows
  );
end;
$$;

revoke all on function public.create_cashier_pos_receipt(jsonb, jsonb) from public;
grant execute on function public.create_cashier_pos_receipt(jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
