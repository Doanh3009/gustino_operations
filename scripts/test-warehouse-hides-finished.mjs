/**
 * Khoá quyết định vận hành 07/08/2026 của chủ quán:
 *
 *   "thành phẩm thường xuyên âm … hủy cuối ngày cũng không ghi nhận … thành phẩm
 *    sẽ không để dồn qua nhiều ngày … hay không hiển thị thành phẩm trong kho
 *    luôn, để thành phẩm cứ trừ vào sau khi bán như cũ nhưng không hiển thị nữa"
 *
 * Ba mệnh đề phải cùng đúng, nếu không là quay lại lỗi cũ:
 *   1. Màn Kho KHÔNG hiện thành phẩm (và không hiện món menu đã tắt).
 *   2. POS vẫn trừ kho thành phẩm y như cũ — KHÔNG được đụng vào `calculateStock`
 *      hay công thức món, vì đó là đường trừ kho khi bán.
 *   3. Thành phẩm vẫn xem được theo NGÀY (chế biến / đã bán / còn lại) và mặt
 *      hàng bị ẩn mà còn số dư vẫn sửa được ở màn Sửa tồn — nếu không thì lặp lại
 *      cái bẫy đã sinh ra kho âm: mất khỏi màn là mất luôn đường sửa (§50).
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { transform } from 'esbuild'

const [inventory, store, scopeSource] = await Promise.all([
  readFile(new URL('../src/pages/InventoryPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/store.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/warehouseScope.ts', import.meta.url), 'utf8'),
])

// `warehouseScope.ts` import `./constants` (kéo theo cả cây phụ thuộc) nên ở đây
// dựng lại đúng luật bằng bản rút gọn — test số học, không test đường import.
const isMenuProduct = (p) => p.category === 'finished' && p.unit !== 'kg' && Number(p.price || 0) > 0
const stub = scopeSource.replace(
  "import { isWarehouseProduct } from './constants'",
  `const isMenuProduct = ${isMenuProduct.toString()}
   const isWarehouseProduct = (p) => !isMenuProduct(p)`,
)
const compiled = await transform(stub, { loader: 'ts', format: 'esm', target: 'es2022' })
const scope = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`)

// ── 1. Cái gì được coi là hàng tồn kho ──────────────────────────────────────
const raw = { id: 'chestnut-raw', category: 'raw', unit: 'kg' }
const packaging = { id: 'bag-110', category: 'packaging', unit: 'cái' }
const finishedKg = { id: 'chestnut-cooked-kg', category: 'finished', unit: 'kg' }
const finishedPiece = { id: 'cake-ready', category: 'finished', unit: 'cái', price: 0 }
const menuItem = { id: 'bag-330', category: 'finished', unit: 'túi', price: 80000 }
const disabledRaw = { id: 'old-raw', category: 'raw', unit: 'kg', active: false }

assert.ok(scope.isStockManagedProduct(raw), 'Nguyên liệu phải nằm trong kho.')
assert.ok(scope.isStockManagedProduct(packaging), 'Bao bì phải nằm trong kho.')
assert.ok(!scope.isStockManagedProduct(finishedKg), 'Thành phẩm kg KHÔNG còn hiện ở kho.')
// Đây chính là `cake-ready` −1.132 cái ở Lotte Vũng Tàu: thành phẩm đơn vị "cái"
// và giá 0 nên bản cũ xếp nhầm nó vào hàng kho.
assert.ok(!scope.isStockManagedProduct(finishedPiece), 'Thành phẩm theo cái cũng không hiện ở kho.')
assert.ok(!scope.isStockManagedProduct(menuItem), 'Món trong menu bán không phải hàng kho.')
assert.ok(!scope.isStockManagedProduct(disabledRaw), 'SKU admin đã tắt thì không hiện ở kho.')

// ── 2. Hàng bị ẩn mà CÒN SỐ DƯ vẫn phải sửa được ────────────────────────────
const split = scope.splitWarehouseLines([
  { product: raw, expected: 12.5 },
  { product: finishedKg, expected: -58.96 },
  { product: finishedPiece, expected: 0 },
  { product: menuItem, expected: 4 },
])
assert.deepEqual(split.managed.map((line) => line.product.id), ['chestnut-raw'])
assert.deepEqual(
  split.hidden.map((line) => line.product.id).sort(),
  ['bag-330', 'chestnut-cooked-kg'],
  'Hàng đã ẩn nhưng còn số dư phải mở lại được ở màn Sửa tồn.',
)
assert.ok(
  !split.hidden.some((line) => line.product.id === 'cake-ready'),
  'Hàng đã ẩn và số dư bằng 0 thì không cần bày ra.',
)

// ── 3. Thành phẩm xem theo NGÀY, không cộng dồn ─────────────────────────────
const movements = [
  { productId: 'chestnut-cooked-kg', type: 'processing_in', quantity: 10, shiftDate: '2026-08-07' },
  { productId: 'chestnut-cooked-kg', type: 'sale_out', quantity: 3, shiftDate: '2026-08-07' },
  { productId: 'chestnut-cooked-kg', type: 'waste', quantity: 0.5, shiftDate: '2026-08-07' },
  // Phiếu của hôm trước KHÔNG được kéo sang: đây là lý do tồn cộng dồn vô nghĩa.
  { productId: 'chestnut-cooked-kg', type: 'sale_out', quantity: 999, shiftDate: '2026-08-06' },
]
const [today] = scope.summarizeFinishedToday(movements, '2026-08-07')
assert.equal(today.made, 10)
assert.equal(today.sold, 3)
assert.equal(today.wasted, 0.5)
assert.equal(today.left, 6.5, 'Còn lại trong ngày = chế biến − bán − hao, không dính số hôm trước.')
assert.equal(scope.summarizeFinishedToday(movements, '2026-08-05').length, 0, 'Ngày không phát sinh thì bảng rỗng.')

// ── 4. Đường TRỪ KHO KHI BÁN không được đụng tới ────────────────────────────
assert.match(
  store,
  /sale_out:\s*-1/,
  'POS vẫn phải trừ kho khi bán — ẩn hiển thị KHÔNG được đổi cách tính tồn.',
)
assert.ok(
  !/isStockManagedProduct|isDailyFinishedProduct/.test(store),
  'Luật hiển thị của màn Kho không được lọt vào `calculateStock` (báo cáo/bàn giao vẫn cần thành phẩm).',
)

// ── 5. Màn Kho dùng đúng lớp lọc này ────────────────────────────────────────
assert.match(inventory, /splitWarehouseLines\(stock\)/, 'Màn Kho phải lọc qua `splitWarehouseLines`.')
assert.match(inventory, /summarizeFinishedToday\(todayMovements, today\)/, 'Thiếu bảng thành phẩm theo ngày.')
assert.match(inventory, /showHiddenInReset/, 'Màn Sửa tồn phải mở được nhóm hàng đã ẩn còn số dư.')
assert.match(
  inventory,
  /rows=\{resetAvailability\}/,
  'Màn Sửa tồn phải nhận cả hàng đã ẩn khi người dùng bật lên.',
)

console.log('WAREHOUSE_HIDES_FINISHED_OK')
