// Kho hiển thị KHÔNG ĐỒNG BỘ giữa các màn (chủ quán báo 05/08/2026).
//
// Bản vá BUG-133 cùng ngày chỉ nâng độ chính xác hiển thị ở MÀN KHO, các màn còn
// lại giữ nguyên cách làm tròn cũ ⇒ cùng một tồn 5,123 kg mà mỗi màn một con số:
//
//   Kho        5.123 kg   (dấu chấm — tiếng Việt đọc thành "năm nghìn 123")
//   Quản trị   5,123 kg
//   Báo cáo    5,12 kg    (cắt mất số lẻ thứ ba)
//   Bàn giao   5,1234     (thừa số lẻ thứ tư = rác dấu phẩy động)
//   Nhà hàng   5.1 kg
//
// Test này khoá 3 điều:
//   1. `formatQuantity` viết số kiểu Việt (dấu phẩy thập phân) và giữ đủ 3 chữ
//      số lẻ như `stock_movements.quantity` numeric(14,3).
//   2. Số đổ vào Ô NHẬP phải là dạng máy đọc được và quay vòng lại đúng số cũ —
//      dùng nhầm bản hiển thị thì "1.234,5" bị bóp thành 1,2345.
//   3. Mọi màn có hiển thị số lượng kho đều gọi bộ hiển thị dùng chung, không
//      tự làm tròn riêng bằng toFixed()/maximumFractionDigits.
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

const readPage = (path) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8')

const entry = await loadEntryModule()
const { formatQuantity, formatStockAmount, quantityInputValue, parseQuantityInput, sanitizeQuantityInput } = entry

// ── 1. Cách viết số: dấu phẩy thập phân, đủ 3 số lẻ, cắt số 0 thừa ────────────
assert.equal(formatQuantity(5.123), '5,123', 'Tồn 5.123 phải hiện "5,123" (dấu phẩy), không phải "5.123"')
assert.equal(formatQuantity(5.1), '5,1', 'Không được đệm số 0 thừa')
assert.equal(formatQuantity(5), '5', 'Số nguyên hiện gọn, không có phần lẻ')
assert.equal(formatQuantity(1234.5), '1.234,5', 'Hàng nghìn nhóm kiểu Việt')
assert.equal(formatQuantity(0.0004), '0', 'Nhỏ hơn nửa đơn vị cuối của DB là coi như 0')
assert.equal(formatStockAmount(5.123, 'kg'), '5,123 kg')
assert.equal(formatStockAmount(0.123, 'kg'), '123 g', 'Dưới 1 kg đọc bằng gram')
assert.equal(formatStockAmount(12.5, 'túi'), '12,5 túi')

// ── 2. Ô nhập phải quay vòng đúng số ──────────────────────────────────────────
for (const value of [5.123, 0.5, 1234.5, 25, 0.001]) {
  const typed = quantityInputValue(value)
  const roundTrip = parseQuantityInput(sanitizeQuantityInput(typed))
  assert.equal(roundTrip, value, `Bấm "Xuất hết" với tồn ${value} phải gõ lại ra đúng ${value}, đang ra ${roundTrip}`)
}
// Chính là cái bẫy: bản HIỂN THỊ không dùng được cho ô nhập.
assert.notEqual(
  parseQuantityInput(sanitizeQuantityInput(formatQuantity(1234.5))),
  1234.5,
  'Nếu bản hiển thị cũng nhập được thì test này thừa — nhưng "1.234,5" vốn bị bóp thành 1,2345',
)

// ── 3. Các màn dùng chung bộ hiển thị, không tự làm tròn ──────────────────────
const inventoryPage = await readPage('pages/InventoryPage.tsx')
assert.match(
  inventoryPage,
  /quantity: quantityInputValue\(/,
  'Nút "Xuất hết"/"Đúng tồn" phải đổ số dạng máy đọc vào ô nhập (quantityInputValue)',
)

const adminPage = await readPage('pages/AdminPage.tsx')
assert.match(
  adminPage,
  /function formatInventoryQuantity\(value: number, unit: string\) \{\s*return formatStockAmount\(value, unit\)/,
  'Màn Quản trị → Kho phải dùng chung formatStockAmount, không tự định dạng 4 số lẻ',
)
assert.doesNotMatch(
  adminPage,
  /formatInventoryDecimal\(normalized/,
  'Không còn nhánh làm tròn riêng cho số lượng kho ở màn quản trị',
)

for (const [path, label] of [
  ['pages/ReportPage.tsx', 'Báo cáo'],
  ['pages/ShiftHandoverPage.tsx', 'Bàn giao ca'],
  ['pages/ControlCenterPage.tsx', 'Control center'],
  ['pages/admin/DashboardPage.tsx', 'Tổng quan quản trị'],
]) {
  const source = await readPage(path)
  // Điều cần khoá là DÙNG CHUNG bộ hiển thị, không phải tên hàm bọc. Sau
  // redesign, Tổng quan gọi thẳng formatQuantity/formatStockAmount thay vì bọc
  // qua một `formatNumber` cục bộ.
  assert.match(
    source,
    /formatQuantity\(|formatStockAmount\(/,
    `Màn ${label} phải hiển thị số lượng bằng bộ hiển thị kho dùng chung`,
  )
  assert.match(source, /from '\.\.\/(\.\.\/)?lib\/inventoryEntry'/, `Màn ${label} phải import bộ hiển thị kho dùng chung`)
}

const restaurantPage = await readPage('pages/RestaurantPage.tsx')
assert.match(
  restaurantPage,
  /formatStockAmount\(line\.expected, line\.product\.unit\)/,
  'Cảnh báo tồn thấp ở màn Nhà hàng phải dùng chung formatStockAmount',
)

// Không màn nào được quay lại kiểu làm tròn cũ cho số lượng kho.
for (const [path, pattern, label] of [
  ['pages/RestaurantPage.tsx', /line\.expected\.toFixed\(/, 'Nhà hàng'],
  ['pages/ShiftHandoverPage.tsx', /toFixed\(4\)/, 'Bàn giao ca'],
]) {
  assert.doesNotMatch(await readPage(path), pattern, `Màn ${label} còn tự làm tròn số lượng kho`)
}

console.log('INVENTORY_DISPLAY_CONSISTENCY_OK')
