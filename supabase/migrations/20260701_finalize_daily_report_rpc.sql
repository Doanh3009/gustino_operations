-- Close daily reports in one transaction so shift leaders, managers, and admins
-- see the same finalized data across report, revenue, and operation-day views.

create unique index if not exists report_snapshots_one_per_branch_day_idx
  on public.report_snapshots(branch_id, report_date);

create or replace function public.finalize_daily_report(
  p_branch_id text,
  p_report_date date,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  operation_day_id uuid;
begin
  select * into actor from public.profiles where id = auth.uid() and active = true;

  if actor.id is null then
    raise exception 'Tai khoan chua san sang de chot bao cao.';
  end if;

  if actor.role not in ('shift_leader', 'manager', 'admin') then
    raise exception 'Ban khong co quyen chot bao cao.';
  end if;

  if actor.role = 'shift_leader' and actor.branch_id <> p_branch_id then
    raise exception 'Ca truong chi duoc chot bao cao chi nhanh cua minh.';
  end if;

  if actor.role in ('manager', 'admin') and not public.can_manage_branch(p_branch_id) then
    raise exception 'Ban khong co quyen quan ly chi nhanh nay.';
  end if;

  insert into public.operation_days (
    id,
    branch_id,
    business_date,
    status,
    opened_by,
    opened_at
  )
  values (
    gen_random_uuid(),
    p_branch_id,
    p_report_date,
    'open',
    actor.id,
    now()
  )
  on conflict (branch_id, business_date) do update
    set status = case
      when public.operation_days.status = 'closed' then public.operation_days.status
      else excluded.status
    end
  returning id into operation_day_id;

  insert into public.report_snapshots (
    id,
    branch_id,
    report_date,
    created_by,
    payload,
    created_at
  )
  values (
    gen_random_uuid(),
    p_branch_id,
    p_report_date,
    actor.id,
    p_payload,
    now()
  )
  on conflict (branch_id, report_date) do update
    set payload = excluded.payload,
        created_by = excluded.created_by,
        created_at = now();

  update public.operation_days
  set status = 'closed',
      closed_by = actor.id,
      closed_at = now()
  where branch_id = p_branch_id
    and business_date = p_report_date;
end;
$$;

grant execute on function public.finalize_daily_report(text, date, jsonb) to authenticated;

notify pgrst, 'reload schema';
