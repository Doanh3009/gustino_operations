// Khóa hợp đồng BUG chấm công 2026-07-27:
// 1. DB có ràng buộc "một người tối đa MỘT phiên chấm công đang mở".
// 2. Guard UI chặn check-in khi còn phiên mở BẤT KỲ ngày nào, không còn nút vượt.
// 3. Chống chấm trùng do MÁY CHỦ đảm nhiệm (BUG-131), không phải bằng màn khóa client.
// 4. Giờ ca neo múi giờ Việt Nam (+07:00), không theo múi giờ thiết bị.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [migration, attendanceLib, attendancePage, dates, lanServer] = await Promise.all([
  readFile(new URL('../supabase/migrations/20260727_attendance_single_open_session.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/AttendancePage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/dates.ts', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/lan-server.mjs', import.meta.url), 'utf8'),
])

// (1) Migration: unique partial index + chỉ đóng hành chính, không xóa dòng nào.
assert.match(migration, /create unique index if not exists attendance_records_one_open_per_user/)
assert.match(migration, /where check_out_time is null/)
assert.match(migration, /CHỐT HÀNH CHÍNH/)
assert.doesNotMatch(migration, /delete from public\.attendance_records/i)

// (2) Lib: dịch lỗi 23505 của index thành thông báo tiếng Việt hành động được.
assert.match(attendanceLib, /isSingleOpenSessionViolation/)
assert.match(attendanceLib, /attendance_records_one_open_per_user/)
assert.match(attendanceLib, /chưa check-out nên chưa thể check-in/)

// (2b) UI: guard quét MỌI phiên mở (kể cả ngày trước), không còn đường vượt.
assert.match(attendancePage, /function findOpenShift\(/)
assert.doesNotMatch(attendancePage, /findOpenSameDayShift/)
assert.doesNotMatch(attendancePage, /Vẫn check-in ca này/)

// (3) BUG-131 (quyết định chủ quán 04/08): mạng chậm/lỗi đọc KHÔNG được khóa màn
// chấm công nữa. Đổi lại, chống trùng phải nằm ở MÁY CHỦ: bấm lại thì hoặc unique
// một-phiên-mở từ chối, hoặc 23505 được xác nhận idempotent bằng read-back ĐÚNG
// registration (không được xóa op chỉ vì thấy một unique constraint bất kỳ).
assert.doesNotMatch(attendancePage, /Chưa tải được dữ liệu chấm công/)
assert.match(attendanceLib, /isDuplicateAttendanceWrite/)
assert.match(attendanceLib, /verifyExistingCheckIn\(user\.id, op\.registrationId\)/)
assert.match(attendanceLib, /quarantineAttendanceOutboxOp/)

// (4) Múi giờ: ngày nghiệp vụ + giờ ca neo Asia/Ho_Chi_Minh (+07:00, không DST).
assert.match(dates, /Asia\/Ho_Chi_Minh/)
assert.match(dates, /\+07:00/)
assert.match(attendanceLib, /T\$\{time\}:00\+07:00/)

// (5) LAN khớp hành vi DB thật: chặn phiên mở thứ hai.
assert.match(lanServer, /một ca trong ngày chưa check-out nên chưa thể check-in ca mới/)

// (6) Cron nửa đêm TỰ ĐÓNG ca quên check-out (ngày < hôm nay, theo giờ tan ca,
// chốt hành chính, có guard chống đè check-out thật) — hết treo qua đêm.
const autoClose = await readFile(new URL('../api/auto-close-day.ts', import.meta.url), 'utf8')
assert.match(autoClose, /closeForgottenCheckouts/)
assert.match(autoClose, /CHỐT HÀNH CHÍNH\] \[LỖI QUÊN CHECK-OUT\]/)
assert.match(autoClose, /check_out_time=is\.null'/)
assert.match(autoClose, /18 \* 60 \* 60 \* 1000/)

// (7) Excel/bảng công tự ghi chú lỗi quên check-out và ghép đúng đơn điều chỉnh
// của nhân viên theo user + chi nhánh + ngày làm việc.
assert.match(attendanceLib, /ADMIN_CLOSE_ADDRESS_PREFIX/)
assert.match(attendanceLib, /QUÊN CHECK-OUT — hệ thống tự chốt theo giờ tan ca/)
assert.match(attendanceLib, /buildAttendanceAdjustmentNoteMap/)
assert.match(attendanceLib, /adjustmentNotes\.get\(`/)
assert.match(attendanceLib, /registration\.userId/)
assert.match(attendanceLib, /registration\.branchId/)
assert.match(attendanceLib, /registration\.workDate/)

console.log('ATTENDANCE_SINGLE_OPEN_SESSION_OK')
