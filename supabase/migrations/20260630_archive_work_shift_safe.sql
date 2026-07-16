-- Safe archive for schedule work shifts.
-- Used when direct table updates are blocked by older RLS policies.

create or replace function public.archive_work_shift_safe(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  target public.shifts;
begin
  select * into actor from public.profiles where id = auth.uid() and active = true;
  if actor.id is null then
    raise exception 'Chua dang nhap';
  end if;

  select * into target from public.shifts where id = p_shift_id;
  if target.id is null then
    raise exception 'Khong tim thay khung ca';
  end if;

  if not (
    actor.role in ('admin', 'manager')
    or (actor.role = 'shift_leader' and actor.branch_id = target.branch_id)
  ) then
    raise exception 'Khong co quyen xoa khung ca nay';
  end if;

  update public.shifts
  set active = false
  where id = p_shift_id;
end;
$$;

grant execute on function public.archive_work_shift_safe(uuid) to authenticated;

notify pgrst, 'reload schema';
