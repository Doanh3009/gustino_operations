begin transaction read only;

select jsonb_pretty(jsonb_build_object(
  'auth_user', (
    select jsonb_build_object('id', u.id, 'email', u.email, 'confirmed_at', u.email_confirmed_at,
                              'last_sign_in_at', u.last_sign_in_at, 'banned_until', u.banned_until)
    from auth.users u where u.id = '24efd4c4-53c3-4a74-a2fd-d9d21942ad23'),
  'auth_by_email', coalesce((
    select jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'last_sign_in_at', u.last_sign_in_at))
    from auth.users u where u.email = 'baotran@accounts.gustino.vn'), '[]'::jsonb),
  'branch', (select to_jsonb(b) from public.branches b where b.id = 'gold-coast'),
  'shifts_gold_coast', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'start', s.start_time, 'end', s.end_time,
                                        'active', s.active, 'employment_types', s.employment_types) order by s.start_time)
    from public.shifts s where s.branch_id = 'gold-coast'), '[]'::jsonb),
  'registrations', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'branch', r.branch_id, 'work_date', r.work_date,
                                        'start', r.start_time, 'end', r.end_time, 'status', r.status,
                                        'shift_id', r.shift_id, 'created_at', r.created_at)
                     order by r.work_date desc, r.start_time)
    from public.shift_registrations r
    where r.user_id = '24efd4c4-53c3-4a74-a2fd-d9d21942ad23'
      and r.work_date >= current_date - 21), '[]'::jsonb),
  'records', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'registration_id', a.shift_registration_id, 'branch', a.branch_id,
                                        'check_in_local', a.check_in_time at time zone 'Asia/Bangkok',
                                        'check_out_local', a.check_out_time at time zone 'Asia/Bangkok')
                     order by a.check_in_time desc)
    from public.attendance_records a
    where a.user_id = '24efd4c4-53c3-4a74-a2fd-d9d21942ad23'
      and a.check_in_time >= current_date - 21), '[]'::jsonb)
)) as cao_bao_tran_audit;

rollback;
