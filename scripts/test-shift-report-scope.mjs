// Phân vùng doanh thu theo ca chạy theo ĐỒNG HỒ (chủ quán chốt 11/08/2026):
// hóa đơn tới 15:15 thuộc Ca 1, sau 15:15 thuộc Ca 2 — bất kể phiên ca mở lúc nào,
// đóng lúc nào, hay ca trưởng có bấm bàn giao hay không.
//
// Lịch sử để không quay lại: bản đầu lọc theo cửa sổ giờ của phiên ca nên hóa đơn
// bán trong "khoảng trống" giữa hai ca biến mất khỏi cả hai ảnh (31/07 Lotte 23/10
// Ca 2 mở 17:17, mất 122.000đ; 28/07 Gold Coast mất 662.000đ; 29/07 Gold Coast mất
// hóa đơn 89.000đ tạo lúc 09:01 trước giờ mở ca). Bản thứ hai (BUG-117) cắt tại
// điểm giao giữa hai phiên ca — hết hở, nhưng ranh giới vẫn trôi theo giờ bấm nút.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const failures = []
const root = fileURLToPath(new URL('..', import.meta.url))

const workDir = await mkdtemp(join(tmpdir(), 'gustino-shift-scope-'))
const outFile = join(workDir, 'shiftReportScope.mjs')
await build({
  entryPoints: [join(root, 'src/lib/shiftReportScope.ts')],
  outfile: outFile,
  format: 'esm',
  bundle: true,
  logLevel: 'silent',
})
const {
  sessionScopeWindow,
  timestampInScopeWindow,
  isTimestampInSessionScope,
  shiftCutoverTimestamp,
  SHIFT_CUTOVER_TIME,
} = await import(pathToFileURL(outFile).href)

const BUSINESS_DATE = '2026-07-31'
// 15:15 giờ Việt Nam = 08:15Z. Mọi mốc bên dưới ghi theo UTC cho khỏi nhầm.
const CUTOVER_UTC = '2026-07-31T08:15:00.000Z'

function session(id, sequence, startedAt, endedAt, extra = {}) {
  return {
    id,
    branchId: 'lotte-2310',
    businessDate: BUSINESS_DATE,
    sequence,
    status: endedAt ? 'closed' : 'open',
    leaderId: `leader-${sequence}`,
    leaderName: `Leader ${sequence}`,
    startedAt,
    endedAt: endedAt || undefined,
    openingBalances: {},
    ...extra,
  }
}

function receipt(code, createdAt, amount) {
  return { code, createdAt, totalAmount: amount, branchId: 'lotte-2310', businessDate: BUSINESS_DATE }
}

function splitRevenue(sessions, receipts) {
  return sessions.map((target) => {
    const window = sessionScopeWindow(target, sessions)
    return receipts
      .filter((item) => timestampInScopeWindow(item.createdAt, window))
      .reduce((sum, item) => sum + item.totalAmount, 0)
  })
}

function expectSplit(label, sessions, receipts, expected, { checkTotal = true } = {}) {
  const actual = splitRevenue(sessions, receipts)
  const total = receipts.reduce((sum, item) => sum + item.totalAmount, 0)
  const actualTotal = actual.reduce((sum, value) => sum + value, 0)
  if (checkTotal && actualTotal !== total) {
    failures.push(`${label}: tổng các ca ${actualTotal} ≠ tổng ngày ${total} — vẫn còn hở/chồng.`)
  }
  expected.forEach((value, index) => {
    if (actual[index] !== value) {
      failures.push(`${label}: ca thứ ${index + 1} mong ${value}, nhận ${actual[index]}.`)
    }
  })
}

// ---- Mốc cắt đúng 15:15 giờ Việt Nam ----------------------------------------
if (SHIFT_CUTOVER_TIME !== '15:15') {
  failures.push(`Mốc cắt phải là 15:15, đang là ${SHIFT_CUTOVER_TIME}.`)
}
if (shiftCutoverTimestamp(BUSINESS_DATE) !== CUTOVER_UTC) {
  failures.push(`Mốc cắt của ${BUSINESS_DATE} phải là ${CUTOVER_UTC}, nhận ${shiftCutoverTimestamp(BUSINESS_DATE)}.`)
}

