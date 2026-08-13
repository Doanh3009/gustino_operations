import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8')
const inventoryExport = source.slice(source.indexOf('async function exportInventory()'), source.indexOf('function exportSupplyReport()'))
const reconciliationBuilder = source.slice(source.indexOf('function buildShiftInventoryReconciliation('), source.indexOf('function buildDailyOutboundRows('))
// 13/08/2026: đối soát ca nằm THẲNG trên trang trong một khối gấp — chủ hệ
// thống không chấp nhận kiểu giấu nội dung sau menu rồi mở ra panel bên phải.
const reconciliationUi = source.slice(
  source.indexOf('<strong>Đối soát theo ca</strong>'),
  source.indexOf('<strong>Sổ phát sinh kho</strong>'),
)

assert.ok(!source.includes('inventorySalesDate'), 'Xuất bán/bàn giao không được khóa vào một ngày riêng lẻ.')
assert.match(source, /item\.type === 'sale_out'[\s\S]*?item\.shiftDate >= from[\s\S]*?item\.shiftDate <= to/, 'Phiếu xuất bán phải lọc theo toàn bộ khoảng Từ ngày–Đến ngày.')
assert.match(source, /buildShiftInventoryReconciliation\([\s\S]*?movements,[\s\S]*?from,[\s\S]*?to,/, 'Đối chiếu bàn giao phải nhận cả đầu và cuối kỳ.')
assert.match(reconciliationBuilder, /session\.businessDate >= fromDate[\s\S]*?session\.businessDate <= toDate/, 'Ca bàn giao phải được lọc bao gồm mọi ngày trong kỳ.')
// Khoảng ngày nay do MỘT bộ lọc chung ở đầu trang điều khiển (§6) và vẫn chảy
// thẳng vào đối chiếu ca — không còn cặp ô ngày thứ hai lặp bên trong khối.
assert.match(source, /<DateRangeField[\s\S]*?from=\{from\}[\s\S]*?to=\{to\}/, 'Trang phải có đúng một bộ chọn khoảng ngày dùng chung.')
assert.equal((source.match(/<DateRangeField/g) || []).length, 1, 'Không được lặp bộ chọn khoảng ngày ở nhiều nơi.')
assert.ok(reconciliationUi.length > 0, 'Không tìm thấy khu đối soát theo ca.')
assert.ok(reconciliationUi.includes('formatDate(row.businessDate)'), 'Mỗi ca trong danh sách nhiều ngày phải hiển thị ngày kinh doanh.')
assert.ok(reconciliationUi.includes('inventoryShiftVisibleRows.map'), 'Đối soát ca phải giữ danh sách ca đã lọc.')
assert.ok(reconciliationUi.includes('inventoryDailyOutboundDocumentCount'), 'Số phiếu xuất riêng trong kỳ không được biến mất.')
assert.ok(inventoryExport.includes("addWorksheet('Xuất bán trong kỳ')"), 'Sheet xuất bán phải thể hiện đây là dữ liệu cả kỳ.')
assert.ok(source.includes("addWorksheet('Danh sách hao hụt')"), 'Excel kho phải có sheet danh sách hao hụt chi tiết.')
assert.ok(source.includes('exportInventoryLoss'), 'Màn kho phải có lệnh xuất riêng danh sách hao hụt.')
assert.ok(inventoryExport.includes('formatDate(from)} - ${formatDate(to)'), 'Tiêu đề các sheet xuất bán/bàn giao phải ghi rõ khoảng ngày.')

console.log('INVENTORY_EXPORT_DATE_RANGE_OK')
