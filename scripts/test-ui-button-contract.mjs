import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = new URL('../src/', import.meta.url)

async function findSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return findSourceFiles(target)
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [target] : []
  }))
  return nested.flat()
}

function resolveImport(fromFile, specifier, sourceFiles) {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
  return candidates.find((candidate) => sourceFiles.has(path.normalize(candidate))) || null
}

function attr(node, name) {
  return node.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.text === name)
}

function attrText(attribute, source) {
  if (!attribute?.initializer) return attribute ? 'true' : ''
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text
  if (ts.isJsxExpression(attribute.initializer)) return attribute.initializer.expression?.getText(source) || ''
  return attribute.initializer.getText(source)
}

function tagName(node) {
  return node.tagName.getText()
}

function ancestorElement(node, name) {
  let current = node.parent
  while (current) {
    if ((ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) && tagName(ts.isJsxElement(current) ? current.openingElement : current) === name) {
      return ts.isJsxElement(current) ? current.openingElement : current
    }
    current = current.parent
  }
  return null
}

function labelOf(node, source) {
  const fullNode = ts.isJsxElement(node.parent) ? node.parent : node
  const raw = fullNode.getText(source)
    .replace(/<button\b[^>]*>/i, '')
    .replace(/<\/button>\s*$/i, '')
    .replace(/\{[^{}]{0,160}\}/g, '{…}')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return raw.slice(0, 100) || '(không có nhãn tĩnh)'
}

const sourceRoot = fileURLToPath(root)
const sourceFileList = await findSourceFiles(sourceRoot)
const sourceFiles = new Set(sourceFileList.map((file) => path.normalize(file)))
const importGraph = new Map()
for (const file of sourceFileList) {
  const content = await readFile(file, 'utf8')
  const specifiers = [
    ...content.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
    ...content.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((match) => match[1])
  importGraph.set(path.normalize(file), specifiers.map((specifier) => resolveImport(file, specifier, sourceFiles)).filter(Boolean))
}
const reachableFiles = new Set()
const pendingFiles = [path.normalize(path.join(sourceRoot, 'App.tsx'))]
while (pendingFiles.length) {
  const file = pendingFiles.pop()
  if (!file || reachableFiles.has(file)) continue
  reachableFiles.add(file)
  pendingFiles.push(...(importGraph.get(file) || []))
}
const files = sourceFileList.filter((file) => file.endsWith('.tsx'))
const rows = []

for (const file of files.sort()) {
  const content = await readFile(file, 'utf8')
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function walk(node) {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null
    if (opening && tagName(opening) === 'button') {
      const position = source.getLineAndCharacterOfPosition(opening.getStart(source))
      const onClick = attr(opening, 'onClick')
      const disabled = attr(opening, 'disabled')
      const type = attrText(attr(opening, 'type'), source)
      const form = ancestorElement(opening, 'form')
      const formOnSubmit = form ? attrText(attr(form, 'onSubmit'), source) : ''
      const clickText = attrText(onClick, source)
      const issues = []
      if (!onClick && !form && type !== 'submit') issues.push('no-action')
      if (!onClick && form && !formOnSubmit) issues.push('submit-form-without-handler')
      if (type === 'submit' && !form && !attr(opening, 'form')) issues.push('submit-outside-form')
      if (onClick && form && !type) issues.push('implicit-submit-with-click')
      if (onClick && (/=>\s*\{\s*\}/.test(clickText) || clickText === 'undefined' || clickText === 'null')) issues.push('noop-click')
      if (disabled && ['true', '{true}'].includes(attrText(disabled, source))) issues.push('always-disabled')
      rows.push({
        file: path.relative(sourceRoot, file).replaceAll('\\', '/'),
        line: position.line + 1,
        label: labelOf(opening, source),
        type: type || (form ? 'implicit-submit' : 'button-default'),
        onClick: clickText || '',
        disabled: attrText(disabled, source),
        reachable: reachableFiles.has(path.normalize(file)),
        issues,
      })
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
}

const suspicious = rows.filter((row) => row.issues.length)
const grouped = Object.groupBy(rows, (row) => row.file)
console.log(`UI_BUTTON_TOTAL ${rows.length}`)
console.log(`UI_BUTTON_REACHABLE ${rows.filter((row) => row.reachable).length}`)
console.log(`UI_BUTTON_DEAD_SOURCE ${rows.filter((row) => !row.reachable).length}`)
for (const [file, fileRows] of Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`UI_BUTTON_FILE ${file} ${fileRows.length}`)
}
for (const row of suspicious) {
  console.log(`UI_BUTTON_REVIEW ${row.file}:${row.line} [${row.issues.join(',')}] ${row.label}`)
}
if (process.argv.includes('--list')) {
  for (const row of rows) {
    console.log(`UI_BUTTON ${row.file}:${row.line} reachable=${row.reachable} type=${row.type} click=${row.onClick || '(form submit)'} disabled=${row.disabled || '-'} label=${row.label}`)
  }
}

assert.equal(
  suspicious.length,
  0,
  `Có ${suspicious.length} nút cần kiểm tra handler/form trước khi có thể xác nhận hợp đồng UI.`,
)
console.log('UI_BUTTON_CONTRACT_OK')
