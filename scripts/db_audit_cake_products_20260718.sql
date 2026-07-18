begin transaction read only;

select jsonb_build_object(
  'cake_rows', (
    select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at), '[]'::jsonb)
    from (
      select id, sku, name, unit, category, active, source, deleted_at, created_at, updated_at, recipe
      from public.products
      where lower(coalesce(name, '')) like '%bánh%hạt%dẻ%'
         or upper(coalesce(sku, '')) like '%BANH%'
         or id in ('cake-raw', 'cake-ready', 'cake-box')
    ) p
  ),
  'cake_movements', (
    select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc), '[]'::jsonb)
    from (
      select id, branch_id, product_id, movement_type, quantity, shift_date, source_product_id, source_quantity, created_at
      from public.stock_movements
      where product_id in ('cake-raw', 'cake-ready', 'cake-box')
         or source_product_id in ('cake-raw', 'cake-ready', 'cake-box')
      order by created_at desc
      limit 100
    ) m
  )
) as cake_product_audit;

rollback;
