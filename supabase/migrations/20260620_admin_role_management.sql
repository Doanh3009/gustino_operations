-- Cho phép quản trị viên thay đổi vai trò nhân sự qua một RPC có kiểm tra quyền.
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
    raise exception 'Chỉ quản trị viên được thay đổi phân quyền';
  end if;

  if p_profile_id = auth.uid() and p_role <> 'admin' then
    raise exception 'Bạn không thể tự hạ quyền quản trị của chính mình';
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
