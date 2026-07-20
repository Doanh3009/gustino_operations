begin transaction read only;

select jsonb_build_object(
  'cashier_role', exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'app_role' and e.enumlabel = 'cashier'
  ),
  'receipt_columns', (
    select jsonb_agg(column_name order by column_name)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_receipts'
      and column_name in ('customer_paid', 'change_amount')
  ),
  'rpc_security_definer', (
    select p.prosecdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_cashier_pos_receipt'
    limit 1
  ),
  'authenticated_execute', (
    select has_function_privilege('authenticated', p.oid, 'execute')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_cashier_pos_receipt'
    limit 1
  )
) as cashier_pos_catalog;

rollback;
