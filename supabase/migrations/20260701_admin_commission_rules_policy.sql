-- Allow System Admin to configure branch revenue KPI and commission rules.
-- Older commission_rules policy only accepted role = 'manager', so Admin UI
-- could edit the draft field but Postgres rejected the save through RLS.

drop policy if exists "managers update commission rules" on public.commission_rules;
create policy "managers update commission rules" on public.commission_rules
for all to authenticated using (
  (public.current_profile()).role in ('admin', 'manager')
  and public.can_manage_branch(branch_id)
) with check (
  (public.current_profile()).role in ('admin', 'manager')
  and public.can_manage_branch(branch_id)
);

notify pgrst, 'reload schema';
