-- Historical employee revenue supplied by the owner for days before web POS was used.
-- These rows merge into daily and total KPI revenue only; they are not POS receipts
-- and must never deduct stock. Existing web revenue is not duplicated.
-- EXPECTED_OWNER_SUPPLEMENT_ROWS=27
-- EXPECTED_OWNER_SUPPLEMENT_TOTAL=19444000

create table if not exists public.employee_kpi_revenue_adjustments (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  branch_id text not null references public.branches(id),
  employee_id uuid not null references public.profiles(id),
  business_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  reason text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists employee_kpi_revenue_adjustments_period_idx
  on public.employee_kpi_revenue_adjustments (business_date, branch_id, employee_id);

alter table public.employee_kpi_revenue_adjustments enable row level security;

drop policy if exists "kpi revenue adjustments are readable in scope"
  on public.employee_kpi_revenue_adjustments;
create policy "kpi revenue adjustments are readable in scope"
  on public.employee_kpi_revenue_adjustments
  for select
  to authenticated
  using (
    employee_id = auth.uid()
    or public.can_manage_branch(branch_id)
    or exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and coalesce(actor.active, true)
        and actor.role::text in ('admin', 'manager', 'supmt')
    )
  );

revoke all on public.employee_kpi_revenue_adjustments from anon;
grant select on public.employee_kpi_revenue_adjustments to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.employee_kpi_revenue_adjustments;
exception when duplicate_object then null;
end $$;

insert into public.employee_kpi_revenue_adjustments
  (source_key, branch_id, employee_id, business_date, amount, reason)
values
  ('owner-20260810-2026-07-03-ngoc-ly', 'lotte-2310', '07a30b92-5e6a-404f-95d9-4ab6d7a26b0a', date '2026-07-03', 560000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-04-my-quyen', 'lotte-2310', '6d05ecc1-d7bd-4ba3-a8be-3289e3d638b7', date '2026-07-04', 603000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-04-hoan-vy', 'lotte-vt', 'c712b5ca-a030-457d-a759-d2335cb51a9d', date '2026-07-04', 1135000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-05-le-quyen', 'lotte-2310', 'e75c3973-f56a-44ab-9b19-c3b6ae1710c6', date '2026-07-05', 576000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-05-uyen-thu', 'lotte-2310', '774e6d39-bf11-4e5d-b718-11925706f43b', date '2026-07-05', 1303000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-05-thuy-trinh', 'lotte-2310', '9299f412-6be4-4b38-9e9e-e135300a947c', date '2026-07-05', 1365000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-06-phuong-anh', 'lotte-vt', 'cf1f1f60-ab61-4772-befd-98424cc0ec6f', date '2026-07-06', 1118000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-06-phung-quynh', 'lotte-vt', '930a6c8f-094a-466d-be85-12d161b6f2f7', date '2026-07-06', 582000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-06-le-quyen', 'lotte-2310', 'e75c3973-f56a-44ab-9b19-c3b6ae1710c6', date '2026-07-06', 867000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-06-thuy-trinh', 'lotte-2310', '9299f412-6be4-4b38-9e9e-e135300a947c', date '2026-07-06', 1669000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-06-minh-ly', 'gold-coast', 'ecf91e2b-0add-4720-b7a0-9cca1b3dab88', date '2026-07-06', 409000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-06-truong-thi-phuong', 'gold-coast', 'd2654d6d-6f1d-4052-9ab8-4a5104a47b13', date '2026-07-06', 328000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-07-le-quyen', 'lotte-2310', 'e75c3973-f56a-44ab-9b19-c3b6ae1710c6', date '2026-07-07', 455000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-07-uyen-thu', 'lotte-2310', '774e6d39-bf11-4e5d-b718-11925706f43b', date '2026-07-07', 854000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-07-thuy-trinh', 'lotte-2310', '9299f412-6be4-4b38-9e9e-e135300a947c', date '2026-07-07', 1129000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-07-nhat-an', 'gold-coast', 'a7c1b66b-abb6-448e-9a5e-628b3d28bb89', date '2026-07-07', 1180000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-07-bao-linh', 'gold-coast', 'bb42ecd5-9e95-4fa7-bd4c-32b83dcb4992', date '2026-07-07', 546000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-07-minh-ly', 'gold-coast', 'ecf91e2b-0add-4720-b7a0-9cca1b3dab88', date '2026-07-07', 346000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-08-dinh-phat', 'gold-coast', '0119a432-48e4-42e3-890a-d36c3b6c3b8a', date '2026-07-08', 577000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-08-thuy-trinh', 'lotte-2310', '9299f412-6be4-4b38-9e9e-e135300a947c', date '2026-07-08', 1050000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-08-my-quyen', 'lotte-2310', '6d05ecc1-d7bd-4ba3-a8be-3289e3d638b7', date '2026-07-08', 511000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-08-le-quyen', 'lotte-2310', 'e75c3973-f56a-44ab-9b19-c3b6ae1710c6', date '2026-07-08', 402000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-08-yen', 'lotte-2310', '570f3d38-49b5-453f-962d-470650cebe0b', date '2026-07-08', 333000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-08-thao-nguyen', 'lotte-2310', 'e281bcf2-521b-466a-abb3-bd72bd1139a9', date '2026-07-08', 366000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-09-bao-tran', 'gold-coast', '24efd4c4-53c3-4a74-a2fd-d9d21942ad23', date '2026-07-09', 608000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-09-ngoc-tram', 'gold-coast', '15ee6bc3-8c5c-461c-b119-eec5a2be9840', date '2026-07-09', 539000, 'Doanh thu thực tế trước khi chi nhánh dùng web; owner bổ sung vào KPI tổng.'),
  ('owner-20260810-2026-07-09-minh-ly-delta', 'gold-coast', 'ecf91e2b-0add-4720-b7a0-9cca1b3dab88', date '2026-07-09', 33000, 'Bổ sung phần chênh KPI: hệ thống đã có 455.000đ, owner xác nhận tổng đúng là 488.000đ.')
on conflict (source_key) do update
set branch_id = excluded.branch_id,
    employee_id = excluded.employee_id,
    business_date = excluded.business_date,
    amount = excluded.amount,
    reason = excluded.reason;

notify pgrst, 'reload schema';
