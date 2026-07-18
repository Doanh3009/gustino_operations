begin transaction read only;

select jsonb_build_object(
  'auth_users', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'auth_without_profile', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at
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

select jsonb_build_object(
  'cake_rows', (
    select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at), '[]'::jsonb)
    from (
      select id, sku, name, unit, category, active, source, deleted_at, created_at, updated_at, recipe
      from public.products
      where lower(coalesce(name, '')) like '%bánh%hạt%dẻ%'
         or upper(coalesce(sku, '')) like '%BANH%'
         or id in ('cake-raw', 'cake-ready', 'cake-box')
    ) p
  ),
  'cake_movements', (
    select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc), '[]'::jsonb)
    from (
      select id, branch_id, product_id, movement_type, quantity, shift_date, source_product_id, source_quantity, created_at
      from public.stock_movements
      where product_id in ('cake-raw', 'cake-ready', 'cake-box')
         or source_product_id in ('cake-raw', 'cake-ready', 'cake-box')
      order by created_at desc
      limit 100
    ) m
  )
) as cake_product_audit;

select jsonb_build_object(
  'open_attendance_records', (
    select count(*) from public.attendance_records where check_out_time is null
  ),
  'open_older_than_18h', (
    select count(*) from public.attendance_records
    where check_out_time is null and check_in_time < now() - interval '18 hours'
  ),
  'duplicate_registration_records', (
    select count(*) from (
      select shift_registration_id
      from public.attendance_records
      group by shift_registration_id
      having count(*) > 1
    ) duplicates
  ),
  'checkout_evidence_gaps', (
    select count(*) from public.attendance_records
    where check_out_time is not null
      and (
        check_out_selfie_url is null
        or check_out_latitude is null
        or check_out_longitude is null
        or check_out_accuracy is null
        or nullif(trim(check_out_address), '') is null
      )
  ),
  'recent_open_rows', (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.check_in_time desc), '[]'::jsonb)
    from (
      select id, user_id, branch_id, shift_registration_id, check_in_time, updated_at
      from public.attendance_records
      where check_out_time is null
      order by check_in_time desc
      limit 30
    ) r
  )
) as attendance_integrity_audit;

rollback;
