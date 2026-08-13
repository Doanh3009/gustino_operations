import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [admin, shell, routes, dashboard, workbookSource] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/admin/routeMap.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/admin/DashboardPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/kpiEvidenceWorkbook.ts', import.meta.url), 'utf8'),
])

// Admin phải tìm thấy màn thi đua bằng đúng tên nghiệp vụ, kể cả từ Tổng quan.
assert.match(shell, /section: 'commission', label: 'Thi đua nhân viên'/)
assert.match(routes, /section: 'commission'[\s\S]*label: 'Thi đua nhân viên'/)
// Sau redesign (§18) Tổng quan không còn banner lớn chỉ chứa một chữ "Xem bảng
// thi đua" — nó hiển thị top thật kèm lối sang màn thi đua. Lối đó phải đổi cả
// URL để refresh/Back còn đúng (§89), và URL phải là route thi đua thật.
assert.match(dashboard, /Xem bảng thi đua/)
assert.match(dashboard, /onOpenSection\('commission'\)/)
assert.match(dashboard, /Thi đua hôm nay/)
assert.match(admin, /navigateAdminHash\(adminRouteForSection\(section\)\)/)
assert.match(admin, /<h2>Thi đua nhân viên<\/h2>/)

// Workbook mới phải tách rõ tổng hợp tháng, từng ngày/nhân viên và chi tiết nguồn.
for (const sheet of ['Tổng hợp tháng', 'Theo ngày nhân viên', 'Chi tiết doanh thu']) {
  assert.ok(workbookSource.includes(`'${sheet}'`), `Thiếu sheet ${sheet}`)
}
assert.match(workbookSource, /dailyRows:/)
assert.match(workbookSource, /soldQuantity: number/)

const { buildKpiEvidenceWorkbook } = await import('../src/lib/kpiEvidenceWorkbook.ts')
const workbook = await buildKpiEvidenceWorkbook({
  title: 'THI ĐUA NHÂN VIÊN THÁNG 08/2026',
  generatedAt: new Date('2026-08-03T03:00:00.000Z'),
  filters: [
    { label: 'Phân loại', value: 'Nhân viên theo tháng' },
    { label: 'Kỳ dữ liệu', value: '01/08/2026 - 31/08/2026' },
    { label: 'Chi nhánh', value: 'Toàn hệ thống' },
    { label: 'Nhân sự toàn cục', value: 'Tất cả' },
  ],
  summaryRows: [{
    employeeKey: '550e8400-e29b-41d4-a716-446655440000', employeeName: 'Nguyễn An',
    branchId: 'gold-coast-long-technical-id', branchName: 'Gold Coast', roleLabel: 'Nhân viên bán hàng',
    shiftCount: 2, soldQuantity: 5, revenue: 550000, targetRevenue: 500000,
    progress: 110, rank: 'A', reward: 40000,
  }],
  dailyRows: [{
    date: '2026-08-01', employeeKey: '550e8400-e29b-41d4-a716-446655440000', employeeName: 'Nguyễn An',
    branchId: 'gold-coast-long-technical-id', branchName: 'Gold Coast', positionTitle: 'Part-time',
    totalHours: 8, soldQuantity: 5, revenue: 550000, targetRevenue: 500000,
    progress: 110, rank: 'A', dailyBonus: 40000,
  }],
  sourceRows: [{
    businessDate: '2026-08-01', employeeKey: '550e8400-e29b-41d4-a716-446655440000', employeeName: 'Nguyễn An',
    branchId: 'gold-coast-long-technical-id', branchName: 'Gold Coast', roleLabel: 'Nhân viên bán hàng',
    sourceType: 'Hóa đơn POS', sourceId: 'very-long-technical-source-id', sourceCode: 'POS-0812', shiftLabel: '',
    detail: '2 × Khoai nướng, 3 × Bánh', meta: 'Bán trực tiếp', quantity: 5, revenue: 550000,
    createdAt: '2026-08-01T03:15:00.000Z',
  }],
})

assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Tổng hợp tháng', 'Theo ngày nhân viên', 'Chi tiết doanh thu'])

const monthly = workbook.getWorksheet('Tổng hợp tháng')
const daily = workbook.getWorksheet('Theo ngày nhân viên')
const detail = workbook.getWorksheet('Chi tiết doanh thu')
assert.ok(monthly && daily && detail)

const visibleHeaders = (sheet, rowNumber) => sheet.getRow(rowNumber).values
  .filter((value, index) => index > 0 && !sheet.getColumn(index).hidden)
  .map(String)
for (const [sheet, rowNumber] of [[monthly, 5], [daily, 4], [detail, 3]]) {
  const headers = visibleHeaders(sheet, rowNumber)
  assert.ok(!headers.some((header) => /^Mã (nhân sự|nhân viên|chi nhánh|nguồn)$/.test(header)), `${sheet.name} còn cột mã dài`)
}

assert.equal(monthly.getCell('B6').value, 'Nguyễn An')
assert.equal(monthly.getCell('G6').value, 550000)
assert.equal(daily.getCell('A5').value instanceof Date, true)
assert.equal(daily.getCell('H5').value, 550000)
assert.equal(detail.getCell('I4').value, 550000)
assert.match(String(monthly.getCell('L6').value?.formula || ''), /COUNTIFS/)
assert.match(String(monthly.getCell('M6').value?.formula || ''), /SUMIFS/)
assert.equal(monthly.views[0]?.state, 'frozen')
assert.equal(daily.views[0]?.state, 'frozen')
assert.equal(detail.views[0]?.state, 'frozen')
assert.ok(monthly.autoFilter && daily.autoFilter && detail.autoFilter)

const buffer = await workbook.xlsx.writeBuffer()
assert.ok(buffer.byteLength > 3000, 'Workbook phải xuất được thành XLSX thật')
const ExcelJS = await import('exceljs')
const Workbook = ExcelJS.Workbook || ExcelJS.default.Workbook
const reopened = new Workbook()
await reopened.xlsx.load(buffer)
assert.deepEqual(reopened.worksheets.map((sheet) => sheet.name), ['Tổng hợp tháng', 'Theo ngày nhân viên', 'Chi tiết doanh thu'])
assert.equal(reopened.getWorksheet('Tổng hợp tháng').getCell('G6').value, 550000)
assert.equal(reopened.getWorksheet('Theo ngày nhân viên').getCell('H5').value, 550000)
assert.equal(reopened.getWorksheet('Chi tiết doanh thu').getCell('I4').value, 550000)

console.log('ADMIN_COMPETITION_WORKBOOK_CLARITY_OK')
