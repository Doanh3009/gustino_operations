-- One-off go-live video seed: make the app look like the team used it for 1 week.
-- Range: 2026-06-27..2026-07-03. Idempotent for rows tagged DEMO-WEEK-* / Demo week seed.

begin;

select public.seed_default_work_shifts(branch.id)
from public.branches branch
where branch.id in ('gold-coast', 'lotte-2310', 'lotte-vt')
  and branch.active = true;

delete from public.sales_receipt_items item
using public.sales_receipts receipt
where item.receipt_id = receipt.id
  and (
    receipt.code like 'DEMO-WEEK-%'
    or receipt.code like 'DEMO-YD-%'
  );

delete from public.sales_receipts
where code like 'DEMO-WEEK-%'
   or code like 'DEMO-YD-%';

delete from public.attendance_records record
using public.shift_registrations registration
where record.shift_registration_id = registration.id
  and registration.note in ('Demo week seed', 'Demo video seed');

delete from public.shift_registrations
where note in ('Demo week seed', 'Demo video seed')
  and not exists (
    select 1 from public.attendance_records record
    where record.shift_registration_id = public.shift_registrations.id
  );

delete from public.bag_allocations allocation
using public.bag_shift_sessions session
where allocation.shift_id = session.id
  and session.discrepancy_note = 'Demo week seed';

delete from public.bag_shift_sessions
where discrepancy_note = 'Demo week seed';

create temp table demo_days on commit drop as
select (date '2026-06-27' + offset_value)::date as work_date, offset_value as day_index
from generate_series(0, 6) as offset_value;

create temp table demo_people on commit drop as
select
  profile.id,
  profile.full_name,
  profile.branch_id,
  profile.role,
  profile.employment_type,
  profile.position_title,
  row_number() over (
    partition by profile.branch_id
    order by
      case profile.role when 'shift_leader' then 0 else 1 end,
      profile.full_name
  ) as branch_index
from public.profiles profile
where profile.active = true
  and profile.role in ('shift_leader', 'staff')
  and profile.branch_id in ('gold-coast', 'lotte-2310', 'lotte-vt');

create temp table demo_leaders on commit drop as
select distinct on (branch_id)
  branch_id,
  id as leader_id,
  full_name as leader_name
from demo_people
order by branch_id, case role when 'shift_leader' then 0 else 1 end, full_name;

insert into public.bag_shift_sessions (
  id,
  branch_id,
  business_date,
  sequence,
  leader_id,
  leader_name,
  status,
  opening_balances,
  closing_balances,
  discrepancy_note,
  started_at,
  ended_at
)
select
  gen_random_uuid(),
  branch.id,
  day.work_date,
  sequence.value,
  leader.leader_id,
  leader.leader_name,
  'closed',
  jsonb_build_object('chestnut-110', 90 + day.day_index * 3, 'chestnut-330', 48 + day.day_index * 2, 'snow-110', 34 + day.day_index),
  jsonb_build_object('chestnut-110', 18 + day.day_index, 'chestnut-330', 12 + day.day_index, 'snow-110', 9 + day.day_index),
  'Demo week seed',
  ((day.work_date::text || case sequence.value when 1 then ' 07:15:00+07' else ' 14:15:00+07' end)::timestamptz),
  ((day.work_date::text || case sequence.value when 1 then ' 15:15:00+07' else ' 22:15:00+07' end)::timestamptz)
from demo_days day
cross join (values (1), (2)) as sequence(value)
join public.branches branch on branch.id in ('gold-coast', 'lotte-2310', 'lotte-vt') and branch.active = true
join demo_leaders leader on leader.branch_id = branch.id
on conflict (branch_id, business_date, sequence) do update
set
  leader_id = excluded.leader_id,
  leader_name = excluded.leader_name,
  status = excluded.status,
  opening_balances = excluded.opening_balances,
  closing_balances = excluded.closing_balances,
  discrepancy_note = excluded.discrepancy_note,
  started_at = excluded.started_at,
  ended_at = excluded.ended_at
where public.bag_shift_sessions.discrepancy_note in ('Demo week seed', 'Demo video seed');

