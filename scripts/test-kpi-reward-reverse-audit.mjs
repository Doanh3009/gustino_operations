import { readFile } from 'node:fs/promises'

const [admin, commission] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/commission.ts', import.meta.url), 'utf8'),
])

const failures = []
for (const formula of [
  "if (position === 'shift_leader') return progress >= 100 ? 30000 : 0",
  'if (progress >= 110) return 40000',
  'if (progress >= 100) return 20000',
  'if (perfectWeekDays >= 6) return 200000',
  'if (achievedDays >= 5) return 100000',
]) {
  if (!commission.includes(formula)) failures.push(`Công thức thưởng hiện tại bị thay đổi ngoài kiểm soát: ${formula}`)
}

const commissionBuilder = sourceBetween(admin, 'function buildCommissionRows(', '\nfunction normalizeName')
const dailyKpiBuilder = sourceBetween(admin, 'function buildDailyEmployeeKpiRows(', '\nfunction buildPayrollRows')
const receiptLoop = sourceBetween(commissionBuilder, 'receipts.forEach((receipt) => {', '\n\n  const weekWins')
if (!commissionBuilder.includes('const dailyPerformance = new Map')) {
  failures.push('Thưởng ngày chưa có lớp gom doanh thu theo đúng ngày × nhân viên trước khi áp KPI.')
}
if (!commissionBuilder.includes('dailyPerformance.forEach')) {
  failures.push('Thưởng ngày/tuần chưa được tính đúng một lần trên tổng doanh thu của từng ngày.')
}
if (receiptLoop.includes('dailyKpiBonus(') || receiptLoop.includes('weekRow.achievedDays += 1')) {
  failures.push('POS trực tiếp vẫn tính thưởng theo từng hóa đơn; một ngày nhiều hóa đơn có thể thiếu hoặc nhân thưởng.')
}
if (!commissionBuilder.includes('const monthlyBonus = 0')) {
  failures.push('Audit không còn chứng minh được rằng thưởng tháng hiện chưa được cộng vào bảng lương.')
}
if (!commissionBuilder.includes('const kpiBonus = row.dailyBonus + row.weeklyBonus')) {
  failures.push('Audit không chứng minh được cột Thưởng KPI chỉ gồm thưởng ngày + tuần.')
}
if (!dailyKpiBuilder.includes('receipts: SalesReceipt[]') || !dailyKpiBuilder.includes('receipts.forEach((receipt) => {')) {
  failures.push('Daily KPI detail does not include the direct POS revenue used by payroll.')
}
if (dailyKpiBuilder.includes('allocation.shiftId')) {
  failures.push('Daily KPI detail still splits one employee-day by allocation shift before applying the daily target.')
}
if (!admin.includes('<h2>KPI & thưởng theo ngày</h2>') || admin.includes('<th>Ca</th>')) {
  failures.push('Daily KPI labels still describe a per-shift bonus.')
}
const payrollBuilder = sourceBetween(admin, 'function buildPayrollRows(', '\nfunction buildCompetitionRows')
if (!payrollBuilder.includes('grossPay: basePay + commissionPay + bonus - deduction')) {
  failures.push('Thưởng KPI có nguy cơ bị cộng sai hoặc cộng hai lần vào thực nhận.')
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
