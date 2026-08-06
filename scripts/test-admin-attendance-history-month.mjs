import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [admin, styles] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

// Bộ chọn tháng phải nằm ngay trong vùng chỉnh công, không bắt Admin quay lên
// bộ lọc chung và không giới hạn tháng cũ.
const correctionArea = sourceBetween(admin, '<div className="attendance-correction-filters">', '<div className="attendance-detail-list"')
assert.match(correctionArea, /type="month"/)
assert.match(correctionArea, /attendanceCorrectionMonth/)
assert.doesNotMatch(correctionArea, /type="month"[^>]*\bmin=/)
assert.match(correctionArea, /Tháng trước/)
assert.match(correctionArea, /Tháng sau/)

// Chọn/chuyển tháng phải đổi đúng range tải dữ liệu và đồng bộ ngày đang xem.
assert.match(admin, /function setAttendanceCorrectionMonth\(/)
assert.match(admin, /setFrom\(`\$\{month\}-01`\)/)
assert.match(admin, /setTo\(lastDayOfMonth\(month\)\)/)
assert.match(admin, /setAttendanceListDate/)
assert.match(admin, /shiftMonthKey/)
assert.match(styles, /\.attendance-month-picker/)

// Khi ở phân hệ chấm công, bộ lọc chung cũng phải khóa ngày tương lai như bộ
// chọn tháng cục bộ và tự kéo một range tương lai về hôm nay.
assert.match(admin, /attendanceDateMax/)
assert.match(admin, /max=\{attendanceDateMax\}/)
assert.match(admin, /activeSection !== 'attendance'/)
assert.match(admin, /setTo\(todayKey\)/)

console.log('ADMIN_ATTENDANCE_HISTORY_MONTH_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
