-- Quy trình thực tế: Quản lý không đăng ký ca; nhân viên đăng ký và chấm công theo lịch.

create or replace function public.list_schedule_people()
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
  left join public.profiles profile on profile.id = person.profile_id
  where person.active = true
    and (person.profile_id is null or profile.role <> 'manager')
  order by person.branch_id, person.sort_order, person.full_name;
$$;
grant execute on function public.list_schedule_people() to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.schedule_people;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.shifts;
exception
  when duplicate_object then null;
end $$;
