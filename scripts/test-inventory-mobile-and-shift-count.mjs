/**
 * Khoá hai hợp đồng của đợt 06/08/2026:
 *   1. Kiểm đếm cuối ca phải phủ được hàng đang ÂM và hàng không tính bằng kg —
 *      đây là gốc của "kho thành phẩm âm hoài" (bánh hạt dẻ −1.132 ở Lotte VT,
 *      hạt dẻ nướng −58,96 kg ở Gold Coast với 0 lần kiểm kê).
 *   2. Màn Kho trên điện thoại: một tầng điều hướng, danh sách rút gọn theo
 *      hàng hay dùng, nút lưu dính đáy — không phải cuộn hết 30 SKU mới lưu được.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { transform } from 'esbuild'

const [handover, inventory, styles, app, scopeSource] = await Promise.all([
  readFile(new URL('../src/pages/ShiftHandoverPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/InventoryPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/shiftCountScope.ts', import.meta.url), 'utf8'),
])
const compiled = await transform(scopeSource, { loader: 'ts', format: 'esm', target: 'es2022' })
const scope = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`)

// ── 1. Hàng ĐANG ÂM vẫn phải được đếm ────────────────────────────────────────
const products = [
  { id: 'chestnut-cooked-kg', name: 'Thành phẩm hạt dẻ rang' },
  { id: 'chestnut-grilled-finished', name: 'Thành phẩm hạt dẻ nướng' },
  { id: 'cake-ready', name: 'Bánh hạt dẻ thành phẩm' },
  { id: 'potato-cooked-kg', name: 'Khoai lang chín' },
]
const shiftStartedAt = '2026-08-06T01:00:00.000Z'

const negativeStock = scope.productsToCount({
  products,
  openingBalances: {},
  expectedBalances: { 'chestnut-grilled-finished': -58.96 },
  movements: [],
  shiftStartedAt,
})
assert.deepEqual(
  negativeStock.map((product) => product.id),
  ['chestnut-grilled-finished'],
  'SKU đang âm phải nằm trong danh sách kiểm đếm — bỏ nó ra là kẹt âm vĩnh viễn.',
)

// Bán POS trong ca (sale_out) cũng là dấu hiệu SKU đang được dùng.
const soldInShift = scope.productsToCount({
  products,
  openingBalances: {},
  expectedBalances: {},
  movements: [
    { productId: 'cake-ready', createdAt: '2026-08-06T03:00:00.000Z' },
    { productId: 'potato-cooked-kg', createdAt: '2026-08-05T22:00:00.000Z' },
  ],
  shiftStartedAt,
})
assert.deepEqual(
  soldInShift.map((product) => product.id),
  ['cake-ready'],
  'Phiếu phát sinh trong ca phải kéo SKU vào màn đếm; phiếu của ca trước thì không.',
)

// Tồn dương như cũ vẫn vào, và số rác dưới nửa gram thì không.
assert.deepEqual(
  scope.productsToCount({
    products,
    openingBalances: { 'chestnut-cooked-kg': 12.5 },
    expectedBalances: { 'cake-ready': 0.0001 },
    movements: [],
    shiftStartedAt,
  }).map((product) => product.id),
  ['chestnut-cooked-kg'],
)
// Ca chưa phát sinh gì vẫn phải đếm vài mặt hàng chính (không để màn trống trơn).
assert.equal(
  scope.productsToCount({ products, openingBalances: {}, expectedBalances: {}, movements: [], shiftStartedAt }).length,
  4,
)

// ── 2. Ô đếm trống ≠ đã đếm 0 ────────────────────────────────────────────────
assert.equal(scope.hasCountInput(undefined), false)
assert.equal(scope.hasCountInput(''), false)
assert.equal(scope.hasCountInput('   '), false)
assert.equal(scope.hasCountInput('0'), true, '"0" là đã đếm và hết sạch, khác hẳn ô để trống')
assert.equal(scope.hasCountInput('12,5'), false, 'Ô number trả về dấu chấm; dấu phẩy không phải số hợp lệ')
assert.equal(scope.hasCountInput('12.5'), true)
assert.deepEqual(
  scope.uncountedProducts(products, { 'cake-ready': '3', 'chestnut-cooked-kg': '' }).map((product) => product.id),
  ['chestnut-cooked-kg', 'chestnut-grilled-finished', 'potato-cooked-kg'],
)

// ── 3. Màn bàn giao dùng đúng các quy tắc trên ───────────────────────────────
assert.match(handover, /from '\.\.\/lib\/shiftCountScope'/, 'Bàn giao phải dùng quy tắc đếm dùng chung.')
assert.match(
  handover,
  /category === 'finished' && isWarehouseProduct\(product\)/,
  'Kiểm đếm cuối ca phải phủ mọi thành phẩm kho, không riêng hàng đơn vị kg.',
)
assert.doesNotMatch(handover, /getFinishedBulkProducts/, 'Bản cũ chỉ lấy thành phẩm kg — đã bỏ.')
assert.match(handover, /const expectedBalances = useMemo/, 'Phải có bản tồn giữ nguyên dấu để nhận hàng âm.')
// 07/08/2026 — KHÔI PHỤC: ô đếm điền sẵn tồn dự kiến trở lại.
// Bản bắt đếm tay từng mặt hàng (blank = chưa đếm, thiếu ô là CHẶN chốt ca) đã khiến
// ca trưởng ngoài quầy không bàn giao được. Chốt ca không được phép kẹt: kẹt một ca là
// kẹt luôn bàn giao, ca sau và chốt ngày. Chất lượng số đếm siết bằng nhắc, không chặn.
assert.match(
  handover,
  /closingBalances\[product\.id\] \?\? availableBalances\[product\.id\]/,
  'Ô trống phải hiểu là "đúng bằng số hệ thống" để chốt ca không bị chặn.',
)
assert.match(
  handover,
  /value=\{closingBalances\[product\.id\] \?\? String\(expected\)\}/,
  'Ô đếm phải điền sẵn tồn dự kiến.',
)
assert.doesNotMatch(handover, /Chưa đếm \$\{notCounted\.length\} mặt hàng/, 'Không được chặn chốt ca vì thiếu số đếm.')

// ── 4. Màn Kho: một tầng điều hướng, tối ưu điện thoại (namespace `wh-`) ─────
// 07/08/2026: màn Kho được viết lại toàn bộ theo yêu cầu "không dùng dạng card".
// Mọi thứ là BẢNG DÒNG; tên lớp cũ `inventory-modebar`/`stock-entry-*` đã thay
// bằng `wh-*`. Các hợp đồng NGHIỆP VỤ bên dưới thì giữ nguyên.
assert.match(
  inventory,
  /type InventoryMode = 'stock' \| 'inbound' \| 'processing' \| 'outbound' \| 'reset' \| 'count'/,
  'Mỗi việc của kho phải là một chế độ phẳng, không còn tab con.',
)
assert.doesNotMatch(inventory, /inventory-subtabs/, 'Tầng tab con đã bị bỏ.')
assert.doesNotMatch(inventory, /type InboundSub|type OutboundSub/, 'State tab con đã bị bỏ.')
assert.doesNotMatch(inventory, /className="section-card|className="entry-card/, 'Màn kho không được quay lại dạng thẻ (card).')
assert.match(inventory, /className="wh-tabs"/, 'Thiếu thanh chế độ kho.')
assert.match(inventory, /function recentProductIds\(/, 'Thiếu nhóm mặt hàng hay dùng.')
assert.match(inventory, /recentIds=\{recentIds\}/, 'Bảng nhập liệu chưa nhận nhóm hay dùng.')
assert.match(inventory, /className="wh-more"/, 'Thiếu nút hiện thêm mặt hàng ít dùng.')
assert.match(inventory, /function quickStepFor\(/, 'Thiếu nút cộng/trừ nhanh.')
assert.match(inventory, /className="wh-save"/, 'Nút lưu phải là nút riêng ở thanh dính đáy.')
assert.match(inventory, /disabled=\{saving \|\| !changedCount\}/, 'Không cho bấm lưu khi chưa có gì thay đổi.')
// Không được đánh mất các hợp đồng cũ của màn kho.
assert.match(inventory, /quantity: quantityInputValue\(/, 'Nút "Hết"/"= Tồn" vẫn phải đổ số máy đọc vào ô nhập.')
assert.ok(!/window\.confirm/.test(inventory), 'Màn kho không được dùng window.confirm trần (BUG-137).')

// ── 5. Sổ kho chưa tải xong thì KHÔNG được vẽ bảng tồn toàn số 0 ─────────────
assert.match(inventory, /movementsStatus/, 'Màn kho phải biết sổ kho đã tải xong hay chưa.')
assert.match(inventory, /const loadingStock = movementsStatus === 'loading' && !movements\.length/, 'Thiếu cờ đang tải.')
assert.match(inventory, /if \(loading\) return <SkeletonRows/, 'Đang tải phải hiện khung chờ thay cho số 0.')
assert.match(app, /setMovementsStatus\('error'\)|setMovementsStatus\(hadData \? 'ready' : 'error'\)/, 'Lỗi tải sổ kho phải báo ra, không nuốt im.')

for (const selector of [
  '.wh-tabs {',
  '.wh-tr {',
  '.wh-etr {',
  '.wh-step {',
  '.wh-more {',
  '.wh-skeleton {',
]) {
  assert.ok(styles.includes(selector), `Thiếu CSS ${selector}`)
}
assert.ok(!styles.includes('.inventory-crm-actions button small { grid-column'), 'CSS của khối thẻ cũ chưa được dọn.')
assert.match(styles, /\.wh-savebar \{[^}]*position: sticky/, 'Thanh lưu phải dính đáy màn.')

console.log('INVENTORY_MOBILE_AND_SHIFT_COUNT_OK')
