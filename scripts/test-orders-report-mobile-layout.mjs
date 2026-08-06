import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [orders, styles] = await Promise.all([
  readFile(new URL('../src/pages/OrdersPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

for (const label of ['STT', 'Tên hàng', 'Số lượng', 'Ngày đặt / nhận', 'Trạng thái', 'Người đặt']) {
  assert.match(
    orders,
    new RegExp(`data-label=["']${escapeRegExp(label)}["']`),
    `Phiếu đặt hàng thiếu nhãn mobile "${label}".`,
  )
}

const mobileReportCss = sourceBetween(
  styles,
  '/* Mobile order report: readable label-value cards; keep the 1080px export table intact. */',
  '/* End mobile order report. */',
)

assert.ok(mobileReportCss, 'Không tìm thấy hợp đồng responsive riêng cho phiếu đặt hàng mobile.')
assert.match(mobileReportCss, /:not\(\.order-report-sheet-export\)/, 'CSS mobile phải loại trừ khung xuất ảnh 1080px.')
assert.match(mobileReportCss, /\.order-report-table thead\s*\{[^}]*display:\s*none/s, 'Header bảng 6 cột vẫn chiếm ngang trên mobile.')
assert.match(mobileReportCss, /\.order-report-table tr\s*\{[^}]*display:\s*grid/s, 'Mỗi đơn trong phiếu mobile chưa chuyển thành một khối dễ đọc.')
assert.match(mobileReportCss, /\.order-report-table td\s*\{[^}]*grid-template-columns:\s*minmax\(76px,\s*\.42fr\) minmax\(0,\s*1fr\)/s, 'Ô dữ liệu mobile chưa dành bề ngang ổn định cho nhãn và nội dung.')
assert.match(mobileReportCss, /\.order-report-table td::before\s*\{[^}]*content:\s*attr\(data-label\)/s, 'Phiếu mobile chưa hiển thị nhãn của từng trường.')
assert.match(mobileReportCss, /word-break:\s*normal\s*!important;[\s\S]*overflow-wrap:\s*break-word\s*!important;[\s\S]*writing-mode:\s*horizontal-tb/s, 'Nội dung phiếu mobile vẫn có thể bị bẻ thành chữ dọc.')
assert.match(mobileReportCss, /td\.num\s*\{[^}]*white-space:\s*normal\s*!important/s, 'Số lượng mobile vẫn bị khóa trên một dòng và có thể bóp các cột khác.')

console.log('ORDERS_REPORT_MOBILE_LAYOUT_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  if (start < 0) return ''
  const end = source.indexOf(endMarker, start + startMarker.length)
  return source.slice(start, end >= 0 ? end : undefined)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
