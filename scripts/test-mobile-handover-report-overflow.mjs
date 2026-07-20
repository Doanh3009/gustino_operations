import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [handover, styles] = await Promise.all([
  readFile(new URL('../src/pages/ShiftHandoverPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

assert.match(
  handover,
  /className="handover-heading-actions"/,
  'Nhóm trạng thái/nút đầu trang Bàn giao cần class responsive riêng.',
)
assert.match(
  styles,
  /@media \(max-width: 430px\)[\s\S]*?\.handover-heading-actions\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
  'Nút Bàn giao phải xếp một cột ở điện thoại hẹp.',
)
assert.match(
  styles,
  /\.report-page,[\s\S]*?\.rp-stage\s*\{[\s\S]*?max-width:\s*100%[\s\S]*?overflow-x:\s*(?:hidden|clip)/,
  'Khung báo cáo và stage phải khóa tràn ngang.',
)
assert.match(
  styles,
  /@media \(max-width: 480px\)[\s\S]*?\.report-essential-actions\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
  'Thanh nút báo cáo phải xếp một cột ở điện thoại.',
)
assert.match(
  styles,
  /@media \(max-width: 430px\)[\s\S]*?\.rp-poster\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
  'Poster trên màn hình điện thoại phải dùng một cột để không ép nội dung.',
)
assert.match(
  styles,
  /\.rp-n8n-poster-stage\s*\{[\s\S]*?left:\s*-10000px/,
  'Poster n8n 1080px phải nằm hoàn toàn ngoài viewport hẹp.',
)
assert.match(
  styles,
  /\.rp-export-frame\s*\{[\s\S]*?left:\s*-10000px/,
  'Khung xuất ảnh 1080px phải nằm hoàn toàn ngoài viewport hẹp.',
)

console.log('MOBILE_HANDOVER_REPORT_OVERFLOW_OK')
