-- Launch cleanup: remove operational/test data while preserving master data.
-- Preserved on purpose: profiles/accounts, branches, products/SKU/menu, payroll defaults.
--
-- Usage in Supabase SQL editor:
-- 1. Review v_from/v_to. The default removes historical operational data up to yesterday.
--    Safety rule: do not delete today's data.
-- 2. Keep v_delete_schedule_plan = false if tomorrow's real roster is already prepared.
-- 3. Run as an admin/service session, then refresh the app.

do $$
declare
  v_from date := null;
  v_to date := current_date - 1;
  v_delete_schedule_plan boolean := false;
  v_counts jsonb := '{}'::jsonb;
  v_affected bigint;
begin
  if v_to >= current_date then
    raise exception 'Safety stop: this cleanup must not delete today (%)', current_date;
  end if;

  if to_regclass('public.sales_receipt_items') is not null and to_regclass('public.sales_receipts') is not null then
    delete from public.sales_receipt_items item
    using public.sales_receipts receipt
    where receipt.id = item.receipt_id
      and (v_from is null or receipt.business_date >= v_from)
      and (v_to is null or receipt.business_date <= v_to);
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('sales_receipt_items', v_affected);
  end if;

  if to_regclass('public.sales_receipts') is not null then
    delete from public.sales_receipts
    where (v_from is null or business_date >= v_from)
      and (v_to is null or business_date <= v_to);
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('sales_receipts', v_affected);
  end if;

  if to_regclass('public.bag_allocations') is not null and to_regclass('public.bag_shift_sessions') is not null then
    update public.bag_allocations allocation
    set settlement_shift_id = null
    where settlement_shift_id in (
      select id from public.bag_shift_sessions
      where (v_from is null or business_date >= v_from)
        and (v_to is null or business_date <= v_to)
    );

    delete from public.bag_allocations allocation
    using public.bag_shift_sessions session
    where session.id = allocation.shift_id
      and (v_from is null or session.business_date >= v_from)
      and (v_to is null or session.business_date <= v_to);
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('bag_allocations', v_affected);
  end if;

  if to_regclass('public.bag_shift_sessions') is not null then
    delete from public.bag_shift_sessions
    where (v_from is null or business_date >= v_from)
      and (v_to is null or business_date <= v_to);
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('bag_shift_sessions', v_affected);
  end if;

  if to_regclass('public.stock_movements') is not null then
    delete from public.stock_movements
    where (v_from is null or shift_date >= v_from)
      and (v_to is null or shift_date <= v_to);
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('stock_movements', v_affected);
  end if;

  if to_regclass('public.inventory_reports') is not null then
    delete from public.inventory_reports
    where (v_from is null or report_date >= v_from)
      and (v_to is null or report_date <= v_to);
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('inventory_reports', v_affected);
  end if;

  if to_regclass('public.report_snapshots') is not null then
    delete from public.report_snapshots
    where (v_from is null or report_date >= v_from)
      and (v_to is null or report_date <= v_to);
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('report_snapshots', v_affected);
  end if;

  if to_regclass('public.operation_days') is not null then
    delete from public.operation_days
    where (v_from is null or business_date >= v_from)
      and (v_to is null or business_date <= v_to);
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('operation_days', v_affected);
  end if;

  if to_regclass('public.supply_requests') is not null then
    delete from public.supply_requests
    where (v_from is null or created_at::date >= v_from)
      and (v_to is null or created_at::date <= v_to);
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('supply_requests', v_affected);
  end if;

  if to_regclass('public.attendance_records') is not null then
    delete from public.attendance_records
    where (v_from is null or check_in_time::date >= v_from)
      and (v_to is null or check_in_time::date <= v_to);
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('attendance_records', v_affected);
  end if;

  if to_regclass('public.shift_registrations') is not null then
    delete from public.shift_registrations
    where (v_from is null or work_date >= v_from)
      and (v_to is null or work_date <= v_to);
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('shift_registrations', v_affected);
  end if;

  if v_delete_schedule_plan and to_regclass('public.schedule_entries') is not null then
    delete from public.schedule_entries
    where (v_from is null or work_date >= v_from)
      and (v_to is null or work_date <= v_to);
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('schedule_entries', v_affected);
  end if;

  if to_regclass('public.payroll_bonus_ledger') is not null then
    delete from public.payroll_bonus_ledger
    where (v_from is null or coalesce(bonus_date, created_at::date) >= v_from)
      and (v_to is null or coalesce(bonus_date, created_at::date) <= v_to);
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('payroll_bonus_ledger', v_affected);
  end if;

  if to_regclass('public.payroll_kpi_metrics') is not null then
    delete from public.payroll_kpi_metrics
    where (v_from is null or metric_date >= v_from)
      and (v_to is null or metric_date <= v_to);
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('payroll_kpi_metrics', v_affected);
  end if;

  if to_regclass('public.payroll_entries') is not null then
    delete from public.payroll_entries
    where (v_from is null or period >= to_char(v_from, 'YYYY-MM'))
      and (v_to is null or period <= to_char(v_to, 'YYYY-MM'));
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('payroll_entries', v_affected);
  end if;

  if to_regclass('public.lotte_reconciliation_lines') is not null then
    delete from public.lotte_reconciliation_lines
    where (v_from is null or business_date >= v_from)
      and (v_to is null or business_date <= v_to);
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('lotte_reconciliation_lines', v_affected);
  end if;

  if to_regclass('public.control_audit_entries') is not null then
    delete from public.control_audit_entries
    where (v_from is null or created_at::date >= v_from)
      and (v_to is null or created_at::date <= v_to);
    get diagnostics v_affected = row_count;
    v_counts := v_counts || jsonb_build_object('control_audit_entries', v_affected);
  end if;

  raise notice 'launch cleanup deleted counts: %', v_counts;
end $$;
