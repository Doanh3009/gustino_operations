-- Repair branch bootstrap so newly-created branches are immediately usable.
-- - Admin/Manager can see every branch.
-- - Branch slugs are ASCII, trimmed, and cannot become "-foo" or empty.
-- - Default work shifts are added per missing template instead of skipped when
--   a branch already has a partial shift set.

create extension if not exists unaccent;

create or replace function public.can_manage_branch(p_branch_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    (public.current_profile()).role in ('admin', 'manager')
    or (
      (public.current_profile()).role = 'shift_leader'
      and (public.current_profile()).branch_id = p_branch_id
    )
$$;

create or replace function public.config_branch_slug(p_value text)
returns text
language sql immutable
set search_path = public
as $$
  select trim(both '-' from regexp_replace(lower(unaccent(trim(coalesce(p_value, '')))), '[^a-z0-9-]+', '-', 'g'))
$$;

create or replace function public.seed_default_work_shifts(p_branch_id text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.shifts (
    branch_id, name, start_time, end_time, grace_minutes, recommended_staff, employment_types, active
  )
  select p_branch_id, template.name, template.start_time::time, template.end_time::time, 5, 3, template.groups, true
  from (values
    ('Ca sang CT', '07:30', '15:30', array['leader']::text[]),
    ('Ca chieu CT', '14:00', '22:00', array['leader']::text[]),
    ('Ca sang FT', '07:30', '15:30', array['full_time']::text[]),
    ('Ca giua FT', '10:00', '18:00', array['full_time']::text[]),
    ('Ca chieu FT', '14:00', '22:00', array['full_time']::text[]),
    ('Ca PT sang', '10:00', '15:00', array['part_time']::text[]),
    ('Ca PT giua', '13:00', '19:00', array['part_time']::text[]),
    ('Ca PT chieu', '15:00', '21:00', array['part_time']::text[]),
    ('Ca PT toi', '16:30', '21:30', array['part_time']::text[])
  ) as template(name, start_time, end_time, groups)
  where exists (
    select 1 from public.branches branch
    where branch.id = p_branch_id and branch.active = true
  )
  and not exists (
    select 1 from public.shifts shift
    where shift.branch_id = p_branch_id
      and shift.name = template.name
      and shift.active = true
  )
  on conflict (branch_id, name) do update
  set
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    grace_minutes = excluded.grace_minutes,
    recommended_staff = excluded.recommended_staff,
    employment_types = excluded.employment_types,
    active = true;
$$;

grant execute on function public.seed_default_work_shifts(text) to authenticated;

create or replace function public.upsert_config_branch(
  p_branch_id text,
  p_branch_name text
)
returns public.branches
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  result public.branches;
  clean_id text := public.config_branch_slug(p_branch_id);
  clean_name text := trim(p_branch_name);
begin
  select * into actor from public.profiles where id = auth.uid() and active = true;
  if actor.id is null or actor.role <> 'admin' then
    raise exception 'Chi Admin he thong duoc tao chi nhanh.';
  end if;
  if clean_id = '' or clean_name = '' then
    raise exception 'Chi nhanh khong hop le.';
  end if;

  insert into public.branches (id, name, active)
  values (clean_id, clean_name, true)
  on conflict (id) do update
  set name = excluded.name,
      active = true
  returning * into result;

  perform public.seed_default_work_shifts(result.id);
  return result;
end;
$$;

grant execute on function public.upsert_config_branch(text, text) to authenticated;

select public.seed_default_work_shifts(branch.id)
from public.branches branch
where branch.active = true;

notify pgrst, 'reload schema';
