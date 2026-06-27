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
  if actor.id is null then raise exception 'Chưa đăng nhập'; end if;

  select * into employee
  from public.profiles
  where id = p_user_id and active = true and branch_id = p_branch_id;
  if employee.id is null then raise exception 'Không tìm thấy nhân viên'; end if;

  if not (
    p_user_id = auth.uid()
    or (actor.role = 'manager' and public.can_manage_branch(p_branch_id))
  ) then
    raise exception 'Không có quyền thêm ca cho nhân viên này';
  end if;

  if actor.role <> 'manager' and p_work_date < current_date then
    raise exception 'Không thể thêm ca cho ngày đã qua';
  end if;

  insert into public.shift_registrations (
    user_id, branch_id, shift_id, work_date, start_time, end_time,
    status, note, employment_type, position_title
  ) values (
    p_user_id, p_branch_id, null, p_work_date, p_start_time, p_end_time,
    'approved', coalesce(nullif(trim(p_note), ''), 'Ca tăng ca'),
    employee.employment_type, employee.position_title
  ) returning * into result;

  return result;
end;
$$;

grant execute on function public.add_manual_shift_registration(uuid, text, date, time, time, text) to authenticated;
