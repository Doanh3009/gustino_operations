-- Ensure the emergency system admin account exists in Supabase Auth.
-- Login in the app with username "admin" and password "123456".

do $$
declare
  v_admin_id uuid;
  v_email text := 'admin@accounts.gustino.vn';
  v_legacy_email text := 'admin@gustino.vn';
begin
  select id
  into v_admin_id
  from auth.users
  where lower(email) in (v_email, v_legacy_email)
  order by case when lower(email) = v_email then 0 else 1 end
  limit 1;

  if v_admin_id is null then
    v_admin_id := gen_random_uuid();

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      email_change_token_current,
      phone_change,
      phone_change_token,
      reauthentication_token,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      is_sso_user,
      is_anonymous
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      v_admin_id,
      'authenticated',
      'authenticated',
      v_email,
      crypt('123456', gen_salt('bf', 10)),
      now(),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'role', 'admin',
        'branch_id', 'gold-coast',
        'full_name', 'Admin hệ thống',
        'employment_type', 'leader',
        'position_title', 'Admin hệ thống'
      ),
      now(),
      now(),
      false,
      false
    );
  else
    update auth.users
    set
      aud = 'authenticated',
      role = 'authenticated',
      email = v_email,
      encrypted_password = crypt('123456', gen_salt('bf', 10)),
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      confirmation_token = '',
      recovery_token = '',
      email_change_token_new = '',
      email_change = '',
      email_change_token_current = '',
      phone_change = '',
      phone_change_token = '',
      reauthentication_token = '',
      raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
      raw_user_meta_data = jsonb_build_object(
        'role', 'admin',
        'branch_id', 'gold-coast',
        'full_name', 'Admin hệ thống',
        'employment_type', 'leader',
        'position_title', 'Admin hệ thống'
      ),
      updated_at = now(),
      is_sso_user = false,
      is_anonymous = false
    where id = v_admin_id;
  end if;

  insert into auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    v_admin_id::text,
    v_admin_id,
    jsonb_build_object(
      'sub', v_admin_id::text,
      'email', v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    now(),
    now(),
    now()
  )
  on conflict (provider_id, provider) do update
  set
    user_id = excluded.user_id,
    identity_data = excluded.identity_data,
    updated_at = now();

  insert into public.profiles (
    id,
    full_name,
    email,
    role,
    branch_id,
    active,
    employment_type,
    position_title
  )
  values (
    v_admin_id,
    'Admin hệ thống',
    v_email,
    'admin'::public.app_role,
    'gold-coast',
    true,
    'leader',
    'Admin hệ thống'
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    email = excluded.email,
    role = excluded.role,
    branch_id = excluded.branch_id,
    active = true,
    employment_type = excluded.employment_type,
    position_title = excluded.position_title;
end $$;
