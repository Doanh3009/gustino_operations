import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

const mobileBlock = sourceBetween(styles, '  .section-title {\n    display', '  .eyebrow {')
assert.ok(mobileBlock, 'Không tìm thấy block mobile chứa .section-title.')

const sectionTitle = sourceBetween(mobileBlock, '.section-title {', '}')
assert.match(sectionTitle, /display:\s*flex/, '.section-title mobile phải dùng flex-wrap; grid "1fr auto" bóp tiêu đề thành chữ dọc khi cụm nút bên phải rộng.')
assert.match(sectionTitle, /flex-wrap:\s*wrap/, '.section-title mobile thiếu flex-wrap nên cụm nút không rơi xuống hàng dưới được.')
assert.doesNotMatch(sectionTitle, /grid-template-columns/, '.section-title mobile không được quay lại grid cột cố định.')

const titleColumn = sourceBetween(mobileBlock, '.section-title > div:first-child {', '}')
assert.match(titleColumn, /flex:\s*1 1 180px/, 'Cột tiêu đề cần giữ basis 180px để không tụt về min-content (1 ký tự).')

const actions = sourceBetween(mobileBlock, '.section-title > .section-actions {', '}')
assert.match(actions, /max-width:\s*100%/, 'Cụm nút phải giới hạn trong bề ngang màn hình.')

const heading = sourceBetween(mobileBlock, '.section-title h2 {', '}')
assert.match(heading, /overflow-wrap:\s*normal\s*!important/, 'Tiêu đề mobile không được dùng anywhere vì nó hạ min-content về một ký tự.')
assert.match(heading, /writing-mode:\s*horizontal-tb/, 'Tiêu đề phải luôn giữ hướng chữ ngang.')

const eyebrow = sourceBetween(mobileBlock, '.section-title .eyebrow {', '}')
assert.match(eyebrow, /overflow-wrap:\s*normal\s*!important/, 'Nhãn KPI/Doanh thu không được ngắt tùy ý theo từng ký tự.')
assert.match(eyebrow, /writing-mode:\s*horizontal-tb/, 'Nhãn KPI/Doanh thu phải luôn giữ hướng chữ ngang.')

console.log('SECTION_TITLE_MOBILE_WRAP_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  if (start < 0) return ''
  const end = source.indexOf(endMarker, start + startMarker.length)
  return source.slice(start, end >= 0 ? end : undefined)
}
