select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'attendance_records'
  and column_name in (
    'check_out_selfie_url',
    'check_out_latitude',
    'check_out_longitude',
    'check_out_accuracy',
    'check_out_address'
  )
order by column_name;
