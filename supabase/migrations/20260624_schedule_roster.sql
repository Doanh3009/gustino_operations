-- Bảng lịch độc lập với tài khoản đăng nhập, cho phép Quản lý tự thêm tên và xếp ca.

create table if not exists public.schedule_people (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  branch_id text not null references public.branches(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  employment_type text check (employment_type in ('leader', 'full_time', 'part_time')),
  position_title text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.schedule_people(id) on delete cascade,
  branch_id text not null references public.branches(id) on delete cascade,
  work_date date not null,
  shift_id uuid references public.shifts(id),
  start_time time not null,
  end_time time not null,
  note text not null default '',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (person_id, work_date)
);

create index if not exists schedule_people_branch_idx on public.schedule_people(branch_id, active, sort_order, full_name);
create index if not exists schedule_entries_branch_date_idx on public.schedule_entries(branch_id, work_date, person_id);

insert into public.schedule_people (
  profile_id, branch_id, full_name, employment_type, position_title, active
)
select id, branch_id, full_name, employment_type, position_title, true
from public.profiles
where active = true and branch_id is not null
on conflict (profile_id) do update
set full_name = excluded.full_name,
    branch_id = excluded.branch_id,
    employment_type = excluded.employment_type,
    position_title = excluded.position_title;

create or replace function public.sync_profile_to_schedule_person()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.branch_id is not null then
    insert into public.schedule_people (
      profile_id, branch_id, full_name, employment_type, position_title, active
    ) values (
      new.id, new.branch_id, new.full_name, new.employment_type, new.position_title, true
    )
    on conflict (profile_id) do update
    set full_name = excluded.full_name,
        branch_id = excluded.branch_id,
        employment_type = excluded.employment_type,
        position_title = excluded.position_title;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_profile_schedule_person on public.profiles;
create trigger sync_profile_schedule_person
after insert or update of full_name, branch_id, employment_type, position_title
on public.profiles
for each row execute function public.sync_profile_to_schedule_person();

alter table public.schedule_people enable row level security;
alter table public.schedule_entries enable row level security;

create policy "branch users read schedule people" on public.schedule_people
for select to authenticated using (
  branch_id = (public.current_profile()).branch_id or public.can_manage_branch(branch_id)
);
create policy "managers manage schedule people" on public.schedule_people
for all to authenticated using (
  (public.current_profile()).role = 'manager' and public.can_manage_branch(branch_id)
) with check (
  (public.current_profile()).role = 'manager' and public.can_manage_branch(branch_id)
);
create policy "branch users read schedule entries" on public.schedule_entries
for select to authenticated using (
  branch_id = (public.current_profile()).branch_id or public.can_manage_branch(branch_id)
);

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
        (public.current_profile()).role = 'manager'
        and public.can_manage_branch(person.branch_id)
      )
    )
  order by person.sort_order, person.full_name;
$$;
grant execute on function public.list_schedule_people() to authenticated;

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
  result public.schedule_entries;
begin
  select * into actor from public.profiles where id = auth.uid() and active = true;
  if actor.id is null then raise exception 'Chưa đăng nhập'; end if;
  select * into person from public.schedule_people where id = p_person_id and active = true;
  if person.id is null or person.branch_id <> p_branch_id then raise exception 'Nhân sự không hợp lệ'; end if;
  if not (
    person.profile_id = auth.uid()
    or (actor.role = 'manager' and public.can_manage_branch(p_branch_id))
  ) then raise exception 'Bạn chỉ được chỉnh hàng của mình'; end if;
  if actor.role <> 'manager' and p_work_date < current_date then
    raise exception 'Không thể sửa lịch ngày đã qua';
  end if;

  delete from public.schedule_entries where person_id = p_person_id and work_date = p_work_date;
  if person.profile_id is not null then
    delete from public.shift_registrations
    where user_id = person.profile_id and branch_id = p_branch_id and work_date = p_work_date;
  end if;
  if p_shift_id is null then return null; end if;

  select * into selected_shift from public.shifts
  where id = p_shift_id and branch_id = p_branch_id and active = true;
  if selected_shift.id is null then raise exception 'Ca làm không hợp lệ'; end if;

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
    );
  end if;
  return result;
end;
$$;
grant execute on function public.set_schedule_entry(uuid, text, date, uuid) to authenticated;

insert into public.schedule_entries (
  person_id, branch_id, work_date, shift_id, start_time, end_time, updated_by
)
select person.id, registration.branch_id, registration.work_date, registration.shift_id,
       registration.start_time, registration.end_time, registration.user_id
from public.shift_registrations registration
join public.schedule_people person on person.profile_id = registration.user_id
where registration.status <> 'rejected'
on conflict (person_id, work_date) do update
set shift_id = excluded.shift_id,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    updated_at = now();
