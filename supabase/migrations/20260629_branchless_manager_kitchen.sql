-- Manager and Kitchen are not tied to one branch.
-- Managers can manage schedule setup for all branches; Kitchen receives all branch orders.

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

drop policy if exists "read permitted profiles" on public.profiles;
create policy "read permitted profiles" on public.profiles
for select to authenticated using (
  id = auth.uid()
  or (public.current_profile()).role in ('admin', 'manager')
  or (
    (public.current_profile()).role = 'shift_leader'
    and branch_id = (public.current_profile()).branch_id
  )
);

drop policy if exists "managers manage shifts" on public.shifts;
create policy "managers manage shifts" on public.shifts
for all to authenticated using (
  (public.current_profile()).role in ('admin', 'manager')
  or public.can_manage_branch(branch_id)
) with check (
  (public.current_profile()).role in ('admin', 'manager')
  or public.can_manage_branch(branch_id)
);

create or replace function public.admin_update_profile_role(
  p_profile_id uuid,
  p_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'Chỉ Admin hệ thống được thay đổi phân quyền';
  end if;

  if p_profile_id = auth.uid() and p_role <> 'admin' then
    raise exception 'Bạn không thể tự hạ quyền Admin của chính mình';
  end if;

  update public.profiles
  set
    role = p_role,
    branch_id = case when p_role in ('manager', 'kitchen') then null else branch_id end
  where id = p_profile_id;

  if not found then
    raise exception 'Không tìm thấy hồ sơ nhân viên';
  end if;
end;
$$;

grant execute on function public.admin_update_profile_role(uuid, public.app_role) to authenticated;

drop policy if exists "branch users read supply requests" on public.supply_requests;
create policy "branch users read supply requests" on public.supply_requests
for select to authenticated using (
  branch_id = (public.current_profile()).branch_id
  or (public.current_profile()).role in ('admin', 'manager', 'kitchen')
);

drop policy if exists "kitchen users update supply requests" on public.supply_requests;
create policy "kitchen users update supply requests" on public.supply_requests
for update to authenticated using (
  (public.current_profile()).role in ('admin', 'manager', 'kitchen')
) with check (
  (public.current_profile()).role in ('admin', 'manager', 'kitchen')
);

notify pgrst, 'reload schema';
