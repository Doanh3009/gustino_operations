import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [admin, styles] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

assert.match(admin, /inventory: \['employees', 'movements', 'inventoryReports', 'sessions', 'receipts'\]/, 'Kho quản lý chưa tải ca và POS.')
assert.match(admin, /inventory: \['stock_movements', 'operation_days', 'inventory_reports', 'bag_shift_sessions', 'sales_receipts', 'sales_receipt_items'\]/, 'Kho quản lý chưa realtime theo ca/POS.')
assert.match(admin, /getPackingOptionsByOutput/, 'Thiếu quy đổi sản phẩm POS về thành phẩm nguồn.')
assert.match(admin, /buildShiftInventoryReconciliation/, 'Thiếu bộ tính đối chiếu tồn bàn giao theo ca.')
assert.match(admin, /opening \+ additions - closing - waste/, 'Công thức Out chưa đúng tồn đầu + nhập thêm - tồn bàn giao - hao hụt.')
assert.match(admin, /receipt\.createdAt < session\.startedAt/, 'POS chưa giới hạn đúng thời gian ca.')
assert.match(admin, /session\.endedAt && receipt\.createdAt > session\.endedAt/, 'POS chưa chặn sau thời điểm đóng ca.')
assert.match(admin, /ĐỐI CHIẾU THEO CA/, 'Thiếu bảng đối chiếu theo ca.')
for (const label of ['Tồn đầu', 'Nhập thêm', 'POS đã bán', 'Hao hụt', 'Tồn bàn giao', 'Out chính thức', 'Chênh lệch']) {
  assert.ok(admin.includes(label), `Thiếu cột ${label}.`)
}
assert.match(admin, /Ca đang mở · POS tạm tính/, 'Ca mở chưa hiển thị POS tạm tính rõ ràng.')
assert.match(admin, /Chưa bàn giao/, 'Ca mở chưa báo chưa có tồn cuối.')
assert.match(admin, /workbook\.addWorksheet\('Đối chiếu ca'\)/, 'Excel kho thiếu sheet đối chiếu ca.')
assert.doesNotMatch(admin, /Nhập trả hàng thừa|Nhập trả cuối ca/, 'Không được thêm luồng nhập trả trùng với bàn giao.')
assert.match(styles, /\.inventory-shift-reconciliation/, 'Thiếu CSS bảng đối chiếu ca.')
assert.match(styles, /\.inventory-shift-reconciliation-row/, 'Thiếu CSS dòng đối chiếu ca.')

console.log('INVENTORY_SHIFT_RECONCILIATION_OK')
