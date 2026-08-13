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
// Doanh thu sau redesign (§21–§28): bảng theo ngày và danh sách hóa đơn không
// còn nằm ở màn chính, chúng chuyển vào drawer — nhưng phải còn nguyên.
assert.match(admin, /Doanh thu theo ngày \(\$\{periodRevenueRows\.length\}\)/)
assert.match(admin, /periodRevenueRows\.map\(\(snap\) => \(/)
assert.match(admin, /snap\.grade/)
assert.match(admin, /Đã chốt/)
assert.match(admin, /Tạm tính/)
// Hiệu quả chi nhánh giữ lại, nhưng dưới dạng thanh xếp hạng thay cho lưới thẻ.
assert.match(admin, /const revenueBranchRows = useMemo/)
assert.match(admin, /<RankBar/)
assert.doesNotMatch(admin, /className="admin-workspace-toolbar"/)
assert.doesNotMatch(admin, /className="rbn-chevron"|top-branch/)
assert.match(admin, /void refresh\(false\)/)
assert.doesNotMatch(admin, /className="rev-day-list"/)
assert.doesNotMatch(admin, /className="rev-day"/)
assert.match(admin, /className="erp-workspace-panel commission-section"/)
// 07/08/2026: panel `payroll-section` (bảng KPI × ngày toàn cục) đã bị gộp vào
// chính section Thi đua — KPI theo ngày nay là thẻ drill-down của từng người.
assert.doesNotMatch(admin, /className="erp-workspace-panel payroll-section"/)
assert.match(admin, /className="erp-workspace-panel admin-requests-workspace"/)
assert.match(styles, /\.erp-workspace-panel\s*\{[\s\S]*border-radius: 0/)
assert.doesNotMatch(styles, /\.admin-workspace-toolbar/)
assert.match(styles, /font-family: 'Inter'/)
assert.match(styles, /--green: #89a96b/)
assert.match(styles, /\.primary-button \{ background: #b5dd39/)
assert.match(styles, /\.primary-button:hover \{ background: #89a96b/)

// Tổng quan là control center của HÔM NAY (§12–§14): mỗi metric phải có ý nghĩa
// vận hành. "Tổng nhân viên" và "Số chi nhánh" đứng trơ không còn là KPI lớn.
assert.doesNotMatch(dashboard, /admin-business-stats/)
assert.match(dashboard, /label=\{isToday \? 'Doanh thu hôm nay' : 'Doanh thu'\}/)
assert.match(dashboard, /label="Đơn hàng"/)
assert.match(dashboard, /label="Tiến độ KPI"/)
assert.match(dashboard, /label="Chi nhánh"/)
assert.match(dashboard, /hoạt động/)
assert.doesNotMatch(dashboard, /label="Tổng nhân viên"|label="Nhân viên thử việc"|label="Thiếu chấm ra"|label="Đơn chờ xử lý"|label="Cảnh báo tồn kho"|label="Ca hoàn thành"|label="Giờ làm việc"/)
assert.match(styles, /\.sidebar-capy-decoration\s*\{[\s\S]*animation: capyFloat/)
assert.match(styles, /Mobile Admin: dense ERP rows, not miniature dashboard cards/)

// Design system mới phải được nạp và có bộ token spacing dùng chung (§80).
const ui = await readFile(new URL('../src/ui.css', import.meta.url), 'utf8')
assert.match(styles, /@import '\.\/ui\.css'/)
assert.match(ui, /--gt-4: 16px/)
assert.match(ui, /\.gt-surface/)
assert.match(ui, /\.gt-metrics/)

console.log('ADMIN_ERP_WORKSPACES_OK')
