import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const adminPage = await readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8')
assert.match(adminPage, /exportDailyKpiExcel/)
assert.match(adminPage, /Xuất Excel KPI theo ngày/)
assert.match(adminPage, /buildDailyKpiWorkbook/)

const { buildDailyKpiWorkbook } = await import('../src/lib/kpiDailyWorkbook.ts')
const generatedAt = new Date('2026-08-03T03:00:00.000Z')
const workbook = await buildDailyKpiWorkbook({
  from: '2026-08-01',
  to: '2026-08-02',
  branchLabel: 'Toàn hệ thống',
  employeeLabel: 'Tất cả nhân viên',
  generatedAt,
  rows: [
    {
      date: '2026-08-01', employeeKey: 'nv-1', employeeName: 'Nguyễn An', branchId: 'gold-coast',
      branchName: 'Gold Coast', positionTitle: 'Part-time', totalHours: 8, soldQuantity: 12,
      revenue: 550000, targetRevenue: 500000, progress: 110, rank: 'A', dailyBonus: 40000,
    },
    {
      date: '2026-08-02', employeeKey: 'nv-2', employeeName: 'Trần Bình', branchId: 'lotte-vt',
      branchName: 'Lotte Vũng Tàu', positionTitle: 'Ca trưởng', totalHours: 8, soldQuantity: 20,
      revenue: 800000, targetRevenue: 780000, progress: 102.56, rank: 'A', dailyBonus: 30000,
    },
  ],
})

const sheet = workbook.getWorksheet('KPI thưởng theo ngày')
assert.ok(sheet, 'Thiếu sheet KPI thưởng theo ngày')
assert.equal(sheet.getCell('A4').value, 'Ngày')
assert.ok(sheet.getCell('A5').value instanceof Date, 'Ngày phải là Date thật để Excel lọc/sắp xếp')
assert.equal(sheet.getCell('H5').value, 550000, 'Doanh thu phải là số, không phải chuỗi định dạng sẵn')
assert.equal(sheet.getCell('L5').value, 40000, 'Thưởng ngày phải là số cụ thể')
assert.equal(sheet.getColumn('revenue').numFmt, '#,##0" đ"')
assert.equal(sheet.getColumn('dailyBonus').numFmt, '#,##0" đ"')
assert.equal(sheet.getColumn('progress').numFmt, '0.0%')
assert.equal(sheet.views[0]?.state, 'frozen')
assert.equal(sheet.views[0]?.ySplit, 4)
assert.ok(sheet.autoFilter, 'Bảng chi tiết phải có bộ lọc')
assert.equal(sheet.getCell('G2').value, 1350000, 'Tổng doanh thu đầu sheet phải nhìn thấy ngay')
assert.equal(sheet.getCell('K2').value, 70000, 'Tổng thưởng đầu sheet phải nhìn thấy ngay')

const buffer = await workbook.xlsx.writeBuffer()
assert.ok(buffer.byteLength > 1000, 'Workbook phải xuất được thành XLSX hợp lệ')

console.log('KPI_DAILY_EXCEL_OK')
