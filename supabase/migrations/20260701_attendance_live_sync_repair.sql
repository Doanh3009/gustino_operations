-- Ensure attendance changes reach manager timesheets in realtime.

do $$
begin
  alter publication supabase_realtime add table public.shift_registrations;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.attendance_records;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
