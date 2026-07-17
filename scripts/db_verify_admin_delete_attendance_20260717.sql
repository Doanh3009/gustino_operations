do $$
declare
  v_function regprocedure := to_regprocedure('public.admin_delete_attendance_record(uuid,text)');
  v_definition text;
  v_security_definer boolean;
begin
  if v_function is null then
    raise exception 'admin_delete_attendance_record(uuid,text) is missing';
  end if;

  select pg_get_functiondef(v_function), prosecdef
  into v_definition, v_security_definer
  from pg_proc
  where oid = v_function;

  if not v_security_definer then
    raise exception 'admin_delete_attendance_record must be security definer';
  end if;
  if not has_function_privilege('authenticated', v_function, 'EXECUTE') then
    raise exception 'authenticated lacks execute privilege';
  end if;
  if position('v_actor.role is distinct from ''admin''' in v_definition) = 0 then
    raise exception 'admin role guard is missing';
  end if;
  if position('delete from public.attendance_records' in v_definition) = 0
     or position('where id = v_record.id' in v_definition) = 0 then
    raise exception 'exact attendance-record delete is missing';
  end if;
  if position('control_audit_entries' in v_definition) = 0
     or position('to_jsonb(v_record)' in v_definition) = 0 then
    raise exception 'complete before-state audit is missing';
  end if;
  if position('delete from public.shift_registrations' in v_definition) > 0 then
    raise exception 'shift registration must remain intact';
  end if;
end;
$$;

select
  to_regprocedure('public.admin_delete_attendance_record(uuid,text)') is not null as function_installed,
  has_function_privilege('authenticated', 'public.admin_delete_attendance_record(uuid,text)', 'EXECUTE') as authenticated_can_execute;
