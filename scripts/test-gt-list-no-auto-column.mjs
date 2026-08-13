/**
 * BẢNG `gt-list`: KHÔNG CỘT NÀO ĐƯỢC LÀ `auto` (13/08/2026).
 *
 * Chủ hệ thống: "chữ bị không thẳng hàng" — ảnh chụp bảng Hao hụt cho thấy cùng
 * một chuỗi "Lotte Mart 23/10" mà mỗi dòng lại bắt đầu ở một toạ độ khác.
 *
 * Nguyên nhân: `.gt-list__head` và mỗi `.gt-list__row` là những GRID RIÊNG BIỆT,
 * không phải các hàng của cùng một grid. Track `auto` vì thế co giãn theo nội
 * dung của CHÍNH DÒNG ĐÓ — dòng "1,435 kg" rộng hơn dòng "310 g" ⇒ cột cuối
 * rộng khác nhau ⇒ mọi cột phía trước xê dịch theo. Càng nhiều dòng càng lệch.
 *
 * Cách chữa: mọi track phải có bề rộng XÁC ĐỊNH giống hệt nhau ở mọi dòng —
 * `<số>px` hoặc `minmax(0, <số>fr)`. Đừng đổi `.gt-list` sang `subgrid` để lách:
 * WebView cũ (Zalo) không có subgrid thì toàn bộ bảng sập thành một cột.
 */
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

const root = new URL('../src/', import.meta.url)
const files = []
await collect('')

const offenders = []
let scanned = 0
for (const file of files) {
  const source = await readFile(new URL(file, root), 'utf8')
  for (const template of gridTemplates(source)) {
    scanned += 1
    if (hasAutoTrack(template)) offenders.push(`${file}: "${template}"`)
  }
}

// Chống test xanh giả: bộ quét hỏng (đổi thư mục, đổi cú pháp) thì offenders
// rỗng vì không đọc được gì, chứ không phải vì code sạch.
assert.ok(files.length > 50, `Bộ quét chỉ thấy ${files.length} file trong src/ — nó đang hỏng, không phải code sạch.`)
assert.ok(scanned >= 8, `Chỉ tìm thấy ${scanned} lưới cột — regex đã lệch khỏi cú pháp đang dùng.`)

assert.deepEqual(
  offenders, [],
  `Track \`auto\` làm các dòng lệch cột nhau (mỗi dòng là một grid riêng). Dùng px hoặc minmax(0, Nfr):\n  ${offenders.join('\n  ')}`,
)

// Chốt luôn vài lưới đã sửa, để ai đó "dọn dẹp" bằng cách trả về `auto` thì đỏ.
const admin = await readFile(new URL('pages/AdminPage.tsx', root), 'utf8')
assert.match(admin, /const inventoryStockCols = branchId\s*\n\s*\? 'minmax\(0, 1\.7fr\) minmax\(0, 1fr\) 104px'/,
  'Cột trạng thái của bảng tồn phải cố định bề rộng.')
// Cột "Lượt" của bảng Hao hụt đã bỏ theo yêu cầu; số lượt còn ở tooltip biểu đồ.
assert.match(admin, /<DataList columns="minmax\(0, 1\.5fr\) minmax\(0, 1fr\) 92px">/,
  'Bảng Hao hụt theo kỳ phải còn đúng 3 cột (Kỳ · Chi nhánh · Hao hụt).')
assert.doesNotMatch(admin, /<span className="gt-cell--num" data-gt-label="Số lượt">/,
  'Cột Lượt của bảng Hao hụt đã bỏ — không dựng lại.')

console.log('GT_LIST_NO_AUTO_COLUMN_OK')

async function collect(prefix) {
  for (const entry of await readdir(new URL(prefix, root), { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`
    if (entry.isDirectory()) await collect(`${path}/`)
    else if (/\.tsx?$/.test(entry.name)) files.push(path)
  }
}

/** Lấy chuỗi lưới cột từ `columns="…"` và từ biến gán cho `--gt-cols`. */
function gridTemplates(source) {
  const found = []
  for (const match of source.matchAll(/columns="([^"]+)"/g)) found.push(match[1])
  for (const match of source.matchAll(/const inventoryStockCols = branchId\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) {
    found.push(match[1], match[2])
  }
  return found
}

/** Một track đứng riêng bằng đúng chữ `auto` (không tính `minmax(auto, …)`). */
function hasAutoTrack(template) {
  return template
    .replace(/minmax\([^)]*\)/g, 'T')
    .split(/\s+/)
    .includes('auto')
}
