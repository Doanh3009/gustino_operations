select current_database() as database_name;
select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name in ('payroll_entries','payroll_fixed','payroll_role_defaults') order by table_name, ordinal_position;
select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname='public' and tablename in ('payroll_entries','payroll_fixed','payroll_role_defaults');
select conname, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.payroll_entries'::regclass;
select count(*) as payroll_entries_count from public.payroll_entries;
