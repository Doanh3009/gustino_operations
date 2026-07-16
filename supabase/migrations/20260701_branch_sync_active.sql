-- Đồng bộ trạng thái chi nhánh giữa các thiết bị.

create or replace function public.set_config_branch_active(
  p_branch_id text,
  p_active boolean
)
returns public.branches
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  result public.branches;
begin
  select * into actor from public.profiles where id = auth.uid() and active = true;
  if actor.id is null or actor.role <> 'admin' then
    raise exception 'Chi Admin he thong duoc cap nhat chi nhanh.';
  end if;

  update public.branches
  set active = p_active
  where id = p_branch_id
  returning * into result;

  if result.id is null then
    raise exception 'Khong tim thay chi nhanh.';
  end if;

  return result;
end;
$$;

grant execute on function public.set_config_branch_active(text, boolean) to authenticated;

notify pgrst, 'reload schema';
