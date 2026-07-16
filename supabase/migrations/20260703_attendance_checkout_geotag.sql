alter table public.attendance_records
add column if not exists check_out_selfie_url text,
add column if not exists check_out_latitude numeric(10,7),
add column if not exists check_out_longitude numeric(10,7),
add column if not exists check_out_accuracy numeric(10,2),
add column if not exists check_out_address text;

do $$
begin
  alter table public.attendance_records
    add constraint attendance_records_checkout_evidence_required
    check (
      check_out_time is null
      or (
        check_out_selfie_url is not null
        and length(trim(check_out_selfie_url)) > 0
        and check_out_latitude is not null
        and check_out_longitude is not null
        and check_out_accuracy is not null
        and check_out_address is not null
        and length(trim(check_out_address)) > 0
      )
    ) not valid;
exception
  when duplicate_object then null;
end $$;
