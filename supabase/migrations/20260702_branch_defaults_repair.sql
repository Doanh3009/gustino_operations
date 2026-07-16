-- Keep core branches available after cleanup/import mistakes.
-- Several workflows depend on branches before custom branch sync can run.

insert into public.branches (id, name, active)
values
  ('gold-coast', 'Gold Coast Nha Trang', true),
  ('lotte-2310', 'Lotte Mart 23/10', true),
  ('lotte-vt', 'Lotte Mart Vung Tau', true)
on conflict (id) do update
set name = excluded.name,
    active = true;

do $$
begin
  if to_regprocedure('public.seed_default_work_shifts(text)') is not null then
    perform public.seed_default_work_shifts(branch.id)
    from public.branches branch
    where branch.id in ('gold-coast', 'lotte-2310', 'lotte-vt')
      and branch.active = true;
  end if;
end $$;

notify pgrst, 'reload schema';
