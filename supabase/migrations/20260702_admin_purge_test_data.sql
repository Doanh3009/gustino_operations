-- Admin-only purge of test/business data for one branch in a date range.
-- Used by Control Center ("Dọn dữ liệu test"). Returns per-table deleted counts.

create or replace function public.admin_purge_business_data(
  p_branch_id text,
  p_from date,
  p_to date,
  p_targets jsonb default '["sales","ledger","stock","reports","attendance","kpi"]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  targets text[];
  deleted_counts jsonb := '{}'::jsonb;
  affected bigint;
begin
  select * into actor from public.current_profile();
  if actor.role <> 'admin' then
    raise exception 'Chỉ admin mới được xóa dữ liệu.';
  end if;
  if p_branch_id is null or trim(p_branch_id) = '' then
    raise exception 'Thiếu chi nhánh cần dọn dữ liệu.';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Khoảng ngày không hợp lệ.';
  end if;

  if p_to >= current_date then
    raise exception 'Safety stop: khong duoc xoa du lieu ngay hom nay (%).', current_date;
  end if;

  targets := array(select jsonb_array_elements_text(coalesce(p_targets, '[]'::jsonb)));

  if 'sales' = any(targets) then
    delete from public.sales_receipts
    where branch_id = p_branch_id
      and business_date between p_from and p_to;
    get diagnostics affected = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('sales_receipts', affected);
  end if;

  if 'ledger' = any(targets) then
    -- Receipt items keep a soft link to allocations; detach before deleting.
    update public.sales_receipt_items items
    set allocation_id = null
    where items.allocation_id in (
      select allocation.id
      from public.bag_allocations allocation
      join public.bag_shift_sessions session on session.id = allocation.shift_id
      where session.branch_id = p_branch_id
        and session.business_date between p_from and p_to
    );

    delete from public.bag_allocations allocation
    using public.bag_shift_sessions session
    where session.id = allocation.shift_id
      and session.branch_id = p_branch_id
      and session.business_date between p_from and p_to;
    get diagnostics affected = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('bag_allocations', affected);

    update public.bag_allocations allocation
    set settlement_shift_id = null
    where allocation.settlement_shift_id in (
      select id from public.bag_shift_sessions
      where branch_id = p_branch_id and business_date between p_from and p_to
    );

    delete from public.bag_shift_sessions
    where branch_id = p_branch_id
      and business_date between p_from and p_to;
    get diagnostics affected = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('bag_shift_sessions', affected);
  end if;

  if 'stock' = any(targets) then
    delete from public.stock_movements
    where branch_id = p_branch_id
      and shift_date between p_from and p_to;
    get diagnostics affected = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('stock_movements', affected);
  end if;

  if 'reports' = any(targets) then
    delete from public.report_snapshots
    where branch_id = p_branch_id
      and report_date between p_from and p_to;
    get diagnostics affected = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('report_snapshots', affected);

    delete from public.inventory_reports
    where branch_id = p_branch_id
      and report_date between p_from and p_to;
    get diagnostics affected = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('inventory_reports', affected);

    delete from public.operation_days
    where branch_id = p_branch_id
      and business_date between p_from and p_to;
    get diagnostics affected = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('operation_days', affected);
  end if;

  if 'requests' = any(targets) then
    delete from public.supply_requests
    where branch_id = p_branch_id
      and created_at::date between p_from and p_to;
    get diagnostics affected = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('supply_requests', affected);
  end if;

  if 'attendance' = any(targets) then
    delete from public.attendance_records record
    using public.shift_registrations registration
    where registration.id = record.shift_registration_id
      and registration.branch_id = p_branch_id
      and registration.work_date between p_from and p_to;
    get diagnostics affected = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('attendance_records', affected);

    delete from public.shift_registrations
    where branch_id = p_branch_id
      and work_date between p_from and p_to;
    get diagnostics affected = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('shift_registrations', affected);
  end if;

  if 'kpi' = any(targets) then
    if to_regclass('public.payroll_bonus_ledger') is not null then
      execute 'delete from public.payroll_bonus_ledger where branch_id = $1 and coalesce(bonus_date, created_at::date) between $2 and $3'
      using p_branch_id, p_from, p_to;
      get diagnostics affected = row_count;
      deleted_counts := deleted_counts || jsonb_build_object('payroll_bonus_ledger', affected);
    end if;

    if to_regclass('public.payroll_kpi_metrics') is not null then
      execute 'delete from public.payroll_kpi_metrics where branch_id = $1 and metric_date between $2 and $3'
      using p_branch_id, p_from, p_to;
      get diagnostics affected = row_count;
      deleted_counts := deleted_counts || jsonb_build_object('payroll_kpi_metrics', affected);
    end if;

    if to_regclass('public.payroll_entries') is not null then
      execute 'delete from public.payroll_entries where branch_id = $1 and period between to_char($2::date, ''YYYY-MM'') and to_char($3::date, ''YYYY-MM'')'
      using p_branch_id, p_from, p_to;
      get diagnostics affected = row_count;
      deleted_counts := deleted_counts || jsonb_build_object('payroll_entries', affected);
    end if;

    if to_regclass('public.employee_kpi_targets') is not null then
      execute 'delete from public.employee_kpi_targets where branch_id = $1 and updated_at::date between $2 and $3'
      using p_branch_id, p_from, p_to;
      get diagnostics affected = row_count;
      deleted_counts := deleted_counts || jsonb_build_object('employee_kpi_targets', affected);
    end if;
  end if;

  if 'history' = any(targets) then
    delete from public.stock_movements
    where branch_id = p_branch_id
      and shift_date between p_from and p_to;
    get diagnostics affected = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('history_stock_movements', affected);

    delete from public.report_snapshots
    where branch_id = p_branch_id
      and report_date between p_from and p_to;
    get diagnostics affected = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('history_report_snapshots', affected);
  end if;

  return deleted_counts;
end;
$$;

grant execute on function public.admin_purge_business_data(text, date, date, jsonb) to authenticated;

notify pgrst, 'reload schema';
