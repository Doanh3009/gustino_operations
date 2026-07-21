import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [manager, orders, styles] = await Promise.all([
  readFile(new URL('../src/pages/ManagerDashboardPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/OrdersPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

const realtimeEffect = sourceBetween(manager, "const refreshWhenActive = () => setReloadTick", "}, [user.authToken, branchKey])")
assert.match(realtimeEffect, /window\.setInterval\(refreshWhenActive, client \? 30000 : 5000\)/, 'Dashboard cloud thiếu nhịp đối chiếu dự phòng khi realtime bị rớt.')
assert.match(realtimeEffect, /window\.addEventListener\('focus', refreshWhenActive\)/, 'Dashboard chưa tải số mới khi quay lại cửa sổ.')
assert.match(realtimeEffect, /document\.addEventListener\('visibilitychange', refreshWhenVisible\)/, 'Dashboard chưa tải số mới khi tab hiện lại.')
assert.match(realtimeEffect, /table: 'sales_receipts'/, 'Dashboard vẫn thiếu subscription hóa đơn doanh thu.')
assert.match(realtimeEffect, /table: 'report_snapshots'/, 'Dashboard vẫn thiếu subscription snapshot báo cáo.')

assert.match(orders, /className="supply-request-list compact"/, 'Danh sách đơn mobile không dùng selector compact được bảo vệ.')
assert.match(orders, /className="supply-request-tail"/, 'Danh sách đơn thiếu vùng trạng thái\/thao tác để chuyển xuống hàng riêng.')
const mobileOrdersCss = sourceBetween(styles, '@media (max-width: 720px) {\n  .orders-page .supply-request-list.compact', '@media (max-width: 380px)')
assert.match(mobileOrdersCss, /grid-template-columns:\s*26px minmax\(0, 1fr\)/, 'Đơn mobile vẫn giữ ba cột làm nội dung bị ép thành chữ dọc.')
assert.match(mobileOrdersCss, /\.supply-request-tail[\s\S]*?grid-column:\s*1 \/ -1/, 'Trạng thái\/nút đơn mobile chưa xuống một hàng đủ rộng.')
assert.match(mobileOrdersCss, /word-break:\s*normal[\s\S]*?overflow-wrap:\s*break-word/, 'Tên hàng mobile vẫn có thể bị bẻ dọc từng ký tự.')

console.log('DASHBOARD_ORDERS_MOBILE_RECOVERY_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
