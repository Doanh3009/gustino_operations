import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const [admin, styles, employeeSource, leaderSource, shiftScopeSource] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/competitionDrilldown.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/shiftCompetition.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/shiftReportScope.ts', import.meta.url), 'utf8'),
])

for (const token of [
  'title={`${sources.length} nguồn · ${dayRows.length} ngày`}',
  'aria-expanded={expanded}',
  'CHI TIẾT MỘT NGƯỜI',
  'Nguồn doanh thu ({sources.length})',
  'buildEmployeeCompetitionRevenueSources',
  'buildShiftLeaderReceiptSources',
  'Tổng nguồn đang lệch',
]) assert.ok(admin.includes(token), `Thiếu contract drill-down: ${token}`)

for (const selector of [
  '.competition-drilldown-trigger',
  '.competition-drilldown-panel',
  '.competition-drilldown-list > article',
  '.competition-source-kind.allocation',
]) assert.ok(styles.includes(selector), `Thiếu CSS drill-down: ${selector}`)

const employeeModule = await importTs(employeeSource
  .replace(
    "import { productSaleValues, soldBagQuantity } from './commission'",
    "const soldBagQuantity = (allocation) => Math.max(0, allocation.soldQuantity ?? 0); const productSaleValues = (_productId, quantity) => ({ revenue: quantity * 100 })",
  ))

const allocation = (id, employeeId, soldQuantity) => ({
  id,
  branchId: 'lotte-vt',
  shiftId: 'shift-1',
  businessDate: '2026-07-20',
  employeeId,
  employeeName: employeeId === 'employee-a' ? 'Nhân viên A' : 'Nhân viên B',
  productId: 'cake',
  issuedQuantity: soldQuantity,
  soldQuantity,
  returnedQuantity: 0,
  damagedQuantity: 0,
  issuedBy: 'leader',
  issuedAt: '2026-07-20T01:00:00.000Z',
  settledAt: '2026-07-20T05:00:00.000Z',
})
const receipt = (id, sellerId, lines) => ({
  id,
  code: id,
  branchId: 'lotte-vt',
  businessDate: '2026-07-20',
  sellerKey: sellerId,
  sellerId,
  sellerName: sellerId === 'employee-a' ? 'Nhân viên A' : 'Nhân viên B',
  paymentMethod: 'cash',
  totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
  totalAmount: lines.reduce((sum, line) => sum + line.total, 0),
  lines,
  createdAt: '2026-07-20T06:00:00.000Z',
  createdBy: sellerId,
  createdByName: '',
})
const employeeSources = employeeModule.buildEmployeeCompetitionRevenueSources(
  [allocation('allocation-a', 'employee-a', 2), allocation('allocation-b', 'employee-b', 50)],
  [
    receipt('receipt-a', 'employee-a', [
      { allocationId: 'allocation-a', productId: 'cake', productName: 'Bánh giao túi', quantity: 3, unitPrice: 1000, total: 3000 },
      { productId: 'direct', productName: 'Bán trực tiếp', quantity: 2, unitPrice: 500, total: 1000 },
    ]),
    receipt('receipt-b', 'employee-b', [{ productId: 'direct', productName: 'Sai nhân sự', quantity: 10, unitPrice: 500, total: 5000 }]),
  ],
  { branchId: 'lotte-vt', employeeId: 'employee-a', employeeName: 'Nhân viên A', from: '2026-07-20', to: '2026-07-20' },
)
assert.equal(employeeSources.length, 2, 'Drill-down nhân viên phải giữ đúng 1 phiếu giao túi và 1 hóa đơn trực tiếp.')
assert.equal(employeeSources.reduce((sum, source) => sum + source.revenue, 0), 1200, 'Doanh thu nguồn phải loại dòng POS đã gắn allocation để không cộng hai lần.')
assert.equal(employeeSources.find((source) => source.kind === 'receipt')?.soldQuantity, 2, 'Số lượng hóa đơn drill-down chỉ lấy dòng bán trực tiếp.')

const leaderModule = await importTs(`${shiftScopeSource
  .replace("import type { BagShiftSession } from '../types'", '')
  .replace(/\bexport\s+/g, '')}
${leaderSource.replace("import { sessionScopeWindow, timestampInScopeWindow } from './shiftReportScope'", '')}`)
const sessions = [{
  id: 'shift-a', branchId: 'lotte-vt', businessDate: '2026-07-20', sequence: 1,
  leaderId: 'leader-a', leaderName: 'Ca trưởng A', status: 'closed', openingBalances: {},
  startedAt: '2026-07-20T01:00:00.000Z', endedAt: '2026-07-20T05:00:00.000Z',
}]
const leaderReceipts = [
  receipt('inside-shift', 'employee-a', []),
  { ...receipt('outside-shift', 'employee-a', []), createdAt: '2026-07-20T07:00:00.000Z' },
]
leaderReceipts[0].createdAt = '2026-07-20T03:00:00.000Z'
const leaderSources = leaderModule.buildShiftLeaderReceiptSources(sessions, leaderReceipts, {
  branchIds: ['lotte-vt'], from: '2026-07-20', to: '2026-07-20',
})
assert.deepEqual(
  leaderSources.map((source) => source.receipt.id),
  ['inside-shift', 'outside-shift'],
  'Ca 1 phải nhận mọi hóa đơn tới 15:15, kể cả hóa đơn bán sau khi ca trưởng đã chốt ca (vùng doanh thu chia theo đồng hồ, không theo giờ mở/đóng phiên ca).',
)
assert.equal(leaderSources[0].leaderKey, 'leader-a')

console.log('COMPETITION_DRILLDOWN_OK')

async function importTs(source) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}
