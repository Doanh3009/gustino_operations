import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [admin, attendancePage, attendanceLib, styles] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/AttendancePage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

const checkIn = new Date('2026-07-04T13:55:00+07:00')
const checkOut = new Date('2026-07-04T22:20:00+07:00')
const elapsedMinutes = Math.round((checkOut.getTime() - checkIn.getTime()) / 60000)
assert.equal(elapsedMinutes, 505)
assert.equal(Number((elapsedMinutes / 60).toFixed(2)), 8.42, '8.42 là giờ thập phân đúng khi xuất Excel bảng công.')

let durationModule
try {
  durationModule = await import(new URL('../src/lib/workDuration.ts', import.meta.url))
} catch {
  durationModule = null
}
assert.ok(durationModule, 'Thiếu helper thời lượng dùng chung cho hiển thị giờ–phút.')
assert.equal(durationModule.durationMinutesBetween(checkIn.toISOString(), checkOut.toISOString()), 505)
assert.equal(durationModule.formatWorkDurationBetween(checkIn.toISOString(), checkOut.toISOString()), '8 giờ 25 phút')
assert.equal(durationModule.formatDecimalHoursAsDuration(8.42), '8 giờ 25 phút')

assert.ok(admin.includes('formatWorkDurationBetween(row.checkInTime, row.checkOutTime)'), 'Danh sách công phải hiển thị từ timestamp chính xác.')
assert.ok(admin.includes('formatDecimalHoursAsDuration(row.totalHours)'), 'Các tổng giờ trên Admin phải hiển thị dạng giờ–phút.')
assert.doesNotMatch(admin, /formatNumber\(row\.totalHours\)\} giờ/, 'Không được tiếp tục ghi giờ thập phân như thể phần lẻ là phút.')
// Màn hình hiển thị giờ–phút; cột Excel phải nói rõ là giờ THẬP PHÂN để kế toán
// không nhân nhầm 8 giờ 25 phút thành 8,25 (tính năng lương trong app đã gỡ).
assert.ok(admin.includes('(thập phân)'), 'Cột giờ trong Excel phải ghi rõ là giờ thập phân.')
assert.ok(attendancePage.includes('formatWorkDurationBetween(record.checkInTime, record.checkOutTime)'), 'Màn chấm công nhân viên phải dùng cùng định dạng giờ–phút.')
assert.ok(attendanceLib.includes('formatWorkDurationBetween(record.checkInTime, checkOutTime)'), 'Ảnh check-out phải đóng dấu thời lượng giờ–phút rõ ràng.')

assert.match(admin, /const \[attendanceEmployeeSearch, setAttendanceEmployeeSearch\]/)
assert.match(admin, /type="search"/)
assert.match(admin, /placeholder="Tìm tên nhân viên/)
assert.match(admin, /normalizeName\(attendanceEmployeeSearch\)/)
assert.match(admin, /normalizeName\(row\.employeeName\)/)
assert.match(admin, /attendance-employee-search/)
assert.match(styles, /\.attendance-employee-search/)
assert.match(admin, /attendance-cute-mascot/)
assert.match(styles, /\.attendance-cute-mascot/)

console.log('ATTENDANCE_DURATION_SEARCH_OK')
