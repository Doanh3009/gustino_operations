// Quyết định chủ quán 2026-08-03 thay thế luồng BUG-113 cũ:
// nhân viên không tự khai/check-out bù; hệ thống tự đóng sau khi sang ngày và
// Admin sửa qua luồng audit nếu giờ thực tế khác.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [attendance, page, lan, autoClose] = await Promise.all([
  readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/AttendancePage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./lan-server.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../api/auto-close-day.ts', import.meta.url), 'utf8'),
])

assert.doesNotMatch(page, /Check-out bù/)
assert.doesNotMatch(page, /lateCheckOut\(/)
assert.doesNotMatch(page, /<option value="missing_checkout">/)
assert.match(page, /Hệ thống sẽ tự đóng ca này khi sang ngày mới/)
assert.match(page, /Admin sẽ nhận ca này trong danh sách lỗi chấm công/)

assert.match(lan, /autoCloseStaleAttendanceRecords/)
assert.match(lan, /Tính năng tự khai bù giờ ra đã ngừng/)
assert.doesNotMatch(lan, /patch\.lateCheckOutTime/)
assert.match(lan, /ATTENDANCE_AUTO_CLOSE_ADDRESS_PREFIX/)

assert.match(autoClose, /closeForgottenCheckouts/)
assert.match(autoClose, /ATTENDANCE_AUTO_CLOSE_ADDRESS_PREFIX/)
assert.match(autoClose, /check_out_time=is\.null/)
// BUG-130: giờ đóng là closeAt (giờ tan ca, hoặc đúng thời điểm check-in khi
// check-in sau giờ tan ca) — không còn nhánh skip để phiên ngày cũ treo vĩnh viễn.
assert.match(autoClose, /closeAt\.toISOString\(\)/)
assert.match(autoClose, /sau giờ tan ca của lịch đăng ký nên hệ thống đóng ngay tại thời điểm check-in/)

// Hàm legacy có thể còn lại để bundle cũ không vỡ, nhưng UI mới tuyệt đối không
// gọi nó. Ghi chú bảng công chỉ gắn lỗi cho marker auto-close của hệ thống.
assert.match(attendance, /isAttendanceAutoClosedError/)
assert.match(attendance, /QUÊN CHECK-OUT — hệ thống tự chốt theo giờ tan ca/)

console.log('ATTENDANCE_LATE_CHECKOUT_OK')
