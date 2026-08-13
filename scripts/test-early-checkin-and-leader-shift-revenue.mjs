// Hai luật chủ quán chốt/cập nhật ngày 12/08/2026:
//  1. Từ 12/08, đi trễ tính từ mốc VÀO SỚM 15 PHÚT cho mọi chi nhánh. Trước
//     12/08 vẫn lấy giờ bắt đầu ca. Sai số theo phút: ca 07:00 thì 07:00 không
//     trễ, từ 07:01 mới trễ; tương tự mốc mới 08:45 thì từ 08:46 mới trễ.
//  2. Doanh thu ca trưởng ghi nhận theo CA LÀM: tổng doanh thu các ca mình đứng
//     tên ca trưởng, cộng hóa đơn tự bấm ở ca người khác, KHÔNG cộng trùng.
// Luật doanh thu ca trưởng vẫn áp từ 01/08/2026; không đổi trong yêu cầu này.
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const failures = []
const root = fileURLToPath(new URL('..', import.meta.url))
const workDir = await mkdtemp(join(tmpdir(), 'gustino-attendance-leader-'))

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

function expect(label, actual, expected) {
  if (actual !== expected) failures.push(`${label}: mong ${expected}, nhận ${actual}.`)
}

/* ---------------- 1. Đi trễ tính từ mốc vào sớm 15 phút ---------------- */
const lateness = await bundle('src/lib/attendanceLateness.ts', 'attendanceLateness.mjs')
const {
  EARLY_CHECK_IN_MINUTES,
  LATE_CHECK_IN_TOLERANCE_MINUTES,
  usesEarlyCheckInRule,
  onTimeCheckInDeadline,
  lateMinutesFor,
  isLateCheckIn,
} = lateness

expect('Phải vào sớm 15 phút', EARLY_CHECK_IN_MINUTES, 15)
expect('Sai số chuyển trạng thái theo phút kế tiếp', LATE_CHECK_IN_TOLERANCE_MINUTES, 1)
expect('Ca 11/08 vẫn dùng giờ bắt đầu ca', usesEarlyCheckInRule('2026-08-11'), false)
expect('Ca 12/08 bắt đầu dùng mốc vào sớm', usesEarlyCheckInRule('2026-08-12'), true)

// Trước ngày hiệu lực: ca 07:00 lấy đúng giờ bắt đầu, không cộng grace cũ 5 phút.
const legacyStart = new Date('2026-08-11T07:00:00+07:00')
const legacyAt = (time) => new Date(`2026-08-11T${time}+07:00`)
expect(
  'Ngày 11/08 lấy mốc đúng 07:00',
  onTimeCheckInDeadline('2026-08-11', legacyStart, 5).toISOString(),
  legacyAt('07:00:00').toISOString(),
)
expect('Đúng 07:00 chưa trễ', lateMinutesFor('2026-08-11', legacyStart, legacyAt('07:00:00'), 5), 0)
expect('Cuối phút 07:00 vẫn chưa trễ', lateMinutesFor('2026-08-11', legacyStart, legacyAt('07:00:59'), 5), 0)
expect('Từ đúng 07:01 mới trễ 1 phút', lateMinutesFor('2026-08-11', legacyStart, legacyAt('07:01:00'), 5), 1)
expect('Cờ trễ tắt trong phút 07:00', isLateCheckIn('2026-08-11', legacyStart, legacyAt('07:00:59'), 5), false)
expect('Cờ trễ bật từ đúng 07:01', isLateCheckIn('2026-08-11', legacyStart, legacyAt('07:01:00'), 5), true)

// Từ ngày hiệu lực: ca 09:00 lấy mốc 08:45 ở mọi chi nhánh.
const start = new Date('2026-08-12T09:00:00+07:00')
const at = (time) => new Date(`2026-08-12T${time}+07:00`)

