import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, shell, orders, report, toolbar, styles] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/OrdersPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/admin/ErpListToolbar.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

// Hai khẳng định dưới đây đã đổi so với bản cũ: admin KHÔNG còn vào trang lập phiếu đặt
// hàng của chi nhánh nữa, mà theo dõi/lọc/xuất đơn ở mục requests của trang Quản trị.
// Hợp đồng đầy đủ của hành vi mới nằm ở scripts/test-admin-orders-readonly.mjs.
assert.match(shell, /section: 'requests', label: 'Đơn hàng'/)
assert.match(app, /if \(page === 'orders'\) return user\.role !== 'admin' && \(canUseManagement\(user\.role\) \|\| canUseOperations\(user\.role\)\)/)
assert.match(app, /\{page === 'orders' && <OrdersPage/)
assert.match(orders, /table: 'supply_requests'/)
assert.match(orders, /filter: `branch_id=eq\.\$\{user\.branchId\}`/)
assert.match(orders, /window\.setInterval\(refreshSilently, 30000\)/)
assert.match(orders, /window\.addEventListener\('focus', refreshSilently\)/)
assert.match(orders, /void refresh\(false\)/)
assert.match(report, /className="secondary-button report-backup-image-button"/)
assert.match(report, />\s*Lưu ảnh\s*<\/button>/)
assert.match(report, /onClick=\{\(\) => void exportInfographicImage\(\)\}/)
assert.doesNotMatch(toolbar, /<button type="button">Nhóm<\/button>|<button type="button">Yêu thích<\/button>/)
assert.doesNotMatch(styles, /\.admin-workspace-toolbar/)
assert.doesNotMatch(shell, /section: 'requests', label: 'Nhập hàng'/)
assert.match(orders, /table: 'supply_requests'/)

console.log('ADMIN_ACTIONS_AND_REPORT_BACKUP_OK')
