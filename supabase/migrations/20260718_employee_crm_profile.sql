-- Admin CRM employment metadata only; this does not change active/auth/payroll rules.
alter table public.profiles
  add column if not exists employment_status text not null default 'working'
    check (employment_status in ('probation', 'working', 'ended')),
  add column if not exists employment_start_date date,
  add column if not exists probation_end_date date,
  add column if not exists employment_end_date date,
  add column if not exists employment_note text not null default '';

alter table public.branches
  add column if not exists address text not null default '',
  add column if not exists manager_name text not null default '';

create or replace function public.admin_update_employee_crm(
  p_employee_id uuid, p_employment_status text, p_start_date date,
  p_probation_end_date date, p_end_date date, p_note text
) returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare actor public.profiles; result public.profiles;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.role is distinct from 'admin'::public.app_role then
    raise exception 'Only system Admin can update employee CRM data';
  end if;
  if p_employment_status not in ('probation', 'working', 'ended') then raise exception 'Invalid employment status'; end if;
  if p_probation_end_date is not null and p_start_date is not null and p_probation_end_date < p_start_date then
    raise exception 'Probation end date cannot precede start date';
  end if;
  if p_end_date is not null and p_start_date is not null and p_end_date < p_start_date then
    raise exception 'Employment end date cannot precede start date';
  end if;
  if p_employment_status = 'ended' and p_end_date is null then raise exception 'Employment end date is required'; end if;
  update public.profiles set
    employment_status = p_employment_status,
    employment_start_date = p_start_date,
    probation_end_date = p_probation_end_date,
    employment_end_date = case when p_employment_status = 'ended' then p_end_date else null end,
    employment_note = left(coalesce(p_note, ''), 2000)
  where id = p_employee_id returning * into result;
  if result.id is null then raise exception 'Employee not found'; end if;
  return result;
end;
$$;
revoke all on function public.admin_update_employee_crm(uuid, text, date, date, date, text) from public;
grant execute on function public.admin_update_employee_crm(uuid, text, date, date, date, text) to authenticated;

create or replace function public.admin_upsert_crm_branch(
  p_branch_id text, p_name text, p_address text, p_manager_name text
) returns public.branches
language plpgsql security definer set search_path = public
as $$
declare actor public.profiles; result public.branches;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.role is distinct from 'admin'::public.app_role then
    raise exception 'Only system Admin can create or update branches';
  end if;
  if nullif(trim(p_branch_id), '') is null or nullif(trim(p_name), '') is null then
    raise exception 'Branch id and name are required';
  end if;
  insert into public.branches (id, name, address, manager_name, active)
  values (trim(p_branch_id), trim(p_name), trim(coalesce(p_address, '')), trim(coalesce(p_manager_name, '')), true)
  on conflict (id) do update set
    name = excluded.name, address = excluded.address,
    manager_name = excluded.manager_name, active = true
  returning * into result;
  return result;
end;
$$;
revoke all on function public.admin_upsert_crm_branch(text, text, text, text) from public;
grant execute on function public.admin_upsert_crm_branch(text, text, text, text) to authenticated;
notify pgrst, 'reload schema';
