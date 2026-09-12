begin;

-- Read-only inbox summary. Reuses the existing contact restrictions and message RLS.
create or replace function public.messaging_inbox()
returns table (
  id uuid, name text, role text, branch_id text,
  latest_message text, latest_at timestamptz, latest_sender_id uuid,
  unread_count bigint
)
language sql stable security invoker set search_path = public
as $$
  select c.id, c.name, c.role, c.branch_id,
    last_message.body, last_message.created_at, last_message.sender_id,
    unread.total
  from public.messaging_contacts() c
  left join lateral (
    select m.body, m.created_at, m.sender_id, m.id
    from public.employee_messages m
    where (m.sender_id = auth.uid() and m.recipient_id = c.id)
      or (m.sender_id = c.id and m.recipient_id = auth.uid())
    order by m.created_at desc, m.id desc limit 1
  ) last_message on true
  cross join lateral (
    select count(*) as total from public.employee_messages m
    where m.sender_id = c.id and m.recipient_id = auth.uid() and m.read_at is null
  ) unread
  order by last_message.created_at desc nulls last, last_message.id desc nulls last, c.name, c.id;
$$;

revoke all on function public.messaging_inbox() from public;
grant execute on function public.messaging_inbox() to authenticated;
notify pgrst, 'reload schema';
commit;
