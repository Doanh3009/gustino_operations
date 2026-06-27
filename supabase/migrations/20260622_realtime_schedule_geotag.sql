-- Nhóm nhân sự, mẫu ca theo vị trí, realtime lịch và vị trí chấm công.

alter table public.profiles
add column if not exists employment_type text
  check (employment_type in ('leader', 'full_time', 'part_time')),
add column if not exists position_title text;

update public.profiles
set employment_type = case when role = 'shift_leader' then 'leader' else 'part_time' end
where employment_type is null;

update public.profiles
set position_title = case
  when role = 'shift_leader' then 'Ca trưởng'
  when employment_type = 'full_time' then 'Full-time'
  else 'Part-time'
end
where position_title is null;

alter table public.shifts
add column if not exists employment_types text[] not null default array[]::text[];

alter table public.attendance_records
add column if not exists check_in_latitude numeric(10,7),
add column if not exists check_in_longitude numeric(10,7),
add column if not exists check_in_accuracy numeric(10,2),
add column if not exists check_in_address text;

alter table public.shift_registrations
add column if not exists employment_type text
  check (employment_type in ('leader', 'full_time', 'part_time')),
add column if not exists position_title text;

update public.shift_registrations sr
set employment_type = p.employment_type,
    position_title = p.position_title
from public.profiles p
where p.id = sr.user_id
  and (sr.employment_type is null or sr.position_title is null);

insert into public.shifts (
  branch_id, name, start_time, end_time, grace_minutes, recommended_staff, employment_types
)
select b.id, template.name, template.start_time::time, template.end_time::time, 5, 3, template.groups
from public.branches b
cross join (values
  ('Ca sáng CT', '07:30', '15:30', array['leader']::text[]),
  ('Ca chiều CT', '14:00', '22:00', array['leader']::text[]),
  ('Ca sáng FT', '07:30', '15:30', array['full_time']::text[]),
  ('Ca giữa FT', '10:00', '18:00', array['full_time']::text[]),
  ('Ca chiều FT', '14:00', '22:00', array['full_time']::text[]),
  ('Ca PT sáng', '10:00', '15:00', array['part_time']::text[]),
  ('Ca PT giữa', '13:00', '19:00', array['part_time']::text[]),
  ('Ca PT chiều', '15:00', '21:00', array['part_time']::text[]),
  ('Ca PT tối', '16:30', '21:30', array['part_time']::text[])
) as template(name, start_time, end_time, groups)
on conflict (branch_id, name) do update
set start_time = excluded.start_time,
    end_time = excluded.end_time,
    employment_types = excluded.employment_types,
    active = true;

do $$
begin
  alter publication supabase_realtime add table public.shift_registrations;
exception
  when duplicate_object then null;
end $$;

create or replace function public.set_schedule_registration(
  p_user_id uuid,
  p_branch_id text,
  p_work_date date,
  p_shift_id uuid default null
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
  result public.shift_registrations;
begin
  select * into actor from public.profiles where id = auth.uid() and active = true;
  if actor.id is null then raise exception 'Chưa đăng nhập'; end if;
  if p_user_id <> auth.uid() and actor.role <> 'manager' then
    raise exception 'Bạn chỉ được chỉnh lịch của chính mình';
  end if;
  if actor.role <> 'manager' and p_work_date < current_date then
    raise exception 'Nhân viên không thể sửa lịch của ngày đã qua';
  end if;
  if not (
    (p_user_id = auth.uid() and actor.branch_id = p_branch_id)
    or (actor.role = 'manager' and public.can_manage_branch(p_branch_id))
  ) then
    raise exception 'Không có quyền tại chi nhánh này';
  end if;
  select * into employee from public.profiles where id = p_user_id and active = true and branch_id = p_branch_id;
  if employee.id is null then raise exception 'Không tìm thấy nhân viên'; end if;

  delete from public.shift_registrations
  where user_id = p_user_id and branch_id = p_branch_id and work_date = p_work_date;

  if p_shift_id is null then return null; end if;
  select * into selected_shift from public.shifts
  where id = p_shift_id and branch_id = p_branch_id and active = true;
  if selected_shift.id is null then raise exception 'Ca làm không hợp lệ'; end if;

  insert into public.shift_registrations (
    user_id, branch_id, shift_id, work_date, start_time, end_time,
    status, note, employment_type, position_title
  ) values (
    p_user_id, p_branch_id, selected_shift.id, p_work_date,
    selected_shift.start_time, selected_shift.end_time,
    'approved', '', employee.employment_type, employee.position_title
  ) returning * into result;
  return result;
end;
$$;

grant execute on function public.set_schedule_registration(uuid, text, date, uuid) to authenticated;
