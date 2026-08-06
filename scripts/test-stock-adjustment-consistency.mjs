// Sổ kho phải CÂN sau khi ca trưởng sửa tồn (05/08/2026, phần còn lại của BUG-134).
//
// Phiếu kiểm kê / sửa tồn ghi movement `count` — mốc reset của `calculateStock`.
// Tồn nhảy sang số khai ngay, nhưng `count` không thuộc cột Nhập lẫn cột Xuất của
// bất kỳ bảng nào, nên "Tồn đầu + Nhập − Xuất − Hao" không còn ra "Tồn cuối" và
// bảng kho trông như tự nhảy số.
//
// Test khoá 4 điều:
//   1. `stockAdjustmentDeltas` trả đúng độ lệch của từng phiếu kiểm kê.
//   2. Sổ kho theo kỳ cân trở lại khi có thêm cột Điều chỉnh.
//   3. Dòng ghi TRÙNG micro-giây với mốc kiểm kê không còn bị bỏ khỏi bảng tồn.
//   4. Mốc kiểm kê cuối ca do MÁY CHỦ đóng dấu, không phải đồng hồ điện thoại.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const PRODUCTS = [
  { id: 'chestnut-cooked-kg', sku: 'TP-01', name: 'Hạt dẻ chín (kg)', unit: 'kg', category: 'finished', lowStock: 1 },
  { id: 'bag-330', sku: 'BB-330', name: 'Túi 330g', unit: 'túi', category: 'packaging', lowStock: 5 },
]

