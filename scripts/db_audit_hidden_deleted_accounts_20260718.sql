begin transaction read only;

select jsonb_pretty(jsonb_build_object(
  'auth_users', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'auth_without_profile', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at
    ) order by u.created_at)
    from auth.users u
    left join public.profiles p on p.id = u.id
    where p.id is null
  ), '[]'::jsonb),
  'profiles_without_auth', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'email', p.email, 'name', p.full_name, 'active', p.active
    ) order by p.created_at)
    from public.profiles p
    left join auth.users u on u.id = p.id
    where u.id is null
  ), '[]'::jsonb),
  'hidden_inactive_profiles', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'email', p.email, 'name', p.full_name, 'active', p.active, 'auth_email', u.email
    ) order by p.created_at)
    from public.profiles p
    left join auth.users u on u.id = p.id
    where p.active = false
  ), '[]'::jsonb),
  'tombstoned_auth_users', coalesce((
    select jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at) order by u.created_at)
    from auth.users u
    where lower(coalesce(u.email, '')) like 'deleted-%@accounts.invalid'
  ), '[]'::jsonb),
  'auth_identities_without_user', coalesce((
    select jsonb_agg(jsonb_build_object(
      'identity_id', i.id, 'user_id', i.user_id, 'provider', i.provider,
      'identity_data_email', i.identity_data ->> 'email'
    ))
    from auth.identities i
    left join auth.users u on u.id = i.user_id
    where u.id is null
  ), '[]'::jsonb)
)) as hidden_deleted_account_audit;

rollback;
