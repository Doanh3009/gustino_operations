-- Cloud-backed Control Center data that was previously browser-local only.
-- Keeps permission matrix, Lotte reconciliation rows, and audit log shared
-- across devices before production release.

create table if not exists public.control_permission_matrix (
  role text not null,
  module_id text not null,
  actions text[] not null default '{}',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (role, module_id)
);

create table if not exists public.lotte_reconciliation_lines (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches(id) on delete cascade,
  business_date date not null,
  order_code text not null,
  lotte_bill_code text not null,
  quantity numeric(14,3) not null default 0,
  amount numeric(14,2) not null default 0,
  note text not null default '',
  resolved boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists lotte_reconciliation_branch_date_idx
  on public.lotte_reconciliation_lines (branch_id, business_date desc, created_at desc);

create table if not exists public.control_audit_entries (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null default '',
  module text not null,
  action text not null,
  detail text not null,
  before_value text,
  after_value text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists control_audit_entries_created_idx
  on public.control_audit_entries (created_at desc);

alter table public.control_permission_matrix enable row level security;
alter table public.lotte_reconciliation_lines enable row level security;
alter table public.control_audit_entries enable row level security;

drop policy if exists "managers read permission matrix" on public.control_permission_matrix;
create policy "managers read permission matrix" on public.control_permission_matrix
for select to authenticated using ((public.current_profile()).role in ('admin', 'manager'));

drop policy if exists "admins manage permission matrix" on public.control_permission_matrix;
create policy "admins manage permission matrix" on public.control_permission_matrix
for all to authenticated
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');

drop policy if exists "managers read lotte reconciliation" on public.lotte_reconciliation_lines;
create policy "managers read lotte reconciliation" on public.lotte_reconciliation_lines
for select to authenticated using (
  (public.current_profile()).role in ('admin', 'manager')
  and public.can_manage_branch(branch_id)
);

drop policy if exists "managers manage lotte reconciliation" on public.lotte_reconciliation_lines;
create policy "managers manage lotte reconciliation" on public.lotte_reconciliation_lines
for all to authenticated using (
  (public.current_profile()).role in ('admin', 'manager')
  and public.can_manage_branch(branch_id)
) with check (
  (public.current_profile()).role in ('admin', 'manager')
  and public.can_manage_branch(branch_id)
);

drop policy if exists "managers read control audit" on public.control_audit_entries;
create policy "managers read control audit" on public.control_audit_entries
for select to authenticated using ((public.current_profile()).role in ('admin', 'manager'));

drop policy if exists "authenticated create control audit" on public.control_audit_entries;
create policy "authenticated create control audit" on public.control_audit_entries
for insert to authenticated with check (actor_id = auth.uid());

drop policy if exists "admins delete control audit" on public.control_audit_entries;
create policy "admins delete control audit" on public.control_audit_entries
for delete to authenticated using ((public.current_profile()).role = 'admin');

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'control_permission_matrix'
    ) then
      alter publication supabase_realtime add table public.control_permission_matrix;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'lotte_reconciliation_lines'
    ) then
      alter publication supabase_realtime add table public.lotte_reconciliation_lines;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'control_audit_entries'
    ) then
      alter publication supabase_realtime add table public.control_audit_entries;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
