import { readFile } from 'node:fs/promises'

const [app, report, handover, attendanceLib, attendance, manager, admin, styles, autoCloseApi, vercel] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ShiftHandoverPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/AttendancePage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ManagerDashboardPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../api/auto-close-day.ts', import.meta.url), 'utf8').catch(() => ''),
  readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
])

const failures = []

if (handover.includes('gustino:auto-finalize-report') || report.includes('gustino:auto-finalize-report')) {
  failures.push('Auto-chốt vẫn phụ thuộc sessionStorage và việc người dùng mở trang Báo cáo.')
}
if (!autoCloseApi.includes('SUPABASE_SERVICE_ROLE_KEY') || !autoCloseApi.includes('CRON_SECRET')) {
  failures.push('Chưa có endpoint lịch máy chủ được bảo vệ để tự đóng ngày khi không có trình duyệt mở.')
}
if (!autoCloseApi.includes('autoFinalizedAt') || !autoCloseApi.includes("status: 'closed'") || !autoCloseApi.includes('returned_quantity')) {
  failures.push('Auto-close máy chủ chưa lưu dấu báo cáo và áp dụng đầy đủ settlement/đóng ca hiện có.')
}
if (!vercel.includes('"/api/auto-close-day"') || !vercel.includes('"0 17 * * *"')) {
  failures.push('Vercel chưa xếp lịch auto-close lúc 00:00 UTC+7 để chốt ngày vừa kết thúc.')
}
if (!report.includes('Chia sẻ ảnh Zalo') || !report.includes('shareInfographicToZalo')) {
  failures.push('Sau khi chốt chưa có nút chia sẻ infographic bằng Share Sheet để chọn Zalo.')
}
if (!report.includes('{(finalized || shiftReportEntry) && (')) {
  failures.push('Ngày đã được máy chủ tự chốt nhưng chưa có shift report vẫn không hiện nút chia sẻ ảnh Zalo.')
}

if (manager.includes('fetchShiftRegistrations') || manager.includes('registeredHoursByEmployee') || manager.includes('giờ đăng ký')) {
  failures.push('Dashboard thi đua vẫn tải hoặc hiển thị giờ đăng ký trái yêu cầu chủ hệ thống.')
}
const adminCompetitionPoster = sourceBetween(admin, 'function EmployeeCompetitionPoster(', '\nfunction buildBusinessProductRows(')
if (adminCompetitionPoster.includes('giờ đăng ký') || adminCompetitionPoster.includes('row.totalHours')) {
  failures.push('Poster thi đua Admin vẫn hiển thị giờ đăng ký của nhân viên.')
}

const stampSource = sourceBetween(attendanceLib, 'async function stampAttendancePhoto(', '\nfunction fitCanvasText(')
if (!stampSource.includes('rgba(6,18,31,.94)') || !stampSource.includes('details.address')) {
  failures.push('Ảnh chấm công chưa khôi phục nền tối và địa chỉ theo kiểu ghi nhận cũ.')
}
if (!stampSource.includes('details.latitude.toFixed(6)') || !stampSource.includes('details.longitude.toFixed(6)') || !stampSource.includes('sai số ±')) {
  failures.push('Ảnh chấm công chưa khôi phục dòng tọa độ GPS và sai số kiểu cũ.')
}
if (stampSource.includes("details.branchName.toLocaleUpperCase('vi')")) {
  failures.push('Ảnh chấm công vẫn biến tên chi nhánh thành tiêu đề viết hoa lớn, không đúng kiểu cũ.')
}

if (!attendance.includes('attendanceEvidenceUrlCache')) {
  failures.push('Xuất bảng công chưa cache URL bằng chứng nên cùng ảnh bị ký lại ở nhiều sheet.')
}
if (!/Promise\.all\(\[\s*selfieEvidenceUrl\(row\.selfieUrl\)/.test(attendance)) {
  failures.push('URL ảnh check-in/check-out vẫn được tạo tuần tự cho từng dòng Excel.')
}
if (!attendance.includes('shareOrDownloadBlob') || !attendance.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) {
  failures.push('File Excel chưa dùng cơ chế share/download an toàn sau tác vụ bất đồng bộ.')
}
for (const mealLabel of ['Bữa sáng', 'Bữa trưa', 'Bữa tối']) {
  if (attendance.includes(mealLabel) || admin.includes(mealLabel)) {
    failures.push(`Bảng công vẫn tự thêm cột không được yêu cầu: ${mealLabel}.`)
  }
}
if (!attendance.includes('attendanceDataNeeds(refreshContext.tab, canAdjustSchedule)')) {
  failures.push('Màn chấm công vẫn tải mọi nhóm dữ liệu dù tab hiện tại không sử dụng chúng.')
}
if (!attendance.includes('attendance-sync-status') || !styles.includes('.attendance-sync-status')) {
  failures.push('Màn chấm công chưa hiển thị trạng thái tự đồng bộ rõ ràng, gọn nhẹ.')
}
if (!attendance.includes('attendance-loading-skeleton') || !styles.includes('.attendance-loading-skeleton')) {
  failures.push('Trạng thái tải đầu tiên của chấm công chưa có khung chờ nhẹ thay cho thông báo tải kéo dài.')
}

if (!app.includes('lazy(() => import(') || !app.includes('<Suspense')) {
  failures.push('Ứng dụng vẫn nạp đồng thời toàn bộ page thay vì tách bundle theo màn hình.')
}
if (!admin.includes('managementDataNeeds(refreshContext.activeSection, refreshContext.focused)')) {
  failures.push('Màn quản lý tập trung vẫn tải dữ liệu của mọi module dù chỉ mở một chức năng.')
}
if (!admin.includes('admin-inventory-overview') || !styles.includes('.admin-inventory-overview')) {
  failures.push('Kho quản lý chưa có phần tổng quan trực quan riêng cho bộ lọc hiện tại.')
}

if (failures.length) {
  console.error(failures.map((item) => `FAIL: ${item}`).join('\n'))
  process.exit(1)
}

console.log('OPERATIONS_UX_PERFORMANCE_OK')

function attendanceDetailColumnsSource(source) {
  const start = source.indexOf('function attendanceDetailColumns()')
  const end = source.indexOf('\nasync function addAttendanceDetailRow', start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
