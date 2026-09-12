begin;
set local lock_timeout = '5s';

create table public.employee_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);
create index employee_messages_recipient_unread on public.employee_messages(recipient_id, created_at desc) where read_at is null;
create index employee_messages_conversation on public.employee_messages(sender_id, recipient_id, created_at desc, id desc);
alter table public.employee_messages enable row level security;
revoke all on public.employee_messages from anon, authenticated;
grant select on public.employee_messages to authenticated;
create policy "participants read messages" on public.employee_messages
  for select to authenticated using (auth.uid() in (sender_id, recipient_id));

create function public.messaging_contacts()
returns table(id uuid, name text, role text, branch_id text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.role::text, p.branch_id
  from public.profiles p
  join public.profiles me on me.id = auth.uid() and me.active = true
  where p.active = true and p.id <> me.id
    and ((me.role::text = 'admin' and p.role::text <> 'admin')
      or (me.role::text <> 'admin' and p.role::text = 'admin'))
  order by p.full_name, p.id;
$$;

-- NULL recipient is an Admin-only broadcast to active employees.
create function public.send_employee_message(p_recipient_id uuid, p_body text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  sender_role text;
  target_role text;
  sent_count integer;
begin
  select role::text into sender_role from public.profiles where id = auth.uid() and active = true;
  if sender_role is null then raise exception 'Tài khoản không được phép nhắn tin.'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then
    raise exception 'Tin nhắn phải có từ 1 đến 2000 ký tự.';
  end if;
  if p_recipient_id is null then
    if sender_role <> 'admin' then raise exception 'Chỉ Admin được gửi cho tất cả nhân viên.'; end if;
    insert into public.employee_messages(sender_id, recipient_id, body)
      select auth.uid(), id, btrim(p_body) from public.profiles where active = true and role::text <> 'admin';
  else
    select role::text into target_role from public.profiles where id = p_recipient_id and active = true;
    if target_role is null or p_recipient_id = auth.uid()
      or not ((sender_role = 'admin' and target_role <> 'admin') or (sender_role <> 'admin' and target_role = 'admin')) then
      raise exception 'Nhân viên chỉ được nhắn cho Admin; Admin chỉ được nhắn cho nhân viên.';
    end if;
    insert into public.employee_messages(sender_id, recipient_id, body) values(auth.uid(), p_recipient_id, btrim(p_body));
  end if;
  get diagnostics sent_count = row_count;
  return sent_count;
end;
$$;

create function public.messaging_history(p_contact_id uuid, p_before_id uuid default null)
returns setof public.employee_messages
language sql stable security invoker set search_path = public
as $$
  select m.* from public.employee_messages m
  where ((m.sender_id = auth.uid() and m.recipient_id = p_contact_id)
    or (m.recipient_id = auth.uid() and m.sender_id = p_contact_id))
    and (p_before_id is null or (m.created_at, m.id) < (
      select c.created_at, c.id from public.employee_messages c where c.id = p_before_id
    ))
  order by m.created_at desc, m.id desc limit 50;
$$;

create function public.mark_employee_messages_read(p_contact_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.employee_messages set read_at = now()
  where recipient_id = auth.uid() and sender_id = p_contact_id and read_at is null;
$$;

revoke all on function public.messaging_contacts() from public;
revoke all on function public.send_employee_message(uuid, text) from public;
revoke all on function public.messaging_history(uuid, uuid) from public;
revoke all on function public.mark_employee_messages_read(uuid) from public;
grant execute on function public.messaging_contacts() to authenticated;
grant execute on function public.send_employee_message(uuid, text) to authenticated;
grant execute on function public.messaging_history(uuid, uuid) to authenticated;
grant execute on function public.mark_employee_messages_read(uuid) to authenticated;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.employee_messages;
  end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
