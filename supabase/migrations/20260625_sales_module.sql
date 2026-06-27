-- Sales module: PG records sold bags against bags issued by the shift leader.

alter table public.bag_allocations
add column if not exists sold_quantity numeric(14,3) not null default 0 check (sold_quantity >= 0);

update public.bag_allocations
set sold_quantity = greatest(0, issued_quantity - returned_quantity - damaged_quantity)
where settled_at is not null
  and sold_quantity = 0;

do $$
begin
  alter table public.bag_allocations
  add constraint bag_allocations_total_quantities_fit
  check (sold_quantity + returned_quantity + damaged_quantity <= issued_quantity);
exception
  when duplicate_object then null;
end $$;

create index if not exists bag_allocations_employee_open_idx
on public.bag_allocations(employee_id, branch_id, settled_at)
where settled_at is null;

drop policy if exists "assigned employees read their bag allocations" on public.bag_allocations;
create policy "assigned employees read their bag allocations" on public.bag_allocations
for select to authenticated
using (
  employee_id = auth.uid()
  or public.can_manage_branch(branch_id)
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
begin
  if p_quantity is null or p_quantity <= 0 or p_quantity <> trunc(p_quantity) then
    raise exception 'Số túi bán phải là số nguyên lớn hơn 0.';
  end if;

  select * into allocation_row
  from public.bag_allocations
  where id = p_allocation_id
  for update;

  if not found then
    raise exception 'Không tìm thấy dòng túi được phát.';
  end if;

  if allocation_row.settled_at is not null then
    raise exception 'Dòng túi này đã đối soát, ca trưởng cần sửa trong báo cáo/bàn giao.';
  end if;

  if allocation_row.employee_id is distinct from auth.uid()
    and not public.can_manage_branch(allocation_row.branch_id) then
    raise exception 'Bạn chỉ được ghi bán túi đã phát cho tài khoản của mình.';
  end if;

  if allocation_row.sold_quantity + p_quantity + allocation_row.returned_quantity + allocation_row.damaged_quantity > allocation_row.issued_quantity then
    raise exception 'Số túi bán vượt quá số túi đã phát.';
  end if;

  update public.bag_allocations
  set sold_quantity = sold_quantity + p_quantity
  where id = p_allocation_id
  returning * into allocation_row;

  return allocation_row;
end;
$$;

grant execute on function public.record_bag_sale(uuid, numeric) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.bag_allocations;
exception
  when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
