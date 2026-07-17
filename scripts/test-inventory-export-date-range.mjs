import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8')
const inventoryExport = source.slice(source.indexOf('async function exportInventory()'), source.indexOf('function exportSupplyReport()'))
const reconciliationBuilder = source.slice(source.indexOf('function buildShiftInventoryReconciliation('), source.indexOf('function buildDailyOutboundRows('))
const reconciliationUi = source.slice(source.indexOf('<section className="inventory-shift-reconciliation">'), source.indexOf("{user.role === 'admin'", source.indexOf('<section className="inventory-shift-reconciliation">')))

assert.ok(!source.includes('inventorySalesDate'), 'Xuất bán/bàn giao không được khóa vào một ngày riêng lẻ.')
assert.match(source, /item\.type === 'sale_out'[\s\S]*?item\.shiftDate >= from[\s\S]*?item\.shiftDate <= to/, 'Phiếu xuất bán phải lọc theo toàn bộ khoảng Từ ngày–Đến ngày.')
assert.match(source, /buildShiftInventoryReconciliation\([\s\S]*?movements,[\s\S]*?from,[\s\S]*?to,/, 'Đối chiếu bàn giao phải nhận cả đầu và cuối kỳ.')
assert.match(reconciliationBuilder, /session\.businessDate >= fromDate[\s\S]*?session\.businessDate <= toDate/, 'Ca bàn giao phải được lọc bao gồm mọi ngày trong kỳ.')
assert.ok(reconciliationUi.includes('<label>Từ ngày') && reconciliationUi.includes('<label>Đến ngày'), 'Khu Xuất bán và tồn bàn giao phải cho chọn khoảng ngày trực tiếp.')
assert.ok(reconciliationUi.includes('formatDate(row.businessDate)'), 'Mỗi ca trong danh sách nhiều ngày phải hiển thị ngày kinh doanh.')
assert.ok(inventoryExport.includes("addWorksheet('Xuất bán trong kỳ')"), 'Sheet xuất bán phải thể hiện đây là dữ liệu cả kỳ.')
assert.ok(inventoryExport.includes('formatDate(from)} - ${formatDate(to)'), 'Tiêu đề các sheet xuất bán/bàn giao phải ghi rõ khoảng ngày.')

console.log('INVENTORY_EXPORT_DATE_RANGE_OK')
