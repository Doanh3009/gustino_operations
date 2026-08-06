-- BUG-115: bán hàng trên POS không hề trừ kho.
--
-- Control Center bắt admin gán công thức cho từng món menu ("Bắt buộc chọn nguyên
-- vật liệu … để hệ thống trừ tồn kho khi bán") nhưng KHÔNG có chỗ nào dùng công
-- thức đó: `create_cashier_pos_receipt` chỉ ghi `sales_receipts` + items. Vì vậy
-- tồn thành phẩm chỉ giảm khi ca trưởng tự lập phiếu xuất hoặc lúc kiểm đếm cuối
-- ca — giữa ca thì số tồn trên màn hình luôn cao hơn thực tế.
--
-- Bản này để chính RPC bán hàng ghi luôn phiếu xuất kho, trong CÙNG transaction
-- với hóa đơn, nên không bao giờ có hóa đơn mà thiếu phiếu trừ kho.
--
-- Quy ước:
--   * Mỗi dòng `recipe` của món (role source/ingredient/packaging đều là "trừ")
--     nhân với số lượng bán → gom theo SKU → một dòng `sale_out`.
--   * `document_id` = id hóa đơn, để xóa hóa đơn thì gỡ đúng nhóm phiếu đó.
--   * Món CHƯA gán công thức vẫn bán bình thường, chỉ là không trừ được gì —
--     chủ quán chọn phương án này để nhân viên không bao giờ bị chặn bán hàng.
--     Danh sách món chưa gán hiện ở Control Center để admin bổ sung.
--   * KHÔNG kiểm tra đủ tồn: bán hàng thật không được phép bị kho chặn. Tồn âm
--     là tín hiệu cho ca trưởng biết còn thiếu phiếu nhập/mẻ chế biến.

create or replace function public.post_pos_receipt_stock(p_receipt_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt public.sales_receipts;
  v_rows integer := 0;
begin
  select * into v_receipt from public.sales_receipts where id = p_receipt_id;
  if not found then
    return 0;
  end if;

  -- Chống ghi đôi khi hàm được gọi lại (retry mạng, sửa dữ liệu).
  if exists (
    select 1 from public.stock_movements
    where document_id = p_receipt_id and movement_type = 'sale_out'
  ) then
    return 0;
  end if;

  with component as (
    select recipe_line->>'productId' as product_id,
           sum(
             (recipe_line->>'quantity')::numeric * item.quantity
           ) as quantity
    from public.sales_receipt_items item
    join public.products menu on menu.id = item.product_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(menu.recipe) = 'array' then menu.recipe else '[]'::jsonb end
    ) as recipe_line
    where item.receipt_id = p_receipt_id
      and item.quantity > 0
      and coalesce(recipe_line->>'productId', '') <> ''
      and coalesce(recipe_line->>'quantity', '') ~ '^[0-9]+(\.[0-9]+)?$'
      and (recipe_line->>'quantity')::numeric > 0
    group by recipe_line->>'productId'
  )
  insert into public.stock_movements (
    branch_id, product_id, movement_type, quantity, shift_date, note,
    document_id, created_by, measured_weight_kg
  )
  select v_receipt.branch_id,
         component.product_id,
         'sale_out',
         round(component.quantity, 4),
         v_receipt.business_date,
         '[POS ' || v_receipt.code || '] Trừ kho theo công thức món',
         v_receipt.id,
         v_receipt.created_by,
         case when stock_product.unit = 'kg' then round(component.quantity, 4) end
  from component
  join public.products stock_product on stock_product.id = component.product_id
  where round(component.quantity, 4) > 0;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.post_pos_receipt_stock(uuid) from public;

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
  v_branch text := p_receipt->>'branch_id';
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_date date := coalesce(nullif(p_receipt->>'business_date', '')::date, v_today);
  v_payment text := coalesce(nullif(p_receipt->>'payment_method', ''), 'cash');
  v_total numeric(14,2);
  v_quantity numeric(14,3);
  v_paid numeric(14,2);
  v_change numeric(14,2);
  v_sequence integer;
  v_code text;
  v_seller_id uuid;
  v_seller_name text;
  v_stock_rows integer := 0;
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
  if v_payment not in ('cash', 'qr', 'card') then raise exception 'Phương thức thanh toán không hợp lệ.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Hóa đơn chưa có sản phẩm.';
  end if;

  select coalesce(sum((line->>'quantity')::numeric), 0),
         coalesce(sum((line->>'quantity')::numeric * (line->>'unit_price')::numeric), 0)
  into v_quantity, v_total
  from jsonb_array_elements(p_lines) line;

  if v_quantity <= 0 or v_total < 0 then raise exception 'Số lượng hoặc tổng tiền hóa đơn không hợp lệ.'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) line
    where (line->>'quantity')::numeric <= 0
       or (line->>'unit_price')::numeric < 0
       or abs((line->>'line_total')::numeric - ((line->>'quantity')::numeric * (line->>'unit_price')::numeric)) > 0.01
  ) then raise exception 'Chi tiết hóa đơn không khớp số lượng và đơn giá.'; end if;

  v_paid := coalesce(nullif(p_receipt->>'customer_paid', '')::numeric, v_total);
  if v_payment = 'cash' and v_paid < v_total then raise exception 'Số tiền khách đưa chưa đủ.'; end if;
  if v_payment <> 'cash' then v_paid := v_total; end if;
  v_change := greatest(v_paid - v_total, 0);

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

  insert into public.sales_receipts (
    id, code, branch_id, business_date, seller_id, seller_name, payment_method,
    total_quantity, total_amount, customer_paid, change_amount, created_by
  ) values (
    v_id, v_code, v_branch, v_date, v_seller_id, v_seller_name, v_payment,
    v_quantity, v_total, v_paid, v_change, actor.id
  );

  insert into public.sales_receipt_items (
    receipt_id, allocation_id, product_id, product_name, quantity, unit_price, line_total
  )
  select v_id,
         nullif(line->>'allocation_id', '')::uuid,
         line->>'product_id',
         line->>'product_name',
         (line->>'quantity')::numeric,
         (line->>'unit_price')::numeric,
         (line->>'line_total')::numeric
  from jsonb_array_elements(p_lines) line;

  -- Trừ kho ngay trong transaction bán hàng: hóa đơn và phiếu xuất luôn đi cùng nhau.
  v_stock_rows := public.post_pos_receipt_stock(v_id);

  return jsonb_build_object(
    'id', v_id, 'code', v_code, 'customer_paid', v_paid,
    'change_amount', v_change, 'created_at', now(),
    'stock_rows', v_stock_rows
  );
