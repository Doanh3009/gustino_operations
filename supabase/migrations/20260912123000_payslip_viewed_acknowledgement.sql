-- Installs the viewed acknowledgement when only additive payslip columns were applied.
-- Does not update existing rows, salary fields or RLS policies.
begin;
create or replace function public.mark_own_payslip_viewed(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payroll_entries
  set employee_viewed_at = coalesce(employee_viewed_at, now())
  where id = p_entry_id
    and employee_id = auth.uid()
    and published_at is not null;
  if not found then
    raise exception 'Phiếu lương không tồn tại hoặc không thuộc tài khoản hiện tại.';
  end if;
end;
$$;
revoke all on function public.mark_own_payslip_viewed(uuid) from public;
grant execute on function public.mark_own_payslip_viewed(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
