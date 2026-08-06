import { roleLabel } from '../../lib/access'
import { formatQuantity } from '../../lib/inventoryEntry'
import type { SalesReceipt } from '../../lib/salesReceipts'
import type { ActiveUserSession } from '../../types'

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
  recentBills: SalesReceipt[]
  wasteRows: WasteRow[]
  branchName: (branchId: string) => string
}

export function DashboardPage(props: Props) {
  const {
    from, to, branchCount, revenue, employeeCount, activeUsers, showActiveUsers,
    recentBills, wasteRows,
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
      <a className="admin-competition-shortcut" href="#/admin/sales-performance">
        <span><small>KPI & XẾP HẠNG</small><strong>Thi đua nhân viên</strong><em>Xem theo ngày, theo tháng, vai trò và chi nhánh.</em></span>
        <b>Xem bảng thi đua →</b>
      </a>
      <div className="admin-report-grid">
        <section className="section-card">
          <div className="section-title"><div><span className="eyebrow dark">HOẠT ĐỘNG POS</span><h2>Lịch sử bill gần đây</h2></div><span className="date-chip">{recentBills.length} bill</span></div>
          <div className="admin-archive-list admin-bill-history">
            {recentBills.slice(0, 30).map((receipt) => (
              <article key={receipt.id}>
                <time>{formatBillDateTime(receipt.createdAt, receipt.businessDate)}</time>
                <span>
                  <strong>{receipt.code || 'Bill POS'}</strong>
                  <small>{branchName(receipt.branchId)} · {receipt.sellerName || 'Chưa có nhân viên bán'} · {formatNumber(receipt.totalQuantity)} sản phẩm</small>
                </span>
                <b>{formatMoney(receipt.totalAmount)}</b>
              </article>
            ))}
            {!recentBills.length && <p className="empty-copy">Chưa có bill trong khoảng đang chọn.</p>}
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

function formatBillDateTime(createdAt: string, businessDate: string) {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return formatDate(businessDate)
  return date.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

// Số lượng kho (hao hụt, sản phẩm) hiển thị đúng 3 chữ số lẻ như DB, khớp màn Kho.
function formatNumber(value: number) {
  return formatQuantity(value)
}
