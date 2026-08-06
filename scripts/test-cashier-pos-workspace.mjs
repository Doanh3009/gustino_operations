import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [types, access, app, shell, sales, salesLib, admin, edge, migration, styles] = await Promise.all([
  readFile(new URL('../src/types.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/access.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/SalesPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/salesReceipts.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/manage-employee/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260718_cashier_pos.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

assert.match(types, /'cashier'/)
assert.match(access, /\['shift_leader', 'staff', 'cashier'\]/)
assert.match(app, /user\.role === 'staff' \|\| user\.role === 'cashier'/)
assert.match(app, /user\.role !== 'cashier'/)
assert.match(app, /adminRouteForSection\(nextSection!\)/)
assert.match(app, /managementSectionFromHash/)
assert.match(app, /window\.history\.pushState/)
assert.doesNotMatch(app, /\]\.includes\(candidate\)\) return 'management'/)
assert.match(shell, /section: 'overview'/)
assert.match(shell, /section: 'accounts'/)
assert.doesNotMatch(shell.slice(shell.indexOf('const ADMIN_NAV'), shell.indexOf('const MANAGER_NAV')), /manager-business|manager-inventory|admin-accounts/)
assert.match(shell.slice(shell.indexOf('const MANAGER_NAV'), shell.indexOf('const NAV_ITEMS')), /manager-business/)
assert.match(shell.slice(shell.indexOf('const MANAGER_NAV'), shell.indexOf('const NAV_ITEMS')), /manager-inventory/)
assert.match(admin, /Thu ngân POS/)
assert.match(edge, /'staff', 'cashier', 'kitchen'/)
assert.match(migration, /alter type public\.app_role add value if not exists 'cashier'/)
assert.match(migration, /pg_advisory_xact_lock/)
assert.match(migration, /actor\.role in \('cashier', 'staff'\)/)
assert.match(salesLib, /create_cashier_pos_receipt/)
assert.doesNotMatch(salesLib, /\.from\('sales_receipts'\)\.insert/)
// Nghiệp vụ 2026-07-27: nhân viên KHÔNG thu tiền — màn POS không được có ô nhập
// tiền/phương thức thanh toán; nút chốt là "Xác nhận bán hàng".
assert.doesNotMatch(sales, /Khách đưa/)
assert.doesNotMatch(sales, /Tiền thừa/)
assert.doesNotMatch(sales, /Chuyển khoản QR/)
assert.doesNotMatch(sales, /pos-payment-panel/)
assert.match(sales, /Xác nhận bán hàng/)
assert.match(sales, /pendingReceiptIdRef/)
assert.match(sales, /In hóa đơn/)
assert.match(styles, /body\.printing-pos-receipt/)
assert.match(shell, /management-workspace/)
assert.match(shell, /pos-workspace/)
assert.match(styles, /Unified management\/POS visual system/)
assert.match(styles, /\.management-workspace \.management-function-detail/)
assert.match(styles, /\.pos-workspace \.checkout-button/)
assert.match(admin, /if \(section === 'overview'\) return new Set<ManagementDataKey>\(ALL_MANAGEMENT_DATA\)/)
assert.doesNotMatch(admin, /if \(!focused \|\| section === 'overview'\)/)

console.log('CASHIER_POS_WORKSPACE_OK')
