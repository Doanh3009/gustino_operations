import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [admin, shell, toolbar, styles, dashboard] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/admin/ErpListToolbar.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/admin/DashboardPage.tsx', import.meta.url), 'utf8'),
])

assert.doesNotMatch(shell, /loadCollapsed|sidebar-collapsed|toggleCollapse|onNavigate\('launcher'\)/)
assert.match(toolbar, />Tạo mới<|primaryLabel/)
assert.match(toolbar, /\{onImport && <button type="button" onClick=\{onImport\}>Import/)
assert.match(toolbar, /\{onExport && <button type="button" onClick=\{onExport\}>Export/)
assert.match(toolbar, /\{filters && <details>/)
assert.match(toolbar, /\{onGroup && <button type="button" onClick=\{onGroup\}>Nhóm/)
assert.match(toolbar, /\{onFavorite && <button type="button" onClick=\{onFavorite\}>Yêu thích/)
assert.doesNotMatch(toolbar, /disabled=\{!onImport\}|disabled=\{!onExport\}/)
assert.match(admin, /className="admin-data-table erp-revenue-table"/)
assert.match(admin, /className="rev-branch-list"/)
assert.doesNotMatch(admin, /className="admin-workspace-toolbar"/)
assert.doesNotMatch(admin, /className="rbn-chevron"|top-branch/)
assert.match(admin, /void refresh\(false\)/)
assert.doesNotMatch(admin, /className="rev-day-list"/)
assert.doesNotMatch(admin, /className="rev-day"/)
assert.match(admin, /className="erp-workspace-panel admin-report-section"/)
assert.match(admin, /className="erp-workspace-panel commission-section"/)
// 07/08/2026: panel `payroll-section` (bảng KPI × ngày toàn cục) đã bị gộp vào
// chính section Thi đua — KPI theo ngày nay là thẻ drill-down của từng người.
assert.doesNotMatch(admin, /className="erp-workspace-panel payroll-section"/)
assert.match(admin, /className="erp-workspace-panel admin-requests-workspace"/)
assert.match(styles, /\.erp-workspace-panel\s*\{[\s\S]*border-radius: 0/)
assert.doesNotMatch(styles, /\.admin-workspace-toolbar/)
assert.match(styles, /\.erp-revenue-table th\.num/)
assert.match(styles, /font-family: 'Inter'/)
assert.match(styles, /--green: #89a96b/)
assert.match(styles, /\.primary-button \{ background: #b5dd39/)
assert.match(styles, /\.primary-button:hover \{ background: #89a96b/)
assert.match(styles, /\.management-workspace \.rev-overview-head\s*\{[\s\S]*#fbfdf5/)
assert.match(styles, /\.management-workspace \.rev-branch-list\s*\{[\s\S]*grid-template-columns: repeat\(2/)
assert.doesNotMatch(dashboard, /admin-business-stats/)
assert.match(dashboard, /label="Tổng doanh thu"/)
assert.match(dashboard, /label="Tổng nhân viên"/)
assert.match(dashboard, /label="Số chi nhánh"/)
assert.doesNotMatch(dashboard, /label="Nhân viên thử việc"|label="Thiếu chấm ra"|label="Đơn chờ xử lý"|label="Cảnh báo tồn kho"|label="Ca hoàn thành"|label="Giờ làm việc"/)
assert.match(styles, /\.sidebar-capy-decoration\s*\{[\s\S]*animation: capyFloat/)
assert.match(styles, /\.admin-dashboard-capy\s*\{[\s\S]*animation: capyFloat/)
assert.match(styles, /Mobile Admin: dense ERP rows, not miniature dashboard cards/)
assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.management-workspace \.admin-command-metrics article\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/)

console.log('ADMIN_ERP_WORKSPACES_OK')
