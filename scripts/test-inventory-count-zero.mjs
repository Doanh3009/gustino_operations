// Khóa hợp đồng kiểm kê 2026-07-27: số 0 là giá trị hợp lệ.
// - Ô nhập giữ CHUỖI: "0" hiển thị được (không còn pattern `value || ''` nuốt số 0).
// - "Đã kiểm kê 0" và "chưa nhập" là hai trạng thái khác nhau.
// - Movement `count` được ghi cả khi quantity = 0 (mốc reset tồn).
// - Số âm bị chặn ở mọi tầng (UI regex, store guard, LAN validate, DB CHECK >= 0).
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [inventoryPage, store, lanServer, schema] = await Promise.all([
  readFile(new URL('../src/pages/InventoryPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/store.ts', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/lan-server.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'),
])

// UI: state chuỗi + helper phân biệt "chưa nhập" vs "0".
assert.match(inventoryPage, /type InventoryCountFormLine/)
assert.match(inventoryPage, /function parseCountInput/)
assert.match(inventoryPage, /function isCountedFormLine/)
// Không còn pattern nuốt số 0 trên các ô kiểm kê.
assert.doesNotMatch(inventoryPage, /value=\{line\.freezerQty \|\| ''\}/)
assert.doesNotMatch(inventoryPage, /value=\{line\.stockRoomQty \|\| ''\}/)
// Lưu phiếu: lọc theo "đã kiểm" chứ không theo "> 0" (0 vẫn được ghi movement count).
assert.match(inventoryPage, /lines\.filter\(isCountedFormLine\)/)
assert.doesNotMatch(inventoryPage, /filter\(\(line\) => line\.freezerQty \+ line\.stockRoomQty > 0\)/)
// Phiếu lưu kèm cờ counted để lịch sử phân biệt được dòng đếm 0.
assert.match(inventoryPage, /counted: isCountedFormLine\(line\)/)

// Store: chặn phiếu rỗng + số âm/NaN trước khi tới RPC.
assert.match(store, /if \(!items\.length\) return/)
assert.match(store, /item\.quantity < 0/)

// LAN: validate quantity >= 0 như CHECK constraint của DB thật.
assert.match(lanServer, /Number\(item\.quantity\) < 0/)

// DB: CHECK cho phép 0, chặn âm.
assert.match(schema, /quantity numeric\(14,[34]\) not null check \(quantity >= 0\)/)

console.log('INVENTORY_COUNT_ZERO_OK')
