import { readFile } from 'node:fs/promises'

const [attendance, lan] = await Promise.all([
  readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8'),
  readFile(new URL('./lan-server.mjs', import.meta.url), 'utf8'),
])
const failures = []

const checkout = sourceBetween(attendance, 'export async function checkOut(', '\nexport function buildAttendanceReport')
if (!checkout.includes(".select('id, check_out_time')")) failures.push('Check-out cloud chưa yêu cầu Supabase trả lại dòng thực sự được cập nhật.')
if (!checkout.includes('verifyCompletedCheckout')) failures.push('Check-out chưa read-back để phân biệt đã lưu/idempotent với update 0 dòng.')
if (!attendance.includes('withAttendanceWriteRetry')) failures.push('Ghi chấm công chưa có retry có giới hạn cho lỗi mạng tạm thời.')
if (!attendance.includes('isDuplicateAttendanceWrite')) failures.push('Retry check-in chưa khóa bằng unique/idempotent duplicate recovery.')
if (!attendance.includes('uploadAttendanceSelfieWithRetry')) failures.push('Upload ảnh chấm công chưa retry an toàn với cùng đường dẫn.')
if (!/if \(store\.attendanceRecords\[index\]\.checkOutTime\) return json\(response, 200, store\.attendanceRecords\[index\]\)/.test(lan)) {
  failures.push('LAN check-out lặp lại sau khi mất response vẫn trả lỗi thay vì kết quả đã lưu.')
}

if (failures.length) {
  console.error(failures.map((item) => `FAIL: ${item}`).join('\n'))
  process.exit(1)
}

console.log('ATTENDANCE_IDEMPOTENT_WRITE_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