expect(
  'Mốc đúng giờ là 08:45',
  onTimeCheckInDeadline('2026-08-12', start, 5).toISOString(),
  at('08:45:00').toISOString(),
)
expect('Vào 08:40 không trễ', lateMinutesFor('2026-08-12', start, at('08:40:00'), 5), 0)
expect('Cuối phút 08:45 vẫn không trễ', lateMinutesFor('2026-08-12', start, at('08:45:59'), 5), 0)
expect('Vào đúng 08:46 trễ 1 phút', lateMinutesFor('2026-08-12', start, at('08:46:00'), 5), 1)
expect('Vào 08:50 trễ 5 phút', lateMinutesFor('2026-08-12', start, at('08:50:00'), 5), 5)
expect('Vào đúng giờ ca 09:00 trễ 15 phút', lateMinutesFor('2026-08-12', start, at('09:00:00'), 5), 15)
expect('Vào 09:20 trễ 35 phút', lateMinutesFor('2026-08-12', start, at('09:20:00'), 5), 35)
expect('Không check-in thì không tính trễ', lateMinutesFor('2026-08-12', start, undefined, 5), 0)
expect('Cờ trễ tắt trong phút 08:45', isLateCheckIn('2026-08-12', start, at('08:45:59'), 5), false)
expect('Cờ trễ bật từ đúng 08:46', isLateCheckIn('2026-08-12', start, at('08:46:00'), 5), true)

// Bảng công dùng đúng một helper cho toàn bộ chi nhánh, không có ngày bật riêng.
const attendanceRuntime = await bundle('src/lib/attendance.ts', 'attendance.mjs')
const attendanceBranches = ['gold-coast', 'lotte-23-10', 'lotte-vt']
const registrations = attendanceBranches.map((branchId, index) => ({
  id: `registration-${index}`,
  userId: `employee-${index}`,
  userName: `Nhân viên ${index}`,
  branchId,
  workDate: '2026-08-12',
  shiftId: `shift-${index}`,
  startTime: '09:00',
  endTime: '17:00',
  status: 'approved',
}))
const records = registrations.map((registration, index) => ({
  id: `record-${index}`,
  userId: registration.userId,
  userName: registration.userName,
  branchId: registration.branchId,
  shiftRegistrationId: registration.id,
  checkInTime: '2026-08-12T08:46:00+07:00',
}))
const branchRows = attendanceRuntime.buildAttendanceDetailRows(registrations, records, new Map())
expect('Cả ba chi nhánh cùng áp mốc 12/08', branchRows.map((row) => `${row.branchId}:${row.lateMinutes}`).join(','), 'gold-coast:1,lotte-23-10:1,lotte-vt:1')

/* ---------------- 2. Doanh thu ca trưởng theo ca làm ---------------- */
const competition = await bundle('src/lib/shiftCompetition.ts', 'shiftCompetition.mjs')
const { buildShiftLeaderRecordedRevenue } = competition

const BRANCH = 'lotte-vt'
const DATE = '2026-08-11'
const session = (id, sequence, leaderId, leaderName) => ({
  id,
  branchId: BRANCH,
  businessDate: DATE,
  sequence,
  status: 'closed',
  leaderId,
  leaderName,
  startedAt: `${DATE}T00:30:00.000Z`,
  endedAt: `${DATE}T15:30:00.000Z`,
  openingBalances: {},
})
const receipt = (id, time, amount, quantity, sellerId, sellerName) => ({
  id,
  code: id,
  branchId: BRANCH,
  businessDate: DATE,
  sellerId,
  sellerKey: sellerId,
  sellerName,
  totalQuantity: quantity,
  totalAmount: amount,
  lines: [],
  createdAt: `${DATE}T${time}:00.000Z`,
  createdBy: sellerId,
  createdByName: sellerName,
})

