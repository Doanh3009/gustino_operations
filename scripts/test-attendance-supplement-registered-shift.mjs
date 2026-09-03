import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [archive, attendance, migration] = await Promise.all([
  readFile(new URL('../src/components/AttendanceAdjustmentArchive.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260825_attendance_supplement_uses_registered_shift.sql', import.meta.url), 'utf8'),
])

assert.match(archive, /fetchShiftRegistrations\(user,[\s\S]*userId: supplementEmployeeId[\s\S]*from: supplementDate[\s\S]*to: supplementDate/)
assert.match(archive, />Ca làm đã đăng ký/)
assert.match(archive, /Tự nhập ca bổ sung \(chưa có đăng ký\)/)
assert.match(archive, /supplementRegistrationId === 'manual'/)
assert.match(archive, /shiftRegistrationId: registration\?\.id/)
assert.match(archive, /scheduledStartTime: usesManualRegistration \? supplementScheduledStart : undefined/)
assert.match(archive, /scheduledEndTime: usesManualRegistration \? supplementScheduledEnd : undefined/)
assert.match(archive, /checkInTime: supplementStart/)
assert.match(archive, /checkOutTime: supplementEnd/)
assert.doesNotMatch(archive, /startTime: supplementStart/)
assert.doesNotMatch(archive, /endTime: supplementEnd/)
assert.match(archive, /Check-in thực tế/)
assert.match(archive, /Check-out thực tế/)

assert.match(attendance, /p_shift_registration_id: input\.shiftRegistrationId \|\| null/)
assert.match(attendance, /p_scheduled_start_time: input\.scheduledStartTime \|\| null/)
assert.match(attendance, /p_scheduled_end_time: input\.scheduledEndTime \|\| null/)
assert.match(attendance, /p_check_in_time: input\.checkInTime/)
assert.match(attendance, /p_check_out_time: input\.checkOutTime/)
assert.doesNotMatch(sourceBetween(attendance, 'export async function createAttendanceSupplement', 'export async function updateAttendanceRecordByAdmin'), /p_start_time|p_end_time/)

assert.match(migration, /where id = p_shift_registration_id[\s\S]*status <> 'rejected'/)
assert.match(migration, /v_registration\.work_date \+ p_check_in_time/)
assert.match(migration, /v_registration\.work_date \+ p_check_out_time/)
assert.match(migration, /if p_shift_registration_id is not null then/)
assert.match(migration, /else[\s\S]*insert into public\.shift_registrations/)
assert.doesNotMatch(migration, /update public\.shift_registrations/)
assert.doesNotMatch(migration, /v_registration\.work_date \+ v_registration\.start_time|v_registration\.work_date \+ v_registration\.end_time/)
assert.match(migration, /where shift_registration_id = v_registration\.id/)
assert.match(migration, /v_check_out - v_check_in > interval '18 hours'/)
assert.match(migration, /v_scheduled_end - v_scheduled_start > interval '18 hours'/)

const databaseVerification = await readFile(new URL('./db_verify_attendance_future_guard.sql', import.meta.url), 'utf8')
assert.match(databaseVerification, /admin_add_attendance_supplement\(uuid,text,date,uuid,time without time zone,time without time zone,time without time zone,time without time zone,text\)/)

console.log('ATTENDANCE_SUPPLEMENT_REGISTERED_SHIFT_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
