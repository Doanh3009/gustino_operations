alter type public.app_role add value if not exists 'cashier';

alter table public.sales_receipts
  add column if not exists customer_paid numeric(14,2),
  add column if not exists change_amount numeric(14,2) not null default 0 check (change_amount >= 0);

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

  return jsonb_build_object(
    'id', v_id, 'code', v_code, 'customer_paid', v_paid,
    'change_amount', v_change, 'created_at', now()
  );
end;
$$;

revoke all on function public.create_cashier_pos_receipt(jsonb, jsonb) from public;
grant execute on function public.create_cashier_pos_receipt(jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
