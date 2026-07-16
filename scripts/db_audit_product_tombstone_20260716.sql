begin transaction read only;

select jsonb_pretty(jsonb_build_object(
  'products_exists', to_regclass('public.products') is not null,
  'deleted_at_column', exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'deleted_at'
  ),
  'products_rls', (
    select relrowsecurity
    from pg_class
    where oid = 'public.products'::regclass
  ),
  'product_policy_count', (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'products'
  ),
  'products_realtime', exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'products'
  ),
  'product_rows', (select count(*) from public.products),
  'deleted_product_rows', (
    select count(*)
    from public.products
    where deleted_at is not null
  ),
  'inactive_product_rows', (
    select count(*)
    from public.products
    where active is false
  )
)) as product_tombstone_audit;

rollback;
