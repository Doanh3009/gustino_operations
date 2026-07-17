import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8').catch(() => '')
const [admin, attendanceLib, migration, styles] = await Promise.all([
  read('../src/pages/AdminPage.tsx'),
  read('../src/lib/attendance.ts'),
  read('../supabase/migrations/20260717_admin_delete_attendance_record.sql'),
  read('../src/styles.css'),
])

assert.match(migration, /create or replace function public\.admin_delete_attendance_record/i)
assert.match(migration, /v_actor\.role is distinct from 'admin'/i, 'RPC xóa công phải giới hạn Admin.')
assert.match(migration, /where id = p_record_id[\s\S]*for update/i, 'RPC phải khóa và xác định đúng một bản ghi.')
assert.match(migration, /delete from public\.attendance_records[\s\S]*where id = v_record\.id/i, 'Chỉ được xóa đúng bản ghi đã chọn.')
assert.doesNotMatch(migration, /delete from public\.shift_registrations/i, 'Không được xóa lịch đăng ký ca.')
assert.match(migration, /'admin_delete_attendance'/i, 'Mọi lần xóa phải ghi audit.')
assert.match(migration, /jsonb_build_object\([\s\S]*'record_id'/i, 'Audit phải giữ lại định danh và dữ liệu bản ghi trước khi xóa.')
assert.match(migration, /grant execute on function public\.admin_delete_attendance_record\(uuid, text\) to authenticated/i)

assert.match(attendanceLib, /export async function deleteAttendanceRecordByAdmin/)
assert.match(attendanceLib, /actor\.role !== 'admin'/)
assert.match(attendanceLib, /input\.reason\.trim\(\)\.length < 3/)
assert.match(attendanceLib, /rpc\('admin_delete_attendance_record'/)
assert.match(attendanceLib, /p_record_id: input\.recordId/)

assert.match(admin, /Xóa ca công/)
assert.match(admin, /attendance-delete-confirm/)
assert.match(admin, /deleteAttendanceRecordByAdmin/)
assert.match(admin, /attendanceDelete\.employeeName/)
assert.match(admin, /attendanceDelete\.workDate/)
assert.match(admin, /Lý do xóa/)
assert.match(styles, /\.attendance-delete-button/)
assert.match(styles, /\.attendance-delete-confirm/)

console.log('ADMIN_ATTENDANCE_DELETE_OK')
