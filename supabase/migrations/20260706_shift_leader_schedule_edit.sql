-- Allow shift leaders to edit the roster for everyone in their own branch.
-- Managers/admins keep their existing multi-branch permissions.

create or replace function public.set_schedule_entry(
  p_person_id uuid,
  p_branch_id text,
  p_work_date date,
  p_shift_id uuid default null
)
returns public.schedule_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  person public.schedule_people;
  selected_shift public.shifts;
  old_entry public.schedule_entries;
  result public.schedule_entries;
begin
  select * into actor from public.profiles where id = auth.uid() and active = true;
  if actor.id is null then raise exception 'Chua dang nhap'; end if;

  select * into person from public.schedule_people where id = p_person_id and active = true;
  if person.id is null or person.branch_id <> p_branch_id then raise exception 'Nhan su khong hop le'; end if;

  if not (
    person.profile_id = auth.uid()
    or (actor.role in ('manager', 'admin') and public.can_manage_branch(p_branch_id))
    or (actor.role = 'shift_leader' and actor.branch_id = p_branch_id)
  ) then
    raise exception 'Ban chi duoc chinh hang cua minh';
  end if;

  if actor.role not in ('shift_leader', 'manager', 'admin') and p_work_date < current_date then
    raise exception 'Khong the sua lich ngay da qua';
  end if;

  select * into old_entry
  from public.schedule_entries
  where person_id = p_person_id and work_date = p_work_date;

  delete from public.schedule_entries
  where person_id = p_person_id and work_date = p_work_date;

  if old_entry.id is not null and person.profile_id is not null then
    delete from public.shift_registrations sr
    where sr.user_id = person.profile_id
      and sr.branch_id = p_branch_id
      and sr.work_date = p_work_date
      and sr.shift_id = old_entry.shift_id
      and sr.start_time = old_entry.start_time
      and sr.end_time = old_entry.end_time
      and coalesce(sr.note, '') = ''
      and not exists (
        select 1
        from public.attendance_records ar
        where ar.shift_registration_id = sr.id
      );
  end if;

  if p_shift_id is null then return null; end if;

  select * into selected_shift
  from public.shifts
  where id = p_shift_id and branch_id = p_branch_id and active = true;
  if selected_shift.id is null then raise exception 'Ca lam khong hop le'; end if;

  insert into public.schedule_entries (
    person_id, branch_id, work_date, shift_id, start_time, end_time, updated_by
  ) values (
    person.id, p_branch_id, p_work_date, selected_shift.id,
    selected_shift.start_time, selected_shift.end_time, auth.uid()
  ) returning * into result;

  if person.profile_id is not null then
    insert into public.shift_registrations (
      user_id, branch_id, shift_id, work_date, start_time, end_time,
      status, note, employment_type, position_title
    ) values (
      person.profile_id, p_branch_id, selected_shift.id, p_work_date,
      selected_shift.start_time, selected_shift.end_time, 'approved', '',
      person.employment_type, person.position_title
    )
    on conflict (user_id, work_date, start_time, end_time) do update
    set branch_id = excluded.branch_id,
        shift_id = excluded.shift_id,
        status = 'approved',
        employment_type = coalesce(excluded.employment_type, public.shift_registrations.employment_type),
        position_title = coalesce(excluded.position_title, public.shift_registrations.position_title)
    where not exists (
      select 1
      from public.attendance_records ar
      where ar.shift_registration_id = public.shift_registrations.id
    );
  end if;

  return result;
end;
$$;

grant execute on function public.set_schedule_entry(uuid, text, date, uuid) to authenticated;

create or replace function public.add_manual_shift_registration(
  p_user_id uuid,
  p_branch_id text,
  p_work_date date,
  p_start_time time,
  p_end_time time,
  p_note text default ''
)
returns public.shift_registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  employee public.profiles;
  result public.shift_registrations;
begin
  select * into actor from public.profiles where id = auth.uid() and active = true;
  if actor.id is null then raise exception 'Chua dang nhap'; end if;

  select * into employee
  from public.profiles
  where id = p_user_id and active = true and branch_id = p_branch_id;
  if employee.id is null then raise exception 'Khong tim thay nhan vien'; end if;

  if not (
    p_user_id = auth.uid()
    or (actor.role in ('manager', 'admin') and public.can_manage_branch(p_branch_id))
    or (actor.role = 'shift_leader' and actor.branch_id = p_branch_id)
  ) then
    raise exception 'Khong co quyen them ca cho nhan vien nay';
  end if;

  if actor.role not in ('shift_leader', 'manager', 'admin') and p_work_date < current_date then
    raise exception 'Khong the them ca cho ngay da qua';
  end if;

  insert into public.shift_registrations (
    user_id, branch_id, shift_id, work_date, start_time, end_time,
    status, note, employment_type, position_title
  ) values (
    p_user_id, p_branch_id, null, p_work_date, p_start_time, p_end_time,
    'approved', coalesce(nullif(trim(p_note), ''), 'Ca tang ca'),
    employee.employment_type, employee.position_title
  ) returning * into result;

  return result;
