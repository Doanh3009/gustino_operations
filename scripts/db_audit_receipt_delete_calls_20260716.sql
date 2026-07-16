begin transaction read only;

select
  calls,
  rows,
  total_exec_time,
  query
from extensions.pg_stat_statements
where query ilike '%delete_pos_receipt%'
   or (
     query ilike '%delete%'
     and query ilike '%sales_receipt%'
   )
order by calls desc, total_exec_time desc;

rollback;
