begin transaction read only;

select jsonb_build_object(
  'auth_users', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'inactive_profiles_with_login', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'email', p.email,
      'name', p.full_name,
      'active', p.active
    ) order by p.created_at), '[]'::jsonb)
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.active = false
  ),
  'auth_without_profile', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'banned_until', u.banned_until
    ) order by u.created_at), '[]'::jsonb)
    from auth.users u
    left join public.profiles p on p.id = u.id
    where p.id is null
  ),
  'profiles_without_auth', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'email', p.email,
      'name', p.full_name,
      'active', p.active
    ) order by p.created_at), '[]'::jsonb)
    from public.profiles p
    left join auth.users u on u.id = p.id
    where u.id is null
  )
) as account_sync_audit;

rollback;
