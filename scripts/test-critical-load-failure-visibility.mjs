import { readFile } from 'node:fs/promises'

const [admin, handover, manager, sales] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ShiftHandoverPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ManagerDashboardPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/SalesPage.tsx', import.meta.url), 'utf8'),
])

const failures = []
const adminRefresh = sourceBetween(admin, 'async function refresh(showLoading = true)', '\n  useEffect(() => {\n    void refresh')
for (const marker of ['fetchSupplyRequests', 'fetchReportSnapshots', 'fetchSalesReceiptsRange']) {
  const line = adminRefresh.split('\n').find((item) => item.includes(marker)) || ''
  if (line.includes('.catch(() => []')) failures.push(`Quản lý vẫn biến lỗi ${marker} thành danh sách rỗng giả.`)
}

const handoverRefresh = sourceBetween(handover, 'async function refresh(showLoading = false)', '\n  useEffect(() => {')
if (/fetchAttendanceRecords[\s\S]*?\.catch\(\(\) => \[\] as AttendanceRecord\[\]\)/.test(handoverRefresh)) {
  failures.push('Bàn giao ca vẫn nuốt lỗi tải chấm công và tiếp tục với dữ liệu rỗng.')
}
if (/fetchSalesReceipts[\s\S]*?\.catch\(\(\) => \[\] as SalesReceipt\[\]\)/.test(handoverRefresh)) {
  failures.push('Bàn giao ca vẫn nuốt lỗi tải POS và có thể chốt ca như không có doanh thu.')
}

if (manager.includes('fetchBagShiftSessions(user, { branchId: id })')) {
  failures.push('Dashboard quản lý vẫn tải toàn bộ phiên ca dù state phiên ca không được sử dụng để render/tính toán.')
}
const managerReceipts = sourceBetween(manager, 'async function loadReceipts()', '\n    void loadReceipts()')
if (!managerReceipts.includes('setError(') || /setReceipts\([\s\S]*?: \[\]\)/.test(managerReceipts)) {
  failures.push('Dashboard quản lý vẫn biến lỗi tải POS thành biểu đồ rỗng mà không báo lỗi.')
}

const salesRefresh = sourceBetween(sales, 'async function refresh(showLoading = false)', '\n  useEffect(() => { void refresh')
if (/fetchEmployees\(user\)\.catch\(\(\) => \[\] as EmployeeProfile\[\]\)/.test(salesRefresh)) {
  failures.push('POS ca trưởng vẫn nuốt lỗi tải danh sách nhân viên và hiển thị danh sách người bán thiếu.')
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}

console.log('CRITICAL_LOAD_FAILURE_VISIBILITY_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
