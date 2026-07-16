-- Safe schedule-cell registration update.
-- Replaces only the editable main schedule shift for one employee/day.
-- Manual overtime/extra shifts are preserved, and attended shifts are never deleted.

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

  if p_user_id <> auth.uid() and actor.role not in ('manager', 'admin') then
    raise exception 'Ban chi duoc chinh lich cua chinh minh';
  end if;

  if actor.role not in ('manager', 'admin') and p_work_date < current_date then
    raise exception 'Nhan vien khong the sua lich cua ngay da qua';
  end if;

  if not (
    (p_user_id = auth.uid() and actor.branch_id = p_branch_id)
    or (actor.role in ('manager', 'admin') and public.can_manage_branch(p_branch_id))
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
      or lower(coalesce(nullif(trim(sr.note), ''), '')) in ('', 'ca tuy chinh', 'ca tu chon')
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
