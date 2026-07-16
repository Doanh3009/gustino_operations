-- One-off go-live video seed for July 4, 2026 demo.
-- Creates July 3, 2026 approved registrations across the 3 real branches and
-- fake internal sales receipts. Idempotent: rerunning replaces rows with DEMO-YD-*.

begin;

select public.seed_default_work_shifts(branch.id)
from public.branches branch
where branch.id in ('gold-coast', 'lotte-2310', 'lotte-vt')
  and branch.active = true;

delete from public.sales_receipt_items item
using public.sales_receipts receipt
where item.receipt_id = receipt.id
  and receipt.business_date = date '2026-07-03'
  and receipt.code like 'DEMO-YD-%';

delete from public.sales_receipts
where business_date = date '2026-07-03'
  and code like 'DEMO-YD-%';

delete from public.shift_registrations registration
where registration.work_date = date '2026-07-03'
  and registration.note = 'Demo video seed'
  and not exists (
    select 1
    from public.attendance_records attendance
    where attendance.shift_registration_id = registration.id
  );

with actor as (
  select id
  from public.profiles
  where active = true and role = 'admin'
  order by created_at nulls last, id
  limit 1
), people as (
  select
    profile.*,
    row_number() over (
      partition by profile.branch_id
      order by
        case profile.role when 'shift_leader' then 0 else 1 end,
        profile.full_name
    ) as branch_index
  from public.profiles profile
  where profile.active = true
    and profile.role in ('shift_leader', 'staff')
    and profile.branch_id in ('gold-coast', 'lotte-2310', 'lotte-vt')
), planned as (
  select
    people.id as user_id,
    people.branch_id,
    people.employment_type,
    people.position_title,
    case
      when people.employment_type = 'part_time' and people.branch_index % 2 = 1 then 'Ca PT sang'
      when people.employment_type = 'part_time' then 'Ca PT chieu'
      when people.branch_index % 2 = 1 then 'Ca 1'
      else 'Ca 2'
    end as shift_name
  from people
), chosen as (
  select
    planned.*,
    shift.id as shift_id,
    shift.start_time,
    shift.end_time
  from planned
  join public.shifts shift
    on shift.branch_id = planned.branch_id
   and shift.name = planned.shift_name
   and shift.active = true
)
insert into public.shift_registrations (
  user_id,
  branch_id,
  shift_id,
  work_date,
  start_time,
  end_time,
  status,
  note,
  reviewed_by,
  reviewed_at,
  employment_type,
  position_title,
  created_at
)
select
  chosen.user_id,
  chosen.branch_id,
  chosen.shift_id,
  date '2026-07-03',
  chosen.start_time,
  chosen.end_time,
  'approved',
  'Demo video seed',
  (select id from actor),
  now(),
  chosen.employment_type,
  chosen.position_title,
  timestamp with time zone '2026-07-03 09:00:00+07'
from chosen
on conflict (user_id, work_date, start_time, end_time) do update
set
  branch_id = excluded.branch_id,
  shift_id = excluded.shift_id,
  status = 'approved',
  note = excluded.note,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at,
  employment_type = excluded.employment_type,
  position_title = excluded.position_title
where not exists (
  select 1
  from public.attendance_records attendance
  where attendance.shift_registration_id = public.shift_registrations.id
);

with actor as (
  select id
  from public.profiles
  where active = true and role = 'admin'
  order by created_at nulls last, id
  limit 1
), sellers as (
  select
    profile.id,
    profile.full_name,
    profile.branch_id,
    row_number() over (
      partition by profile.branch_id
      order by
        case profile.role when 'shift_leader' then 0 else 1 end,
        profile.full_name
    ) as branch_index
  from public.profiles profile
  where profile.active = true
    and profile.role in ('shift_leader', 'staff')
    and profile.branch_id in ('gold-coast', 'lotte-2310', 'lotte-vt')
), product_catalog as (
  select *
  from (values
    (1, 'chestnut-110', 'Hạt dẻ rang 110g', 30000::numeric),
    (2, 'chestnut-330', 'Hạt dẻ rang 330g', 80000::numeric),
    (3, 'chestnut-500', 'Hạt dẻ rang 500g', 120000::numeric),
    (4, 'snow-110', 'Hạt dẻ tuyết 110g', 30000::numeric),
    (5, 'grilled-330', 'Hạt dẻ nướng 330g', 80000::numeric),
    (6, 'potato-500', 'Khoai lang mật 500g', 120000::numeric)
  ) as product(sort_order, product_id, product_name, unit_price)
  where exists (
    select 1 from public.products product
    where product.id = product_id
  )
), receipt_plan as (
  select
    gen_random_uuid() as receipt_id,
    concat('DEMO-YD-', sellers.branch_id, '-', sellers.branch_index) as code,
    sellers.branch_id,
    sellers.id as seller_id,
    sellers.full_name as seller_name,
    sellers.branch_index,
    timestamp with time zone '2026-07-03 10:30:00+07'
      + ((sellers.branch_index * 37) || ' minutes')::interval as created_at,
    ((sellers.branch_index % 4) + 3)::numeric as quantity,
    catalog.product_id,
    catalog.product_name,
    catalog.unit_price
  from sellers
  join lateral (
    select *
    from product_catalog
    order by ((product_catalog.sort_order + sellers.branch_index) % 6)
    limit 1
  ) catalog on true
  where sellers.branch_index <= 4
), inserted_receipts as (
  insert into public.sales_receipts (
    id,
    code,
    branch_id,
    business_date,
    seller_id,
    seller_name,
    payment_method,
    total_quantity,
    total_amount,
    created_by,
    created_at
  )
  select
    receipt_id,
    code,
    branch_id,
    date '2026-07-03',
    seller_id,
    seller_name,
    'cash',
    quantity,
    quantity * unit_price,
    (select id from actor),
    created_at
  from receipt_plan
  returning id
)
insert into public.sales_receipt_items (
  receipt_id,
  allocation_id,
  product_id,
  product_name,
  quantity,
  unit_price,
  line_total,
  created_at
)
select
  receipt_plan.receipt_id,
  null,
  receipt_plan.product_id,
  receipt_plan.product_name,
  receipt_plan.quantity,
  receipt_plan.unit_price,
  receipt_plan.quantity * receipt_plan.unit_price,
  receipt_plan.created_at
from receipt_plan
join inserted_receipts on inserted_receipts.id = receipt_plan.receipt_id;

commit;