end;
$$;

revoke all on function public.create_cashier_pos_receipt(jsonb, jsonb) from public;
grant execute on function public.create_cashier_pos_receipt(jsonb, jsonb) to authenticated;

-- Xóa hóa đơn phải trả lại kho đúng phần đã trừ, nếu không mỗi lần bấm nhầm rồi
-- xóa là kho mất hàng vĩnh viễn.
create or replace function public.delete_pos_receipt(p_receipt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt public.sales_receipts;
begin
  select * into v_receipt
  from public.sales_receipts
  where id = p_receipt_id;

  if not found then
    raise exception 'Không tìm thấy hóa đơn.';
  end if;

  if not (
    public.can_manage_branch(v_receipt.branch_id)
    or (
      (v_receipt.created_by = auth.uid() or v_receipt.seller_id = auth.uid())
      and v_receipt.business_date = timezone('Asia/Bangkok', now())::date
    )
  ) then
    raise exception 'Bạn không có quyền xóa hóa đơn này.';
  end if;

  delete from public.stock_movements
  where document_id = p_receipt_id
    and movement_type = 'sale_out';

  delete from public.sales_receipt_items where receipt_id = p_receipt_id;
  delete from public.sales_receipts where id = p_receipt_id;
end;
$$;

grant execute on function public.delete_pos_receipt(uuid) to authenticated;

notify pgrst, 'reload schema';
