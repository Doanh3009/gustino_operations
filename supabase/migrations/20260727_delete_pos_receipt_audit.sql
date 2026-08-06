-- ============================================================================
-- 20260727 — XÓA HÓA ĐƠN POS PHẢI ĐỂ LẠI DẤU VẾT (không mất lịch sử)
--
-- delete_pos_receipt hoàn kho bằng cách gỡ đúng nhóm phiếu sale_out của hóa đơn
-- (document_id = id hóa đơn) — hoàn đúng MỘT lần, không hoàn trùng. Nhưng trước
-- bản này, toàn bộ hóa đơn + items + phiếu kho biến mất không dấu vết.
--
-- Bản này: TRƯỚC khi xóa, chụp snapshot đầy đủ (hóa đơn + items + phiếu kho đã
-- trừ) vào public.control_audit_entries (module 'pos', action 'delete_receipt').
-- Doanh thu/tồn kho hành xử y như cũ; chỉ thêm lịch sử để đối soát.
--
-- ROLLBACK: chạy lại đoạn delete_pos_receipt trong
-- 20260724_pos_sale_deducts_stock.sql (bản không ghi audit).
-- ============================================================================

create or replace function public.delete_pos_receipt(p_receipt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt public.sales_receipts;
  v_actor_name text;
  v_snapshot jsonb;
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

  select coalesce(full_name, 'Không rõ') into v_actor_name
  from public.profiles where id = auth.uid();

  v_snapshot := jsonb_build_object(
    'receipt', to_jsonb(v_receipt),
    'items', coalesce((
      select jsonb_agg(to_jsonb(item))
      from public.sales_receipt_items item
      where item.receipt_id = p_receipt_id
    ), '[]'::jsonb),
    'stock_movements', coalesce((
      select jsonb_agg(to_jsonb(movement))
      from public.stock_movements movement
      where movement.document_id = p_receipt_id and movement.movement_type = 'sale_out'
    ), '[]'::jsonb)
  );

  insert into public.control_audit_entries (id, actor_id, actor_name, module, action, detail, before_value, after_value)
  values (
    gen_random_uuid(),
    auth.uid(),
    coalesce(v_actor_name, 'Không rõ'),
    'pos',
    'delete_receipt',
    'Xóa hóa đơn ' || v_receipt.code || ' (' || v_receipt.branch_id || ' ' || v_receipt.business_date || ', '
      || v_receipt.total_amount || 'đ). Kho được hoàn đúng phần đã trừ.',
    v_snapshot::text,
    null
  );

  delete from public.stock_movements
  where document_id = p_receipt_id
    and movement_type = 'sale_out';

  delete from public.sales_receipt_items where receipt_id = p_receipt_id;
  delete from public.sales_receipts where id = p_receipt_id;
end;
$$;

grant execute on function public.delete_pos_receipt(uuid) to authenticated;

notify pgrst, 'reload schema';
