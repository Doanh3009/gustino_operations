begin transaction read only;

select
  branch_id,
  sequence,
  status,
  opening_balances,
  closing_balances,
  started_at,
  ended_at
from public.bag_shift_sessions
where business_date = (timezone('Asia/Bangkok', now()))::date
order by branch_id, sequence;

rollback;
