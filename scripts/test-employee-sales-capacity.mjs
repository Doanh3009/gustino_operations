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

// 07/08/2026 — mẫu số đổi từ CA/GIỜ sang NGÀY/THÁNG theo yêu cầu chủ quán:
// "nhân viên đó bán mỗi ngày bao nhiêu, tổng tháng trung bình bao nhiêu".
// Một người trực 2 ca cùng ngày vẫn chỉ bán trong MỘT ngày ⇒ mẫu số là ngày.

// ── 1. Người làm ít ngày nhưng bán khỏe phải đứng trên người có tổng doanh thu lớn hơn.
const inputs = [
  employee('a', 'Nhân viên A', { revenue: 10_000_000, soldQuantity: 200, shiftCount: 12, dayCount: 10, monthCount: 2, totalHours: 80 }),
  employee('b', 'Nhân viên B', { revenue: 3_000_000, soldQuantity: 75, shiftCount: 2, dayCount: 2, monthCount: 1, totalHours: 10 }),
  employee('c', 'Nhân viên C', { revenue: 1_200_000, soldQuantity: 20, shiftCount: 0, dayCount: 0, monthCount: 0, totalHours: 0 }),
]

const perDay = capacity.buildEmployeeSalesCapacity(inputs, 'revenuePerDay')
assert.deepEqual(
  perDay.rows.map((row) => row.employeeKey),
  ['b', 'a', 'c'],
  'Xếp hạng năng suất phải theo doanh thu/ngày, người thiếu mẫu số xếp cuối.',
)
assert.equal(perDay.rows[0].value, 1_500_000, 'Doanh thu/ngày sai.')
assert.equal(perDay.rows[1].value, 1_000_000, 'Doanh thu/ngày sai.')
assert.equal(perDay.rows[2].measured, false, 'Người không có ngày công không thể có năng suất trung bình.')
assert.equal(perDay.rows[2].value, 0, 'Người thiếu mẫu số phải để trống chỉ số, không lấy tổng doanh thu làm trung bình.')
assert.equal(perDay.measuredRows.length, 2)

// Trực 2 ca trong cùng một ngày KHÔNG được làm loãng trung bình ngày.
const doubleShift = capacity.buildEmployeeSalesCapacity(
  [employee('d', 'Nhân viên D', { revenue: 2_000_000, soldQuantity: 40, shiftCount: 4, dayCount: 2, monthCount: 1, totalHours: 32 })],
  'revenuePerDay',
)
assert.equal(doubleShift.rows[0].value, 1_000_000, 'Mẫu số phải là NGÀY công, không phải số ca.')

// Trung bình đội là bình quân gia quyền (tổng/tổng), không phải trung bình của các số trung bình.
assert.equal(
  Math.round(perDay.teamAverage),
  Math.round(13_000_000 / 12),
  'Trung bình đội phải lấy tổng doanh thu chia tổng số ngày công của người đo được.',
)
assert.notEqual(Math.round(perDay.teamAverage), Math.round((1_500_000 + 1_000_000) / 2))
assert.equal(perDay.totalRevenue, 14_200_000, 'Tổng doanh thu phải gồm cả người chưa tính được năng suất.')
assert.equal(perDay.totalDays, 12)
assert.equal(perDay.bestRow.employeeKey, 'b')

// So với trung bình đội: trên mức thì dương, dưới mức thì âm.
assert.ok(perDay.rows[0].diffFromTeam > 0 && perDay.rows[0].teamRatio > 100, 'Người trên mức trung bình phải có chênh lệch dương.')
assert.ok(perDay.rows[1].diffFromTeam < 0 && perDay.rows[1].teamRatio < 100, 'Người dưới mức trung bình phải có chênh lệch âm.')
assert.equal(perDay.rows[2].teamRatio, 0, 'Người thiếu mẫu số không được gán tỷ lệ so sánh.')

// ── 2. Đổi chỉ số thì đổi cả thứ hạng lẫn mốc trung bình.
const perQuantity = capacity.buildEmployeeSalesCapacity(inputs, 'quantityPerDay')
assert.equal(perQuantity.rows[0].value, 37.5, 'Sản phẩm/ngày sai.')
assert.equal(perQuantity.teamAverage, 275 / 12, 'Trung bình sản phẩm/ngày phải theo tổng sản phẩm chia tổng ngày.')

const perMonth = capacity.buildEmployeeSalesCapacity(inputs, 'revenuePerMonth')
assert.equal(perMonth.rows.find((row) => row.employeeKey === 'a').value, 5_000_000, 'Doanh thu/tháng sai (10tr trong 2 tháng).')
assert.equal(perMonth.rows.find((row) => row.employeeKey === 'b').value, 3_000_000, 'Doanh thu/tháng sai (3tr trong 1 tháng).')
assert.equal(perMonth.teamAverage, 13_000_000 / 3, 'Trung bình tháng phải theo tổng doanh thu chia tổng lượt tháng có làm.')
assert.equal(perMonth.totalMonths, 3)

