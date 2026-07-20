begin transaction read only;

select
  (
    select jsonb_agg(jsonb_build_object(
      'table', table_name,
      'column', column_name,
      'type', data_type
    ) order by table_name, column_name)
    from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'profiles' and column_name in (
          'employment_status',
          'employment_start_date',
          'probation_end_date',
          'employment_end_date',
          'employment_note'
        ))
        or
        (table_name = 'branches' and column_name in ('address', 'manager_name'))
      )
  ) as crm_columns,
  (
    select jsonb_agg(jsonb_build_object(
      'function', p.proname,
      'security_definer', p.prosecdef,
      'authenticated_can_execute', has_function_privilege('authenticated', p.oid, 'execute')
    ) order by p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_update_employee_crm', 'admin_upsert_crm_branch')
  ) as crm_functions;

rollback;
