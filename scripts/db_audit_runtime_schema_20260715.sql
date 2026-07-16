begin transaction read only;

with required_tables(name) as (
  values
    ('active_user_sessions'),
    ('attendance_adjustment_requests'),
    ('attendance_records'),
    ('bag_allocations'),
    ('bag_shift_sessions'),
    ('branches'),
    ('commission_rules'),
    ('control_audit_entries'),
    ('control_permission_matrix'),
    ('employee_kpi_targets'),
    ('inventory_reports'),
    ('lotte_reconciliation_lines'),
    ('manager_branch_assignments'),
    ('operation_days'),
    ('payroll_bonus_ledger'),
    ('payroll_entries'),
    ('payroll_fixed'),
    ('payroll_kpi_metrics'),
    ('payroll_role_defaults'),
    ('products'),
    ('profiles'),
    ('report_snapshots'),
    ('sales_receipt_items'),
    ('sales_receipts'),
    ('schedule_entries'),
    ('schedule_people'),
    ('shift_registrations'),
    ('shifts'),
    ('stock_movements'),
    ('supply_requests')
),
required_functions(name) as (
  values
    ('add_manual_shift_registration'),
    ('add_shift_registration_safe'),
    ('admin_add_attendance_supplement'),
    ('admin_purge_business_data'),
    ('admin_update_profile_role'),
    ('archive_work_shift_safe'),
    ('close_bag_shift_safe'),
    ('create_stock_movements_checked'),
    ('create_work_shift_safe'),
    ('delete_pos_receipt'),
    ('finalize_daily_report'),
    ('list_schedule_people'),
    ('set_config_branch_active'),
    ('set_schedule_entry'),
    ('set_schedule_registration'),
    ('set_schedule_registration_safe'),
    ('upsert_config_branch')
),
table_status as (
  select name, to_regclass(format('public.%I', name)) is not null as present
  from required_tables
),
function_status as (
  select
    required.name,
    exists (
      select 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = required.name
    ) as present
  from required_functions required
)
select jsonb_pretty(jsonb_build_object(
  'missing_tables', coalesce((select jsonb_agg(name order by name) from table_status where not present), '[]'::jsonb),
  'missing_functions', coalesce((select jsonb_agg(name order by name) from function_status where not present), '[]'::jsonb),
  'table_count', (select count(*) from table_status),
  'function_count', (select count(*) from function_status)
)) as runtime_schema_audit;

rollback;