// 15:15 giờ VN = 08:15Z. Ca sáng: Ngân. Ca tối: Tú.
const sessions = [
  session('s1', 1, 'ngan', 'Lưu Thị Thanh Ngân'),
  session('s2', 2, 'tu', 'Dương Minh Tú'),
]
const receipts = [
  receipt('r1', '02:00', 5_000_000, 50, 'nhanvien-a', 'Nhân viên A'),
  receipt('r2', '07:00', 2_000_000, 20, 'nhanvien-b', 'Nhân viên B'),
  // Ca trưởng ca sáng tự bấm một bill TRONG ca của mình: không được cộng hai lần.
  receipt('r3', '05:00', 1_000_000, 10, 'ngan', 'Lưu Thị Thanh Ngân'),
  receipt('r4', '10:00', 3_000_000, 30, 'nhanvien-a', 'Nhân viên A'),
  // Ca trưởng ca sáng bấm bill trong ca TỐI (ca của người khác): vẫn là bán hàng của mình.
  receipt('r5', '12:00', 500_000, 5, 'ngan', 'Lưu Thị Thanh Ngân'),
]
const recorded = buildShiftLeaderRecordedRevenue(sessions, receipts, {
  branchIds: [BRANCH],
  from: DATE,
  to: DATE,
})
const ngan = recorded.get(`${BRANCH}|ngan`)
const tu = recorded.get(`${BRANCH}|tu`)

// Ca sáng = r1 + r2 + r3 = 8.000.000, cộng r5 bấm ở ca tối = 8.500.000.
expect('Ngân: doanh thu ca sáng + bill bấm ở ca tối', ngan?.revenue, 8_500_000)
expect('Ngân: sản lượng tương ứng', ngan?.soldQuantity, 85)
expect('Ngân: đúng 4 hóa đơn, không đếm trùng', ngan?.receiptCount, 4)
expect('Ngân: 1 ca đứng tên', ngan?.shiftCount, 1)
// Ca tối = r4 + r5 = 3.500.000 (r5 nằm trong ca tối nên vẫn thuộc tổng ca của Tú).
expect('Tú: trọn doanh thu ca tối', tu?.revenue, 3_500_000)
expect('Tú: sản lượng ca tối', tu?.soldQuantity, 35)

// Bất biến: tổng doanh thu các CA phải bằng tổng ngày, không hở không chồng.
const dayTotal = receipts.reduce((sum, item) => sum + item.totalAmount, 0)
const shiftTotal = Array.from(recorded.values()).reduce((sum, row) => sum + row.revenue, 0)
// r5 được cộng cho cả Tú (theo ca) lẫn Ngân (bill của mình) nên tổng lớn hơn đúng r5.
expect('Tổng các ca + bill riêng = tổng ngày + phần bill ca trưởng bấm ở ca khác', shiftTotal, dayTotal + 500_000)

// Ca trưởng trực CẢ HAI ca thì gom hết về một dòng, mỗi hóa đơn vẫn chỉ tính một lần.
const soloRecorded = buildShiftLeaderRecordedRevenue(
  [session('s1', 1, 'ngan', 'Lưu Thị Thanh Ngân'), session('s2', 2, 'ngan', 'Lưu Thị Thanh Ngân')],
  receipts,
  { branchIds: [BRANCH], from: DATE, to: DATE },
)
expect('Trực cả ngày thì ôm trọn doanh thu ngày', soloRecorded.get(`${BRANCH}|ngan`)?.revenue, dayTotal)
expect('Trực cả ngày: đúng 5 hóa đơn', soloRecorded.get(`${BRANCH}|ngan`)?.receiptCount, 5)
expect('Trực cả ngày: 2 ca', soloRecorded.get(`${BRANCH}|ngan`)?.shiftCount, 2)

// Ngày ngoài khoảng lọc không được lọt vào.
const outOfRange = buildShiftLeaderRecordedRevenue(sessions, receipts, {
  branchIds: [BRANCH],
  from: '2026-08-12',
  to: '2026-08-12',
})
expect('Ngoài khoảng ngày thì không ghi nhận gì', outOfRange.size, 0)

// Bộ nguồn đối chiếu phải khớp ĐÚNG doanh thu đã cộng — đây là thứ Excel đọc.
const nganSourceRevenue = (ngan?.sources || []).reduce((sum, item) => sum + item.receipt.totalAmount, 0)
expect('Nguồn đối chiếu của Ngân bằng đúng doanh thu ghi nhận', nganSourceRevenue, ngan?.revenue)
expect('Nguồn đối chiếu không đếm trùng hóa đơn', ngan?.sources?.length, 4)
expect(
  'Bill bấm ở ca khác được đánh dấu riêng',
  (ngan?.sources || []).filter((item) => item.ownBillOutsideShift).map((item) => item.receipt.id).join(','),
  'r5',
)
// Vỡ theo ngày dùng để chấm KPI ngày khi chủ đã đặt chỉ tiêu.
expect('Doanh thu theo ngày cộng lại bằng tổng', (ngan?.days || []).reduce((sum, day) => sum + day.revenue, 0), ngan?.revenue)

