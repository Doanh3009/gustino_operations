-- Staff POS visibility repair:
-- If an open bag allocation was issued with a missing/wrong employee_id but
-- employee_name still matches exactly one active staff account in the branch,
-- attach it to that profile and allow name-based fallback for read/sale.

create extension if not exists unaccent;

create or replace function public.normalized_vi_name(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(regexp_replace(unaccent(trim(coalesce(p_value, ''))), '\s+', ' ', 'g'))
$$;

with unique_matches as (
  select
    allocation.id as allocation_id,
    (array_agg(profile.id order by profile.id))[1] as profile_id,
    count(*) as match_count
  from public.bag_allocations allocation
  join public.profiles profile
    on profile.branch_id = allocation.branch_id
   and profile.role in ('staff', 'shift_leader')
   and coalesce(profile.active, true)
   and public.normalized_vi_name(profile.full_name) = public.normalized_vi_name(allocation.employee_name)
  left join public.profiles current_profile on current_profile.id = allocation.employee_id
  where allocation.settled_at is null
    and (
      allocation.employee_id is null
      or current_profile.id is null
      or public.normalized_vi_name(current_profile.full_name) <> public.normalized_vi_name(allocation.employee_name)
    )
  group by allocation.id
)
update public.bag_allocations allocation
set employee_id = unique_matches.profile_id
from unique_matches
where allocation.id = unique_matches.allocation_id
  and unique_matches.match_count = 1;

drop policy if exists "assigned employees read their bag allocations" on public.bag_allocations;
create policy "assigned employees read their bag allocations" on public.bag_allocations
for select to authenticated
using (
  public.can_manage_branch(branch_id)
  or employee_id = auth.uid()
  or exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.branch_id = bag_allocations.branch_id
      and coalesce(profile.active, true)
      and public.normalized_vi_name(profile.full_name) = public.normalized_vi_name(bag_allocations.employee_name)
  )
);

create or replace function public.record_bag_sale(
  p_allocation_id uuid,
  p_quantity numeric
)
returns public.bag_allocations
language plpgsql
security definer
set search_path = public
as $$
declare
  allocation_row public.bag_allocations%rowtype;
  actor_profile public.profiles%rowtype;
  actor_matches_name boolean := false;
begin
  if p_quantity is null or p_quantity <= 0 or p_quantity <> trunc(p_quantity) then
    raise exception 'So tui ban phai la so nguyen lon hon 0.';
  end if;

  select * into allocation_row
  from public.bag_allocations
  where id = p_allocation_id
  for update;

  if not found then
    raise exception 'Khong tim thay dong tui duoc phat.';
  end if;

  if allocation_row.settled_at is not null then
    raise exception 'Dong tui nay da doi soat, ca truong can sua trong bao cao/ban giao.';
  end if;

  select * into actor_profile
  from public.profiles
  where id = auth.uid()
    and coalesce(active, true);

  actor_matches_name := actor_profile.id is not null
    and actor_profile.branch_id = allocation_row.branch_id
    and public.normalized_vi_name(actor_profile.full_name) = public.normalized_vi_name(allocation_row.employee_name);

  if allocation_row.employee_id is distinct from auth.uid()
    and not actor_matches_name
    and not public.can_manage_branch(allocation_row.branch_id) then
    raise exception 'Ban chi duoc ghi ban tui da phat cho tai khoan cua minh.';
  end if;

  if allocation_row.sold_quantity + p_quantity + allocation_row.returned_quantity + allocation_row.damaged_quantity > allocation_row.issued_quantity then
    raise exception 'So tui ban vuot qua so tui da phat.';
  end if;

  update public.bag_allocations
  set sold_quantity = sold_quantity + p_quantity,
      employee_id = case when actor_matches_name then auth.uid() else employee_id end
  where id = p_allocation_id
  returning * into allocation_row;

  return allocation_row;
end;
$$;

grant execute on function public.record_bag_sale(uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