create temp table demo_product_catalog on commit drop as
select *
from (values
  (1, 'chestnut-110', 'Hạt dẻ rang 110g', 30000::numeric),
  (2, 'chestnut-330', 'Hạt dẻ rang 330g', 80000::numeric),
  (3, 'chestnut-500', 'Hạt dẻ rang 500g', 120000::numeric),
  (4, 'snow-110', 'Hạt dẻ tuyết 110g', 30000::numeric),
  (5, 'grilled-330', 'Hạt dẻ nướng 330g', 80000::numeric),
  (6, 'potato-500', 'Khoai lang mật 500g', 120000::numeric)
) as catalog(sort_order, product_id, product_name, unit_price)
where exists (
  select 1 from public.products product
  where product.id = catalog.product_id
);

create temp table demo_planned_work on commit drop as
select
  person.id as user_id,
  person.full_name,
  person.branch_id,
  person.role,
  person.employment_type,
  person.position_title,
  person.branch_index,
  day.work_date,
  day.day_index,
  case
    when person.employment_type = 'part_time' and (person.branch_index + day.day_index) % 2 = 0 then 'Ca PT sang'
    when person.employment_type = 'part_time' then 'Ca PT chieu'
    when (person.branch_index + day.day_index) % 2 = 0 then 'Ca 1'
    else 'Ca 2'
  end as shift_name
from demo_people person
cross join demo_days day;

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
  work.user_id,
  work.branch_id,
  shift.id,
  work.work_date,
  shift.start_time,
  shift.end_time,
  'approved',
  'Demo week seed',
  leader.leader_id,
  now(),
  work.employment_type,
  work.position_title,
  ((work.work_date::text || ' 08:00:00+07')::timestamptz)
from demo_planned_work work
join public.shifts shift
  on shift.branch_id = work.branch_id
 and shift.name = work.shift_name
 and shift.active = true
join demo_leaders leader on leader.branch_id = work.branch_id
on conflict (user_id, work_date, start_time, end_time) do nothing;

