-- Safe create/reactivate for configurable work shifts.
-- Avoids direct RLS/upsert failures when a shift name was archived earlier.

create or replace function public.create_work_shift_safe(
  p_branch_id text,
  p_name text,
  p_start_time time,
  p_end_time time,
  p_employment_types text[] default '{}'
)
returns public.shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  result public.shifts;
  clean_name text := coalesce(nullif(trim(p_name), ''), concat(p_start_time::text, '-', p_end_time::text));
begin
  select * into actor from public.profiles where id = auth.uid() and active = true;
  if actor.id is null then
    raise exception 'Chua dang nhap';
  end if;

  if not (
    actor.role in ('admin', 'manager')
    or (actor.role = 'shift_leader' and actor.branch_id = p_branch_id)
  ) then
    raise exception 'Khong co quyen tao khung ca nay';
  end if;

  if p_start_time is null or p_end_time is null or p_start_time = p_end_time then
    raise exception 'Khung gio khong hop le';
  end if;

  if not exists (select 1 from public.branches where id = p_branch_id and active = true) then
    raise exception 'Chi nhanh chua duoc dong bo len Supabase';
  end if;

  insert into public.shifts (
    branch_id,
    name,
    start_time,
    end_time,
    grace_minutes,
    recommended_staff,
    employment_types,
    active,
    created_by
  ) values (
    p_branch_id,
    clean_name,
    p_start_time,
    p_end_time,
    5,
    3,
    coalesce(p_employment_types, '{}'),
    true,
    auth.uid()
  )
  on conflict (branch_id, name) do update
  set start_time = excluded.start_time,
      end_time = excluded.end_time,
      recommended_staff = excluded.recommended_staff,
      employment_types = excluded.employment_types,
      active = true
  returning * into result;

  return result;
end;
$$;

grant execute on function public.create_work_shift_safe(text, text, time, time, text[]) to authenticated;

notify pgrst, 'reload schema';