end;
$$;

grant execute on function public.add_manual_shift_registration(uuid, text, date, time, time, text) to authenticated;

create or replace function public.set_schedule_registration_safe(
  p_user_id uuid,
  p_branch_id text,
  p_work_date date,
  p_shift_id uuid default null,
  p_start_time time default null,
  p_end_time time default null,
  p_note text default ''
)
returns public.shift_registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  employee public.profiles;
  selected_shift public.shifts;
  v_start time := p_start_time;
  v_end time := p_end_time;
  v_note text := coalesce(nullif(trim(p_note), ''), 'Ca tuy chinh');
  result public.shift_registrations;
begin
  select * into actor from public.profiles where id = auth.uid() and active = true;
  if actor.id is null then raise exception 'Chua dang nhap'; end if;

  if p_user_id <> auth.uid()
    and not (
      (actor.role in ('manager', 'admin') and public.can_manage_branch(p_branch_id))
      or (actor.role = 'shift_leader' and actor.branch_id = p_branch_id)
    ) then
    raise exception 'Ban chi duoc chinh lich cua chinh minh';
  end if;

  if actor.role not in ('shift_leader', 'manager', 'admin') and p_work_date < current_date then
    raise exception 'Nhan vien khong the sua lich cua ngay da qua';
  end if;

  if not (
    (p_user_id = auth.uid() and actor.branch_id = p_branch_id)
    or (actor.role in ('manager', 'admin') and public.can_manage_branch(p_branch_id))
    or (actor.role = 'shift_leader' and actor.branch_id = p_branch_id)
  ) then
    raise exception 'Khong co quyen tai chi nhanh nay';
  end if;

  select * into employee
  from public.profiles
  where id = p_user_id and active = true and branch_id = p_branch_id;
  if employee.id is null then raise exception 'Khong tim thay nhan vien'; end if;

  if p_shift_id is not null then
    select * into selected_shift
    from public.shifts
    where id = p_shift_id and branch_id = p_branch_id and active = true;
    if selected_shift.id is null then raise exception 'Ca lam khong hop le'; end if;
    v_start := selected_shift.start_time;
    v_end := selected_shift.end_time;
    v_note := '';
  end if;

  delete from public.shift_registrations sr
  where sr.user_id = p_user_id
    and sr.branch_id = p_branch_id
    and sr.work_date = p_work_date
    and not exists (
      select 1 from public.attendance_records ar
      where ar.shift_registration_id = sr.id
    )
    and (
      sr.shift_id is not null
      or (
        lower(coalesce(nullif(trim(sr.note), ''), '')) not like '%tang ca%'
        and lower(coalesce(nullif(trim(sr.note), ''), '')) not like '%tăng ca%'
        and lower(coalesce(nullif(trim(sr.note), ''), '')) not like '%bo sung%'
        and lower(coalesce(nullif(trim(sr.note), ''), '')) not like '%bổ sung%'
        and lower(coalesce(nullif(trim(sr.note), ''), '')) not like '%phat sinh%'
        and lower(coalesce(nullif(trim(sr.note), ''), '')) not like '%phát sinh%'
      )
    );

  if p_shift_id is null and (v_start is null or v_end is null) then
    return null;
  end if;

  if v_start is null or v_end is null or v_start = v_end then
    raise exception 'Khung gio khong hop le';
  end if;

  insert into public.shift_registrations (
    user_id, branch_id, shift_id, work_date, start_time, end_time,
    status, note, employment_type, position_title
  ) values (
    p_user_id, p_branch_id, p_shift_id, p_work_date, v_start, v_end,
    'approved', v_note, employee.employment_type, employee.position_title
  )
  on conflict (user_id, work_date, start_time, end_time) do update
  set status = 'approved',
      shift_id = excluded.shift_id,
      branch_id = excluded.branch_id,
      note = excluded.note,
      employment_type = excluded.employment_type,
      position_title = excluded.position_title
  where not exists (
    select 1
    from public.attendance_records ar
    where ar.shift_registration_id = public.shift_registrations.id
  )
  returning * into result;

  return result;
end;
$$;

grant execute on function public.set_schedule_registration_safe(uuid, text, date, uuid, time, time, text) to authenticated;

notify pgrst, 'reload schema';
