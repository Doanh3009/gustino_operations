-- Phiếu lương theo nhân viên/tháng. Các cột nullable để phân biệt giá trị đã nhập
-- với giá trị lấy tự động từ cấu hình lương, chấm công hoặc KPI.
alter table public.payroll_entries
  add column if not exists base_salary numeric,
  add column if not exists responsibility_allowance numeric,
  add column if not exists attendance_allowance numeric,
  add column if not exists meal_transport_allowance numeric,
  add column if not exists agreed_salary numeric,
  add column if not exists daily_rate numeric,
  add column if not exists workday_salary numeric,
  add column if not exists overtime_hours numeric,
  add column if not exists kpi_bonus numeric,
  add column if not exists net_salary numeric,
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references public.profiles(id),
  add column if not exists employee_viewed_at timestamptz;

-- Yêu cầu nghiệp vụ trực tiếp: Phiếu lương chỉ dành cho Admin. Chặn cả ở RLS,
-- không chỉ ẩn nút trên giao diện.
drop policy if exists "managers manage payroll entries" on public.payroll_entries;
drop policy if exists "admin manages payroll entries" on public.payroll_entries;
create policy "admin manages payroll entries" on public.payroll_entries
  for all to authenticated
  using ((select (public.current_profile()).role) = 'admin'::public.app_role)
  with check ((select (public.current_profile()).role) = 'admin'::public.app_role);

drop policy if exists "employee reads own published payslips" on public.payroll_entries;
create policy "employee reads own published payslips" on public.payroll_entries
  for select to authenticated
  using (employee_id = auth.uid() and published_at is not null);

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

drop policy if exists "managers manage payroll role defaults" on public.payroll_role_defaults;
drop policy if exists "admin manages payroll role defaults" on public.payroll_role_defaults;
create policy "admin manages payroll role defaults" on public.payroll_role_defaults
  for all to authenticated
  using ((select (public.current_profile()).role) = 'admin'::public.app_role)
  with check ((select (public.current_profile()).role) = 'admin'::public.app_role);

drop policy if exists "managers manage payroll fixed" on public.payroll_fixed;
drop policy if exists "admin manages payroll fixed" on public.payroll_fixed;
create policy "admin manages payroll fixed" on public.payroll_fixed
  for all to authenticated
  using ((select (public.current_profile()).role) = 'admin'::public.app_role)
  with check ((select (public.current_profile()).role) = 'admin'::public.app_role);

notify pgrst, 'reload schema';