/* ---------------- 3. Dấu vết nối vào app ---------------- */
const commission = await readFile(join(root, 'src/lib/commission.ts'), 'utf8')
const admin = await readFile(join(root, 'src/pages/AdminPage.tsx'), 'utf8')
if (!/LEADER_SHIFT_REVENUE_FROM = '2026-08-01'/.test(commission)) {
  failures.push('Mốc áp luật doanh thu ca trưởng phải là 01/08/2026.')
}
if (!admin.includes('shiftLeaderRevenue: monthlyLeaderShiftRevenue')) {
  failures.push('Bảng thi đua tháng chưa dùng doanh thu ca trưởng theo ca làm.')
}
if (!admin.includes('shiftLeaderRevenue: dailyLeaderShiftRevenue')) {
  failures.push('Bảng thi đua ngày chưa dùng doanh thu ca trưởng theo ca làm.')
}
if (!admin.includes("rank: recordedLeader ? '' : kpiRank(progress)")) {
  failures.push('Ca trưởng vẫn bị xếp hạng dù chưa có chỉ tiêu KPI.')
}
// Chấm KPI hay không phải do CHỦ tự đặt mức trên web quyết định, không hardcode.
if (!admin.includes('const leaderNotGraded = Boolean(shiftLeaderRow) && !hasLeaderKpiTarget(row.branchId)')) {
  failures.push('Ca trưởng chưa ăn theo mức KPI chủ tự đặt trong Quản trị.')
}
if (!commission.includes('export function hasLeaderKpiTarget')) {
  failures.push('Thiếu cửa kiểm tra chủ đã đặt KPI ca trưởng chưa.')
}
// Excel/đối chiếu phải đọc đúng bộ hóa đơn đã cộng vào doanh thu ca trưởng.
if (!admin.includes('const leaderRecorded = leaderShiftRevenue')) {
  failures.push('Bảng đối chiếu vẫn dò nguồn ca trưởng theo seller_id ⇒ sẽ báo "Lệch" oan.')
}
if (!admin.includes('monthlyLeaderShiftRevenue,\n    )')) {
  failures.push('Xuất Excel chưa truyền nguồn doanh thu theo ca của ca trưởng.')
}
if (!admin.includes('targetQuantity: recordedLeader ? 0 : targetRevenue')) {
  failures.push('Ca trưởng vẫn bị gán chỉ tiêu KPI cũ.')
}
if (!admin.includes('const dailyBonus = recordedLeader ? 0 : row.dailyBonus')) {
  failures.push('Ca trưởng vẫn được tính thưởng KPI dù chưa chấm KPI.')
}
const attendance = await readFile(join(root, 'src/lib/attendance.ts'), 'utf8')
if (!attendance.includes('isLateCheckIn(registration.workDate, scheduledStart, checkIn, grace)')) {
  failures.push('Bảng công chưa đếm đi trễ theo mốc vào sớm 15 phút.')
}
if (!attendance.includes('lateMinutesFor(registration.workDate, scheduledStart, checkIn, grace)')) {
  failures.push('Chi tiết ca chưa tính số phút trễ theo mốc mới.')
}
const attendancePage = await readFile(join(root, 'src/pages/AttendancePage.tsx'), 'utf8')
if (!attendancePage.includes('isLateNow: isLateCheckIn(registration.workDate, scheduledStart, now, 0)')) {
  failures.push('Cảnh báo trực tiếp vẫn có thể dùng biên mili-giây khác với bảng công.')
}

if (failures.length) {
  console.error('EARLY_CHECKIN_AND_LEADER_SHIFT_REVENUE_FAIL')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log('EARLY_CHECKIN_AND_LEADER_SHIFT_REVENUE_OK')
