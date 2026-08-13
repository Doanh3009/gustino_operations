import { readFile } from 'node:fs/promises'

const [admin, commission] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/commission.ts', import.meta.url), 'utf8'),
])

const failures = []
for (const formula of [
  "if (position === 'shift_leader' || position === 'shift_deputy') return progress >= 100 ? 30000 : 0",
  'if (progress >= 110) return 40000',
  'if (progress >= 100) return 20000',
]) {
  if (!commission.includes(formula)) failures.push(`Công thức thưởng hiện tại bị thay đổi ngoài kiểm soát: ${formula}`)
}

const commissionBuilder = sourceBetween(admin, 'function buildCommissionRows(', '\nfunction normalizeName')
const dailyKpiBuilder = sourceBetween(admin, 'function buildDailyEmployeeKpiRows(', '\nfunction buildPayrollRows')
const receiptLoop = sourceBetween(commissionBuilder, 'receipts.forEach((receipt) => {', '\n\n  const applyDailyResult')
if (!commissionBuilder.includes('const dailyPerformance = new Map')) {
  failures.push('Thưởng ngày chưa có lớp gom doanh thu theo đúng ngày × nhân viên trước khi áp KPI.')
}
if (!commissionBuilder.includes('dailyPerformance.forEach')) {
  failures.push('Thưởng ngày/tuần chưa được tính đúng một lần trên tổng doanh thu của từng ngày.')
}
if (receiptLoop.includes('dailyKpiBonus(') || receiptLoop.includes('weekRow.achievedDays += 1')) {
  failures.push('POS trực tiếp vẫn tính thưởng theo từng hóa đơn; một ngày nhiều hóa đơn có thể thiếu hoặc nhân thưởng.')
}
// `dailyBonus` = row.dailyBonus, ép về 0 cho ca trưởng (chưa chấm KPI từ 11/08/2026).
if (!commissionBuilder.includes('const kpiBonus = dailyBonus')) failures.push('Tổng thưởng KPI chưa giới hạn ở thưởng ngày.')
if (commissionBuilder.includes('weekWins') || commissionBuilder.includes('monthlyKpiBonus(') || commissionBuilder.includes('monthlySpecialBonus({')) {
  failures.push('Bộ tính vẫn kích hoạt thưởng tuần/tháng thay vì chỉ thưởng ngày.')
}
if (!dailyKpiBuilder.includes('receipts: SalesReceipt[]') || !dailyKpiBuilder.includes('receipts.forEach((receipt) => {')) {
  failures.push('Daily KPI detail does not include the direct POS revenue used by payroll.')
}
if (dailyKpiBuilder.includes('allocation.shiftId')) {
  failures.push('Daily KPI detail still splits one employee-day by allocation shift before applying the daily target.')
}
if (!admin.includes('KPI theo ngày ({dayRows.length})') || !admin.includes('aria-label={`KPI theo ngày của ${row.employeeName}`}')) {
  failures.push('Chi tiết KPI ngày chưa nằm trong đúng dòng từng nhân viên.')
}
if (!admin.includes('data-label="Thưởng KPI"') || !admin.includes('formatMoney(row.commission)')) {
  failures.push('Tổng thưởng KPI chưa được hiển thị từ đúng trường commission của một dòng nhân viên.')
}

if (failures.length) {
  console.error(failures.map((item) => `FAIL: ${item}`).join('\n'))
  process.exit(1)
}

console.log('KPI_REWARD_REVERSE_AUDIT_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
