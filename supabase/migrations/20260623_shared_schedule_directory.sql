-- Danh bạ tối thiểu cho bảng lịch chung, không lộ email hay dữ liệu quản trị.

create or replace function public.list_schedule_people()
returns table (
  id uuid,
  full_name text,
  role public.app_role,
  branch_id text,
  active boolean,
  employment_type text,
  position_title text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    profile.id,
    profile.full_name,
    profile.role,
    profile.branch_id,
    profile.active,
    profile.employment_type,
    profile.position_title
  from public.profiles profile
  where profile.active = true
    and (
      profile.branch_id = (public.current_profile()).branch_id
      or (
        (public.current_profile()).role = 'manager'
        and public.can_manage_branch(profile.branch_id)
      )
    )
  order by
    case profile.employment_type
      when 'leader' then 0
      when 'full_time' then 1
      else 2
    end,
    profile.full_name;
$$;

grant execute on function public.list_schedule_people() to authenticated;
