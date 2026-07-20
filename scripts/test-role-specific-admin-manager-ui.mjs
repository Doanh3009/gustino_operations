import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, shell, styles, html] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
])

const adminNav = shell.slice(shell.indexOf('const ADMIN_NAV'), shell.indexOf('const MANAGER_NAV'))
const managerNav = shell.slice(shell.indexOf('const MANAGER_NAV'), shell.indexOf('const NAV_ITEMS'))

assert.match(adminNav, /section: 'overview'/)
assert.match(adminNav, /section: 'revenue'/)
assert.doesNotMatch(adminNav, /manager-business|manager-inventory/)
assert.match(managerNav, /id: 'dashboard'/)
assert.match(managerNav, /id: 'manager-business'/)
assert.match(managerNav, /id: 'manager-inventory'/)
assert.match(managerNav, /id: 'report-archive'[^}\n]+label: 'Báo cáo ngày'/)
assert.doesNotMatch(managerNav, /section: 'accounts'|section: 'attendance'/)
assert.match(shell, /user\.role === 'admin'[\s\S]*ADMIN_NAV/)
assert.match(shell, /user\.role === 'manager'[\s\S]*MANAGER_NAV/)
assert.match(shell, /user\.role === 'manager' \? ' legacy-manager-workspace'/)

assert.match(app, /const ManagerDashboardPage = lazyWithReload/)
assert.match(app, /page === 'dashboard' && user\.role === 'manager'/)
assert.match(app, /if \(page === 'dashboard'\) return user\.role === 'manager'/)
assert.match(app, /if \(page === 'management'\) return user\.role === 'admin'/)
assert.match(app, /if \(user\.role === 'admin'\) return 'management'/)
assert.match(app, /if \(user\.role === 'manager'\) return 'dashboard'/)
assert.doesNotMatch(app, /\]\.includes\(candidate\)\) return 'management'/)

assert.match(styles, /\.management-workspace \.admin-filter-bar\s*\{[\s\S]*position: static/)
assert.match(styles, /\.legacy-manager-workspace \.app-sidebar\s*\{[\s\S]*linear-gradient/)
assert.match(styles, /\.legacy-manager-workspace \.crm-desktop-header\s*\{[\s\S]*display: none/)
assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.mobile-header\s*\{[\s\S]*position: relative !important/)
assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.app-main,[\s\S]*padding-top: 0 !important/)
assert.doesNotMatch(html, /rel="preload"[^>]+capy-attendance-camera/)

console.log('ROLE_SPECIFIC_ADMIN_MANAGER_UI_OK')
