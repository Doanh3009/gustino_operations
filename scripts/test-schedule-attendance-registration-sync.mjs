import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile(
  new URL('../supabase/migrations/20260718_schedule_attendance_registration_sync.sql', import.meta.url),
  'utf8',
)

assert.match(migration, /create or replace function public\.set_schedule_registration_safe/i)
assert.match(migration, /exists\s*\(\s*select 1 from public\.attendance_records ar\s*where ar\.shift_registration_id = sr\.id/i)
assert.match(migration, /if v_attended_count > 1 then[\s\S]*raise exception/i)
assert.match(migration, /if v_attended_count = 1 then[\s\S]*update public\.shift_registrations[\s\S]*where id = v_attended_registration\.id/i)
assert.match(migration, /set shift_id = p_shift_id,[\s\S]*start_time = v_start,[\s\S]*end_time = v_end/i)
assert.match(migration, /sr\.id is distinct from v_attended_registration\.id/i)
assert.match(migration, /Ca da check-in; hay chon ca dung thay vi chuyen OFF/i)
assert.doesNotMatch(
  migration,
  /delete from public\.attendance_records|update public\.attendance_records/i,
  'Migration must preserve attendance evidence and its foreign-key link.',
)

console.log('SCHEDULE_ATTENDANCE_REGISTRATION_SYNC_OK')
