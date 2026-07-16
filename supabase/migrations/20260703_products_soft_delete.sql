-- Keep deletions of built-in products/menu items durable.
-- The app merges cloud products with a built-in catalog, so hard-deleting a
-- built-in row lets it reappear. deleted_at is a cloud tombstone.

alter table public.products
add column if not exists deleted_at timestamptz;

create index if not exists products_deleted_idx
  on public.products (deleted_at)
  where deleted_at is not null;

notify pgrst, 'reload schema';
