-- Keep POS deletion aligned with the application's UTC+7 business date.
-- Permissions and the same-day-only rule are unchanged.

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

  delete from public.sales_receipt_items where receipt_id = p_receipt_id;
  delete from public.sales_receipts where id = p_receipt_id;
end;
$$;

grant execute on function public.delete_pos_receipt(uuid) to authenticated;