// ── 3. Ca trưởng theo tháng chưa có ngày công ⇒ không đo được, không chia cho 0.
const leaderRows = [employee('l1', 'Ca trưởng 1', { revenue: 5_000_000, soldQuantity: 90, shiftCount: 4, dayCount: 0, monthCount: 0, totalHours: 0 })]
const leaderCapacity = capacity.buildEmployeeSalesCapacity(leaderRows, 'revenuePerDay')
assert.equal(leaderCapacity.hasDays, false, 'Không có ngày công thì phải báo hasDays = false.')
assert.equal(leaderCapacity.measuredRows.length, 0)
assert.equal(leaderCapacity.teamAverage, 0, 'Không có mẫu số thì trung bình đội là 0, không chia cho 0.')

assert.equal(capacity.buildEmployeeSalesCapacity([], 'revenuePerDay').teamAverage, 0, 'Danh sách rỗng không được sinh NaN.')
assert.equal(capacity.SALES_CAPACITY_METRICS.length, 3)
assert.equal(capacity.salesCapacityMetricLabel('revenuePerDay'), 'Doanh thu / ngày')
assert.equal(capacity.salesCapacityMetricLabel('revenuePerMonth'), 'Doanh thu / tháng')

// ── 4. Gắn đúng chỗ trong màn Thi đua nhân viên, dùng đúng tập nhân sự đang lọc.
assert.match(admin, /buildEmployeeSalesCapacity\(competitionFilteredRows, effectiveCapacityMetric\)/,
  'Năng suất phải tính trên đúng tập nhân sự đã lọc của bảng thi đua.')
assert.match(admin, /capacityMetric === 'revenuePerMonth' && !capacityHasMonths/,
  'Kỳ chỉ có một ngày thì chỉ số theo tháng phải tự quay về theo ngày.')
const competitionSection = sourceBetween(admin, "{activeSection === 'commission' && (", '<p className="commission-note">KPI chỉ tính cho')
assert.match(competitionSection, /<CompetitionClassificationTable/, 'Sai mốc kiểm tra: bảng xếp hạng thi đua đã đổi chỗ.')
assert.match(competitionSection, /<EmployeeSalesCapacityBoard/,
  'Biểu đồ khả năng bán trung bình phải nằm chung trong section Thi đua nhân viên.')
assert.match(admin, /aria-label="Chỉ số năng suất"/, 'Thiếu nút đổi chỉ số năng suất.')
assert.match(admin, /className="capacity-chart-rows"/, 'Thiếu biểu đồ so sánh năng suất.')
assert.match(admin, /className="capacity-average-mark"/, 'Biểu đồ phải có vạch mốc trung bình đội để so sánh.')

// 07/08/2026 — MỘT BẢNG DUY NHẤT: năng suất từng người là CỘT của bảng xếp hạng,
// không còn là danh sách thứ hai liệt kê lại đúng nhóm người đó.
assert.doesNotMatch(admin, /className="capacity-list"/,
  'Danh sách năng suất riêng đã bị gộp vào bảng xếp hạng — đừng dựng lại danh sách thứ hai.')
// 13/08/2026 — dải tổng đầu màn Thi đua cũng đã bỏ nốt; năng suất từng người
// nằm trong CỘT của bảng xếp hạng, không có dải tổng nào ở đầu màn nữa.
assert.doesNotMatch(admin, /className="capacity-summary-grid"/,
  'Số tổng năng suất nằm trong bảng xếp hạng — đừng dựng lại dải tổng ở đầu màn.')
assert.doesNotMatch(admin, /className="competition-overview"/,
  'Dải tổng đầu màn Thi đua đã bỏ — đừng dựng lại.')
assert.doesNotMatch(admin, /<div className="adm-list">\s*\{commissionRows/,
  'Thẻ thưởng KPI trùng nhóm người của bảng xếp hạng đã bị gỡ.')
assert.match(admin, /competition-classification-capacity/, 'Bảng xếp hạng thiếu cột năng suất.')
assert.match(admin, /<span>\{salesCapacityMetricLabel\(capacityMetric\)\}<\/span>/,
  'Tiêu đề cột năng suất phải đổi theo chỉ số đang chọn.')
assert.match(admin, /Chưa có ngày công để tính trung bình/,
  'Người chưa có ngày công phải được nói rõ lý do thay vì hiện số 0 gây hiểu nhầm.')
assert.match(admin, /so với TB đội/, 'Cột năng suất phải nói rõ chênh lệch so với trung bình đội.')

for (const selector of ['.capacity-board {', '.capacity-chart {', '.capacity-average-mark {']) {
  assert.ok(styles.includes(selector), `Thiếu CSS ${selector}`)
}
assert.ok(!styles.includes('.capacity-list-head,'), 'CSS danh sách năng suất cũ phải được dọn cùng lúc với markup.')
assert.match(styles, /@media \(max-width: 900px\) \{\s*\.capacity-board/, 'Bảng năng suất chưa có bố cục điện thoại.')

console.log('EMPLOYEE_SALES_CAPACITY_OK')

function employee(key, name, metrics) {
  return {
    employeeKey: key,
    employeeName: name,
    branchId: 'gold-coast',
    dayCount: 0,
    monthCount: 0,
    ...metrics,
  }
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
