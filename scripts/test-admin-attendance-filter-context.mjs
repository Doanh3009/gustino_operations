import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [admin, styles] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

// Chỉnh một dòng đang nhìn thấy phải mở form ngay tại chỗ. Không được tự đổi
// từ "Theo ngày" sang "Theo nhân viên" rồi làm Admin mất ngữ cảnh lọc.
const beginCorrection = sourceBetween(admin, 'function beginAttendanceCorrection(', '\n  return (')
assert.match(beginCorrection, /revealTarget\s*=\s*false/)
assert.doesNotMatch(beginCorrection, /setAttendanceListMode\('employee'\)/)
assert.match(beginCorrection, /if \(revealTarget\)/)
assert.match(beginCorrection, /setAttendanceListDate\(row\.workDate\)/)
assert.match(beginCorrection, /setAttendanceListBranchId\(row\.branchId\)/)

// Nhảy từ danh sách lỗi ngoài vùng chỉnh công vẫn phải tự mở đúng ngày/chi
// nhánh; còn nút trong danh sách hiện tại dùng mặc định giữ nguyên bộ lọc.
assert.match(admin, /beginAttendanceCorrection\(row, true\)/)
assert.match(admin, /onClick=\{\(\) => beginAttendanceCorrection\(row\)\}/)

// Chi nhánh là một filter độc lập, dùng được ở cả hai mode và không bắt nhập
// lại tên chi nhánh trong ô tìm nhân viên.
assert.match(admin, /const \[attendanceListBranchId, setAttendanceListBranchId\]/)
assert.match(admin, /attendanceListBranchOptions/)
assert.match(admin, /!attendanceListBranchId \|\| row\.branchId === attendanceListBranchId/)
const correctionFilters = sourceBetween(admin, '<div className="attendance-correction-filters">', '<div className="attendance-detail-list"')
assert.match(correctionFilters, /Chi nhánh cần chỉnh/)
assert.match(correctionFilters, /value=\{attendanceListBranchId\}/)
assert.match(correctionFilters, /Tất cả chi nhánh/)

// Chuyển sang lịch sử một nhân viên phải là thao tác chủ động riêng, không bị
// gắn vào nút Chỉnh công.
assert.match(admin, /function focusAttendanceEmployee\(/)
assert.match(admin, /Xem các ca của nhân viên/)
assert.match(styles, /\.attendance-filter-shortcut/)

console.log('ADMIN_ATTENDANCE_FILTER_CONTEXT_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
