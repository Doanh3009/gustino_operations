import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8').catch(() => '')
const [admin, attendanceLib, migration, emptyRegistrationCleanup, styles] = await Promise.all([
  read('../src/pages/AdminPage.tsx'),
  read('../src/lib/attendance.ts'),
  read('../supabase/migrations/20260717_admin_delete_attendance_record.sql'),
  read('../supabase/migrations/20260803_admin_delete_empty_shift_registration.sql'),
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

// Chủ hệ thống yêu cầu có nút xóa ngay trên dòng "Chưa có bản ghi". RPC mới chỉ
// được xóa đúng registration trống đã chọn, khóa cạnh tranh và lưu audit đầy đủ.
assert.match(emptyRegistrationCleanup, /create or replace function public\.admin_delete_empty_shift_registration/i)
assert.match(emptyRegistrationCleanup, /v_actor\.active is distinct from true/i, 'Tài khoản Admin phải còn hoạt động.')
assert.match(emptyRegistrationCleanup, /v_actor\.role is distinct from 'admin'/i, 'RPC xóa dòng trống phải giới hạn Admin.')
assert.match(emptyRegistrationCleanup, /where id = p_registration_id[\s\S]*for update/i, 'RPC phải khóa đúng registration được chọn.')
assert.match(emptyRegistrationCleanup, /exists[\s\S]*from public\.attendance_records[\s\S]*shift_registration_id = v_registration\.id/i, 'Phải chặn xóa nếu đã có bản ghi chấm công.')
assert.match(emptyRegistrationCleanup, /insert into public\.control_audit_entries/i, 'Phải audit trước khi xóa.')
assert.match(emptyRegistrationCleanup, /to_jsonb\(v_registration\)/i, 'Audit phải giữ bản sao đầy đủ registration trước khi xóa.')
assert.match(emptyRegistrationCleanup, /delete from public\.shift_registrations[\s\S]*where id = v_registration\.id/i, 'Chỉ xóa đúng registration đã chọn.')
assert.doesNotMatch(emptyRegistrationCleanup, /delete from public\.attendance_records/i, 'RPC dòng trống không được xóa attendance record.')
assert.doesNotMatch(emptyRegistrationCleanup, /delete from public\.profiles/i, 'RPC không được xóa nhân viên.')
assert.match(emptyRegistrationCleanup, /grant execute on function public\.admin_delete_empty_shift_registration\(uuid, text\) to authenticated/i)

assert.match(attendanceLib, /export async function deleteAttendanceRecordByAdmin/)
assert.match(attendanceLib, /actor\.role !== 'admin'/)
assert.match(attendanceLib, /input\.reason\.trim\(\)\.length < 3/)
assert.match(attendanceLib, /rpc\('admin_delete_attendance_record'/)
assert.match(attendanceLib, /p_record_id: input\.recordId/)
assert.match(attendanceLib, /export async function deleteEmptyShiftRegistrationByAdmin/)
assert.match(attendanceLib, /rpc\('admin_delete_empty_shift_registration'/)
assert.match(attendanceLib, /p_registration_id: input\.registrationId/)

assert.match(admin, /Xóa ca/)
assert.doesNotMatch(admin, /Xóa ca công|xóa ca công/)
assert.match(admin, /attendance-delete-confirm/)
assert.match(admin, /deleteAttendanceRecordByAdmin/)
assert.match(admin, /attendanceDelete\.employeeName/)
assert.match(admin, /attendanceDelete\.workDate/)
assert.match(admin, /Lý do xóa/)
assert.match(admin, /Xóa dòng/)
assert.match(admin, /deleteEmptyShiftRegistrationByAdmin/)
assert.match(admin, /kind: 'empty-registration'/)
// Sau redesign (§67) thao tác xóa nằm trong drawer chi tiết ca, nên nguồn dòng
// là `attendanceDetailRow` thay vì biến `row` của vòng lặp danh sách.
assert.match(admin, /registrationId: (row|attendanceDetailRow)\.registrationId/)
assert.match(admin, /Chỉ xóa đăng ký ca chưa có bản ghi chấm công/)
assert.match(styles, /\.attendance-delete-button/)
assert.match(styles, /\.attendance-delete-confirm/)

console.log('ADMIN_ATTENDANCE_DELETE_OK')
