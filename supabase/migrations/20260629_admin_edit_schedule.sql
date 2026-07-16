-- Cho phép vai trò Admin chỉnh bảng đăng ký lịch làm (giống Quản lý).
-- can_manage_branch() đã trả true cho admin ở mọi chi nhánh, nên chỉ cần nới các
-- check role = 'manager' trong policy + RPC liên quan tới lịch sang ('manager','admin').

-- 1) Thêm/xóa/sửa dòng nhân sự trong bảng lịch
drop policy if exists "managers manage schedule people" on public.schedule_people;
create policy "managers manage schedule people" on public.schedule_people
for all to authenticated using (
  (public.current_profile()).role in ('manager', 'admin') and public.can_manage_branch(branch_id)
) with check (
  (public.current_profile()).role in ('manager', 'admin') and public.can_manage_branch(branch_id)
);

-- 2) Danh sách nhân sự liên chi nhánh cũng hiển thị cho admin
drop function if exists public.list_schedule_people();
create function public.list_schedule_people()
returns table (
  id uuid,
  profile_id uuid,
  full_name text,
  branch_id text,
  active boolean,
  employment_type text,
  position_title text,
  sort_order integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    person.id,
    person.profile_id,
    person.full_name,
    person.branch_id,
    person.active,
    person.employment_type,
    person.position_title,
    person.sort_order
  from public.schedule_people person
  where person.active = true
    and (
      person.branch_id = (public.current_profile()).branch_id
      or (
        (public.current_profile()).role in ('manager', 'admin')
        and public.can_manage_branch(person.branch_id)
      )
    )
  order by person.sort_order, person.full_name;
$$;
grant execute on function public.list_schedule_people() to authenticated;

-- 3) Đặt ca theo ô trên bảng lịch (giữ nguyên logic bảo vệ chấm công)
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
  ) then raise exception 'Ban chi duoc chinh hang cua minh'; end if;

  if actor.role not in ('manager', 'admin') and p_work_date < current_date then
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

-- 4) Đặt ca trực tiếp theo registration (board cũ + cell)
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
  if p_user_id <> auth.uid() and actor.role not in ('manager', 'admin') then
    raise exception 'Bạn chỉ được chỉnh lịch của chính mình';
  end if;
  if actor.role not in ('manager', 'admin') and p_work_date < current_date then
    raise exception 'Nhân viên không thể sửa lịch của ngày đã qua';
  end if;
  if not (
    (p_user_id = auth.uid() and actor.branch_id = p_branch_id)
    or (actor.role in ('manager', 'admin') and public.can_manage_branch(p_branch_id))
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

-- 5) Thêm ca thủ công / tăng ca
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
    or (actor.role in ('manager', 'admin') and public.can_manage_branch(p_branch_id))
  ) then
    raise exception 'Không có quyền thêm ca cho nhân viên này';
  end if;

  if actor.role not in ('manager', 'admin') and p_work_date < current_date then
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

notify pgrst, 'reload schema';
