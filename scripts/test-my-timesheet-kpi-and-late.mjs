import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { transform } from 'esbuild'

async function loadPureFunctions(relativeUrl, names) {
  let source = await readFile(new URL(relativeUrl, import.meta.url), 'utf8')
  source = source.replace(/^import .*$/gm, '')
  source = source.replace(/^export /gm, '')
  source = `const configuredProductPrice = (_id, fallback) => fallback\nconst supabase = null\n${source}`
  source += `\nexport { ${names.join(', ')} }\n`
  const compiled = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })
  return import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`)
}

const attendanceSource = await readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8')
assert.match(
  attendanceSource,
  /const lateMinutes = completedShiftLateMinutes\(checkIn, checkOut, scheduledStart, grace\)/,
  'Đi trễ chỉ được chốt khi đã có cả check-in và check-out.',
)
const lateFunctionSource = attendanceSource.slice(
  attendanceSource.indexOf('export function completedShiftLateMinutes('),
  attendanceSource.indexOf('\n\nexport function buildAttendanceDetailRows('),
).replace('export function', 'function')
const lateCompiled = await transform(`${lateFunctionSource}\nexport { completedShiftLateMinutes }`, { loader: 'ts', format: 'esm' })
const { completedShiftLateMinutes } = await import(`data:text/javascript;base64,${Buffer.from(lateCompiled.code).toString('base64')}`)
const scheduledStart = new Date('2026-09-08T16:00:00+07:00')
const lateCheckIn = new Date('2026-09-08T16:52:00+07:00')
assert.equal(completedShiftLateMinutes(lateCheckIn, undefined, scheduledStart, 5), 0, 'Ca đang làm chưa được tính trễ.')
assert.equal(completedShiftLateMinutes(lateCheckIn, new Date('2026-09-08T22:00:00+07:00'), scheduledStart, 5), 47, 'Ca đã kết thúc phải tính đúng phút trễ sau ân hạn.')

const commission = await loadPureFunctions('../src/lib/commission.ts', [
  'calculatePersonalKpiReward', 'employeePeriodRevenueTarget', 'dailyKpiBonus', 'weeklyKpiBonus',
  'positionKpiFormula', 'positionKpiKey', 'soldBagQuantity', 'productSaleValues',
])

const user = {
  id: 'staff-1', name: 'Nhân viên A', role: 'staff', branchId: 'gold-coast', employmentType: 'part_time', positionTitle: 'PG part time',
}
const receipts = [
  ['2026-10-06', 500000], ['2026-10-07', 500000], ['2026-10-08', 500000],
  ['2026-10-09', 500000], ['2026-10-10', 500000],
].map(([date, amount], index) => ({
  id: `receipt-${index}`, code: `HD-${index}`, branchId: 'gold-coast', businessDate: date,
  sellerKey: user.id, sellerId: user.id, sellerName: user.name, totalQuantity: 1, totalAmount: amount,
  lines: [{ productId: 'direct', productName: 'Bán trực tiếp', quantity: 1, unitPrice: amount, total: amount }],
  createdAt: `${date}T10:00:00+07:00`, createdBy: user.id, createdByName: user.name,
}))
receipts.push({
  ...receipts[0], id: 'other-person', sellerId: 'staff-2', sellerName: 'Người khác',
  totalAmount: 9999999, lines: [{ productId: 'direct', productName: 'Không được tính', quantity: 1, unitPrice: 9999999, total: 9999999 }],
})
const reward = commission.calculatePersonalKpiReward(user, [], receipts, '2026-10-01', '2026-10-31')
assert.equal(reward.revenue, 2500000, 'Chỉ doanh thu của chính nhân viên được đưa vào KPI.')
assert.equal(reward.dailyBonus, 100000, 'Năm ngày đạt 100% phải có 5 × 20.000đ thưởng ngày.')
assert.equal(reward.weeklyBonus, 100000, 'Năm ngày đạt trong cùng tuần phải có 100.000đ thưởng tuần.')
assert.equal(reward.reward, 200000, 'Thưởng KPI cá nhân phải bằng đúng thưởng ngày + thưởng tuần của cột quản lý.')

console.log('MY_TIMESHEET_KPI_AND_LATE_OK')
