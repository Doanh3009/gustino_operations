/**
 * CONSOLE QUẢN TRỊ: CÁC CẶP BẢNG NGẮN ĐỨNG CẠNH NHAU, KHÔNG GỘP (13/08/2026).
 *
 *   Kho      · Tồn kho    ↔ Hao hụt
 *   Tổng quan· Cần xử lý  ↔ Tình hình chi nhánh
 *
 * Vòng sửa trước đó đi sai hai lần, test này khoá lại cả hai đầu:
 *
 *   1. Bản gốc để MỌI cột của bảng tồn là `fr` trên card rộng cả trang ⇒ trên màn
 *      rộng cột bị kéo giãn ra hai mép, đọc một dòng phải quét mắt cả 1.300px.
 *   2. Bản vá kế tiếp chặn trần px + cho cột cuối nuốt phần thừa ⇒ cột sát nhau
 *      nhưng bỏ trống hẳn nửa phải của card. Chủ hệ thống: "dồn cột lại vậy thì
 *      xấu quá".
 *
 * Cách giải đúng KHÔNG nằm ở lưới cột mà ở BỀ NGANG CARD: hai bảng đứng cạnh
 * nhau, mỗi bảng ~nửa trang, nên `fr` chia đều là vừa khít. Yêu cầu nói rõ
 * "hai card ngang nhau CHỨ KHÔNG PHẢI GỘP VÔ" — nên vẫn phải là HAI `<Surface>`
 * độc lập, mỗi cái giữ nguyên bộ lọc/biểu đồ của nó.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [admin, dashboard, ui, uiCss] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/admin/DashboardPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ui/index.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/ui.css', import.meta.url), 'utf8'),
])

const section = sourceBetween(admin, "{activeSection === 'inventory' && (", "{activeSection === 'requests' && (")
assert.ok(section, 'Không tìm thấy section Kho hàng của trang Quản trị.')

// ── 1. Hai card NGANG NHAU, và vẫn là HAI bảng riêng. ──────────────────────
const split = sourceBetween(section, '<SplitPair>', '</SplitPair>')
assert.ok(split, 'Tồn kho và Hao hụt phải nằm chung một <SplitPair> để đứng cạnh nhau.')
assert.equal(
  (split.match(/<Surface\b/g) || []).length, 2,
  'Cặp card phải có ĐÚNG hai <Surface> — không gộp hai bảng làm một, cũng không nhét thêm card thứ ba.',
)
assert.match(split, /title="Tồn kho"/, 'Card trái phải có tiêu đề Tồn kho để cân với card Hao hụt.')
assert.match(split, /title="Hao hụt"/, 'Card phải phải là bảng Hao hụt.')
// Hai bảng độc lập ⇒ mỗi bảng giữ nguyên bộ lọc/biểu đồ riêng của nó.
assert.match(split, /placeholder="Tìm tên mặt hàng hoặc mã SKU"/, 'Card Tồn kho mất ô tìm mặt hàng.')
assert.match(split, /label="Nhóm hao hụt theo"/, 'Card Hao hụt mất bộ lọc ngày/tháng/năm.')
assert.match(split, /<BarChart/, 'Card Hao hụt mất biểu đồ cột.')

// ── 2. Lưới `.gt-split-2`: 2 cột trên desktop, xếp dọc ≤1180px. ────────────
assert.match(ui, /export function SplitPair/, 'Thiếu component SplitPair.')
assert.match(
  uiCss,
  /\.gt-split-2 \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/,
  'Thiếu lưới 2 cột cho cặp card.',
)
assert.match(
  uiCss,
  /@media \(max-width: 1180px\) \{\s*\.gt-split-2 \{ grid-template-columns: minmax\(0, 1fr\)/,
  'Cặp card phải xếp dọc lại trên màn hẹp, không ép hai bảng vào 2 cột chật.',
)

// ── 3. Cột bảng tồn quay lại `fr` — không chặn trần px, không cột trống. ───
const cols = /const inventoryStockCols = branchId\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/.exec(admin)
assert.ok(cols, 'Không tìm thấy khai báo lưới cột bảng tồn.')
for (const template of [cols[1], cols[2]]) {
  // Cấm TRẦN px trên cột nội dung: đó là thứ tạo ra khoảng trống ở nửa phải card.
  assert.doesNotMatch(template, /minmax\(\s*0\s*,\s*\d+px\s*\)/,
    `Cột nội dung không được chặn trần px (đang là: ${template}) — nó tạo khoảng trống ở nửa phải card.`)
  // Cấm cột "spacer" cuối dòng nuốt phần thừa.
  assert.doesNotMatch(template, /minmax\(\s*\d+px\s*,\s*[\d.]*fr\s*\)\s*$/,
    `Cột cuối không được là spacer nuốt phần thừa (đang là: ${template}).`)
  assert.match(template, /fr\)/, `Lưới cột bảng tồn phải chia theo fr để lấp đúng bề ngang card: ${template}`)
  // Nhưng cột TRẠNG THÁI thì phải cố định — xem test-gt-list-no-auto-column.
  assert.match(template, /\s\d+px$/, `Cột trạng thái phải cố định bề rộng để các dòng thẳng cột: ${template}`)
}

// ── 4. Lưới cột đặt qua `--gt-cols`, KHÔNG style inline. ───────────────────
// Style inline thắng cả media query ⇒ set thẳng `gridTemplateColumns` là vô hiệu
// hoá bố cục dọc ≤900px của `.gt-list__row`, bảng kho trên điện thoại lại thành
// lưới ngang.
assert.doesNotMatch(section, /gridTemplateColumns:/,
  'Đặt lưới cột bằng style inline sẽ đè media query và làm hỏng bố cục điện thoại — dùng --gt-cols.')
assert.match(section, /'--gt-cols': inventoryStockCols/, 'Bảng tồn chưa truyền lưới cột qua --gt-cols.')

// ── 5. Pastel chỉ nhuộm ĐẦU card, vùng dữ liệu giữ nền trắng. ──────────────
assert.match(ui, /export type SurfaceTone = 'mint' \| 'rose' \| 'sky' \| 'sand'/, 'Thiếu bảng sắc pastel của Surface.')
assert.match(split, /<Surface tone="mint">/, 'Card Tồn kho chưa nhuộm pastel.')
assert.match(split, /<Surface tone="rose">/, 'Card Hao hụt chưa nhuộm pastel.')
for (const tone of ['mint', 'rose', 'sky', 'sand']) {
  assert.match(uiCss, new RegExp(`\\.gt-surface--${tone} \\{ border-color: var\\(--gt-${tone}-line\\); \\}`),
    `Thiếu sắc pastel ${tone}.`)
  assert.match(uiCss, new RegExp(`\\.gt-surface--${tone} > \\.gt-section-head,\\s*\\n\\.gt-surface--${tone} > \\.gt-fold > summary \\{ background: var\\(--gt-${tone}\\); \\}`),
    `Sắc ${tone} phải nhuộm đầu card (cả section-head lẫn summary của khối gấp).`)
}
// Nhuộm cả card thì số liệu mất tương phản — chỉ được nhuộm phần đầu.
assert.doesNotMatch(uiCss, /\.gt-surface--(mint|rose|sky|sand) \{[^}]*background:/,
  'Pastel không được tô nền toàn card, chỉ đổi viền + đầu card.')

// ── 6. Tổng quan: Cần xử lý ↔ Tình hình chi nhánh cũng đứng cạnh nhau. ─────
const overviewSplit = sourceBetween(dashboard, '<SplitPair>', '</SplitPair>')
assert.ok(overviewSplit, 'Cần xử lý và Tình hình chi nhánh phải nằm chung một <SplitPair>.')
assert.equal(
  (overviewSplit.match(/<Surface\b/g) || []).length, 2,
  'Cặp card Tổng quan phải có ĐÚNG hai <Surface> — không gộp hai bảng làm một.',
)
assert.match(overviewSplit, /title="Cần xử lý"/, 'Card trái phải là Cần xử lý.')
assert.match(overviewSplit, /title="Tình hình chi nhánh"/, 'Card phải phải là Tình hình chi nhánh.')
assert.match(overviewSplit, /<Surface tone="sand">/, 'Card Cần xử lý chưa nhuộm pastel.')
assert.match(overviewSplit, /<Surface tone="sky">/, 'Card Tình hình chi nhánh chưa nhuộm pastel.')

console.log('ADMIN_SPLIT_CARDS_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  if (start < 0) return ''
  const end = source.indexOf(endMarker, start)
  return source.slice(start, end >= 0 ? end : undefined)
}
