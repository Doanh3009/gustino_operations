-- Gộp vai trò Admin vào Quản lý.
-- Quản lý chỉ đọc dữ liệu tổng hợp; Ca trưởng mới được ghi dữ liệu vận hành.

insert into public.manager_branch_assignments (manager_id, branch_id)
select p.id, b.id
from public.profiles p
cross join public.branches b
where p.role = 'admin'
on conflict do nothing;

update public.profiles
set role = 'manager'
where role = 'admin';

create or replace function public.can_manage_branch(p_branch_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    (
      (public.current_profile()).role = 'shift_leader'
      and (public.current_profile()).branch_id = p_branch_id
    )
    or (
      (public.current_profile()).role = 'manager'
      and (
        (public.current_profile()).branch_id = p_branch_id
        or exists (
          select 1
          from public.manager_branch_assignments mba
          where mba.manager_id = auth.uid()
            and mba.branch_id = p_branch_id
        )
      )
    )
$$;

drop policy if exists "operations users read movements" on public.stock_movements;
drop policy if exists "operations users insert movements" on public.stock_movements;
drop policy if exists "operations users delete movements" on public.stock_movements;

create policy "management and shift leaders read movements" on public.stock_movements
for select to authenticated using (public.can_manage_branch(branch_id));

create policy "shift leaders insert movements" on public.stock_movements
for insert to authenticated with check (
  (public.current_profile()).role = 'shift_leader'
  and branch_id = (public.current_profile()).branch_id
  and created_by = auth.uid()
);

create policy "shift leaders delete movements" on public.stock_movements
for delete to authenticated using (
  (public.current_profile()).role = 'shift_leader'
  and branch_id = (public.current_profile()).branch_id
);

drop policy if exists "operations users read reports" on public.report_snapshots;
drop policy if exists "operations users insert reports" on public.report_snapshots;

create policy "management and shift leaders read shift reports" on public.report_snapshots
for select to authenticated using (public.can_manage_branch(branch_id));

create policy "shift leaders insert shift reports" on public.report_snapshots
for insert to authenticated with check (
  (public.current_profile()).role = 'shift_leader'
  and branch_id = (public.current_profile()).branch_id
  and created_by = auth.uid()
);

drop policy if exists "operations users read inventory reports" on public.inventory_reports;
drop policy if exists "operations users insert inventory reports" on public.inventory_reports;

create policy "management and shift leaders read inventory reports" on public.inventory_reports
for select to authenticated using (public.can_manage_branch(branch_id));

create policy "shift leaders insert inventory reports" on public.inventory_reports
for insert to authenticated with check (
  (public.current_profile()).role = 'shift_leader'
  and branch_id = (public.current_profile()).branch_id
  and created_by = auth.uid()
);

drop policy if exists "operations users read operation days" on public.operation_days;
drop policy if exists "operations users insert operation days" on public.operation_days;
drop policy if exists "operations users update operation days" on public.operation_days;

create policy "management and shift leaders read operation days" on public.operation_days
for select to authenticated using (public.can_manage_branch(branch_id));

create policy "shift leaders insert operation days" on public.operation_days
for insert to authenticated with check (
  (public.current_profile()).role = 'shift_leader'
  and branch_id = (public.current_profile()).branch_id
  and opened_by = auth.uid()
);

create policy "shift leaders update operation days" on public.operation_days
for update to authenticated using (
  (public.current_profile()).role = 'shift_leader'
  and branch_id = (public.current_profile()).branch_id
) with check (
  (public.current_profile()).role = 'shift_leader'
  and branch_id = (public.current_profile()).branch_id
);

create or replace function public.manager_update_profile_role(
  p_profile_id uuid,
  p_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_branch_id text;
begin
  if (select role from public.profiles where id = auth.uid()) <> 'manager' then
    raise exception 'Chỉ quản lý được thay đổi phân quyền';
  end if;

  if p_role = 'admin' then
    raise exception 'Vai trò Admin đã được gộp vào Quản lý';
  end if;

  if p_profile_id = auth.uid() and p_role <> 'manager' then
    raise exception 'Bạn không thể tự hạ quyền Quản lý của chính mình';
  end if;

  select branch_id into target_branch_id
  from public.profiles
  where id = p_profile_id;

  if target_branch_id is null or not public.can_manage_branch(target_branch_id) then
    raise exception 'Bạn không có quyền quản lý nhân sự tại chi nhánh này';
  end if;

  update public.profiles
  set role = p_role
  where id = p_profile_id;

  if not found then
    raise exception 'Không tìm thấy hồ sơ nhân viên';
  end if;
end;
$$;

grant execute on function public.manager_update_profile_role(uuid, public.app_role) to authenticated;
