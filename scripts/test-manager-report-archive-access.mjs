import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, shell, archive, policy] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ReportArchivePage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260629_branchless_manager_kitchen.sql', import.meta.url), 'utf8'),
])

const managerNav = shell.slice(shell.indexOf('const MANAGER_NAV'), shell.indexOf('const NAV_ITEMS'))

assert.match(
  managerNav,
  // 13/08/2026: MANAGER_NAV chỉ dành cho vai trò `manager` nên không cần lọc
  // lại quyền trong `canShow` — nhưng mục Báo cáo ngày phải còn.
  /id: 'report-archive'[^}\n]+label: 'Báo cáo ngày'/,
  'Menu Quản lý phải hiển thị Báo cáo ngày theo đúng quyền đọc hiện có',
)
assert.match(
  app,
  /if \(page === 'report-archive'\) return canUseManagement\(user\.role\)/,
  'Route Báo cáo ngày phải cho cả Admin và Quản lý truy cập',
)
assert.match(
  archive,
  /user\.role === 'admin' \|\| user\.role === 'manager'/,
  'Báo cáo ngày phải giữ bộ lọc chi nhánh dành cho tài khoản Quản lý',
)
assert.match(
  policy,
  /\(public\.current_profile\(\)\)\.role in \('admin', 'manager'\)/,
  'RLS hiện hành phải xác nhận Quản lý có quyền đọc dữ liệu chi nhánh',
)

console.log('MANAGER_REPORT_ARCHIVE_ACCESS_OK')
