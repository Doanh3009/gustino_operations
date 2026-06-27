-- Protect attendance data when editing the weekly roster.
-- The old roster function removed every registration for a person/date, which could
-- also cascade-delete attendance records. This version only replaces the previous
-- roster-controlled shift and never deletes a registration that already has attendance.

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
    or (actor.role = 'manager' and public.can_manage_branch(p_branch_id))
  ) then raise exception 'Ban chi duoc chinh hang cua minh'; end if;

  if actor.role <> 'manager' and p_work_date < current_date then
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

-- Rebuild missing roster rows from existing registrations without failing when a
-- person has multiple shifts in the same day. Extra shifts stay visible as chips.
with ranked_registrations as (
  select distinct on (person.id, registration.work_date)
    person.id as person_id,
    registration.branch_id,
    registration.work_date,
    registration.shift_id,
    registration.start_time,
    registration.end_time,
    registration.user_id as updated_by
  from public.shift_registrations registration
  join public.schedule_people person on person.profile_id = registration.user_id
  where registration.status <> 'rejected'
    and registration.shift_id is not null
  order by person.id, registration.work_date, registration.created_at desc
)
insert into public.schedule_entries (
  person_id, branch_id, work_date, shift_id, start_time, end_time, updated_by
)
select person_id, branch_id, work_date, shift_id, start_time, end_time, updated_by
from ranked_registrations
on conflict (person_id, work_date) do update
set branch_id = excluded.branch_id,
    shift_id = excluded.shift_id,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    updated_by = excluded.updated_by,
    updated_at = now();
