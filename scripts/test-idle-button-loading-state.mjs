import { readFile } from 'node:fs/promises'

const [styles, inventory, archive, control] = await Promise.all([
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/InventoryPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AttendanceAdjustmentArchive.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ControlCenterPage.tsx', import.meta.url), 'utf8'),
])

const failures = []

const idleDisabledEvidence = [
  inventory.includes('disabled={!availableProducts.length}'),
  archive.includes('disabled={!rows.length}'),
  control.includes('disabled={!reconciliationRows.length}'),
]
if (!idleDisabledEvidence.every(Boolean)) {
  failures.push('Không tái hiện được các nút disabled vì thiếu dữ liệu/điều kiện, không phải vì request đang chạy.')
}

for (const selector of [
  '.primary-button:disabled::before',
  '.secondary-button:disabled::before',
  '.mini-button:disabled::before',
]) {
  if (styles.includes(selector)) {
    failures.push(`${selector} vẫn tự gắn vòng quay cho mọi trạng thái disabled.`)
  }
}

const disabledBlock = sourceBetween(styles, '.primary-button:disabled,', '\n\n.data-table th,')
if (disabledBlock.includes('cursor: progress')) {
  failures.push('Nút disabled nhàn rỗi vẫn dùng con trỏ progress như thể đang tải.')
}
if (!disabledBlock.includes('cursor: not-allowed')) {
  failures.push('Nút disabled chưa có trạng thái con trỏ tĩnh, rõ ràng.')
}

if (failures.length) {
  console.error(failures.map((item) => `FAIL: ${item}`).join('\n'))
  process.exit(1)
}

console.log('IDLE_BUTTON_LOADING_STATE_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
