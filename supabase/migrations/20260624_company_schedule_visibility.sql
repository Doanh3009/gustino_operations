-- Mọi tài khoản được xem lịch của tất cả chi nhánh; quyền sửa vẫn giữ nguyên.

drop policy if exists "users read available shifts" on public.shifts;
create policy "authenticated read active shifts" on public.shifts
for select to authenticated using (active);

drop policy if exists "branch users read schedule people" on public.schedule_people;
create policy "authenticated read schedule people" on public.schedule_people
for select to authenticated using (active);

drop policy if exists "branch users read schedule entries" on public.schedule_entries;
create policy "authenticated read schedule entries" on public.schedule_entries
for select to authenticated using (true);

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
  where person.active = true
  order by person.branch_id, person.sort_order, person.full_name;
$$;
grant execute on function public.list_schedule_people() to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.schedule_entries;
exception
  when duplicate_object then null;
end $$;
