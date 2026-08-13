-- Mức KPI theo chi nhánh do Admin tự chỉnh trong giao diện.
--
-- Trước bản này, mọi mức KPI (ngày thường / cuối tuần / tháng) nằm cứng trong
-- `src/lib/commission.ts` (`POSITION_KPI_FORMULAS`), nên đổi một con số là phải
-- sửa code + build + deploy. Bảng này là lớp GHI ĐÈ: dòng nào có ở đây thì thắng
-- hằng số trong code; không có dòng thì vẫn dùng đúng mức mặc định như cũ.
--
-- Ai cũng ĐỌC được: nhân viên phải biết chỉ tiêu của chính mình mới cố gắng được,
-- và bảng thi đua dùng chung công thức này. Chỉ Admin được GHI.

create table if not exists public.branch_kpi_formulas (
  branch_id text not null references public.branches(id) on delete cascade,
  position text not null check (position in ('pg_part_time', 'pg_full_time', 'shift_deputy', 'shift_leader')),
  weekday_target numeric(14,0) not null default 0 check (weekday_target >= 0),
  weekend_target numeric(14,0) not null default 0 check (weekend_target >= 0),
  monthly_target numeric(14,0) not null default 0 check (monthly_target >= 0),
  -- Số người chuẩn của vị trí này tại chi nhánh, dùng để tính KPI team (Ca trưởng
  -- Vũng Tàu chạy theo target team chứ không có target cá nhân).
  headcount integer not null default 0 check (headcount >= 0),
  note text not null default '',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (branch_id, position)
);

alter table public.branch_kpi_formulas enable row level security;

drop policy if exists "everyone reads branch kpi formulas" on public.branch_kpi_formulas;
create policy "everyone reads branch kpi formulas"
  on public.branch_kpi_formulas
  for select
  to authenticated
  using (true);

drop policy if exists "admin writes branch kpi formulas" on public.branch_kpi_formulas;
create policy "admin writes branch kpi formulas"
  on public.branch_kpi_formulas
  for all
  to authenticated
  using ((select (public.current_profile()).role) = 'admin'::public.app_role)
  with check ((select (public.current_profile()).role) = 'admin'::public.app_role);

revoke all on public.branch_kpi_formulas from anon;
grant select on public.branch_kpi_formulas to authenticated;
grant insert, update, delete on public.branch_kpi_formulas to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.branch_kpi_formulas;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