// ---- Kịch bản THẬT 31/07 Lotte 23/10: Ca 2 mở trễ 121 phút -------------------
// Ca 1 mở 06:55 đóng 15:16; Ca 2 mở tận 17:17. Ranh giới KHÔNG đi theo giờ đó nữa:
// 122k bán lúc 16:00 vẫn thuộc Ca 2 vì đã qua 15:15.
{
  const sessions = [
    session('s1', 1, '2026-07-30T23:55:00.000Z', '2026-07-31T08:16:01.000Z'),
    session('s2', 2, '2026-07-31T10:17:05.000Z', '2026-07-31T15:10:00.000Z'),
  ]
  const receipts = [
    receipt('HD-A', '2026-07-31T02:00:00.000Z', 681000),
    receipt('HD-GAP', '2026-07-31T09:00:00.000Z', 122000),
    receipt('HD-B', '2026-07-31T12:00:00.000Z', 681000),
  ]
  expectSplit('Ca 2 mở trễ (31/07 thật)', sessions, receipts, [681000, 803000])
}

// ---- Hóa đơn tạo TRƯỚC giờ mở Ca 1 (29/07 Gold Coast, HD2907-001 09:01) ------
{
  const sessions = [
    session('s1', 1, '2026-07-31T02:05:00.000Z', '2026-07-31T08:16:00.000Z'),
    session('s2', 2, '2026-07-31T08:17:00.000Z', '2026-07-31T15:10:00.000Z'),
  ]
  const receipts = [
    receipt('HD-EARLY', '2026-07-31T02:01:00.000Z', 89000),
    receipt('HD-C1', '2026-07-31T05:00:00.000Z', 500000),
    receipt('HD-C2', '2026-07-31T10:00:00.000Z', 700000),
  ]
  expectSplit('Bán trước giờ mở ca', sessions, receipts, [589000, 700000])
}

