begin transaction read only;

with public_functions as (
  select procedure.proname, pg_get_functiondef(procedure.oid) as definition
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
), stock_columns as (
  select column_name, numeric_precision, numeric_scale
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'stock_movements'
    and column_name in ('quantity', 'source_quantity', 'measured_weight_kg')
)
select jsonb_pretty(jsonb_build_object(
  'schedule_edit_function', exists (select 1 from public_functions where proname = 'set_schedule_entry'),
  'delete_pos_receipt_function', exists (select 1 from public_functions where proname = 'delete_pos_receipt'),
  'stock_quantity_columns_4_decimals', (
    select count(*) = 3 and bool_and(numeric_precision = 14 and numeric_scale = 4)
    from stock_columns
  ),
  'attendance_adjustment_table', to_regclass('public.attendance_adjustment_requests') is not null,
  'active_user_sessions_table', to_regclass('public.active_user_sessions') is not null,
  'attendance_supplement_function', exists (select 1 from public_functions where proname = 'admin_add_attendance_supplement'),
  'attendance_supplement_future_guard', exists (
    select 1 from public_functions
    where proname = 'admin_add_attendance_supplement'
      and position('if v_check_out > now()' in lower(definition)) > 0
  ),
  'active_session_owner_policy', exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'active_user_sessions'
      and policyname = 'admin or owner reads active sessions'
  ),
  'admin_attendance_correction_function', exists (select 1 from public_functions where proname = 'admin_update_attendance_record'),
  'product_deleted_at_column', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'deleted_at'
  )
)) as latest_migration_runtime_audit;

rollback;
