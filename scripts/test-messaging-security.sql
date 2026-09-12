-- QA fixture only: invoked by test-messaging-postgres.ps1 on a fresh local cluster.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',false);
do $$ declare accepted boolean; begin
  if (select count(*) from public.messaging_contacts()) <> 2 then raise exception 'Employee contacts leaked'; end if;
  accepted := false;
  begin perform public.send_employee_message('00000000-0000-0000-0000-000000000012','Forbidden'); accepted := true; exception when others then null; end;
  if accepted then raise exception 'Employee-to-employee allowed'; end if;
  accepted := false;
  begin perform public.send_employee_message(null,'Forbidden broadcast'); accepted := true; exception when others then null; end;
  if accepted then raise exception 'Employee broadcast allowed'; end if;
  accepted := false;
  begin insert into public.employee_messages(sender_id,recipient_id,body) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','Spoof'); accepted := true; exception when insufficient_privilege then null; end;
  if accepted then raise exception 'Direct insert allowed'; end if;
  perform public.send_employee_message('00000000-0000-0000-0000-000000000001','Employee A to Admin A');
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',false);
do $$ begin
  if (select count(*) from public.employee_messages) <> 0 then raise exception 'Other employee can read private chat'; end if;
  perform public.mark_employee_messages_read('00000000-0000-0000-0000-000000000011');
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ declare accepted boolean; begin
  if (select count(*) from public.messaging_contacts()) <> 2 then raise exception 'Admin contact scope wrong'; end if;
  if (select count(*) from public.employee_messages where read_at is null) <> 1 then raise exception 'Other employee marked message read'; end if;
  accepted := false;
  begin perform public.send_employee_message('00000000-0000-0000-0000-000000000013','Inactive'); accepted := true; exception when others then null; end;
  if accepted then raise exception 'Inactive recipient allowed'; end if;
  if public.send_employee_message(null,'Broadcast') <> 2 then raise exception 'Broadcast scope wrong'; end if;
  perform public.send_employee_message('00000000-0000-0000-0000-000000000011','Reply');
  accepted := false;
  begin update public.employee_messages set body='tamper'; accepted := true; exception when insufficient_privilege then null; end;
  if accepted then raise exception 'Direct UPDATE allowed'; end if;
  accepted := false;
  begin delete from public.employee_messages; accepted := true; exception when insufficient_privilege then null; end;
  if accepted then raise exception 'Direct DELETE allowed'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
  if (select count(*) from public.employee_messages) <> 0 then raise exception 'Unrelated Admin reads another private chat'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',false);
do $$ begin
  if (select count(*) from public.messaging_history('00000000-0000-0000-0000-000000000001',null)) <> 3 then raise exception 'Private history mismatch'; end if;
  if (select count(*) from public.messaging_history('00000000-0000-0000-0000-000000000012',null)) <> 0 then raise exception 'Employee history leaked'; end if;
  perform public.mark_employee_messages_read('00000000-0000-0000-0000-000000000001');
  if exists (select 1 from public.employee_messages where recipient_id=auth.uid() and read_at is null) then raise exception 'Read acknowledgement failed'; end if;
end $$;
reset role;
-- Tie timestamps deliberately to prove ID cursor neither skips nor repeats history.
insert into public.employee_messages(id,sender_id,recipient_id,body,created_at)
select ('10000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
 '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','History ' || i,'2026-01-01'::timestamptz
from generate_series(1,55) i;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',false);
do $$ declare cursor_id uuid; remaining integer; begin
  select id into cursor_id from public.messaging_history('00000000-0000-0000-0000-000000000001',null) offset 49 limit 1;
  select count(*) into remaining from public.messaging_history('00000000-0000-0000-0000-000000000001',cursor_id);
  if remaining <> 8 then raise exception 'Cursor skipped/duplicated tied-time rows: %', remaining; end if;
end $$;
reset role;
set role anon;
do $$ declare accepted boolean := false; begin
  begin perform count(*) from public.employee_messages; accepted := true; exception when insufficient_privilege then null; end;
  if accepted then raise exception 'Anonymous read allowed'; end if;
end $$;
reset role;

-- Inbox preview/order/unread metadata is private and uses the latest message.
insert into public.employee_messages(sender_id,recipient_id,body,created_at) values
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','Older latest preview','2098-01-01'),
('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','Employee B new preview','2099-01-01');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ declare first_id uuid; begin
  select id into first_id from public.messaging_inbox() limit 1;
  if first_id <> '00000000-0000-0000-0000-000000000012'::uuid then raise exception 'Inbox not ordered by latest message'; end if;
  if not exists (select 1 from public.messaging_inbox() where id=first_id and latest_message='Employee B new preview' and unread_count=1) then raise exception 'Inbox preview/unread mismatch'; end if;
  perform public.mark_employee_messages_read(first_id);
  if exists (select 1 from public.messaging_inbox() where id=first_id and unread_count <> 0) then raise exception 'Read count not cleared'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',false);
do $$ begin
  if (select count(*) from public.messaging_inbox()) <> 2 then raise exception 'Employee inbox contact scope wrong'; end if;
  if exists (select 1 from public.messaging_inbox() where latest_message='Employee B new preview') then raise exception 'Inbox preview leaks another employee'; end if;
  if not exists (select 1 from public.messaging_inbox() where latest_message='Older latest preview') then raise exception 'Own preview missing'; end if;
end $$;
reset role;
