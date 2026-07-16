-- Restore separate System Admin role.
-- Admin configures people, roles and master data; Manager focuses on operations reports.

create or replace function public.can_manage_branch(p_branch_id text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    (public.current_profile()).role = 'admin'
    or (
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
  set role = p_role
  where id = p_profile_id;

  if not found then
    raise exception 'Không tìm thấy hồ sơ nhân viên';
  end if;
end;
$$;

grant execute on function public.admin_update_profile_role(uuid, public.app_role) to authenticated;

notify pgrst, 'reload schema';
