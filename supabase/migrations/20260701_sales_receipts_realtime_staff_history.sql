-- Keep POS sales visible in real time and scope staff history to their own receipts.

drop policy if exists "branch users read sales receipts" on public.sales_receipts;
create policy "branch users read sales receipts" on public.sales_receipts
for select to authenticated using (
  (
    (public.current_profile()).role in ('admin', 'manager', 'shift_leader')
    and (
      branch_id = (public.current_profile()).branch_id
      or public.can_manage_branch(branch_id)
    )
  )
  or seller_id = auth.uid()
  or created_by = auth.uid()
);

drop policy if exists "branch users read sales receipt items" on public.sales_receipt_items;
create policy "branch users read sales receipt items" on public.sales_receipt_items
for select to authenticated using (
  exists (
    select 1 from public.sales_receipts r
    where r.id = receipt_id
      and (
        (
          (public.current_profile()).role in ('admin', 'manager', 'shift_leader')
          and (
            r.branch_id = (public.current_profile()).branch_id
            or public.can_manage_branch(r.branch_id)
          )
        )
        or r.seller_id = auth.uid()
        or r.created_by = auth.uid()
      )
  )
);

do $$
begin
  alter publication supabase_realtime add table public.sales_receipt_items;
exception
  when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
