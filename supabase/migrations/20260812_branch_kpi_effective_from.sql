-- Add a structured effective date for Admin-edited branch KPI levels.
--
-- Existing rows stay valid with NULL so historical overrides keep their old behavior.
-- New saves in the Admin UI require a date before writing.

alter table public.branch_kpi_formulas
  add column if not exists effective_from date;

comment on column public.branch_kpi_formulas.effective_from is
  'Business date when this branch KPI override starts applying. NULL preserves legacy overrides created before structured effective dates.';

notify pgrst, 'reload schema';
