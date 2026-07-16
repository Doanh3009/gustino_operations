import { readFile } from 'node:fs/promises'

const [salesReceipts, reportPage, lanServer] = await Promise.all([
  readFile(new URL('../src/lib/salesReceipts.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./lan-server.mjs', import.meta.url), 'utf8'),
])

const failures = []

if (/fetchSalesReceipts[\s\S]*?\.limit\(120\)/.test(salesReceipts)) {
  failures.push('Sổ POS/báo cáo vẫn cắt dữ liệu ở 120 hóa đơn nên hóa đơn cũ trong ngày có thể bị thiếu.')
}
if (!salesReceipts.includes('fetchAllSalesReceiptRows')) {
  failures.push('Chưa có phân trang để tải đủ toàn bộ hóa đơn của chi nhánh trong ngày.')
}
if (/url\.pathname === '\/api\/sales-receipts'[\s\S]*?\.slice\(0, 120\)/.test(lanServer)) {
  failures.push('LAN API vẫn cắt sổ POS trong ngày ở 120 hóa đơn.')
}
if (/url\.pathname === '\/api\/sales-receipts\/range'[\s\S]*?\.slice\(0, 1000\)/.test(lanServer)) {
  failures.push('LAN API vẫn cắt sổ POS theo khoảng ngày ở 1.000 hóa đơn.')
}

const saveCloudStart = reportPage.indexOf('async function saveCloud()')
const saveCloudEnd = reportPage.indexOf('\n  async function ', saveCloudStart + 1)
const saveCloud = saveCloudStart >= 0
  ? reportPage.slice(saveCloudStart, saveCloudEnd >= 0 ? saveCloudEnd : undefined)
  : ''

if (!saveCloud.includes('await loadReportLedger()')) {
  failures.push('Nút chốt báo cáo chưa đọc lại ledger/POS có thẩm quyền ngay trước khi tạo snapshot.')
}
if (!saveCloud.includes('freshDailyReport')) {
  failures.push('Payload chốt báo cáo vẫn có thể dùng mô hình React state cũ thay vì dữ liệu vừa tải lại.')
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}

console.log('SALES_REPORT_CONSISTENCY_OK')
