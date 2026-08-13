select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'branch_kpi_formulas'
  and column_name = 'effective_from';