async function loadStoreModule() {
  let source = await readFile(new URL('../src/lib/store.ts', import.meta.url), 'utf8')
  source = source.replace(/^import\s[^\n]+\n/gm, '')
  source = [
    `const PRODUCTS = ${JSON.stringify(PRODUCTS)};`,
    'const getProducts = () => PRODUCTS;',
    'const isWarehouseProduct = () => true;',
    // `store.ts` dùng chung bộ làm tròn của kho (numeric(14,3)).
    'const roundQuantity = (value) => Math.round(value * 1000) / 1000;',
    'const readLocalJson = (_key, fallback) => fallback;',
    'const localDateKey = () => "2026-08-05";',
    'const localDayBoundsIso = () => ({ start: "", end: "" });',
    'const createId = () => "id";',
    'const isDuplicateKey = () => false;',
    'const isMissingRpc = () => false;',
    'const isMissingUniqueConstraint = () => false;',
    'const userHeaders = () => ({});',
    'const shouldUseLanApi = () => false;',
    'const supabase = null;',
  ].join('\n') + '\n' + source
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

const readSource = (path) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8')

const store = await loadStoreModule()
const { calculateStock, stockAdjustmentDeltas, sumStockAdjustments } = store

const PRODUCT = 'chestnut-cooked-kg'
const movement = (type, quantity, createdAt, shiftDate = '2026-08-05', extra = {}) => ({
  id: `${type}-${createdAt}-${quantity}`,
  branchId: 'gold-coast',
  productId: PRODUCT,
  type,
  quantity,
  shiftDate,
  note: '',
  createdBy: 'u1',
  createdAt,
  ...extra,
})

const stockOf = (rows, productId = PRODUCT) =>
  calculateStock(rows).find((line) => line.product.id === productId)?.expected ?? 0

// ── 1. Độ lệch của từng phiếu kiểm kê ─────────────────────────────────────────
{
  // Sổ: nhập 20, bán 5 ⇒ hệ thống 15. Ca trưởng đếm thực tế 12 ⇒ lệch −3.
  const ledger = [
    movement('inbound', 20, '2026-08-05T01:00:00.000Z'),
    movement('sale_out', 5, '2026-08-05T02:00:00.000Z'),
    movement('count', 12, '2026-08-05T03:00:00.000Z'),
  ]
  const adjustments = stockAdjustmentDeltas(ledger)
  assert.equal(adjustments.length, 1)
  assert.equal(adjustments[0].delta, -3, 'Khai 12 khi hệ thống đang 15 ⇒ điều chỉnh −3')
  assert.equal(stockOf(ledger), 12, 'Tồn phải bằng đúng số vừa khai')

  // Phát sinh SAU phiếu sửa tồn không được đụng vào delta của phiếu đó.
  const withLater = [...ledger, movement('sale_out', 2, '2026-08-05T04:00:00.000Z')]
  assert.equal(stockAdjustmentDeltas(withLater)[0].delta, -3)
  assert.equal(stockOf(withLater), 10)

  // Hai phiếu kiểm kê liên tiếp: phiếu sau tính theo tồn SAU phiếu trước.
  const twice = [...withLater, movement('count', 30, '2026-08-05T05:00:00.000Z')]
  const deltas = stockAdjustmentDeltas(twice).map((item) => item.delta)
  assert.deepEqual(deltas, [-3, 20], 'Phiếu thứ hai: khai 30 khi hệ thống đang 10 ⇒ +20')
  assert.equal(stockOf(twice), 30)
}

// ── 2. Sổ kho theo kỳ phải cân ────────────────────────────────────────────────
{
  const history = [
    movement('inbound', 40, '2026-08-03T01:00:00.000Z', '2026-08-03'),
    movement('sale_out', 10, '2026-08-03T05:00:00.000Z', '2026-08-03'),
    // Trong kỳ 04–05/08:
    movement('inbound', 25, '2026-08-04T01:00:00.000Z', '2026-08-04'),
    movement('sale_out', 8, '2026-08-04T06:00:00.000Z', '2026-08-04'),
    movement('waste', 2, '2026-08-04T07:00:00.000Z', '2026-08-04'),
    movement('count', 40, '2026-08-05T02:00:00.000Z', '2026-08-05'),
    movement('sale_out', 5, '2026-08-05T08:00:00.000Z', '2026-08-05'),
  ]
  const from = '2026-08-04'
  const to = '2026-08-05'
  const opening = stockOf(history.filter((item) => item.shiftDate < from))
  const closing = stockOf(history.filter((item) => item.shiftDate <= to))
  const period = history.filter((item) => item.shiftDate >= from && item.shiftDate <= to)
  const sum = (types) => period.filter((item) => types.includes(item.type)).reduce((total, item) => total + item.quantity, 0)
  const inbound = sum(['opening', 'inbound', 'processing_in', 'packing_in'])
  const outbound = sum(['processing_out', 'packing_out', 'sale_out'])
  const waste = sum(['waste'])
  const adjust = sumStockAdjustments(stockAdjustmentDeltas(history), { productId: PRODUCT, from, to })

  assert.equal(opening, 30, 'Trước kỳ: nhập 40 − bán 10')
  assert.equal(closing, 35, 'Sau khi khai lại 40 rồi bán tiếp 5')
  assert.equal(adjust, -5, 'Khai 40 khi hệ thống đang 45 (30 + 25 − 8 − 2) ⇒ −5')
  assert.equal(
    Math.round((opening + inbound - outbound - waste + adjust) * 1000) / 1000,
    closing,
    'Tồn đầu + Nhập − Xuất − Hao + Điều chỉnh phải RA ĐÚNG tồn cuối',
  )
  // Không có cột Điều chỉnh thì lệch đúng bằng phần đã sửa — đây là lỗi cũ.
  assert.notEqual(opening + inbound - outbound - waste, closing)

  // Lọc theo kỳ: phiếu sửa tồn của ngày khác không được lọt vào.
  assert.equal(sumStockAdjustments(stockAdjustmentDeltas(history), { productId: PRODUCT, from: '2026-08-04', to: '2026-08-04' }), 0)
}

// ── 3. Dòng trùng đúng micro-giây với mốc kiểm kê ─────────────────────────────
{
  // Một lệnh INSERT nhiều dòng thì Postgres gán `now()` giống hệt nhau.
  const sameStamp = '2026-08-05T03:00:00.000Z'
  const ledger = [
    movement('inbound', 20, '2026-08-05T01:00:00.000Z'),
    movement('sale_out', 4, sameStamp),
    movement('count', 12, sameStamp),
  ]
  assert.equal(stockOf(ledger), 12, 'Mốc kiểm kê vẫn là số khai')
  const line = calculateStock(ledger).find((row) => row.product.id === PRODUCT)
  assert.equal(
    line.variance,
    -4,
    'Phiếu trùng dấu thời gian phải được tính vào tồn kỳ vọng (20 − 4 = 16 ⇒ lệch −4), trước đây bị bỏ rơi nên ra −8',
  )
  assert.equal(
    stockAdjustmentDeltas(ledger)[0].delta,
    -4,
    'Delta cũng phải xếp phiếu phát sinh TRƯỚC phiếu kiểm kê khi trùng dấu thời gian',
  )
}

// ── 4. Hợp đồng nguồn ─────────────────────────────────────────────────────────
const handover = await readSource('pages/ShiftHandoverPage.tsx')
assert.doesNotMatch(
  handover,
  /createdAt: new Date\(now\.getTime\(\)/,
  'Mốc kiểm kê cuối ca không được đóng dấu bằng đồng hồ điện thoại ca trưởng',
)
assert.doesNotMatch(handover, /created_at: row\.createdAt/, 'Không gửi dấu thời gian của máy lên phiếu kiểm kê cuối ca')

const ledgerLib = await readSource('lib/shiftLedger.ts')
assert.doesNotMatch(
  ledgerLib,
  /created_at: movement\.created_at \|\| endedAt/,
  '`endedAt` cũng là đồng hồ máy — phải để DB dùng `default now()` khi phiếu không có dấu thời gian',
)

const adminPage = await readSource('pages/AdminPage.tsx')
assert.match(adminPage, /const adjust = sumStockAdjustments\(adjustments, \{ productId: product\.id, from, to \}\)/, 'Sổ kho theo kỳ phải có cột Điều chỉnh')
assert.match(adminPage, /opening \+ additions \+ adjust - closing - waste/, 'Đối soát ca phải trừ phần sửa tồn giữa ca ra khỏi "Out chính thức"')
assert.match(adminPage, /if \(item\.movement\.documentId === session\.id\) return false/, 'Phiếu kiểm đếm cuối ca không được tính là điều chỉnh giữa ca')
assert.match(adminPage, /\{ header: 'Điều chỉnh kiểm kê', key: 'adjust'/, 'Excel tổng hợp kho phải có cột Điều chỉnh')

const reportPage = await readSource('pages/ReportPage.tsx')
assert.match(reportPage, /function buildAdjustmentRows\(/, 'Báo cáo ngày phải liệt kê phiếu sửa tồn')
assert.match(reportPage, /adjustmentRows,/, 'adjustmentRows phải nằm trong mô hình báo cáo ngày')

console.log('STOCK_ADJUSTMENT_CONSISTENCY_OK')
