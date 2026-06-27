-- Tự tạo hồ sơ ứng dụng khi người dùng được tạo trong Supabase Auth.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role public.app_role;
  requested_branch text;
  requested_employment text;
begin
  requested_role := case new.raw_user_meta_data ->> 'role'
    when 'manager' then 'manager'::public.app_role
    when 'staff' then 'staff'::public.app_role
    else 'shift_leader'::public.app_role
  end;

  requested_branch := coalesce(new.raw_user_meta_data ->> 'branch_id', 'gold-coast');
  if not exists (select 1 from public.branches where id = requested_branch) then
    requested_branch := 'gold-coast';
  end if;

  requested_employment := case new.raw_user_meta_data ->> 'employment_type'
    when 'leader' then 'leader'
    when 'full_time' then 'full_time'
    when 'part_time' then 'part_time'
    else case when requested_role = 'shift_leader' then 'leader' else 'part_time' end
  end;

  insert into public.profiles (
    id, full_name, email, role, branch_id, active, employment_type, position_title
  ) values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    new.email,
    requested_role,
    requested_branch,
    true,
    requested_employment,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'position_title', ''),
      case
        when requested_role = 'manager' then 'Quản lý'
        when requested_role = 'shift_leader' then 'Ca trưởng'
        when requested_employment = 'full_time' then 'Full-time'
        else 'Part-time'
      end
    )
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

insert into public.profiles (
  id, full_name, email, role, branch_id, active, employment_type, position_title
)
select
  user_row.id,
  coalesce(nullif(user_row.raw_user_meta_data ->> 'full_name', ''), split_part(user_row.email, '@', 1)),
  user_row.email,
  'shift_leader'::public.app_role,
  'gold-coast',
  true,
  'leader',
  'Ca trưởng'
from auth.users user_row
on conflict (id) do update set email = excluded.email;
