// Thiết kế lại màn NHẬP / XUẤT / SỬA TỒN kho (05/08/2026).
//
// Lỗi gốc do ca trưởng báo: kho sai số, muốn xuất hết ra để nhập lại nhưng màn
// hình chỉ hiện 2 chữ số thập phân (tồn 5.123 kg hiện "5.12 kg"). Gõ theo số
// nhìn thấy thì kho còn dư 0.003 kg ⇒ phải xuất đi xuất lại nhiều lần.
//
// Test này khoá 4 điều:
//   1. Hiển thị đủ 3 chữ số như `stock_movements.quantity` numeric(14,3).
//   2. Nút "Xuất hết" lấy đúng số tồn thật ⇒ tồn về 0 tuyệt đối trong MỘT phiếu.
//   3. Gõ lệch ở mức làm tròn (±0,005) vẫn tự khớp về 0, không báo thiếu tồn.
//   4. "Sửa tồn" ghi movement `count` với đúng số khai (mốc reset của calculateStock).
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function loadEntryModule() {
  let source = await readFile(new URL('../src/lib/inventoryEntry.ts', import.meta.url), 'utf8')
  source = source.replace(/^import\s[^\n]+\n/gm, '')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

/** Bản sao `calculateStock` (store.ts) rút gọn — đủ để kiểm tra tồn sau khi ghi phiếu. */
function stockOf(movements) {
  const signs = {
    opening: 1, inbound: 1, processing_out: -1, processing_in: 1,
    packing_out: -1, packing_in: 1, sale_out: -1, waste: -1, adjustment: 1, count: 0,
  }
  let latestCount
  for (const item of movements) {
    if (item.type !== 'count') continue
    if (!latestCount || item.createdAt > latestCount.createdAt) latestCount = item
  }
  let before = 0
  let after = 0
  for (const item of movements) {
    const value = item.quantity * signs[item.type]
    if (!latestCount || item.createdAt < latestCount.createdAt) before += value
    else if (item.createdAt > latestCount.createdAt) after += value
  }
  return latestCount ? latestCount.quantity + after : before
}

const chestnut = { id: 'chestnut-cooked-kg', sku: 'TP-01', name: 'Hạt dẻ chín (kg)', unit: 'kg', category: 'finished', lowStock: 1 }
const bag330 = { id: 'bag-330', sku: 'BB-330', name: 'Túi 330g', unit: 'túi', category: 'packaging', lowStock: 5 }
const rawSack = { id: 'chestnut-raw-kg', sku: 'NL-01', name: 'Hạt dẻ tươi (kg)', unit: 'kg', category: 'raw', lowStock: 1, inboundUnit: 'bao', inboundPackKg: 25 }

const entry = await loadEntryModule()

// 1. Hiển thị đủ số lẻ — chỗ trước đây cắt còn 2 chữ số.
// Số hiển thị viết kiểu Việt (dấu phẩy thập phân) để khớp mọi màn còn lại của
// app — xem `scripts/test-inventory-display-consistency.mjs`.
assert.equal(entry.formatQuantity(5.123), '5,123')
assert.equal(entry.formatStockAmount(5.123, 'kg'), '5,123 kg')
assert.equal(entry.formatStockAmount(5, 'kg'), '5 kg')
assert.equal(entry.formatStockAmount(0.123, 'kg'), '123 g', 'dưới 1 kg đọc theo gram')
assert.equal(entry.formatStockAmount(0.0002, 'kg'), '0 kg', 'nhỏ hơn nửa gram = coi như hết')
assert.equal(entry.formatStockAmount(12, 'túi'), '12 túi')

// Gõ số: dấu phẩy = dấu chấm, chỉ giữ MỘT dấu thập phân.
assert.equal(entry.sanitizeQuantityInput('5,123'), '5.123')
assert.equal(entry.sanitizeQuantityInput('1.2.3'), '1.23')
assert.equal(entry.sanitizeQuantityInput('-4a2'), '42')
assert.equal(entry.parseQuantityInput('5,123'), 5.123)
assert.equal(entry.hasQuantityInput('0'), true, '"0" là ĐÃ khai (hết sạch), khác với ô trống')
assert.equal(entry.hasQuantityInput(''), false)

// 2. "Xuất hết" đúng tồn thật ⇒ một phiếu là sạch kho.
const ledger = [
  { type: 'inbound', quantity: 5.123, createdAt: '2026-08-05T01:00:00.000Z' },
]
const available = stockOf(ledger)
assert.equal(available, 5.123)
const fullPlan = entry.planOutbound(
  [{ product: chestnut, available }],
  // Đúng thứ nút "Xuất hết" đổ vào ô nhập: bản MÁY ĐỌC ĐƯỢC, không phải bản hiển thị.
  { [chestnut.id]: { quantity: entry.quantityInputValue(available), unit: 'kg' } },
)
assert.equal(fullPlan.lines.length, 1)
assert.equal(fullPlan.lines[0].quantity, 5.123)
assert.equal(fullPlan.shortages.length, 0)
const afterFullOut = stockOf([...ledger, { type: 'sale_out', quantity: fullPlan.lines[0].quantity, createdAt: '2026-08-05T02:00:00.000Z' }])
assert.ok(entry.isZeroQuantity(afterFullOut), `xuất hết phải về 0, đang còn ${afterFullOut}`)
assert.equal(entry.hasStock(afterFullOut), false, 'không còn dòng "còn dư" để phải xuất lần hai')

// 3. Gõ theo số hiển thị CŨ (2 chữ số) vẫn phải sạch kho, không báo thiếu tồn.
const legacyTyped = entry.planOutbound(
  [{ product: chestnut, available: 5.123 }],
  { [chestnut.id]: { quantity: '5.12', unit: 'kg' } },
)
assert.equal(legacyTyped.lines[0].quantity, 5.123, 'lệch 3 gram ⇒ tự khớp về đúng tồn')
assert.equal(legacyTyped.lines[0].snapped, true)
assert.equal(legacyTyped.lines[0].remaining, 0)
assert.equal(legacyTyped.snappedCount, 1)

// Gõ thừa vài gram cũng không tạo tồn âm và không bắt xác nhận "thiếu tồn".
const slightOver = entry.planOutbound(
  [{ product: chestnut, available: 5.123 }],
  { [chestnut.id]: { quantity: '5.125', unit: 'kg' } },
)
assert.equal(slightOver.lines[0].quantity, 5.123)
assert.equal(slightOver.shortages.length, 0)

// Thiếu tồn THẬT thì vẫn phải cảnh báo (không được im lặng khớp số).
const realShortage = entry.planOutbound(
  [{ product: chestnut, available: 5.123 }],
  { [chestnut.id]: { quantity: '6', unit: 'kg' } },
)
assert.equal(realShortage.shortages.length, 1)
assert.equal(realShortage.lines[0].quantity, 6)

// Hàng cân ký dưới 1 kg: gõ theo gram vẫn ra đúng số kg lưu vào sổ.
const gramPlan = entry.planOutbound(
  [{ product: chestnut, available: 0.42 }],
  { [chestnut.id]: { quantity: '420', unit: 'g' } },
)
assert.equal(gramPlan.lines[0].quantity, 0.42)
assert.equal(gramPlan.lines[0].remaining, 0)
assert.equal(entry.defaultEntryUnit(chestnut, 0.42), 'g', 'dưới 1 kg thì mặc định gõ gram')
assert.equal(entry.defaultEntryUnit(chestnut, 5.123), 'kg')
assert.equal(entry.defaultEntryUnit(bag330, 12), undefined, 'hàng đếm cái không có lựa chọn kg/g')

// Ô trống = không xuất; đơn vị đếm (túi) giữ nguyên số nguyên.
const mixedPlan = entry.planOutbound(
  [{ product: chestnut, available: 5.123 }, { product: bag330, available: 12 }],
  { [bag330.id]: { quantity: '12' } },
)
assert.equal(mixedPlan.lines.length, 1)
assert.equal(mixedPlan.lines[0].product.id, bag330.id)
assert.equal(mixedPlan.lines[0].quantity, 12)

// 4. Nhập kho theo quy cách đóng gói: 2 bao × 25 kg = 50 kg.
const packed = entry.convertEntryToStockQuantity(rawSack, { quantity: '2' }, { usePackSize: true })
assert.equal(packed.quantity, 50)
assert.match(packed.conversionNote, /2 bao × 25 kg = 50 kg/)
assert.equal(entry.inboundEntryUnit(rawSack), 'bao')
// Phiếu XUẤT không áp quy cách bao (xuất lẻ theo kg).
assert.equal(entry.convertEntryToStockQuantity(rawSack, { quantity: '2' }).quantity, 2)

// 5. Sửa tồn: khai số đúng ⇒ ghi count = số khai, tồn theo đúng số khai.
const wrongLedger = [
  { type: 'inbound', quantity: 5.123, createdAt: '2026-08-05T01:00:00.000Z' },
  { type: 'sale_out', quantity: 1, createdAt: '2026-08-05T02:00:00.000Z' },
]
const systemStock = stockOf(wrongLedger)
const resetLines = entry.planStockReset(
  [{ product: chestnut, available: systemStock }, { product: bag330, available: 12 }],
  { [chestnut.id]: { quantity: '3', unit: 'kg' }, [bag330.id]: { quantity: '0' } },
)
assert.equal(resetLines.length, 2)
const chestnutReset = resetLines.find((line) => line.product.id === chestnut.id)
assert.equal(chestnutReset.target, 3)
assert.equal(chestnutReset.current, 4.123)
assert.equal(chestnutReset.delta, -1.123)
const afterReset = stockOf([
  ...wrongLedger,
  { type: 'count', quantity: chestnutReset.target, createdAt: '2026-08-05T03:00:00.000Z' },
])
assert.equal(afterReset, 3, 'kiểm kê là mốc reset ⇒ tồn = số khai')
// Khai 0 cho túi ⇒ vẫn là một dòng thay đổi (0 khác với "bỏ trống").
assert.equal(resetLines.find((line) => line.product.id === bag330.id).target, 0)
// Khai đúng bằng số hệ thống ⇒ không ghi gì (không tạo phiếu rác).
assert.equal(entry.planStockReset([{ product: chestnut, available: 3 }], { [chestnut.id]: { quantity: '3' } }).length, 0)
// Ô trống ⇒ KHÔNG đụng vào SKU đó (tuyệt đối không được ghi count = 0 cho hàng chưa khai).
assert.equal(entry.planStockReset([{ product: chestnut, available: 3 }], { [chestnut.id]: { quantity: '' } }).length, 0)

// 6. Tìm kiếm không dấu để ca trưởng gõ nhanh trên điện thoại.
assert.equal(entry.matchesProductQuery(chestnut, 'hat de'), true)
assert.equal(entry.matchesProductQuery(chestnut, 'TP-01'), true)
assert.equal(entry.matchesProductQuery(chestnut, 'khoai'), false)
assert.equal(entry.matchesProductQuery(bag330, ''), true)

console.log('✓ Kho nhập/xuất/sửa tồn: hiển thị đủ số lẻ, xuất hết một lần là sạch, sửa tồn ghi đúng mốc kiểm kê.')
