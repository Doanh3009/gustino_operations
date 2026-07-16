-- Keep deleted/old employees out of schedule and attendance views.
-- Root cause: account deletion previously set profiles.active = false but left
-- linked schedule_people rows active, so the schedule RPC could show them again.

update public.schedule_people person
set active = false
from public.profiles profile
where person.profile_id = profile.id
  and coalesce(profile.active, true) = false
  and person.active = true;

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
    (person.active and coalesce(profile.active, true)) as active,
    person.employment_type,
    person.position_title,
    person.sort_order
  from public.schedule_people person
  left join public.profiles profile on profile.id = person.profile_id
  where person.active = true
    and coalesce(profile.active, true) = true
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

notify pgrst, 'reload schema';
