import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

const srcRoot = new URL('../src/', import.meta.url)
const sourceFiles = await collectSourceFiles(srcRoot)
const sources = await Promise.all(sourceFiles.map(async (file) => [file, await readFile(file, 'utf8')]))
const combined = sources.map(([, source]) => source).join('\n')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
const sidebar = await readFile(new URL('../src/sidebar.css', import.meta.url), 'utf8')

assert.doesNotMatch(combined, /writing-mode\s*:\s*vertical-(?:rl|lr)/i, 'Source không được xoay chữ sang writing-mode dọc.')
assert.doesNotMatch(combined, /writingMode\s*:\s*['"]vertical-(?:rl|lr)['"]/i, 'Inline style không được xoay chữ sang writing-mode dọc.')
assert.doesNotMatch(combined, /word-break\s*:\s*break-all/i, 'break-all có thể bẻ tiếng Việt thành cột từng ký tự.')

const writingModes = [...combined.matchAll(/writing-mode\s*:\s*([^;\n}]+)/gi)].map((match) => match[1].trim())
assert.ok(writingModes.length >= 2, 'Audit phải tìm thấy các khóa hướng chữ ngang hiện có.')
assert.ok(writingModes.every((value) => value === 'horizontal-tb'), `Có writing-mode không an toàn: ${writingModes.join(', ')}`)

const mobileTitle = sourceBetween(styles, '  .section-title {\n    display', '  .eyebrow {')
assert.match(mobileTitle, /\.section-title\s*\{[\s\S]*display:\s*flex\s*!important;[\s\S]*flex-wrap:\s*wrap\s*!important;/)
assert.match(mobileTitle, /\.section-title > div:first-child\s*\{[\s\S]*flex:\s*1 1 180px;/)
assert.match(mobileTitle, /\.section-title h2\s*\{[\s\S]*overflow-wrap:\s*normal\s*!important;[\s\S]*writing-mode:\s*horizontal-tb;/)
assert.match(mobileTitle, /\.section-title \.eyebrow\s*\{[\s\S]*overflow-wrap:\s*normal\s*!important;[\s\S]*writing-mode:\s*horizontal-tb;/)

assert.match(sidebar, /\.sidebar-nav-item\s*\{[^}]*white-space:\s*nowrap;/s, 'Nhãn điều hướng phải giữ theo hàng ngang.')
assert.match(styles, /@media \(max-width: 980px\)\s*\{[\s\S]*?\.manager-kpi-grid,[\s\S]*?grid-template-columns:\s*1fr;/, 'KPI Manager phải về một cột trước khi bị ép hẹp.')
assert.match(styles, /\.orders-page \.supply-request-list\.compact \.supply-request-item\s*\{[^}]*grid-template-columns:\s*26px minmax\(0, 1fr\);/s, 'Dòng đơn hàng mobile phải đưa trạng thái/hành động xuống hàng riêng.')

console.log(`SITEWIDE_HORIZONTAL_TEXT_AUDIT_OK (${sourceFiles.length} source files)`)

async function collectSourceFiles(rootUrl) {
  const rootPath = rootUrl.pathname.startsWith('/') && /^[A-Za-z]:/.test(rootUrl.pathname.slice(1))
    ? decodeURIComponent(rootUrl.pathname.slice(1))
    : decodeURIComponent(rootUrl.pathname)
  const output = []
  const pending = [rootPath]
  while (pending.length) {
    const directory = pending.pop()
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (['.css', '.ts', '.tsx'].includes(extname(entry.name))) output.push(path)
    }
  }
  return output.sort()
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  if (start < 0) return ''
  const end = source.indexOf(endMarker, start + startMarker.length)
  return source.slice(start, end >= 0 ? end : undefined)
}
