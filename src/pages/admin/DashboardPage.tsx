import { roleLabel } from '../../lib/access'
import type { ActiveUserSession } from '../../types'

interface ArchiveRow {
  id: string
  type: string
  date: string
  branchId: string
  detail: string
}

interface WasteRow {
  branchId: string
  productId: string
  productName: string
  count: number
  quantity: number
  unit: string
}

interface Props {
  from: string
  to: string
  branchCount: number
  revenue: number
  employeeCount: number
  activeUsers: ActiveUserSession[]
  showActiveUsers: boolean
  archiveRows: ArchiveRow[]
  wasteRows: WasteRow[]
  branchName: (branchId: string) => string
}

export function DashboardPage(props: Props) {
  const {
    from, to, branchCount, revenue, employeeCount, activeUsers, showActiveUsers,
    archiveRows, wasteRows,
    branchName,
  } = props
  return (
    <section className="admin-module-page admin-dashboard-page">
      <header className="admin-module-header">
        <div><span>Tổng quan</span><h2>Tình hình vận hành</h2><p>{formatDate(from)} → {formatDate(to)} · {branchCount} chi nhánh</p></div>
        <img className="admin-dashboard-capy" src="/mascots/capy-loading-4.png" alt="" aria-hidden="true" />
      </header>
      <div className="admin-command-metrics">
        <Metric label="Tổng doanh thu" value={formatMoney(revenue)} hint="Trong khoảng đang chọn" />
        <Metric label="Tổng nhân viên" value={employeeCount.toLocaleString('vi-VN')} hint="Nhân sự đang hoạt động" />
        <Metric label="Số chi nhánh" value={branchCount.toLocaleString('vi-VN')} hint="Trong phạm vi quản lý" />
      </div>
      <div className="admin-report-grid">
        <section className="section-card">
          <div className="section-title"><div><span className="eyebrow dark">HOẠT ĐỘNG</span><h2>Lịch sử gần đây</h2></div><span className="date-chip">{archiveRows.length} bản ghi</span></div>
          <div className="admin-archive-list">
            {archiveRows.slice(0, 30).map((row) => <article key={`${row.type}-${row.id}`}><time>{formatDate(row.date)}</time><span><strong>{row.type}</strong><small>{branchName(row.branchId)} · {row.detail}</small></span><b>ĐÃ LƯU</b></article>)}
            {!archiveRows.length && <p className="empty-copy">Chưa có hoạt động trong khoảng đang chọn.</p>}
          </div>
        </section>
        <section className="section-card admin-waste-report">
          <div className="section-title"><div><span className="eyebrow dark">CẢNH BÁO</span><h2>Hao hụt hàng hóa</h2></div><span className="date-chip">{wasteRows.length} mặt hàng</span></div>
          <div className="admin-waste-list">
            {wasteRows.map((row) => <article key={`${row.branchId}-${row.productId}`}><span><strong>{row.productName}</strong><small>{branchName(row.branchId)} · {row.count} lượt ghi nhận</small></span><b>{formatNumber(row.quantity)} {row.unit}</b></article>)}
            {!wasteRows.length && <p className="empty-copy">Không có hao hụt trong khoảng đang chọn.</p>}
          </div>
        </section>
      </div>
      {showActiveUsers && <section className="section-card active-users-panel">
        <div className="section-title"><div><span className="eyebrow dark">ONLINE</span><h2>Người đang truy cập</h2></div><span className="date-chip">{activeUsers.length} online</span></div>
        <div className="active-user-list">
          {activeUsers.map((session) => <article key={session.userId}><span><strong>{session.userName}</strong><small>{roleLabel(session.role)} · {branchName(session.branchId)} · {session.page || 'app'}</small></span><time>{new Date(session.lastSeenAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</time></article>)}
          {!activeUsers.length && <p className="empty-copy">Chưa có phiên truy cập trong 2 phút gần đây.</p>}
        </div>
      </section>}
    </section>
  )
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <article><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-')
  return day && month && year ? `${day}/${month}/${year}` : value
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value)
}
