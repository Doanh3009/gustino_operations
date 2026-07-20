import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [report, attendance, archive] = await Promise.all([
  readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/AttendancePage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ReportArchivePage.tsx', import.meta.url), 'utf8'),
])

const employeeRowsStart = report.indexOf('function buildEmployeeRows(')
const employeeRowsEnd = report.indexOf('function hasSalesActivity(', employeeRowsStart)
const employeeRows = report.slice(employeeRowsStart, employeeRowsEnd)

assert.ok(employeeRowsStart >= 0 && employeeRowsEnd > employeeRowsStart, 'Không tìm thấy bộ dựng báo cáo nhân viên')
assert.match(employeeRows, /receipts\.forEach\(\(receipt\) => \{/, 'Doanh thu POS phải được gắn vào nhân viên bán')
assert.doesNotMatch(
  employeeRows,
  /registeredRowKeys|return registeredRowKeys\.has/,
  'Không được xóa nhân viên có doanh thu POS chỉ vì thiếu đăng ký ca',
)
assert.match(employeeRows, /\.filter\(hasSalesActivity\)/, 'Báo cáo nhân viên chỉ giữ dòng có phát sinh bán hàng')

assert.match(
  attendance,
  /onOpenRegistration=\{\(\) => setTab\('board'\)\}/,
  'Màn hình chấm công phải có đường dẫn trực tiếp sang đăng ký ca',
)
assert.match(
  attendance,
  /Bạn chưa đăng ký ca hôm nay[\s\S]*onOpenRegistration/,
  'Khi thiếu ca hôm nay phải giải thích đúng nguyên nhân và cho phép mở đăng ký ca',
)
assert.match(
  archive,
  /fetchSalesReceiptsRange[\s\S]*buildArchiveEmployeeRows/,
  'Kho báo cáo phải dùng POS cùng ngày để bổ sung người bán bị thiếu khỏi snapshot cũ',
)
assert.doesNotMatch(
  archive,
  /employeeRows[^;\n]*\.slice\(0,\s*6\)/,
  'Kho báo cáo không được âm thầm ẩn nhân viên từ dòng thứ bảy',
)

console.log('DAILY_REPORT_EMPLOYEE_ATTENDANCE_FLOW_OK')
