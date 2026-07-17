import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8')
const inventoryExport = source.slice(source.indexOf('async function exportInventory()'), source.indexOf('function exportSupplyReport()'))

assert.ok(inventoryExport.length > 0, 'Không tìm thấy hàm xuất Excel kho.')
assert.ok(!inventoryExport.includes("'#,##0.####'"), 'Excel kho không được trộn dấu phân cách hàng nghìn với dấu thập phân.')
assert.ok(!inventoryExport.includes("'#,##0'"), 'Số nguyên trong Excel kho không được thêm dấu phân cách hàng nghìn gây nhập nhằng.')
assert.ok(source.includes("const INVENTORY_EXCEL_QUANTITY_FORMAT = '0.####'"), 'Excel kho phải dùng một dấu thập phân duy nhất và tối đa 4 chữ số lẻ.')
assert.ok(source.includes("const INVENTORY_EXCEL_INTEGER_FORMAT = '0'"), 'Số nguyên trong Excel kho phải hiển thị không có dấu phân cách.')

const quantityFormatUses = inventoryExport.match(/INVENTORY_EXCEL_QUANTITY_FORMAT/g)?.length ?? 0
assert.equal(quantityFormatUses, 6, 'Cả 6 nhóm cột số lượng của workbook kho phải dùng chung một định dạng.')
assert.ok(inventoryExport.includes("getColumn('revenue').numFmt = INVENTORY_EXCEL_INTEGER_FORMAT"), 'Doanh thu POS trong workbook kho phải dùng định dạng số nguyên không nhập nhằng.')

console.log('INVENTORY_EXCEL_NUMBER_FORMAT_OK')