insert into public.attendance_records (
  id,
  user_id,
  branch_id,
  shift_registration_id,
  check_in_time,
  check_out_time,
  selfie_url,
  check_in_latitude,
  check_in_longitude,
  check_in_accuracy,
  check_in_address,
  check_out_selfie_url,
  check_out_latitude,
  check_out_longitude,
  check_out_accuracy,
  check_out_address,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  registration.user_id,
  registration.branch_id,
  registration.id,
  ((registration.work_date::text || ' ' || registration.start_time::text || '+07')::timestamptz)
    + (((people.branch_index % 5) - 1) || ' minutes')::interval,
  ((registration.work_date::text || ' ' || registration.end_time::text || '+07')::timestamptz)
    - (((people.branch_index + planned.day_index) % 4) || ' minutes')::interval,
  'demo/week/check-in.jpg',
  case registration.branch_id when 'gold-coast' then 12.2388 when 'lotte-2310' then 12.2464 else 10.3460 end,
  case registration.branch_id when 'gold-coast' then 109.1967 when 'lotte-2310' then 109.1835 else 107.0843 end,
  18,
  'Demo check-in at Gustino branch',
  'demo/week/check-out.jpg',
  case registration.branch_id when 'gold-coast' then 12.2388 when 'lotte-2310' then 12.2464 else 10.3460 end,
  case registration.branch_id when 'gold-coast' then 109.1967 when 'lotte-2310' then 109.1835 else 107.0843 end,
  18,
  'Demo check-out at Gustino branch',
  ((registration.work_date::text || ' ' || registration.start_time::text || '+07')::timestamptz),
  ((registration.work_date::text || ' ' || registration.end_time::text || '+07')::timestamptz)
from public.shift_registrations registration
join demo_planned_work planned
  on planned.user_id = registration.user_id
 and planned.branch_id = registration.branch_id
 and planned.work_date = registration.work_date
join demo_people people on people.id = registration.user_id
where registration.note = 'Demo week seed'
  and not exists (
    select 1 from public.attendance_records existing
    where existing.shift_registration_id = registration.id
  );

create temp table demo_sessions on commit drop as
select *
from public.bag_shift_sessions
where discrepancy_note = 'Demo week seed'
  and business_date between date '2026-06-27' and date '2026-07-03';

create temp table demo_allocation_plan on commit drop as
select
  gen_random_uuid() as allocation_id,
  session.id as shift_id,
  session.branch_id,
  session.business_date,
  session.sequence,
  planned.user_id as employee_id,
  planned.full_name as employee_name,
  leader.leader_id,
  planned.branch_index,
  planned.day_index,
  product.product_id,
  product.product_name,
  product.unit_price,
  greatest(1, case
    when planned.employment_type = 'part_time' then 2 + ((planned.branch_index + planned.day_index) % 4)
    else 4 + ((planned.branch_index + planned.day_index) % 5)
  end + case when planned.role = 'shift_leader' then 1 else 0 end)::numeric as sold_quantity,
  ((planned.branch_index + planned.day_index) % 3)::numeric as returned_quantity,
  case when (planned.branch_index + planned.day_index) % 11 = 0 then 1::numeric else 0::numeric end as damaged_quantity
from demo_sessions session
join demo_planned_work planned
  on planned.branch_id = session.branch_id
 and planned.work_date = session.business_date
 and (
   (session.sequence = 1 and planned.shift_name in ('Ca 1', 'Ca PT sang'))
   or (session.sequence = 2 and planned.shift_name in ('Ca 2', 'Ca PT chieu'))
 )
join demo_leaders leader on leader.branch_id = session.branch_id
join lateral (
  select *
  from demo_product_catalog catalog
  order by ((catalog.sort_order + planned.branch_index + planned.day_index + session.sequence) % 6)
  limit 1
) product on true;

insert into public.bag_allocations (
  id,
  branch_id,
  shift_id,
  employee_name,
  employee_id,
  product_id,
  issued_quantity,
  sold_quantity,
  returned_quantity,
  damaged_quantity,
  issued_by,
  issued_at,
  settled_by,
  settlement_shift_id,
  settled_at,
  posted_at,
  posted_sold_quantity,
  posted_damaged_quantity
)
select
  allocation_id,
  branch_id,
  shift_id,
  employee_name,
  employee_id,
  product_id,
  sold_quantity + returned_quantity + damaged_quantity,
  sold_quantity,
  returned_quantity,
  damaged_quantity,
  leader_id,
  ((business_date::text || case sequence when 1 then ' 08:20:00+07' else ' 15:10:00+07' end)::timestamptz)
    + ((branch_index % 12) || ' minutes')::interval,
  leader_id,
  shift_id,
  ((business_date::text || case sequence when 1 then ' 15:00:00+07' else ' 22:00:00+07' end)::timestamptz)
    - ((branch_index % 10) || ' minutes')::interval,
  ((business_date::text || case sequence when 1 then ' 15:03:00+07' else ' 22:03:00+07' end)::timestamptz),
  sold_quantity,
  damaged_quantity
from demo_allocation_plan;

create temp table demo_receipt_plan on commit drop as
select
  gen_random_uuid() as receipt_id,
  allocation.allocation_id,
  concat(
    'DEMO-WEEK-',
    to_char(allocation.business_date, 'YYYYMMDD'),
    '-',
    allocation.branch_id,
    '-',
    row_number() over (partition by allocation.business_date, allocation.branch_id order by allocation.sequence, allocation.branch_index)
  ) as code,
  allocation.branch_id,
  allocation.business_date,
  allocation.employee_id as seller_id,
  allocation.employee_name as seller_name,
  allocation.product_id,
  allocation.product_name,
  allocation.sold_quantity,
  allocation.unit_price,
  allocation.sold_quantity * allocation.unit_price as line_total,
  ((allocation.business_date::text || case allocation.sequence when 1 then ' 11:00:00+07' else ' 18:00:00+07' end)::timestamptz)
    + ((allocation.branch_index * 9 + allocation.day_index * 3) || ' minutes')::interval as created_at,
  allocation.leader_id as created_by
from demo_allocation_plan allocation
where allocation.sold_quantity > 0;

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
  business_date,
  seller_id,
  seller_name,
  case when row_number() over (order by business_date, branch_id, code) % 3 = 0 then 'qr' else 'cash' end,
  sold_quantity,
  line_total,
  created_by,
  created_at
from demo_receipt_plan;

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
  receipt_id,
  allocation_id,
  product_id,
  product_name,
  sold_quantity,
  unit_price,
  line_total,
  created_at
from demo_receipt_plan;

commit;
