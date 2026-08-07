/**
 * Snapshot báo cáo KHÔNG được che số POS.
 *
 * Lịch sử: bản đầu chỉ cần snapshot tồn tại là app đọc theo snapshot, nên một
 * báo cáo nộp giữa buổi (chưa có `summary.revenue`) làm cả ngày hiện thiếu tiền.
 * Bản vá đầu tiên chỉ chữa đúng ca đó ("snapshot chưa có summary thì đọc POS").
 *
 * 07/08/2026 — gộp nhánh `main`: luật đổi thành ƯU TIÊN CỨNG
 *   sales_receipts (POS) > report_snapshots > bag_allocations > stock_movements
 * Ngày nào có hóa đơn POS thì đọc thẳng POS, snapshot chỉ dùng cho ngày không có
 * hóa đơn. Nhờ vậy không còn đường nào để báo cáo tay đè lên số máy, và cũng
 * không còn lớp "snapshot làm nền + cộng hóa đơn phát sinh sau" từng gây cộng
 * lặp Ca 2 (BUG-119).
 */
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = await readFile(new URL('../src/lib/revenue.ts', import.meta.url), 'utf8')

// ── Hợp đồng mã nguồn của luật ưu tiên mới.
assert.match(source, /hasRevenueSummary:\s*typeof snap\.payload\.summary\?\.revenue === 'number'/)
assert.match(source, /displayedSnapshotRows = snapshotRows\.filter/)
assert.match(source, /return \[\.\.\.receiptRows, \.\.\.displayedSnapshotRows/,
  'POS phải đứng trước snapshot trong danh sách trả về.')
// Chặn theo KHAI BÁO/LỜI GỌI, không chặn theo tên xuất hiện trong ghi chú —
// comment giải thích vì sao đã gỡ là thứ nên giữ.
assert.doesNotMatch(source, /function liveReceiptRowsAfterSnapshots|liveReceiptRowsAfterSnapshots\(/,
  'Lớp "cộng thêm hóa đơn sau bản kê" đã bị luật ưu tiên POS thay thế — đừng dựng lại.')
assert.doesNotMatch(source, /const reconciledSnapshotRows/,
  'Không còn cộng dồn snapshot + hóa đơn: đó chính là đường sinh ra cộng lặp Ca 2.')

// ── Kiểm bằng SỐ, không chỉ bằng chuỗi.
const workDir = await mkdtemp(join(tmpdir(), 'gustino-rev-partial-'))
const outFile = join(workDir, 'revenue.mjs')
await build({
  entryPoints: [join(root, 'src/lib/revenue.ts')],
  outfile: outFile,
  format: 'esm',
  bundle: true,
  logLevel: 'silent',
  define: { 'import.meta.env': JSON.stringify({}) },
})
const { buildDailyRevenueRows } = await import(pathToFileURL(outFile).href)

const receipt = (code, amount) => ({
  id: code,
  code,
  branchId: 'gold-coast',
  businessDate: '2026-08-07',
  sellerKey: 'nv',
  sellerName: 'NV',
  totalQuantity: 1,
  totalAmount: amount,
  lines: [],
  createdAt: '2026-08-07T05:00:00.000Z',
  createdBy: 'nv',
  createdByName: 'NV',
})

const total = (snapshots, receipts) => buildDailyRevenueRows(snapshots, [], [], {
  branchId: 'gold-coast',
  from: '2026-08-07',
  to: '2026-08-07',
  receipts,
}).reduce((sum, row) => sum + row.revenue, 0)

const receipts = [receipt('HD-1', 3_000_000), receipt('HD-2', 1_500_000)]

// 1. Snapshot nộp giữa buổi (chưa có summary) không được che POS.
const partial = {
  id: 'snap-partial',
  branchId: 'gold-coast',
  reportDate: '2026-08-07',
  createdAt: '2026-08-07T08:00:00.000Z',
  payload: { finalizedAt: '2026-08-07T08:00:00.000Z', shiftReports: {} },
}
assert.equal(total([partial], receipts), 4_500_000, 'Snapshot chưa có summary phải đọc theo POS thật.')

// 2. Snapshot ĐÃ có summary nhưng thiếu tiền cũng không được đè lên POS.
const understated = {
  ...partial,
  id: 'snap-understated',
  payload: { finalizedAt: '2026-08-07T08:00:00.000Z', summary: { revenue: 1_000_000, totalSold: 5 }, shiftReports: {} },
}
assert.equal(total([understated], receipts), 4_500_000, 'Báo cáo tay nộp thiếu không được đè lên số máy.')

// 3. Ngày KHÔNG có hóa đơn POS thì vẫn đọc theo snapshot (đường lùi cho ngày cũ).
assert.equal(total([understated], []), 1_000_000, 'Ngày không có hóa đơn POS phải đọc theo snapshot.')

console.log('REVENUE_PARTIAL_SNAPSHOT_FALLBACK_OK')
