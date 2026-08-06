import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { transform } from 'esbuild'

const [admin, styles, capacitySource] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/employeeSalesCapacity.ts', import.meta.url), 'utf8'),
])
const compiled = await transform(capacitySource, { loader: 'ts', format: 'esm', target: 'es2022' })
const capacity = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`)

// ── 1. Người làm ít ca nhưng bán khỏe phải đứng trên người có tổng doanh thu lớn hơn.
const inputs = [
  employee('a', 'Nhân viên A', { revenue: 10_000_000, soldQuantity: 200, shiftCount: 10, totalHours: 80 }),
  employee('b', 'Nhân viên B', { revenue: 3_000_000, soldQuantity: 75, shiftCount: 2, totalHours: 10 }),
  employee('c', 'Nhân viên C', { revenue: 1_200_000, soldQuantity: 20, shiftCount: 0, totalHours: 0 }),
]

const perShift = capacity.buildEmployeeSalesCapacity(inputs, 'revenuePerShift')
assert.deepEqual(
  perShift.rows.map((row) => row.employeeKey),
  ['b', 'a', 'c'],
  'Xếp hạng năng suất phải theo doanh thu/ca, người thiếu mẫu số xếp cuối.',
)
assert.equal(perShift.rows[0].value, 1_500_000, 'Doanh thu/ca sai.')
assert.equal(perShift.rows[1].value, 1_000_000, 'Doanh thu/ca sai.')
assert.equal(perShift.rows[2].measured, false, 'Người không có ca check-in không thể có năng suất trung bình.')
assert.equal(perShift.rows[2].value, 0, 'Người thiếu mẫu số phải để trống chỉ số, không lấy tổng doanh thu làm trung bình.')
assert.equal(perShift.measuredRows.length, 2)

// Trung bình đội là bình quân gia quyền (tổng/tổng), không phải trung bình của các số trung bình.
assert.equal(
  Math.round(perShift.teamAverage),
  Math.round(13_000_000 / 12),
  'Trung bình đội phải lấy tổng doanh thu chia tổng số ca của người đo được.',
)
assert.notEqual(Math.round(perShift.teamAverage), Math.round((1_500_000 + 1_000_000) / 2))
assert.equal(perShift.totalRevenue, 14_200_000, 'Tổng doanh thu phải gồm cả người chưa tính được năng suất.')
assert.equal(perShift.totalShifts, 12)
assert.equal(perShift.bestRow.employeeKey, 'b')

// So với trung bình đội: trên mức thì dương, dưới mức thì âm.
assert.ok(perShift.rows[0].diffFromTeam > 0 && perShift.rows[0].teamRatio > 100, 'Người trên mức trung bình phải có chênh lệch dương.')
assert.ok(perShift.rows[1].diffFromTeam < 0 && perShift.rows[1].teamRatio < 100, 'Người dưới mức trung bình phải có chênh lệch âm.')
assert.equal(perShift.rows[2].teamRatio, 0, 'Người thiếu mẫu số không được gán tỷ lệ so sánh.')

// ── 2. Đổi chỉ số thì đổi cả thứ hạng lẫn mốc trung bình.
const perQuantity = capacity.buildEmployeeSalesCapacity(inputs, 'quantityPerShift')
assert.equal(perQuantity.rows[0].value, 37.5, 'Sản phẩm/ca sai.')
assert.equal(perQuantity.teamAverage, 275 / 12, 'Trung bình sản phẩm/ca phải theo tổng sản phẩm chia tổng ca.')

const perHour = capacity.buildEmployeeSalesCapacity(inputs, 'revenuePerHour')
assert.equal(perHour.rows[0].value, 300_000, 'Doanh thu/giờ công sai.')
assert.equal(perHour.teamAverage, 13_000_000 / 90, 'Trung bình doanh thu/giờ phải theo tổng giờ công.')
assert.equal(perHour.hasHours, true)

// ── 3. Bảng ca trưởng không có giờ công ⇒ chỉ số theo giờ không đo được.
const leaderRows = [employee('l1', 'Ca trưởng 1', { revenue: 5_000_000, soldQuantity: 90, shiftCount: 4, totalHours: 0 })]
const leaderCapacity = capacity.buildEmployeeSalesCapacity(leaderRows, 'revenuePerHour')
assert.equal(leaderCapacity.hasHours, false, 'Không có giờ công thì phải báo hasHours = false để UI quay về chỉ số theo ca.')
assert.equal(leaderCapacity.measuredRows.length, 0)
assert.equal(leaderCapacity.teamAverage, 0, 'Không có mẫu số thì trung bình đội là 0, không chia cho 0.')
assert.equal(capacity.buildEmployeeSalesCapacity(leaderRows, 'revenuePerShift').rows[0].value, 1_250_000)

assert.equal(capacity.buildEmployeeSalesCapacity([], 'revenuePerShift').teamAverage, 0, 'Danh sách rỗng không được sinh NaN.')
assert.equal(capacity.SALES_CAPACITY_METRICS.length, 3)
assert.equal(capacity.salesCapacityMetricLabel('revenuePerShift'), 'Doanh thu / ca')

// ── 4. Gắn đúng chỗ trong màn Thi đua nhân viên, dùng đúng tập nhân sự đang lọc.
assert.match(admin, /buildEmployeeSalesCapacity\(competitionFilteredRows, effectiveCapacityMetric\)/,
  'Năng suất phải tính trên đúng tập nhân sự đã lọc của bảng thi đua.')
assert.match(admin, /capacityMetric === 'revenuePerHour' && !capacityHasHours/,
  'Thiếu giờ công (bảng ca trưởng) thì chỉ số theo giờ phải tự quay về theo ca.')
const competitionSection = sourceBetween(admin, "{activeSection === 'commission' && (", '<div className="adm-list">')
assert.match(competitionSection, /<CompetitionClassificationTable/, 'Sai mốc kiểm tra: bảng xếp hạng thi đua đã đổi chỗ.')
assert.match(competitionSection, /<EmployeeSalesCapacityBoard/,
  'Danh sách khả năng bán trung bình phải nằm chung trong section Thi đua nhân viên.')
assert.match(admin, /aria-label="Chỉ số năng suất"/, 'Thiếu nút đổi chỉ số năng suất.')
assert.match(admin, /className="capacity-chart-rows"/, 'Thiếu biểu đồ so sánh năng suất.')
assert.match(admin, /className="capacity-average-mark"/, 'Biểu đồ phải có vạch mốc trung bình đội để so sánh.')
assert.match(admin, /aria-label=\{`Danh sách \$\{salesCapacityMetricLabel\(metric\)\} theo nhân viên`\}/,
  'Thiếu danh sách năng suất theo nhân viên.')
assert.match(admin, /Chưa có ca\/giờ công để tính trung bình/,
  'Người chưa có ca phải được nói rõ lý do thay vì hiện số 0 gây hiểu nhầm.')

for (const selector of ['.capacity-board {', '.capacity-chart {', '.capacity-average-mark {', '.capacity-list-head,']) {
  assert.ok(styles.includes(selector), `Thiếu CSS ${selector}`)
}
assert.match(styles, /@media \(max-width: 900px\) \{\s*\.capacity-board/, 'Bảng năng suất chưa có bố cục điện thoại.')

console.log('EMPLOYEE_SALES_CAPACITY_OK')

function employee(key, name, metrics) {
  return {
    employeeKey: key,
    employeeName: name,
    branchId: 'gold-coast',
    ...metrics,
  }
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
