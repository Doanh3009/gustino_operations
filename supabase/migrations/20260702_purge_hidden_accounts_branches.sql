-- Hard-purge rows that were previously only hidden by active=false.
-- Inactive branches are removed with their branch-owned business data.
-- Inactive accounts are removed from public.profiles and auth.users after
-- personal schedules/payroll are deleted and required audit references are
-- reassigned to one active admin.

do $$
declare
  purge_branch_ids text[] := '{}';
  purge_profile_ids uuid[] := '{}';
  purge_schedule_person_ids uuid[] := '{}';
  purge_receipt_ids uuid[] := '{}';
  purge_session_ids uuid[] := '{}';
  replacement_user uuid;
begin
  select id into replacement_user
  from public.profiles
  where role = 'admin' and active = true
  order by created_at
  limit 1;

  select coalesce(array_agg(id), '{}') into purge_branch_ids
  from public.branches
  where active = false;

  select coalesce(array_agg(id), '{}') into purge_profile_ids
  from public.profiles
  where (
      active = false
      or (array_length(purge_branch_ids, 1) is not null and branch_id = any(purge_branch_ids))
    )
    and (replacement_user is null or id <> replacement_user);

  if array_length(purge_branch_ids, 1) is not null then
    select coalesce(array_agg(id), '{}') into purge_receipt_ids
    from public.sales_receipts
    where branch_id = any(purge_branch_ids);

    if array_length(purge_receipt_ids, 1) is not null then
      delete from public.sales_receipt_items
      where receipt_id = any(purge_receipt_ids);
    end if;

    delete from public.sales_receipts where branch_id = any(purge_branch_ids);

    select coalesce(array_agg(id), '{}') into purge_session_ids
    from public.bag_shift_sessions
    where branch_id = any(purge_branch_ids);

    if array_length(purge_session_ids, 1) is not null then
      update public.bag_allocations
      set settlement_shift_id = null
      where settlement_shift_id = any(purge_session_ids);
    end if;

    delete from public.bag_allocations where branch_id = any(purge_branch_ids);
    delete from public.bag_shift_sessions where branch_id = any(purge_branch_ids);
    delete from public.stock_movements where branch_id = any(purge_branch_ids);
    delete from public.report_snapshots where branch_id = any(purge_branch_ids);
    delete from public.inventory_reports where branch_id = any(purge_branch_ids);
    delete from public.operation_days where branch_id = any(purge_branch_ids);
    delete from public.supply_requests where branch_id = any(purge_branch_ids);
    delete from public.attendance_records where branch_id = any(purge_branch_ids);
    delete from public.shift_registrations where branch_id = any(purge_branch_ids);
    delete from public.schedule_entries where branch_id = any(purge_branch_ids);
    delete from public.schedule_people where branch_id = any(purge_branch_ids);
    delete from public.manager_branch_assignments where branch_id = any(purge_branch_ids);
    delete from public.shifts where branch_id = any(purge_branch_ids);

    if to_regclass('public.payroll_entries') is not null then
      execute 'delete from public.payroll_entries where branch_id = any($1)' using purge_branch_ids;
    end if;
    if to_regclass('public.payroll_role_defaults') is not null then
      execute 'delete from public.payroll_role_defaults where branch_id = any($1)' using purge_branch_ids;
    end if;
    if to_regclass('public.payroll_kpi_metrics') is not null then
      execute 'delete from public.payroll_kpi_metrics where branch_id = any($1)' using purge_branch_ids;
    end if;
    if to_regclass('public.payroll_bonus_ledger') is not null then
      execute 'delete from public.payroll_bonus_ledger where branch_id = any($1)' using purge_branch_ids;
    end if;
    if to_regclass('public.employee_kpi_targets') is not null then
      execute 'delete from public.employee_kpi_targets where branch_id = any($1)' using purge_branch_ids;
    end if;
    if to_regclass('public.commission_rules') is not null then
      execute 'delete from public.commission_rules where branch_id = any($1)' using purge_branch_ids;
    end if;
  end if;

  if array_length(purge_profile_ids, 1) is not null then
    select coalesce(array_agg(id), '{}') into purge_schedule_person_ids
    from public.schedule_people
    where profile_id = any(purge_profile_ids);

    if array_length(purge_schedule_person_ids, 1) is not null then
      delete from public.schedule_entries
      where person_id = any(purge_schedule_person_ids);
      delete from public.schedule_people
      where id = any(purge_schedule_person_ids);
    end if;

    delete from public.attendance_records where user_id = any(purge_profile_ids);
    delete from public.shift_registrations where user_id = any(purge_profile_ids);
    delete from public.manager_branch_assignments where manager_id = any(purge_profile_ids);

    update public.sales_receipts set seller_id = null where seller_id = any(purge_profile_ids);
    update public.supply_requests set requested_by = null where requested_by = any(purge_profile_ids);
    update public.shift_registrations set reviewed_by = null where reviewed_by = any(purge_profile_ids);
    update public.schedule_entries set updated_by = null where updated_by = any(purge_profile_ids);
    update public.bag_allocations set settled_by = null where settled_by = any(purge_profile_ids);
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'bag_allocations' and column_name = 'employee_id'
    ) then
      execute 'update public.bag_allocations set employee_id = null where employee_id = any($1)' using purge_profile_ids;
    end if;

    if replacement_user is not null then
      update public.sales_receipts set created_by = replacement_user where created_by = any(purge_profile_ids);
      update public.stock_movements set created_by = replacement_user where created_by = any(purge_profile_ids);
      update public.inventory_reports set created_by = replacement_user where created_by = any(purge_profile_ids);
      update public.report_snapshots set created_by = replacement_user where created_by = any(purge_profile_ids);
      update public.operation_days set opened_by = replacement_user where opened_by = any(purge_profile_ids);
      update public.shifts set created_by = replacement_user where created_by = any(purge_profile_ids);
      update public.bag_shift_sessions set leader_id = replacement_user where leader_id = any(purge_profile_ids);
      update public.bag_allocations set issued_by = replacement_user where issued_by = any(purge_profile_ids);
    end if;
    update public.operation_days set closed_by = null where closed_by = any(purge_profile_ids);

    if to_regclass('public.payroll_entries') is not null then
      execute 'delete from public.payroll_entries where employee_id = any($1)' using purge_profile_ids;
    end if;
    if to_regclass('public.employee_kpi_targets') is not null then
      execute 'update public.employee_kpi_targets set employee_id = null where employee_id = any($1)' using purge_profile_ids;
      execute 'update public.employee_kpi_targets set updated_by = null where updated_by = any($1)' using purge_profile_ids;
    end if;
    if to_regclass('public.payroll_kpi_metrics') is not null then
      execute 'update public.payroll_kpi_metrics set employee_id = null where employee_id = any($1)' using purge_profile_ids;
    end if;
    if to_regclass('public.payroll_bonus_ledger') is not null then
      execute 'update public.payroll_bonus_ledger set employee_id = null where employee_id = any($1)' using purge_profile_ids;
      execute 'update public.payroll_bonus_ledger set created_by = null where created_by = any($1)' using purge_profile_ids;
    end if;
    if to_regclass('public.commission_rules') is not null then
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'commission_rules' and column_name = 'employee_id'
      ) then
        execute 'update public.commission_rules set employee_id = null where employee_id = any($1)' using purge_profile_ids;
      end if;
      execute 'update public.commission_rules set updated_by = null where updated_by = any($1)' using purge_profile_ids;
    end if;

    delete from public.profiles where id = any(purge_profile_ids);

    if to_regclass('auth.users') is not null then
      delete from auth.users where id = any(purge_profile_ids);
    end if;
  end if;

  if array_length(purge_branch_ids, 1) is not null then
    delete from public.profiles where branch_id = any(purge_branch_ids);
    delete from public.branches where id = any(purge_branch_ids);
  end if;
end $$;

notify pgrst, 'reload schema';
