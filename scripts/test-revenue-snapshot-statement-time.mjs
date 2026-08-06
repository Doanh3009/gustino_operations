// BUG-119: dashboard cộng LẶP doanh thu Ca 2.
//
// Từ 25/07, snapshot của một ngày được TẠO ngay lúc chốt báo cáo Ca 1 (~15:17)
// rồi bị GHI ĐÈ payload lúc chốt Tổng ngày (~22:16) — `created_at` của dòng đứng
// nguyên ở giờ chốt Ca 1. Lớp cộng "hóa đơn phát sinh sau snapshot" (BUG-104)
// so với `created_at` nên cộng lại TOÀN BỘ hóa đơn Ca 2 một lần nữa.
//
// Số thật production 29/07 (đã xác minh bằng SQL chỉ đọc):
//   snapshot 3 chi nhánh = 4.292.000 + 2.490.000 + 1.642.000 = 8.424.000đ (ĐÚNG)
//   app hiển thị          = 6.480.000 + 4.200.000 + 2.490.000 = 13.170.000đ (SAI)
// Chủ quán báo "29/7 tới 13 triệu mấy" — khớp chính xác.
//
// Fix: mốc so sánh là lần VIẾT snapshot cuối cùng (payload.finalizedAt — được
// đóng dấu ở mọi đường ghi), không phải created_at của dòng.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const failures = []
const root = fileURLToPath(new URL('..', import.meta.url))

const workDir = await mkdtemp(join(tmpdir(), 'gustino-rev-snap-'))
const outFile = join(workDir, 'revenue.mjs')
await build({
  entryPoints: [join(root, 'src/lib/revenue.ts')],
  outfile: outFile,
  format: 'esm',
  bundle: true,
  logLevel: 'silent',
  // revenue.ts kéo theo constants → supabase client; chạy trong Node thì không có
  // env Vite → ép về rỗng để supabase = null (đúng nhánh LAN/offline).
  define: { 'import.meta.env': JSON.stringify({}) },
})
const { buildDailyRevenueRows } = await import(pathToFileURL(outFile).href)

function receipt(code, createdAt, amount) {
  return {
    id: code,
    code,
    branchId: 'gold-coast',
    businessDate: '2026-07-29',
    sellerKey: 'nv',
    sellerName: 'NV',
    totalQuantity: 1,
    totalAmount: amount,
    lines: [],
    createdAt,
    createdBy: 'nv',
    createdByName: 'NV',
  }
}

function totalRevenue(snapshots, receipts) {
  return buildDailyRevenueRows(snapshots, [], [], {
    branchId: 'gold-coast',
    from: '2026-07-29',
    to: '2026-07-29',
    receipts,
  }).reduce((sum, row) => sum + row.revenue, 0)
}

// Kịch bản THẬT 29/07 Gold Coast:
// - dòng snapshot TẠO lúc chốt Ca 1 (08:16Z = 15:16 VN)
// - payload bị ghi đè lúc chốt Tổng ngày (15:16Z = 22:16 VN), summary = CẢ NGÀY 4.292.000
// - hóa đơn Ca 1 (trước 15:16 VN) + hóa đơn Ca 2 (15:16→22:16 VN, TRƯỚC lần ghi cuối)
const dayFinalizedAt = '2026-07-29T15:16:45.000Z'
const snapshot = {
  id: 'snap-1',
  branchId: 'gold-coast',
  reportDate: '2026-07-29',
  createdAt: '2026-07-29T08:16:30.000Z',
  payload: {
    finalizedAt: dayFinalizedAt,
    summary: { revenue: 4292000, totalSold: 76 },
    shiftReports: {
      s2: { shiftId: 's2', sequence: 2, scope: 'shift-2', leaderId: 'l2', leaderName: 'L2', finalizedAt: dayFinalizedAt, report: {} },
    },
  },
}
const ca1Receipts = [receipt('HD-CA1', '2026-07-29T05:00:00.000Z', 4292000 - 2188000)]
const ca2Receipts = [receipt('HD-CA2', '2026-07-29T10:00:00.000Z', 2188000)]

{
  const total = totalRevenue([snapshot], [...ca1Receipts, ...ca2Receipts])
  if (total !== 4292000) {
    failures.push(`Ngày đã chốt phải hiện đúng 4.292.000 (POS thật), nhận ${total} — Ca 2 đang bị cộng lặp (trước vá là 6.480.000).`)
  }
}

// BUG-104 phải GIỮ NGUYÊN: hóa đơn tạo SAU lần ghi snapshot cuối vẫn được cộng thêm.
{
  const lateReceipt = receipt('HD-LATE', '2026-07-29T16:00:00.000Z', 100000)
  const total = totalRevenue([snapshot], [...ca1Receipts, ...ca2Receipts, lateReceipt])
  if (total !== 4392000) {
    failures.push(`Hóa đơn sau lần chốt cuối phải được cộng thêm (BUG-104): mong 4.392.000, nhận ${total}.`)
  }
}

// Payload cũ KHÔNG có finalizedAt (trước 25/07: dòng chỉ được tạo một lần lúc
// cuối ngày) → mốc rơi về created_at, hành vi cũ giữ nguyên.
{
  const legacy = {
    ...snapshot,
    id: 'snap-legacy',
    createdAt: dayFinalizedAt,
    payload: { summary: { revenue: 4292000, totalSold: 76 } },
  }
  const total = totalRevenue([legacy], [...ca1Receipts, ...ca2Receipts])
  if (total !== 4292000) {
    failures.push(`Snapshot kiểu cũ (không finalizedAt) phải vẫn đúng: mong 4.292.000, nhận ${total}.`)
  }
}

// Snapshot CHƯA có summary (mới chốt Ca 1, chưa chốt ngày) → đọc thẳng POS.
{
  const partial = {
    id: 'snap-partial',
    branchId: 'gold-coast',
    reportDate: '2026-07-29',
    createdAt: '2026-07-29T08:16:30.000Z',
    payload: {
      finalizedAt: '2026-07-29T08:16:30.000Z',
      shiftReports: { s1: { shiftId: 's1', sequence: 1, scope: 'shift-1', leaderId: 'l1', leaderName: 'L1', finalizedAt: '2026-07-29T08:16:30.000Z', report: {} } },
    },
  }
  const total = totalRevenue([partial], [...ca1Receipts, ...ca2Receipts])
  if (total !== 4292000) {
    failures.push(`Snapshot chưa có summary phải đọc theo POS thật: mong 4.292.000, nhận ${total}.`)
  }
}

if (failures.length) {
  console.error('REVENUE_SNAPSHOT_STATEMENT_TIME_FAIL')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log('REVENUE_SNAPSHOT_STATEMENT_TIME_OK')
