create or replace function public.close_bag_shift_safe(
  p_session_id uuid,
  p_closing_balances jsonb,
  p_discrepancy_note text,
  p_movements jsonb,
  p_posted_allocation_ids jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.bag_shift_sessions%rowtype;
  caller_role text;
  caller_branch text;
  ended timestamptz := now();
begin
  select * into session_row
  from public.bag_shift_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'Không tìm thấy ca bàn giao.';
  end if;

  select role::text, branch_id into caller_role, caller_branch
  from public.profiles
  where id = auth.uid();

  if caller_role is null then
    raise exception 'Không xác định được tài khoản đang đăng nhập.';
  end if;

  if caller_role not in ('shift_leader', 'manager', 'admin') then
    raise exception 'Tài khoản này không có quyền chốt bàn giao ca.';
  end if;

  if caller_role = 'shift_leader' and caller_branch <> session_row.branch_id then
    raise exception 'Không có quyền chốt ca của chi nhánh này.';
  end if;

  if session_row.status <> 'open' then
    return;
  end if;

  if jsonb_typeof(p_movements) = 'array' and jsonb_array_length(p_movements) > 0 then
    insert into public.stock_movements (
      id, branch_id, product_id, movement_type, quantity, shift_date, note,
      source_product_id, source_quantity, document_id, measured_weight_kg, created_by, created_at
    )
    select
      x.id,
      session_row.branch_id,
      x.product_id,
      x.movement_type::public.stock_movement_type,
      x.quantity,
      x.shift_date,
      coalesce(x.note, ''),
      x.source_product_id,
      x.source_quantity,
      coalesce(x.document_id, p_session_id),
      x.measured_weight_kg,
      auth.uid(),
      coalesce(x.created_at, ended)
    from jsonb_to_recordset(p_movements) as x(
      id uuid,
      product_id text,
      movement_type text,
      quantity numeric,
      shift_date date,
      note text,
      source_product_id text,
      source_quantity numeric,
      document_id uuid,
      measured_weight_kg numeric,
      created_at timestamptz
    );
  end if;

  update public.bag_shift_sessions
  set
    status = 'closed',
    closing_balances = coalesce(p_closing_balances, '{}'::jsonb),
    discrepancy_note = nullif(trim(coalesce(p_discrepancy_note, '')), ''),
    ended_at = ended
  where id = p_session_id;

  if jsonb_typeof(p_posted_allocation_ids) = 'array' and jsonb_array_length(p_posted_allocation_ids) > 0 then
    update public.bag_allocations
    set posted_at = ended
    where id in (
      select value::uuid
      from jsonb_array_elements_text(p_posted_allocation_ids)
    )
    and posted_at is null;
  end if;
end;
$$;

grant execute on function public.close_bag_shift_safe(uuid, jsonb, text, jsonb, jsonb) to authenticated;
