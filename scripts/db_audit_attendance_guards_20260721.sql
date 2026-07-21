begin transaction read only;

select jsonb_pretty(jsonb_build_object(
  'policies', coalesce((
    select jsonb_agg(jsonb_build_object('table', p.tablename, 'name', p.policyname, 'cmd', p.cmd,
                                        'roles', p.roles, 'using', p.qual, 'check', p.with_check))
    from pg_policies p
    where p.schemaname = 'public' and p.tablename in ('attendance_records', 'shift_registrations')), '[]'::jsonb),
  'storage_policies', coalesce((
    select jsonb_agg(jsonb_build_object('name', p.policyname, 'cmd', p.cmd, 'using', p.qual, 'check', p.with_check))
    from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects'
      and (p.qual ilike '%attendance%' or p.with_check ilike '%attendance%')), '[]'::jsonb),
  'buckets', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'public', b.public)) from storage.buckets b), '[]'::jsonb),
  'constraints', coalesce((
    select jsonb_agg(jsonb_build_object('name', c.conname, 'type', c.contype, 'def', pg_get_constraintdef(c.oid)))
    from pg_constraint c where c.conrelid = 'public.attendance_records'::regclass), '[]'::jsonb),
  'indexes', coalesce((
    select jsonb_agg(i.indexdef) from pg_indexes i
    where i.schemaname = 'public' and i.tablename = 'attendance_records'), '[]'::jsonb),
  'triggers', coalesce((
    select jsonb_agg(jsonb_build_object('name', t.tgname, 'def', pg_get_triggerdef(t.oid)))
    from pg_trigger t where t.tgrelid = 'public.attendance_records'::regclass and not t.tgisinternal), '[]'::jsonb)
)) as attendance_guards;

rollback;
