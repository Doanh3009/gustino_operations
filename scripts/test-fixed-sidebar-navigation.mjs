import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [shell, sidebar, styles, app] = await Promise.all([
  readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/sidebar.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
])

assert.doesNotMatch(shell, /<nav className="mobile-nav"/)
assert.match(shell, /className="mh-menu-toggle"/)
assert.match(shell, /className="crm-desktop-header"/)
assert.doesNotMatch(shell, /className="crm-header-branch"/)
assert.doesNotMatch(shell, /className="crm-header-language"/)
assert.doesNotMatch(shell, /className="crm-header-notification"/)
assert.match(shell, /className="crm-header-account"/)
assert.doesNotMatch(shell, /<div className="sidebar-user">/)
assert.doesNotMatch(shell, /loadCollapsed|saveCollapsed|sidebar-collapsed|toggleCollapse|IconChevron/)
assert.match(shell, /mobile-sidebar-open/)
assert.match(shell, /setSidebarOpen\(false\); onNavigate\(item\.id, item\.section\)/)
assert.match(shell, /section: 'accounts', label: 'Nhân sự'/)
assert.match(shell, /section: 'attendance', label: 'Chấm công'/)
assert.match(shell, /section: 'commission', label: 'KPI nhân viên'/)
assert.match(shell, /section: 'payroll', label: 'Lương'/)
assert.match(shell, /id: 'control', label: 'Cài đặt'/)
assert.match(shell, /user\.role === 'admin'[\s\S]*ADMIN_NAV/)
assert.match(shell, /user\.role === 'manager'[\s\S]*MANAGER_NAV/)
assert.match(shell, /legacy-manager-workspace/)
assert.match(styles, /\.app-sidebar,[\s\S]*width: 252px/)
assert.match(styles, /Fixed ERP desktop system/)
assert.match(styles, /\.sidebar-nav-item\.active::before/)
assert.match(styles, /\.app-main \{[\s\S]*margin-left: 252px/)
assert.match(styles, /\.mobile-nav \{ display: none !important; \}/)
assert.match(styles, /@media \(min-width: 641px\) and \(max-width: 1024px\)[\s\S]*\.app-sidebar \{ display: flex !important; \}/)
assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.mobile-sidebar-open \.app-sidebar \{ transform: translateX\(0\); \}/)
assert.match(app, /currentSection=\{mgmtSection\}/)
assert.match(app, /ManagerDashboardPage/)
assert.doesNotMatch(styles, /\.legacy-manager-workspace \.app-sidebar\s*\{/, 'Manager phải dùng cùng sidebar sáng, không có khối màu riêng theo role.')
assert.match(styles, /\.app-sidebar\s*\{[^}]*background:\s*#fff;/, 'Sidebar dùng chung phải giữ nền trắng.')
assert.match(sidebar, /\.app-main \{[\s\S]*min-height: 100vh/)

console.log('FIXED_SIDEBAR_NAVIGATION_OK')
