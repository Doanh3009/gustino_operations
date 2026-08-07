/**
 * MÀN THI ĐUA = MỘT BỘ LỌC, MỘT DẢI TỔNG, MỘT BẢNG (07/08/2026).
 *
 * Trước bản này màn Thi đua bày 5 danh sách của cùng nhóm người:
 *   1. poster TOP 10 (theo tháng, KHÔNG ăn bộ lọc vai trò/số ca)
 *   2. bảng phân loại thi đua (theo kỳ thi đua)
 *   3. danh sách năng suất đầy đủ (cùng nhóm người, xếp theo chỉ số khác)
 *   4. thẻ thưởng KPI `adm-list` (theo bộ lọc NGÀY ĐẦU TRANG — kỳ khác hẳn)
 *   5. bảng KPI × ngày toàn cục (cũng theo bộ lọc đầu trang)
 * Hệ quả: hai khối cạnh nhau hiện hai con số khác nhau cho cùng một nhân viên,
 * và muốn đọc KPI của một người phải dò mắt qua hàng trăm dòng.
 *
 * Test này khoá lại kết quả đã gộp. Nếu ai đó thêm danh sách thứ hai vào màn
 * Thi đua thì test đỏ — đó là điểm của nó.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [admin, styles] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

const section = sourceBetween(
  admin,
  "{activeSection === 'commission' && (",
  '{/* ===== BÁO CÁO KHO ===== */}',
)
assert.ok(section, 'Không tìm thấy section Thi đua nhân viên.')

// ── 1. Đúng MỘT danh sách nhân sự trong màn.
const personListMarkers = [
  '<CompetitionClassificationTable',
  '<div className="adm-list">',
  'className="capacity-list"',
  'className="kpi-daily-table"',
  'data-table kpi-daily-table',
]
const presentLists = personListMarkers.filter((marker) => section.includes(marker))
assert.deepEqual(
  presentLists,
  ['<CompetitionClassificationTable'],
  `Màn Thi đua phải chỉ còn một danh sách nhân sự, đang có: ${presentLists.join(', ')}`,
)

// ── 2. Đúng MỘT dải số tổng, và nó ăn theo kỳ thi đua chứ không phải bộ lọc đầu trang.
assert.ok(section.includes('className="competition-overview"'), 'Thiếu dải tổng của màn Thi đua.')
assert.ok(!section.includes('payroll-summary-grid'), 'Còn dải tổng thứ hai lấy khoảng ngày khác.')
assert.ok(!section.includes('capacity-summary-grid'), 'Còn dải tổng thứ ba của khối năng suất.')
assert.match(
  admin,
  /const competitionAchievedCount = competitionFilteredRows\.filter\(\(row\) => row\.progress >= 100\)\.length/,
  'Chip "đạt KPI" phải đếm trên đúng tập nhân sự của bảng xếp hạng, không phải bộ lọc đầu trang.',
)

// ── 3. Poster ăn ĐÚNG bộ lọc đang hiển thị và không còn chiếm chỗ trên màn.
assert.match(admin, /const competitionPosterRows = competitionExportRows/, 'Ảnh thi đua phải dùng đúng tập đã lọc.')
assert.match(admin, /if \(!competitionPosterRows\.length\)/, 'Nút xuất ảnh phải kiểm tra đúng tập sẽ được chụp.')
assert.ok(section.includes('className="competition-poster-toggle"'), 'Thiếu nút xem trước ảnh thi đua.')
assert.ok(section.includes('competition-poster-stage'), 'Poster phải nằm trong sân khấu ẩn được.')
// html2canvas không chụp được phần tử display:none ⇒ thu gọn = đẩy ra ngoài khung nhìn.
assert.match(
  styles,
  /\.competition-poster-stage \{ position: absolute; left: -10000px;/,
  'Poster thu gọn phải đẩy ra ngoài khung nhìn, không được display:none.',
)

// ── 4. Bảng xếp hạng: sắp xếp bằng cột, xem thêm bằng nút, chi tiết bằng 2 thẻ.
assert.match(admin, /type CompetitionSortKey = 'revenue' \| 'capacity' \| 'progress' \| 'reward'/, 'Thiếu tiêu chí sắp xếp.')
assert.match(admin, /aria-label="Sắp xếp bảng thi đua"/, 'Thiếu thanh sắp xếp trên bảng xếp hạng.')
assert.match(
  admin,
  /if \(competitionSort === 'revenue'\) return competitionFilteredRows/,
  'Sắp xếp mặc định phải giữ nguyên thứ tự gốc của buildCompetitionRows.',
)
assert.match(admin, /className="competition-classification-more"/, 'Thiếu nút xem tất cả nhân sự.')
assert.match(admin, /Xem tất cả \$\{totalRows\} người/, 'Nút xem thêm phải nói rõ tổng số người.')
assert.match(admin, /role="tablist"/, 'Chi tiết một người phải có thẻ chuyển giữa nguồn doanh thu và KPI ngày.')
assert.match(admin, /KPI theo ngày \(\{dayRows\.length\}\)/, 'Thiếu thẻ KPI theo ngày trong chi tiết từng người.')
assert.match(
  admin,
  /const competitionDailyKpiByKey = useMemo\(/,
  'KPI theo ngày phải được gom sẵn theo từng nhân sự thay vì đổ chung một bảng.',
)
assert.match(
  admin,
  /row\.date >= competitionRangeFrom && row\.date <= competitionRangeTo/,
  'KPI theo ngày trong drill-down phải cùng kỳ với bảng xếp hạng.',
)

// ── 5. Cột năng suất nằm trong chính bảng xếp hạng.
assert.match(admin, /className=\{`competition-classification-capacity/, 'Thiếu cột năng suất trong bảng xếp hạng.')
assert.match(admin, /competitionCapacityByKey\.get\(`\$\{row\.branchId\}-\$\{row\.employeeKey\}`\)/, 'Cột năng suất chưa lấy đúng dòng nhân sự.')
for (const selector of ['.competition-sort-bar {', '.competition-overview {', '.competition-day-row {', '.competition-poster-toggle {']) {
  assert.ok(styles.includes(selector), `Thiếu CSS ${selector}`)
}

console.log('COMPETITION_SINGLE_BOARD_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
