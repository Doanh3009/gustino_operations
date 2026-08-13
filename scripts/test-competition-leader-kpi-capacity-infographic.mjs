import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const workDir = await mkdtemp(join(tmpdir(), 'gustino-competition-separation-'))
const admin = await readFile(join(root, 'src/pages/AdminPage.tsx'), 'utf8')
const employeePage = await readFile(join(root, 'src/pages/CompetitionBoardPage.tsx'), 'utf8')

async function bundle(entry, outName) {
  const outFile = join(workDir, outName)
  await build({
    entryPoints: [join(root, entry)],
    outfile: outFile,
    format: 'esm',
    bundle: true,
    logLevel: 'silent',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': '""',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
      'import.meta.env.DEV': 'false',
      'import.meta.env.MODE': '"test"',
    },
  })
  return import(pathToFileURL(outFile).href)
}

// ── 1. Ca trưởng không được lọt vào bảng nhân viên công khai. ──────────────
const board = await bundle('src/lib/employeeCompetitionBoard.ts', 'employee-board.mjs')
const employees = [
  { id: 'staff-a', name: 'Nhân viên A', role: 'staff', branchId: 'lotte-vt', employmentType: 'full_time', active: true },
  { id: 'deputy', name: 'Ca phó', role: 'shift_deputy', branchId: 'lotte-vt', employmentType: 'leader', active: true },
  { id: 'leader', name: 'Ca trưởng', role: 'shift_leader', branchId: 'lotte-vt', employmentType: 'leader', active: true },
]
const receipt = (id, sellerId, amount, date = '2026-07-06') => ({
  id,
  branchId: 'lotte-vt',
  businessDate: date,
  sellerId,
  sellerKey: sellerId,
  sellerName: '',
  totalQuantity: 1,
  totalAmount: amount,
  lines: [],
  createdAt: `${date}T08:00:00.000Z`,
  createdBy: sellerId,
})
const publicRows = board.buildCompetitionBoardRows({
  receipts: [receipt('r1', 'staff-a', 2_000_000), receipt('r2', 'deputy', 800_000), receipt('r3', 'leader', 9_000_000)],
  employees,
  branchId: 'lotte-vt',
  from: '2026-07-01',
  to: '2026-07-31',
  meId: 'staff-a',
})
assert.deepEqual(
  publicRows.map((row) => row.employeeKey).sort(),
  ['deputy', 'staff-a'],
  'Bảng nhân viên phải giữ nhân viên/Ca phó và loại Ca trưởng sang bảng riêng.',
)

// “Đạt KPI” của chính sách daily-only = có ít nhất một ngày đạt, không phải
// bắt buộc tổng tháng đạt 100%. Đây là nguyên nhân screenshot chỉ hiện 2 người.
const dailyAchievementSummary = board.summarizeCompetitionTeam([
  { employeeKey: 'a', employeeName: 'A', branchId: 'lotte-vt', positionLabel: '', positionGroup: 'pg_full_time', revenue: 10, target: 100, progress: 10, rank: 'D', achievedDays: 3, activeDays: 20, isMe: false },
  { employeeKey: 'b', employeeName: 'B', branchId: 'lotte-vt', positionLabel: '', positionGroup: 'pg_full_time', revenue: 20, target: 100, progress: 20, rank: 'D', achievedDays: 1, activeDays: 20, isMe: false },
  { employeeKey: 'c', employeeName: 'C', branchId: 'lotte-vt', positionLabel: '', positionGroup: 'pg_full_time', revenue: 30, target: 100, progress: 30, rank: 'D', achievedDays: 0, activeDays: 20, isMe: false },
], 'lotte-vt')
assert.equal(dailyAchievementSummary.achievedCount, 2, 'Phải đếm người có ngày đạt KPI dù tổng tháng dưới 100%.')

// ── 2. Bảng quản trị tách hai tập dữ liệu, không chỉ đổi nhãn. ─────────────
assert.match(admin, /monthlyEmployeeCompetitionRows\s*=\s*monthlyCompetitionRows\.filter\(\(row\)\s*=>\s*row\.role\s*!==\s*'shift_leader'\)/,
  'Thiếu tập bảng tháng đã loại Ca trưởng.')
assert.match(admin, /dailyEmployeeCompetitionRows\s*=\s*dailyCompetitionRows\.filter\(\(row\)\s*=>\s*row\.role\s*!==\s*'shift_leader'\)/,
  'Thiếu tập bảng ngày đã loại Ca trưởng.')
assert.match(admin, /<option value="leaders">Ca trưởng theo tháng<\/option>/,
  'Phải giữ bảng Ca trưởng theo tháng riêng.')
assert.doesNotMatch(employeePage, /<option value="shift_leader">Ca trưởng<\/option>/,
  'Bộ lọc bảng nhân viên không được đưa Ca trưởng trở lại.')

// ── 3. Số "đạt KPI" đếm theo NGÀY đạt và nói rõ đơn vị. ───────────────────
// 13/08/2026: dải thẻ tổng đầu màn đã bỏ; con số này nay nằm ở chip cạnh tiêu đề
// section, nhưng vẫn phải đếm đúng người-có-ngày-đạt và gọi đúng tên đơn vị.
assert.match(admin, /row\.achievedDays\s*>\s*0/, 'Chưa đếm người có ngày đạt KPI.')
assert.match(admin, /có ngày đạt KPI/, 'Chưa nói rõ đang đếm KPI theo ngày.')
// Tổng "N lượt ngày đạt chỉ tiêu" của cả kỳ đi cùng dải thẻ tổng đã bỏ. Số đối
// chiếu daily-only nay đọc trong drill-down từng người (thẻ "KPI theo ngày") và
// trong file Excel KPI — không dựng lại dải tổng chỉ để có con số này.
assert.match(admin, /KPI theo ngày \(\{dayRows\.length\}\)/,
  'Mất chỗ đối chiếu số ngày đạt chỉ tiêu của từng người.')
assert.doesNotMatch(admin, /className="competition-overview"/,
  'Dải tổng đầu màn Thi đua đã bỏ — đừng dựng lại.')
assert.match(employeePage, /Có ngày đạt KPI/, 'Bảng nhân viên công khai vẫn dùng nhãn đạt KPI tháng gây hiểu nhầm.')

// ── 4. Infographic trung bình phải có cả ngày và tháng cho TỪNG người. ─────
assert.match(admin, /function EmployeeSalesCapacityPoster\(/, 'Thiếu component infographic năng suất trung bình.')
assert.match(admin, /row\.revenuePerDay/, 'Infographic thiếu doanh thu trung bình/ngày của từng người.')
assert.match(admin, /row\.quantityPerDay/, 'Infographic thiếu sản phẩm trung bình/ngày của từng người.')
assert.match(admin, /row\.revenuePerMonth/, 'Infographic thiếu doanh thu trung bình/tháng của từng người.')
assert.match(admin, /Xuất ảnh trung bình bán/, 'Thiếu nút xuất infographic trung bình bán hàng.')
assert.match(admin, /trung-binh-ban-hang-\$\{rankingPeriod\}\.jpg/, 'Tên file infographic chưa gắn đúng tháng đang xem.')
assert.match(admin, /salesCapacityPosterRef/, 'Infographic chưa được nối vào DOM/ref để html2canvas chụp.')

console.log('COMPETITION_LEADER_KPI_CAPACITY_INFOGRAPHIC_OK')