// ---- Ca trưởng chốt Ca 1 SỚM: doanh thu tới 15:15 vẫn là của Ca 1 ------------
// Đây là điểm khác hẳn bản cũ: trước đây chốt lúc 13:30 là mọi hóa đơn 13:30→15:15
// rơi sang Ca 2. Giờ giờ bấm nút không còn ảnh hưởng ranh giới.
{
  const sessions = [
    session('s1', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T06:30:00.000Z'),
    session('s2', 2, '2026-07-31T06:35:00.000Z', '2026-07-31T15:00:00.000Z'),
  ]
  const receipts = [
    receipt('HD-1', '2026-07-31T05:00:00.000Z', 100000),
    receipt('HD-AFTER-CLOSE', '2026-07-31T07:00:00.000Z', 89000),
    receipt('HD-2', '2026-07-31T12:00:00.000Z', 200000),
  ]
  expectSplit('Chốt Ca 1 sớm', sessions, receipts, [189000, 200000])
}

// ---- Ca trưởng chốt Ca 1 MUỘN: doanh thu sau 15:15 đã là của Ca 2 ------------
{
  const sessions = [
    session('s1', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T11:00:00.000Z'),
    session('s2', 2, '2026-07-31T11:05:00.000Z', '2026-07-31T15:00:00.000Z'),
  ]
  const receipts = [
    receipt('HD-1', '2026-07-31T05:00:00.000Z', 300000),
    receipt('HD-LATE-CA1', '2026-07-31T10:00:00.000Z', 150000),
  ]
  expectSplit('Chốt Ca 1 muộn', sessions, receipts, [300000, 150000])
}

// ---- Bán sau giờ đóng ca cuối vẫn thuộc ca cuối ------------------------------
{
  const sessions = [
    session('s1', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T08:15:00.000Z'),
    session('s2', 2, '2026-07-31T08:16:00.000Z', '2026-07-31T15:00:00.000Z'),
  ]
  const receipts = [
    receipt('HD-1', '2026-07-31T05:00:00.000Z', 300000),
    receipt('HD-LATE', '2026-07-31T15:05:00.000Z', 50000),
  ]
  expectSplit('Bán sau giờ đóng ca cuối', sessions, receipts, [300000, 50000])
}

// ---- Chỉ có MỘT ca (Ca 2 không ai mở): Ca 1 CHỈ ôm phần trước 15:15 ----------
// Hệ quả có ý thức của luật đồng hồ: phần bán sau 15:15 không thuộc ảnh ca nào,
// nhưng vẫn nằm đủ trong ảnh Tổng ngày (Tổng ngày đọc theo business_date).
{
  const only = session('s1', 1, '2026-07-31T02:00:00.000Z', '2026-07-31T08:15:00.000Z')
  const receipts = [
    receipt('HD-EARLY', '2026-07-31T01:00:00.000Z', 10000),
    receipt('HD-IN', '2026-07-31T05:00:00.000Z', 20000),
    receipt('HD-LATE', '2026-07-31T09:00:00.000Z', 30000),
  ]
  expectSplit('Chỉ có Ca 1', [only], receipts, [30000], { checkTotal: false })
}

// ---- Ca 1 còn MỞ khi Ca 2 đã mở (bất thường): vẫn cắt tại 15:15 -------------
{
  const sessions = [
    session('s1', 1, '2026-07-31T00:00:00.000Z', ''),
    session('s2', 2, '2026-07-31T08:16:00.000Z', ''),
  ]
  const receipts = [
    receipt('HD-1', '2026-07-31T05:00:00.000Z', 111000),
    receipt('HD-2', '2026-07-31T09:00:00.000Z', 222000),
  ]
  expectSplit('Ca 1 chưa đóng khi Ca 2 mở', sessions, receipts, [111000, 222000])
}

// ---- Phiên ca không nằm trong danh sách vẫn tự ghép được ---------------------
{
  const lone = session('sx', 2, '2026-07-31T08:16:00.000Z', '2026-07-31T15:00:00.000Z')
  if (!isTimestampInSessionScope('2026-07-31T09:00:00.000Z', lone, [])) {
    failures.push('Phiên đứng một mình phải nhận hóa đơn sau 15:15 của ngày nó.')
  }
  if (isTimestampInSessionScope('2026-07-31T07:00:00.000Z', lone, [])) {
    failures.push('Ca 2 không được nhận hóa đơn bán trước 15:15.')
  }
}

// ---- Biên: ĐÚNG 15:15 thuộc Ca 1, 15:15:01 đã sang Ca 2 ---------------------
{
  const sessions = [
    session('s1', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T08:15:00.000Z'),
    session('s2', 2, '2026-07-31T08:20:00.000Z', '2026-07-31T15:00:00.000Z'),
  ]
  expectSplit('Hóa đơn đúng 15:15', sessions, [receipt('HD-CUT', CUTOVER_UTC, 40000)], [40000, 0])
  expectSplit('Hóa đơn 15:15:01', sessions, [receipt('HD-NEXT', '2026-07-31T08:15:01.000Z', 40000)], [0, 40000])
}

// ---- Định dạng thời gian của PostgREST (`+00:00`) phải so đúng giá trị -------
// So chuỗi thì '…Z' > '…+00:00' theo bảng mã ⇒ cả ngày doanh thu rơi nhầm ca.
{
  const sessions = [
    session('s1', 1, '2026-07-31T00:00:00+00:00', '2026-07-31T08:15:00+00:00'),
    session('s2', 2, '2026-07-31T08:20:00+00:00', '2026-07-31T15:00:00+00:00'),
  ]
  const receipts = [
    receipt('HD-PG-1', '2026-07-31T05:00:00.123456+00:00', 70000),
    receipt('HD-PG-2', '2026-07-31T09:00:00.654321+00:00', 30000),
  ]
  expectSplit('Timestamp kiểu PostgREST', sessions, receipts, [70000, 30000])
}

if (failures.length) {
  console.error('SHIFT_REPORT_SCOPE_FAIL')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log('SHIFT_REPORT_SCOPE_OK')
