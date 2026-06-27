-- Cho phép ca trưởng duyệt ca và xem bảng công tại chi nhánh của mình.
-- File này dành cho hệ thống đã chạy migration attendance trước đó.

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
          select 1 from public.manager_branch_assignments mba
          where mba.manager_id = auth.uid() and mba.branch_id = p_branch_id
        )
      )
    )
$$;

drop policy if exists "read permitted profiles" on public.profiles;
create policy "read permitted profiles" on public.profiles for select to authenticated
using (
  id = auth.uid()
  or (public.current_profile()).role = 'admin'
  or (
    (public.current_profile()).role = 'manager'
    and (
      branch_id = (public.current_profile()).branch_id
      or exists (
        select 1 from public.manager_branch_assignments mba
        where mba.manager_id = auth.uid() and mba.branch_id = profiles.branch_id
      )
    )
  )
  or (
    (public.current_profile()).role = 'shift_leader'
    and branch_id = (public.current_profile()).branch_id
  )
);
