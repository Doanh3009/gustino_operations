-- Align go-live schedule defaults to the 4 shift windows requested for all real branches.

create or replace function public.seed_default_work_shifts(p_branch_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.shifts
  set active = false
  where branch_id = p_branch_id
    and name in (
      'Ca sang CT', 'Ca chieu CT', 'Ca sang FT', 'Ca giua FT', 'Ca chieu FT',
      'Ca PT sang', 'Ca PT giua', 'Ca PT chieu', 'Ca PT toi',
      'Ca sáng CT', 'Ca chiều CT', 'Ca sáng FT', 'Ca giữa FT', 'Ca chiều FT',
      'Ca PT sáng', 'Ca PT giữa', 'Ca PT chiều', 'Ca PT tối'
    );

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
  on conflict (branch_id, name) do update
  set
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    recommended_staff = excluded.recommended_staff,
    employment_types = excluded.employment_types,
    active = true;
$$;

grant execute on function public.seed_default_work_shifts(text) to authenticated;

select public.seed_default_work_shifts(branch.id)
from public.branches branch
where branch.id in ('gold-coast', 'lotte-2310', 'lotte-vt')
  and branch.active = true;

notify pgrst, 'reload schema';
