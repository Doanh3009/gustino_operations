-- Bootstrap configurable branches and default schedule shifts.

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
    ('Ca 1', '07:15', '15:15', array['leader','full_time']::text[]),
    ('Ca 2', '14:15', '22:15', array['leader','full_time']::text[]),
    ('Ca PT sang', '09:00', '13:00', array['part_time']::text[]),
    ('Ca PT chieu', '16:00', '21:00', array['part_time']::text[])
  ) as template(name, start_time, end_time, groups)
  where not exists (
    select 1 from public.shifts
    where branch_id = p_branch_id and active = true
  )
  on conflict (branch_id, name) do update
  set
    start_time = excluded.start_time,
    end_time = excluded.end_time,
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
  clean_id text := lower(regexp_replace(trim(p_branch_id), '[^a-z0-9-]+', '-', 'g'));
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
where not exists (
  select 1 from public.shifts shift
  where shift.branch_id = branch.id and shift.active = true
);

notify pgrst, 'reload schema';
