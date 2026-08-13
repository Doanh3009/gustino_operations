import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const [commissionSource, adminSource, reportSource] = await Promise.all([
  readFile(new URL('../src/lib/commission.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8'),
])

const start = commissionSource.indexOf('export const DEFAULT_REVENUE_TARGET')
const end = commissionSource.indexOf('const PRODUCT_PRICES')
assert.ok(start >= 0 && end > start, 'Không tìm thấy khối công thức KPI thuần.')

const pureSource = commissionSource
  .slice(start, end)
  .replace(/\bexport\s+/g, '')
  .concat('\nexport { positionKpiKey, employeePeriodRevenueTarget, employeeCompetitionPeriodRevenueTarget, branchTeamPeriodRevenueTarget, monthlyKpiBonus, monthlySpecialBonus };\n')
const compiled = ts.transpileModule(pureSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText

const previousTimezone = process.env.TZ
process.env.TZ = 'Asia/Bangkok'

try {
  const kpi = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

  assert.equal(kpi.positionKpiKey('shift_leader', 'leader', 'Ca phó'), 'shift_deputy')
  assert.equal(kpi.positionKpiKey('shift_leader', 'leader', 'Ca pho'), 'shift_deputy')
  assert.equal(kpi.positionKpiKey('shift_leader', 'leader', 'Ca trưởng'), 'shift_leader')
  assert.equal(kpi.positionKpiKey('staff', 'full_time', 'Part-time (8h)'), 'pg_full_time')
  assert.equal(kpi.employeePeriodRevenueTarget('gold-coast', 'staff', 'full_time', 'Part-time (8h)', '2026-08-09', '2026-08-09'), 1300000)

  const target = (title, employmentType, date) => kpi.employeePeriodRevenueTarget(
    'lotte-vt',
    title === 'Ca phó' || title === 'Ca trưởng' ? 'shift_leader' : 'staff',
    employmentType,
    title,
    date,
    date,
  )

  // Thứ Bảy 08/08 và Chủ nhật 09/08 luôn là cuối tuần ở múi giờ Việt Nam.
  assert.equal(target('Part-time', 'part_time', '2026-08-08'), 780000)
  assert.equal(target('Full-time', 'full_time', '2026-08-09'), 1560000)
  assert.equal(target('Ca phó', 'leader', '2026-08-08'), 468000)

  // Thứ Hai 10/08 phải quay về mức ngày thường, không bị lệch từ cuối tuần.
  assert.equal(target('Part-time', 'part_time', '2026-08-10'), 600000)
  assert.equal(target('Full-time', 'full_time', '2026-08-10'), 1200000)
  assert.equal(target('Ca phó', 'leader', '2026-08-10'), 360000)
  assert.equal(target('Ca trưởng', 'leader', '2026-08-10'), 360000)

  // Tháng lịch sử cũng dùng đúng thứ trong tuần: 04/07/2026 là Thứ Bảy,
  // 06/07/2026 là Thứ Hai. Đây là kỳ từng bị lệch trước bản vá UTC.
  assert.equal(target('Part-time', 'part_time', '2026-07-04'), 650000)
  assert.equal(target('Full-time', 'full_time', '2026-07-04'), 1300000)
  assert.equal(target('Ca phó', 'leader', '2026-07-04'), 500000)
  assert.equal(target('Part-time', 'part_time', '2026-07-06'), 550000)
  assert.equal(target('Full-time', 'full_time', '2026-07-06'), 1050000)
  assert.equal(target('Ca phó', 'leader', '2026-07-15'), 500000)
  assert.equal(target('Ca trưởng', 'leader', '2026-07-15'), 0)
  assert.equal(target('Part-time', 'part_time', '2026-07-16'), 600000)
  assert.equal(target('Ca phó', 'leader', '2026-07-16'), 360000)
  assert.equal(target('Ca trưởng', 'leader', '2026-07-16'), 360000)

  assert.equal(kpi.employeePeriodRevenueTarget('lotte-vt', 'staff', 'part_time', 'Part-time', '2026-08-01', '2026-08-31'), 16680000)
  assert.equal(kpi.employeePeriodRevenueTarget('lotte-vt', 'staff', 'full_time', 'Full-time', '2026-08-01', '2026-08-31'), 33360000)
  assert.equal(kpi.employeePeriodRevenueTarget('lotte-vt', 'shift_deputy', 'leader', 'Ca phó', '2026-08-01', '2026-08-31'), 10008000)
  assert.equal(kpi.employeePeriodRevenueTarget('lotte-vt', 'shift_leader', 'leader', 'Ca trưởng', '2026-08-01', '2026-08-31'), 10008000)
  assert.equal(kpi.employeePeriodRevenueTarget('lotte-vt', 'staff', 'part_time', 'Part-time', '2026-07-01', '2026-07-31'), 18970000)
  assert.equal(kpi.employeePeriodRevenueTarget('lotte-vt', 'shift_deputy', 'leader', 'Ca phó', '2026-07-01', '2026-07-31'), 13692000)
  assert.equal(kpi.employeePeriodRevenueTarget('lotte-vt', 'shift_leader', 'leader', 'Ca trưởng', '2026-07-01', '2026-07-31'), 6192000)
  assert.equal(kpi.employeeCompetitionPeriodRevenueTarget('lotte-vt', 'shift_leader', 'leader', 'Ca trưởng', '2026-07-01', '2026-07-31'), 80692000)

  assert.equal(kpi.branchTeamPeriodRevenueTarget('lotte-vt', '2026-07-15', '2026-07-15'), 4700000)
  assert.equal(kpi.branchTeamPeriodRevenueTarget('lotte-vt', '2026-07-16', '2026-07-16'), 5520000)
  assert.equal(kpi.branchTeamPeriodRevenueTarget('lotte-vt', '2026-08-08', '2026-08-08'), 7176000)
  assert.equal(kpi.branchTeamPeriodRevenueTarget('lotte-vt', '2026-08-10', '2026-08-10'), 5520000)
  assert.equal(kpi.branchTeamPeriodRevenueTarget('lotte-vt', '2026-07-01', '2026-07-31'), 169444000)
  assert.equal(kpi.branchTeamPeriodRevenueTarget('lotte-vt', '2026-08-01', '2026-08-31'), 153456000)

  assert.equal(kpi.monthlyKpiBonus(100, 'staff', 'full_time', 'Full-time'), 1500000)
  assert.equal(kpi.monthlyKpiBonus(100, 'shift_leader', 'leader', 'Ca phó'), 1500000)
  assert.equal(kpi.monthlyKpiBonus(100, 'shift_leader', 'leader', 'Ca trưởng'), 3000000)
  assert.equal(kpi.monthlyKpiBonus(120, 'staff', 'part_time', 'Part-time'), 0)

  const specials = kpi.monthlySpecialBonus({
    position: 'pg_full_time',
    revenue: 23000000,
    previousRevenue: 20000000,
    achievedDays: 26,
    totalShifts: 26,
    lateCount: 0,
    absentCount: 0,
    isTopRevenueInGroup: true,
    disciplineConfirmed: false,
  })
  assert.equal(specials.confirmedBonus, 900000, 'Most Improved + Perfect Month phải cộng dồn 400k + 500k.')
  assert.equal(specials.pendingBonus, 1000000, 'PG of the Month Full-time phải chờ Admin xác nhận kỷ luật.')
} finally {
  if (previousTimezone === undefined) delete process.env.TZ
  else process.env.TZ = previousTimezone
}

// Tiền KPI chỉ đến từ thưởng NGÀY (không thưởng tuần/tháng). Từ 11/08/2026 biến
// `dailyBonus` còn bị ép về 0 cho ca trưởng vì họ chưa bị chấm KPI.
assert.ok(adminSource.includes('const kpiBonus = dailyBonus'), 'Admin chưa giới hạn tiền KPI ở thưởng ngày.')
assert.ok(
  adminSource.includes('const dailyBonus = recordedLeader ? 0 : row.dailyBonus'),
  'Ca trưởng vẫn được tính thưởng KPI dù chưa có chỉ tiêu.',
)
assert.ok(!adminSource.includes('monthlyKpiBonus('), 'Admin vẫn kích hoạt thưởng KPI tháng trái yêu cầu mới.')
assert.ok(adminSource.includes('branchTeamPeriodRevenueTarget('), 'Admin chưa dùng KPI team cho Ca trưởng Vũng Tàu.')
assert.ok(adminSource.includes('* bonusMultiplier'), 'Thưởng team Ca trưởng chưa nhân theo số ca thực tế.')
assert.ok(adminSource.includes('workedShiftCount'), 'Admin chưa đếm số ca thực tế của Ca trưởng theo từng ngày.')
assert.ok(reportSource.includes('targetRevenue > 0'), 'Báo cáo chưa chặn thưởng KPI cá nhân khi Ca trưởng có target bằng 0.')
assert.ok(
  commissionSource.includes("if (branchId === 'lotte-vt') return Math.max(0, fallback)"),
  'Override KPI cá nhân cũ vẫn có thể ghi đè khung Vũng Tàu mới.',
)

console.log('VUNG_TAU_KPI_20260810_OK')
