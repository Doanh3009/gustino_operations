select
  s.branch_id,
  s.business_date,
  s.sequence,
  s.status,
  count(*) as sold_or_damaged_allocations,
  count(*) filter (
    where not exists (
      select 1
      from public.stock_movements m
      where m.document_id = a.id
        and m.product_id = a.product_id
        and m.movement_type = 'sale_out'
    )
    and coalesce(a.sold_quantity, 0) > 0
  ) as missing_sale_movements,
  count(*) filter (
    where not exists (
      select 1
      from public.stock_movements m
      where m.document_id = a.id
        and m.product_id = a.product_id
        and m.movement_type = 'waste'
    )
    and coalesce(a.damaged_quantity, 0) > 0
  ) as missing_waste_movements
from public.bag_allocations a
join public.bag_shift_sessions s on s.id = coalesce(a.settlement_shift_id, a.shift_id)
where s.status = 'closed'
  and s.started_at >= now() - interval '14 days'
  and (coalesce(a.sold_quantity, 0) > 0 or coalesce(a.damaged_quantity, 0) > 0)
group by s.branch_id, s.business_date, s.sequence, s.status
order by s.business_date desc, s.branch_id, s.sequence;
