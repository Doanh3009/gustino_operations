-- Safe self-service shift registration.
-- Keeps shift_id when a predefined shift is selected and does not delete other shifts on the same day.

create or replace function public.add_shift_registration_safe(
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
  result public.shift_registrations;
begin
  select * into actor from public.profiles where id = auth.uid() and active = true;
  if actor.id is null then raise exception 'Chua dang nhap'; end if;

  if p_user_id <> auth.uid() and actor.role not in ('manager', 'admin') then
    raise exception 'Ban chi duoc dang ky ca cho chinh minh';
  end if;

  if actor.role not in ('manager', 'admin') and p_work_date < current_date then
    raise exception 'Khong the dang ky ca cho ngay da qua';
  end if;

  if not (
    (p_user_id = auth.uid() and actor.branch_id = p_branch_id)
    or (actor.role in ('manager', 'admin') and public.can_manage_branch(p_branch_id))
  ) then
    raise exception 'Khong co quyen tai chi nhanh nay';
  end if;

  select * into employee from public.profiles where id = p_user_id and active = true;
  if employee.id is null then raise exception 'Khong tim thay nhan vien'; end if;
  if employee.role not in ('manager', 'admin', 'kitchen') and employee.branch_id <> p_branch_id then
    raise exception 'Nhan vien khong thuoc chi nhanh nay';
  end if;

  if p_shift_id is not null then
    select * into selected_shift
    from public.shifts
    where id = p_shift_id and branch_id = p_branch_id and active = true;
    if selected_shift.id is null then raise exception 'Ca lam khong hop le'; end if;
    v_start := selected_shift.start_time;
    v_end := selected_shift.end_time;
  end if;

  if v_start is null or v_end is null or v_start = v_end then
    raise exception 'Khung gio khong hop le';
  end if;

  insert into public.shift_registrations (
    user_id, branch_id, shift_id, work_date, start_time, end_time,
    status, note, employment_type, position_title
  ) values (
    p_user_id, p_branch_id, p_shift_id, p_work_date, v_start, v_end,
    'approved', coalesce(p_note, ''), employee.employment_type, employee.position_title
  )
  on conflict (user_id, work_date, start_time, end_time) do update
  set branch_id = excluded.branch_id,
      shift_id = coalesce(excluded.shift_id, public.shift_registrations.shift_id),
      status = 'approved',
      note = excluded.note,
      employment_type = coalesce(excluded.employment_type, public.shift_registrations.employment_type),
      position_title = coalesce(excluded.position_title, public.shift_registrations.position_title)
  where not exists (
    select 1
    from public.attendance_records ar
    where ar.shift_registration_id = public.shift_registrations.id
  )
  returning * into result;

  if result.id is null then
    select * into result
    from public.shift_registrations
    where user_id = p_user_id
      and work_date = p_work_date
      and start_time = v_start
      and end_time = v_end
    limit 1;
  end if;

  return result;
end;
$$;

grant execute on function public.add_shift_registration_safe(uuid, text, date, uuid, time, time, text) to authenticated;

notify pgrst, 'reload schema';
