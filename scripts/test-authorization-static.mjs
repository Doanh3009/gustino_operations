import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8')
const matrix = readFileSync(new URL('./qa-permission-matrix.mjs', import.meta.url), 'utf8')

const quoted = (text) => [...text.matchAll(/'([^']+)'/g)].map((match) => match[1])
const uniqueSorted = (values) => [...new Set(values)].sort()

function between(text, start, end) {
  const startIndex = text.indexOf(start)
  const endIndex = text.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `Không tìm thấy mốc bắt đầu: ${start}`)
  assert.notEqual(endIndex, -1, `Không tìm thấy mốc kết thúc: ${end}`)
  return text.slice(startIndex, endIndex)
}

const pageType = uniqueSorted(quoted(between(shell, 'export type Page =', 'export type InventoryTab')))
const pageFromHash = between(app, 'function pageFromHash()', 'export default App')
const hashRoutes = uniqueSorted(quoted(between(pageFromHash, 'return [', '].includes(candidate)')))

const renderBlock = between(app, "if (page === 'launcher')", 'function pageFromHash()')
const renderedPages = uniqueSorted([...renderBlock.matchAll(/page === '([^']+)'/g)].map((match) => match[1]))

const managerSections = quoted(between(matrix, 'const managerSections =', ']'))
const matrixBlock = between(matrix, 'const allPages =', ']')
const matrixPages = uniqueSorted([
  ...quoted(matrixBlock),
  ...(matrixBlock.includes('...managerSections') ? managerSections : []),
])

assert.deepEqual(hashRoutes, pageType, 'Page union và pageFromHash không đồng bộ')
assert.deepEqual(renderedPages, pageType, 'Có Page không có render branch hoặc render branch không thuộc Page')
assert.deepEqual(matrixPages, pageType, 'Permission matrix chưa bao phủ toàn bộ Page')
assert.match(
  matrix,
  /page === 'manager-attendance'[^\n]+page === 'manager-payroll'[^\n]+page === 'manager-requests'[^\n]+return canUseAdmin\(role\)/,
  'Permission matrix chưa đồng bộ ba route admin-only hiện tại với App/AppShell',
)

console.log(`AUTH_STATIC_OK (${pageType.length} routes đồng bộ qua type/hash/render/matrix)`)
