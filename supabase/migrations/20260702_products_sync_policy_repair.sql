-- Keep menu/SKU as the cloud master data for every role and every device.
alter table public.products enable row level security;

drop policy if exists "authenticated read products" on public.products;
create policy "authenticated read products" on public.products
for select to authenticated
using (true);

drop policy if exists "admins manage products" on public.products;
create policy "admins manage products" on public.products
for all to authenticated
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'products'
    ) then
      alter publication supabase_realtime add table public.products;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
