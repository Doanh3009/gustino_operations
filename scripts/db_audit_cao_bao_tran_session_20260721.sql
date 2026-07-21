begin transaction read only;

select jsonb_pretty(jsonb_build_object(
  'profiles_policies', coalesce((
    select jsonb_agg(jsonb_build_object('name', p.policyname, 'cmd', p.cmd, 'using', p.qual, 'check', p.with_check))
    from pg_policies p where p.schemaname = 'public' and p.tablename = 'profiles'), '[]'::jsonb),
  'current_profile_fn', (select pg_get_functiondef(p.oid) from pg_proc p
                         join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname = 'current_profile' limit 1),
  'sessions', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'created_at', s.created_at, 'updated_at', s.updated_at,
                                        'not_after', s.not_after, 'user_agent', s.user_agent) order by s.updated_at desc)
    from auth.sessions s where s.user_id = '24efd4c4-53c3-4a74-a2fd-d9d21942ad23'), '[]'::jsonb),
  'refresh_tokens', coalesce((
    select jsonb_agg(jsonb_build_object('created_at', t.created_at, 'updated_at', t.updated_at, 'revoked', t.revoked)
                     order by t.updated_at desc)
    from auth.refresh_tokens t where t.user_id = '24efd4c4-53c3-4a74-a2fd-d9d21942ad23'), '[]'::jsonb),
  'profile_row', (select to_jsonb(p) from public.profiles p where p.id = '24efd4c4-53c3-4a74-a2fd-d9d21942ad23'),
  'schedule_people_link', coalesce((
    select jsonb_agg(to_jsonb(sp)) from public.schedule_people sp
    where sp.full_name ilike '%Trân%'), '[]'::jsonb)
)) as session_audit;

rollback;
