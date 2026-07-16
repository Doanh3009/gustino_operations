import { readFile } from 'node:fs/promises'

const [report, archive, inventory, manager, admin, orders, store, shiftLedger, shiftCompetition, styles] = await Promise.all([
  readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ReportArchivePage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/InventoryPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ManagerDashboardPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/OrdersPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/store.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/shiftLedger.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/shiftCompetition.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

const failures = []

if (report.includes('report-technical-details') || report.includes('report-finalize-hint')) {
  failures.push('Trang báo cáo vẫn hiện ghi chú kỹ thuật hoặc dòng giải thích dài cạnh nút thao tác.')
}
if (report.includes('Trên iPhone, ảnh chỉ được lưu') || report.includes('tổng cộng trong ngày có 3 báo cáo theo nghiệp vụ')) {
  failures.push('Trang báo cáo vẫn còn nội dung hướng dẫn/ghi chú triển khai dài thay vì phản hồi ngắn gọn.')
}
if (inventory.includes('className="stats-grid inventory-stats"')) {
  failures.push('Kho vẫn render bốn card đếm Phiếu nhập/Phiếu xuất/Sắp hết/Phiếu kiểm kê.')
}
if (!manager.includes("user.role === 'admin' && detailBranchId")) {
  failures.push('Role quản lý vẫn có thể render phần xem chi tiết hóa đơn chi nhánh.')
}
for (const source of [manager, admin]) {
  if (!source.includes('buildShiftLeaderRevenueRows') || !source.includes('bagSessions')) {
    failures.push('Thi đua ca trưởng chưa lấy tổng doanh thu theo phiên ca do ca trưởng phụ trách.')
    break
  }
}
if (!shiftLedger.includes('filters.from') || !shiftLedger.includes('filters.to')) {
  failures.push('Đọc phiên ca cho bảng thi đua chưa giới hạn theo khoảng ngày, có nguy cơ tải toàn bộ lịch sử.')
}
await verifyShiftLeaderRevenueAggregation(shiftCompetition, failures)
if (!orders.includes('shareOrDownloadBlob') || !orders.includes('canvasToBlob')) {
  failures.push('Xuất ảnh đặt hàng vẫn dùng click data-URL, chưa có cơ chế tải/chia sẻ ổn định trên điện thoại.')
}
if (!archive.includes('report-archive-content')) {
  failures.push('Kho báo cáo thiếu vùng nội dung để áp dụng khóa chống tràn mobile.')
}
if (!archive.includes('fetchReportSnapshots(id, user, { from, to })') || !store.includes("request.gte('report_date', filters.from)")) {
  failures.push('Kho báo cáo vẫn tải toàn bộ lịch sử thay vì chỉ tháng đang xem.')
}
for (const token of [
  '.report-archive-page',
  '.report-archive-filters input[type="date"]',
  '.competition-mini-board article strong',
  '.competition-poster-list strong',
  'overflow-wrap: anywhere',
]) {
  if (!styles.includes(token)) failures.push(`Thiếu khóa CSS deploy/mobile: ${token}`)
}

if (failures.length) {
  console.error(failures.map((item) => `FAIL: ${item}`).join('\n'))
  process.exit(1)
}

console.log('DEPLOY_UI_BUSINESS_POLISH_OK')

async function verifyShiftLeaderRevenueAggregation(source, failures) {
  const ts = await import('typescript')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
  const { buildShiftLeaderRevenueRows } = await import(moduleUrl)
  const sessions = [
    { id: 'ca-1', branchId: 'gold-coast', businessDate: '2026-07-15', sequence: 1, leaderId: 'leader-a', leaderName: 'Ca trưởng A', status: 'closed', openingBalances: {}, startedAt: '2026-07-15T01:00:00.000Z', endedAt: '2026-07-15T05:00:00.000Z' },
    { id: 'ca-2', branchId: 'gold-coast', businessDate: '2026-07-15', sequence: 2, leaderId: 'leader-b', leaderName: 'Ca trưởng B', status: 'closed', openingBalances: {}, startedAt: '2026-07-15T06:00:00.000Z', endedAt: '2026-07-15T10:00:00.000Z' },
  ]
  const receipt = (id, createdAt, totalAmount, totalQuantity) => ({
    id, code: id, branchId: 'gold-coast', businessDate: '2026-07-15', sellerName: 'Nhân viên bán hàng',
    sellerKey: 'staff', paymentMethod: 'cash', lines: [], totalAmount, totalQuantity, createdBy: 'staff', createdByName: 'Nhân viên bán hàng', createdAt,
  })
  const rows = buildShiftLeaderRevenueRows(sessions, [
    receipt('hd-ca-1', '2026-07-15T02:00:00.000Z', 600000, 12),
    receipt('hd-ngoai-ca', '2026-07-15T05:30:00.000Z', 5000000, 100),
    receipt('hd-ca-2', '2026-07-15T07:00:00.000Z', 900000, 18),
  ], {
    branchIds: ['gold-coast'], from: '2026-07-15', to: '2026-07-15', targetForSession: () => 500000,
  })
  const leaderA = rows.find((row) => row.leaderKey === 'leader-a')
  const leaderB = rows.find((row) => row.leaderKey === 'leader-b')
  if (leaderA?.revenue !== 600000 || leaderA?.soldQuantity !== 12 || leaderA?.achievedShiftCount !== 1 || leaderA?.progress !== 120) {
    failures.push('Tổng hợp ca trưởng không gán đúng toàn bộ doanh thu nhân viên phát sinh trong Ca 1.')
  }
  if (leaderB?.revenue !== 900000 || leaderB?.soldQuantity !== 18 || leaderB?.achievedShiftCount !== 1 || leaderB?.progress !== 180) {
    failures.push('Tổng hợp ca trưởng không tách đúng doanh thu Ca 2 theo mốc phiên ca.')
  }
  if (rows.some((row) => row.revenue >= 5000000)) {
    failures.push('Doanh thu phát sinh ngoài cửa sổ ca bị gán nhầm vào ca trưởng.')
  }
}
