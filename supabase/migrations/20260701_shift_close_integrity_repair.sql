-- Full integrity repair for shift close:
-- 1) remove retry duplicates that inflated/lost stock,
-- 2) backfill missing stock movements from sold bag allocations,
-- 3) make close_bag_shift_safe derive stock movements inside the database.

create extension if not exists pgcrypto;

with ranked as (
  select
    id,
    row_number() over (
      partition by branch_id, shift_date, document_id, product_id, movement_type, coalesce(note, ''), quantity
      order by created_at desc, id desc
    ) as rn
  from public.stock_movements
  where document_id is not null
    and movement_type in ('sale_out', 'count', 'waste')
)
delete from public.stock_movements movement
using ranked
where movement.id = ranked.id
  and ranked.rn > 1;

with ranked_counts as (
  select
    id,
    row_number() over (
      partition by document_id, product_id, movement_type
      order by created_at desc, id desc
    ) as rn
  from public.stock_movements
  where document_id is not null
    and movement_type = 'count'
)
delete from public.stock_movements movement
using ranked_counts
where movement.id = ranked_counts.id
  and ranked_counts.rn > 1;

create unique index if not exists stock_movements_shift_count_once_idx
  on public.stock_movements(document_id, product_id, movement_type)
  where document_id is not null and movement_type = 'count';

create unique index if not exists stock_movements_auto_close_once_idx
  on public.stock_movements(document_id, product_id, movement_type)
  where document_id is not null
    and movement_type in ('sale_out', 'waste')
    and note like '[AUTO-%';

insert into public.stock_movements (
  id, branch_id, product_id, movement_type, quantity, shift_date, note,
  document_id, created_by, created_at
)
select
  gen_random_uuid(),
  allocation.branch_id,
  allocation.product_id,
  'sale_out'::public.stock_movement_type,
  allocation.sold_quantity,
  session.business_date,
  '[AUTO-REPAIR] [' || session.sequence || '] ' || allocation.employee_name || ' sold ' || allocation.sold_quantity || ' bags',
  allocation.id,
  coalesce(allocation.settled_by, allocation.issued_by, session.leader_id),
  coalesce(allocation.settled_at, allocation.posted_at, session.ended_at, now())
from public.bag_allocations allocation
join public.bag_shift_sessions session on session.id = allocation.shift_id
where session.status = 'closed'
  and coalesce(allocation.sold_quantity, 0) > 0
  and not exists (
    select 1
    from public.stock_movements existing
    where existing.movement_type = 'sale_out'
      and existing.branch_id = allocation.branch_id
      and existing.product_id = allocation.product_id
      and (
        existing.document_id = allocation.id
        or (
          existing.document_id = session.id
          and existing.created_at >= session.started_at - interval '1 hour'
          and existing.created_at <= coalesce(session.ended_at, now()) + interval '1 hour'
        )
      )
  )
on conflict do nothing;

insert into public.stock_movements (
  id, branch_id, product_id, movement_type, quantity, shift_date, note,
  document_id, created_by, created_at
)
select
  gen_random_uuid(),
  allocation.branch_id,
  allocation.product_id,
  'waste'::public.stock_movement_type,
  allocation.damaged_quantity,
  session.business_date,
  '[AUTO-REPAIR] [' || session.sequence || '] ' || allocation.employee_name || ' damaged/lost ' || allocation.damaged_quantity || ' bags',
  allocation.id,
  coalesce(allocation.settled_by, allocation.issued_by, session.leader_id),
  coalesce(allocation.settled_at, allocation.posted_at, session.ended_at, now())
from public.bag_allocations allocation
join public.bag_shift_sessions session on session.id = coalesce(allocation.settlement_shift_id, allocation.shift_id)
where session.status = 'closed'
  and coalesce(allocation.damaged_quantity, 0) > 0
  and not exists (
    select 1
    from public.stock_movements existing
    where existing.movement_type = 'waste'
      and existing.branch_id = allocation.branch_id
      and existing.product_id = allocation.product_id
      and existing.document_id = allocation.id
  )
on conflict do nothing;

update public.bag_allocations allocation
set posted_at = coalesce(allocation.posted_at, session.ended_at, now())
from public.bag_shift_sessions session
where session.id = coalesce(allocation.settlement_shift_id, allocation.shift_id)
  and session.status = 'closed'
  and allocation.posted_at is null
  and (coalesce(allocation.sold_quantity, 0) > 0 or coalesce(allocation.damaged_quantity, 0) > 0)
  and exists (
    select 1
    from public.stock_movements movement
    where movement.document_id = allocation.id
      and movement.product_id = allocation.product_id
      and movement.movement_type in ('sale_out', 'waste')
  );

update public.bag_shift_sessions
set
  status = 'closed',
  closing_balances = coalesce(closing_balances, opening_balances, '{}'::jsonb),
  discrepancy_note = coalesce(discrepancy_note, 'Auto-closed stale open session during integrity repair.'),
  ended_at = coalesce(ended_at, started_at)
