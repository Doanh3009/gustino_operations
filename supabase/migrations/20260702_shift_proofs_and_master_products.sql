-- 1) Ảnh quầy đầu/cuối ca: cột + bucket + policy (bản 20260625 chưa từng được apply lên DB thật).
-- 2) Đồng bộ dữ liệu nền (menu/SKU/giá/định mức NVL) qua bảng public.products
--    để mọi thiết bị nhìn cùng một menu thay vì localStorage từng máy.

-- ===== Shift proof photos =====
alter table public.bag_shift_sessions
add column if not exists opening_photo_url text,
add column if not exists closing_photo_url text;

insert into storage.buckets (id, name, public)
values ('shift-proofs', 'shift-proofs', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "shift leaders upload shift proofs" on storage.objects;
create policy "shift leaders upload shift proofs" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'shift-proofs'
  and (
    (
      (storage.foldername(name))[1] = (public.current_profile()).branch_id
      and (public.current_profile()).role = 'shift_leader'
    )
    or (
      (public.current_profile()).role in ('manager', 'admin')
      and public.can_manage_branch((storage.foldername(name))[1])
    )
  )
);

drop policy if exists "branch users read shift proofs" on storage.objects;
create policy "branch users read shift proofs" on storage.objects
for select to authenticated
using (bucket_id = 'shift-proofs');

-- ===== Master products (menu + SKU) =====
alter table public.products
add column if not exists price numeric not null default 0,
add column if not exists source text not null default 'system',
add column if not exists weight_kg numeric,
add column if not exists counts_for_yield boolean,
add column if not exists inbound_unit text,
add column if not exists inbound_pack_kg numeric,
add column if not exists inbound_pack_quantity numeric,
add column if not exists recipe jsonb,
add column if not exists updated_by uuid,
add column if not exists updated_at timestamptz not null default now();

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
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
    ) then
      alter publication supabase_realtime add table public.products;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
