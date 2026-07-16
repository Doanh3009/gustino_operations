-- Repair branch master data after duplicate local rows caused active=true rows
-- to be overwritten by stale active=false rows during sync.

insert into public.branches (id, name, active)
values
  ('gold-coast', 'Gold Coast Nha Trang', true),
  ('lotte-2310', 'Lotte Mart 23/10', true),
  ('lotte-vt', 'Lotte Mart Vũng Tàu', true)
on conflict (id) do update
set name = excluded.name,
    active = true;

update public.branches
set active = false
where id in ('-q', '1', '123', 'test');

do $$
begin
  if to_regprocedure('public.seed_default_work_shifts(text)') is not null then
    perform public.seed_default_work_shifts(branch.id)
    from public.branches branch
    where branch.id in ('gold-coast', 'lotte-2310', 'lotte-vt')
      and branch.active = true;
  end if;
end $$;

update public.shifts
set active = true
where branch_id in ('gold-coast', 'lotte-2310', 'lotte-vt');

update public.profiles
set active = false
where branch_id in ('-q', '1', '123', 'test')
  and role in ('shift_leader', 'staff');

update public.schedule_people
set active = false
where branch_id in ('-q', '1', '123', 'test');

update public.shifts
set active = false
where branch_id in ('-q', '1', '123', 'test');

notify pgrst, 'reload schema';