where status = 'open'
  and business_date < current_date;

create or replace function public.close_bag_shift_safe(
  p_session_id uuid,
  p_closing_balances jsonb,
  p_discrepancy_note text,
  p_movements jsonb default '[]'::jsonb,
  p_posted_allocation_ids jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.bag_shift_sessions%rowtype;
  ended timestamptz := now();
  closing_json jsonb := case
    when jsonb_typeof(coalesce(p_closing_balances, '{}'::jsonb)) = 'object'
      then coalesce(p_closing_balances, '{}'::jsonb)
    else '{}'::jsonb
  end;
begin
  select * into session_row
  from public.bag_shift_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'Shift session was not found.';
  end if;

  if (public.current_profile()).role not in ('shift_leader', 'manager', 'admin')
    or not public.can_manage_branch(session_row.branch_id) then
    raise exception 'You do not have permission to close this branch shift.';
  end if;

  if session_row.status <> 'open' then
    return;
  end if;

  insert into public.stock_movements (
    id, branch_id, product_id, movement_type, quantity, shift_date, note,
    document_id, created_by, created_at
  )
  select
    gen_random_uuid(),
    allocation.branch_id,
    allocation.product_id,
    'sale_out'::public.stock_movement_type,
    allocation.sold_quantity,
    session_row.business_date,
    '[AUTO-CLOSE] [' || session_row.sequence || '] ' || allocation.employee_name || ' sold ' || allocation.sold_quantity || ' bags',
    allocation.id,
    auth.uid(),
    ended
  from public.bag_allocations allocation
  where (allocation.shift_id = p_session_id or allocation.settlement_shift_id = p_session_id)
    and allocation.posted_at is null
    and coalesce(allocation.sold_quantity, 0) > 0
    and not exists (
      select 1
      from public.stock_movements existing
      where existing.document_id = allocation.id
        and existing.product_id = allocation.product_id
        and existing.movement_type = 'sale_out'
    )
  on conflict do nothing;

  insert into public.stock_movements (
    id, branch_id, product_id, movement_type, quantity, shift_date, note,
    document_id, created_by, created_at
  )
  select
    gen_random_uuid(),
    allocation.branch_id,
    allocation.product_id,
    'waste'::public.stock_movement_type,
    allocation.damaged_quantity,
    session_row.business_date,
    '[AUTO-CLOSE] [' || session_row.sequence || '] ' || allocation.employee_name || ' damaged/lost ' || allocation.damaged_quantity || ' bags',
    allocation.id,
    auth.uid(),
    ended
  from public.bag_allocations allocation
  where (allocation.shift_id = p_session_id or allocation.settlement_shift_id = p_session_id)
    and allocation.posted_at is null
    and coalesce(allocation.damaged_quantity, 0) > 0
    and not exists (
      select 1
      from public.stock_movements existing
      where existing.document_id = allocation.id
        and existing.product_id = allocation.product_id
        and existing.movement_type = 'waste'
    )
  on conflict do nothing;

  insert into public.stock_movements (
    id, branch_id, product_id, movement_type, quantity, shift_date, note,
    document_id, created_by, created_at
  )
  with counters as (
    select
      key as product_id,
      case
        when value ~ '^-?[0-9]+(\.[0-9]+)?$' then greatest(0, value::numeric)
        else 0
      end as counter_quantity
    from jsonb_each_text(closing_json)
  ),
  held as (
    select
      allocation.product_id,
      sum(greatest(0,
        allocation.issued_quantity
        - coalesce(allocation.sold_quantity, 0)
        - coalesce(allocation.returned_quantity, 0)
        - coalesce(allocation.damaged_quantity, 0)
      )) as held_quantity
    from public.bag_allocations allocation
    where allocation.branch_id = session_row.branch_id
      and allocation.settled_at is null
    group by allocation.product_id
  )
  select
    gen_random_uuid(),
    session_row.branch_id,
    counters.product_id,
    'count'::public.stock_movement_type,
    counters.counter_quantity + coalesce(held.held_quantity, 0),
    session_row.business_date,
    '[AUTO-CLOSE] [' || session_row.sequence || '] closing count: counter ' || counters.counter_quantity || ', held ' || coalesce(held.held_quantity, 0),
    p_session_id,
    auth.uid(),
    ended
  from counters
  left join held on held.product_id = counters.product_id
  on conflict do nothing;

  update public.bag_shift_sessions
  set
    status = 'closed',
    closing_balances = closing_json,
    discrepancy_note = nullif(trim(coalesce(p_discrepancy_note, '')), ''),
    ended_at = ended
  where id = p_session_id
    and status = 'open';

  update public.bag_allocations allocation
  set posted_at = ended
  where (allocation.shift_id = p_session_id or allocation.settlement_shift_id = p_session_id)
    and allocation.posted_at is null
    and (coalesce(allocation.sold_quantity, 0) > 0 or coalesce(allocation.damaged_quantity, 0) > 0);
end;
$$;

grant execute on function public.close_bag_shift_safe(uuid, jsonb, text, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
