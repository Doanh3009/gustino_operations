import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function loadTypeScriptModule(path, stripRuntimeImports = false) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8')
  if (stripRuntimeImports) {
    source = source.replace(/^import\s[^\n]+\n/gm, '')
    source = [
      'const userHeaders = () => ({});',
      'const productSaleValues = () => ({ revenue: 0 });',
      'const soldBagQuantity = () => 0;',
    ].join('\n') + '\n' + source
  }
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

const revenue = await loadTypeScriptModule('../src/lib/revenue.ts', true)
const shifts = await loadTypeScriptModule('../src/lib/shiftLedger.ts', true)
const reportSource = await readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8')
const handoverSource = await readFile(new URL('../src/pages/ShiftHandoverPage.tsx', import.meta.url), 'utf8')
const attendanceSource = await readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8')

const snapshotTime = '2026-07-20T08:14:47.350Z'
const snapshot = [{
  id: '23-10-snapshot',
  branchId: 'lotte-2310',
  reportDate: '2026-07-20',
  createdAt: snapshotTime,
  payload: { summary: { revenue: 554000, totalSold: 10 } },
}]
const receipt = (id, createdAt, totalAmount, totalQuantity) => ({
  id,
  code: id,
  branchId: 'lotte-2310',
  businessDate: '2026-07-20',
  sellerKey: 'seller',
  sellerName: 'Seller',
  paymentMethod: 'cash',
  totalAmount,
  totalQuantity,
  lines: [],
  createdAt,
  createdBy: 'seller',
  createdByName: 'Seller',
})
const revenueRows = revenue.buildDailyRevenueRows(snapshot, [], [], {
  receipts: [
    receipt('before', '2026-07-20T08:14:00.000Z', 554000, 10),
    receipt('after-a', '2026-07-20T08:15:00.000Z', 600000, 12),
    receipt('after-b', '2026-07-20T10:00:00.000Z', 644000, 13),
  ],
})
assert.equal(revenueRows.length, 1, 'A report day must remain one revenue row.')
assert.equal(revenueRows[0].revenue, 1798000, 'Receipts after the report timestamp must update the report baseline in realtime.')
assert.equal(revenueRows[0].totalSold, 35, 'Realtime receipt quantities must update the report baseline too.')

const leaderOne = { id: 'leader-1', name: 'Same Display Name' }
const leaderTwo = { id: 'leader-2', name: 'Same Display Name' }
const sessions = [
  { id: 'shift-1', leaderId: leaderOne.id, leaderName: leaderOne.name, sequence: 1, startedAt: '2026-07-20T00:00:00Z' },
  { id: 'shift-2', leaderId: leaderTwo.id, leaderName: leaderTwo.name, sequence: 2, startedAt: '2026-07-20T08:00:00Z' },
]
assert.equal(shifts.latestOwnedBagShiftSession(sessions, leaderTwo)?.id, 'shift-2', 'A matching display name must not capture another leader\'s persisted shift.')
assert.equal(shifts.latestOwnedBagShiftSession([
  { ...sessions[0], leaderId: leaderOne.id, sequence: 1 },
  { ...sessions[0], id: 'leader-1-shift-2', leaderId: leaderOne.id, sequence: 2, startedAt: '2026-07-20T08:00:00Z' },
], leaderOne)?.id, 'leader-1-shift-2', 'The newest own sequence must win over an older closed shift.')

assert.match(reportSource, /readHandoverReportRequest/, 'The handover close request must be consumed by Report.')
assert.match(reportSource, /automaticFinalizeAttemptRef/, 'Automatic report finalization must be idempotent per shift.')
assert.match(reportSource, /session\.sequence === 2 \? \['day'/, 'Only Ca 2 may render/send the total-day n8n poster.')
// Chốt báo cáo phải đọc LẠI sổ ca từ máy chủ, và phải chốt đúng ca vừa bàn giao
// (yêu cầu do màn Bàn giao ghi lại) chứ không phải "ca có sequence lớn nhất mình sở
// hữu" — một ca trưởng xuyên ca có thể sở hữu cả hai ca trong ngày (BUG-109).
assert.match(reportSource, /const freshLedger = /, 'Finalization must re-read the ledger from the server.')
assert.match(
  reportSource,
  /resolveLeaderShiftSession\(freshLedger\.sessions, handoverReportRequest\)/,
  'Finalization must re-read the exact persisted session named by the handover request.',
)
assert.match(
  reportSource,
  /item\.id === request\.shiftId[\s\S]{0,160}ownsBagShiftSession\(item, user\)/,
  'The requested shift must still be checked for ownership before it is finalized.',
)
assert.match(
  reportSource,
  /latestOwnedBagShiftSession\(sessions, user\)/,
  'Without a handover request the finalization must fall back to the own latest session.',
)
assert.match(handoverSource, /ownsBagShiftSession\(branchOpenSession, user\)/, 'Only the leader who opened a shift may receive its handover controls.')
assert.match(attendanceSource, /await invokeManageEmployee\(\{ action: 'hard_delete', employeeId \}\)/, 'Normal employee removal must delete the account rather than leave it inactive.')
assert.match(reportSource, /queueCurrentReportImages\(freshLeaderShiftSession, true\)/, 'Closing a shift must ask n8n to send immediately, even after its scheduled clock time has passed.')
assert.match(reportSource, /Hoàn tất bàn giao Ca 2 & chốt ngày/, 'The final Ca 2 action must clearly tell the leader it completes the handover and day close.')

console.log('SHIFT_CLOSE_REPORT_REALTIME_OK')
