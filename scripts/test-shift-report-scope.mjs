// BUG-117: báo cáo TỪNG CA lọc hóa đơn theo đúng cửa sổ giờ của phiên ca nên
// hóa đơn bán TRƯỚC giờ mở Ca 1, trong KHOẢNG TRỐNG giữa hai ca (Ca 2 mở trễ)
// hay khi hai ca CHỒNG GIỜ đều bị mất/đếm trùng — ảnh Ca 1 + Ca 2 lệch Tổng ngày.
// Bằng chứng production 31/07 Lotte 23/10: Ca 2 mở 17:17, 122.000đ bán trong
// 15:16→17:17 biến mất khỏi cả hai ảnh; 28/07 Gold Coast mất 662.000đ tương tự;
// 29/07 Gold Coast mất hóa đơn 89.000đ tạo lúc 09:01 TRƯỚC giờ mở ca.
//
// Quy tắc mới (src/lib/shiftReportScope.ts): ngày được chia bằng đúng MỘT điểm
// cắt giữa hai ca kề nhau → tổng doanh thu các ca LUÔN bằng tổng ngày.
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
const { sessionScopeWindow, timestampInScopeWindow, isTimestampInSessionScope } = await import(pathToFileURL(outFile).href)

function session(id, sequence, startedAt, endedAt, extra = {}) {
  return {
    id,
    branchId: 'lotte-2310',
    businessDate: '2026-07-31',
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
  return { code, createdAt, totalAmount: amount, branchId: 'lotte-2310', businessDate: '2026-07-31' }
}

function splitRevenue(sessions, receipts) {
  return sessions.map((target) => {
    const window = sessionScopeWindow(target, sessions)
    return receipts
      .filter((item) => timestampInScopeWindow(item.createdAt, window))
      .reduce((sum, item) => sum + item.totalAmount, 0)
  })
}

function expectSplit(label, sessions, receipts, expected) {
  const actual = splitRevenue(sessions, receipts)
  const total = receipts.reduce((sum, item) => sum + item.totalAmount, 0)
  const actualTotal = actual.reduce((sum, value) => sum + value, 0)
  if (actualTotal !== total) {
    failures.push(`${label}: tổng các ca ${actualTotal} ≠ tổng ngày ${total} — vẫn còn hở/chồng.`)
  }
  expected.forEach((value, index) => {
    if (actual[index] !== value) {
      failures.push(`${label}: ca thứ ${index + 1} mong ${value}, nhận ${actual[index]}.`)
    }
  })
}

// ---- Kịch bản THẬT 31/07 Lotte 23/10: Ca 2 mở trễ 121 phút -------------------
// Ca 1: 06:55 → 15:16:01. Ca 2: 17:17:05 → 22:10. POS: 681k trước 15:16,
// 122k trong khoảng trống, 681k sau 17:17. Trước bản vá: Ca 1 = 681k, Ca 2 = 681k,
// mất 122k. Sau bản vá: khoảng trống thuộc Ca 2 (ca kế tiếp chịu trách nhiệm quầy).
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

// ---- Hai ca CHỒNG GIỜ: điểm cắt là giờ mở Ca 2, không đếm trùng --------------
{
  const sessions = [
    session('s1', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T08:30:00.000Z'),
    session('s2', 2, '2026-07-31T08:00:00.000Z', '2026-07-31T15:00:00.000Z'),
  ]
  const receipts = [
    receipt('HD-1', '2026-07-31T07:00:00.000Z', 100000),
    receipt('HD-OVERLAP', '2026-07-31T08:10:00.000Z', 89000),
    receipt('HD-2', '2026-07-31T12:00:00.000Z', 200000),
  ]
  expectSplit('Hai ca chồng giờ', sessions, receipts, [100000, 289000])
}

// ---- Bán SAU giờ đóng ca cuối vẫn thuộc ca cuối ------------------------------
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

// ---- Chỉ có MỘT ca: ôm trọn ngày ---------------------------------------------
{
  const only = session('s1', 1, '2026-07-31T02:00:00.000Z', '2026-07-31T08:15:00.000Z')
  const receipts = [
    receipt('HD-EARLY', '2026-07-31T01:00:00.000Z', 10000),
    receipt('HD-IN', '2026-07-31T05:00:00.000Z', 20000),
    receipt('HD-LATE', '2026-07-31T09:00:00.000Z', 30000),
  ]
  expectSplit('Một ca duy nhất', [only], receipts, [60000])
}

// ---- Ca 1 còn MỞ khi Ca 2 đã mở (bất thường): cắt tại giờ mở Ca 2 ------------
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
    failures.push('Phiên đứng một mình phải nhận hóa đơn trong ngày của nó.')
  }
}

// ---- Biên: đúng mốc điểm cắt thuộc ca TRƯỚC, không rơi vào cả hai ------------
{
  const sessions = [
    session('s1', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T08:15:00.000Z'),
    session('s2', 2, '2026-07-31T08:20:00.000Z', '2026-07-31T15:00:00.000Z'),
  ]
  const atCut = receipt('HD-CUT', '2026-07-31T08:15:00.000Z', 40000)
  expectSplit('Hóa đơn đúng mốc cắt', sessions, [atCut], [40000, 0])
}

if (failures.length) {
  console.error('SHIFT_REPORT_SCOPE_FAIL')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log('SHIFT_REPORT_SCOPE_OK')
