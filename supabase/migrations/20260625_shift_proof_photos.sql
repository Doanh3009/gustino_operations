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
  and (storage.foldername(name))[1] = (public.current_profile()).branch_id
  and (public.current_profile()).role = 'shift_leader'
);

drop policy if exists "branch users read shift proofs" on storage.objects;
create policy "branch users read shift proofs" on storage.objects
for select to authenticated
using (
  bucket_id = 'shift-proofs'
  and public.can_manage_branch((storage.foldername(name))[1])
);
