begin transaction read only;

select jsonb_pretty(jsonb_build_object(
  'active_user_sessions_exists', to_regclass('public.active_user_sessions') is not null,
  'attendance_adjustment_requests_exists', to_regclass('public.attendance_adjustment_requests') is not null,
  'active_user_sessions_rls', (
    select relrowsecurity from pg_class where oid = 'public.active_user_sessions'::regclass
  ),
  'attendance_adjustment_requests_rls', (
    select relrowsecurity from pg_class where oid = 'public.attendance_adjustment_requests'::regclass
  ),
  'active_session_policy_count', (
    select count(*) from pg_policies where schemaname = 'public' and tablename = 'active_user_sessions'
  ),
  'adjustment_policy_count', (
    select count(*) from pg_policies where schemaname = 'public' and tablename = 'attendance_adjustment_requests'
  ),
  'active_session_rows', (select count(*) from public.active_user_sessions),
  'adjustment_rows', (select count(*) from public.attendance_adjustment_requests)
)) as presence_adjustment_schema_verification;

rollback;
