-- Desired delivery schedule for Kitchen orders.
-- Nullable columns preserve historical requests without inventing delivery dates.

alter table public.supply_requests
  add column if not exists requested_delivery_date date,
  add column if not exists requested_delivery_period text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'supply_requests_delivery_period_check'
      and conrelid = 'public.supply_requests'::regclass
  ) then
    alter table public.supply_requests
      add constraint supply_requests_delivery_period_check
      check (
        requested_delivery_period is null
        or requested_delivery_period in ('morning', 'noon', 'afternoon')
      );
  end if;
end $$;

comment on column public.supply_requests.requested_delivery_date
  is 'Date requested by the branch for receiving this order; null for legacy rows.';
comment on column public.supply_requests.requested_delivery_period
  is 'Requested receiving period: morning, noon, or afternoon; null for legacy rows.';
