-- PostgREST upsert-on-conflict needs to SELECT the existing row before the
-- UPDATE path can run. Keep Admin overview access and add only own-row read.

drop policy if exists "admin reads active sessions" on public.active_user_sessions;
drop policy if exists "admin or owner reads active sessions" on public.active_user_sessions;
create policy "admin or owner reads active sessions"
on public.active_user_sessions for select to authenticated
using (
  user_id = auth.uid()
  or (public.current_profile()).role = 'admin'
);

notify pgrst, 'reload schema';
