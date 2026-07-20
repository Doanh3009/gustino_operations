begin transaction read only;
select
  b.id, b.name, b.active,
  count(distinct p.id) filter (where p.active = true) as active_profiles,
  count(distinct r.id) filter (where r.business_date = current_date) as today_receipts,
  coalesce(sum(distinct case when r.business_date = current_date then r.total_amount end), 0) as diagnostic_distinct_total
from public.branches b
left join public.profiles p on p.branch_id = b.id
left join public.sales_receipts r on r.branch_id = b.id
where b.id = 'lotte-vt'
group by b.id, b.name, b.active;

select
  p.id, p.full_name, p.email, p.role, p.branch_id, p.active,
  coalesce(array_agg(m.branch_id) filter (where m.branch_id is not null), '{}') as assigned_branches
from public.profiles p
left join public.manager_branch_assignments m on m.manager_id = p.id
where p.active = true and p.role in ('admin', 'manager')
group by p.id
order by p.role, p.full_name;
rollback;
