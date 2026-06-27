import { BRANCHES } from '../lib/constants'
import { canUseKitchen, canUseManagement, canUseOperations, roleLabel } from '../lib/access'
import { AppFooter } from '../components/AppFooter'
import type { AppUser } from '../types'

interface Props {
  user: AppUser
  onOpenOperations: () => void
  onOpenSales: () => void
  onOpenAttendance: () => void
  onOpenManagement: () => void
  onOpenKitchen: () => void
  onLogout: () => void
}

export function LauncherPage({ user, onOpenOperations, onOpenSales, onOpenAttendance, onOpenManagement, onOpenKitchen, onLogout }: Props) {
  const branch = BRANCHES.find((item) => item.id === user.branchId)
  return (
    <div className="launcher-page">
      <header className="launcher-header">
        <div className="launcher-brand"><span>G</span><div><strong>GUSTINO</strong><small>VẬN HÀNH GUSTINO</small></div></div>
        <div className="launcher-user">
          <span><strong>{user.name}</strong><small>{roleLabel(user.role)} · {branch?.name}</small></span>
          <button className="launcher-logout-button" onClick={onLogout}>Đăng xuất</button>
        </div>
      </header>

      <main className="launcher-content">
        <div className="launcher-heading">
          <span>TRANG CHỦ</span>
          <h1>Chúc một ngày tốt lành.</h1>
          <p>Chọn khu vực cần làm. Mọi thao tác tự đồng bộ để cuối ca dễ kiểm tra và bàn giao.</p>
        </div>
        <div className={`app-tile-grid${canUseManagement(user.role) || canUseKitchen(user.role) ? ' three-tiles' : ''}`}>
          {canUseOperations(user.role) && (
            <button className="app-tile operations" onClick={onOpenOperations}>
              <span className="app-tile-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              </span>
              <span className="app-tile-status ready">OK</span>
              <strong>Vận hành cửa hàng</strong>
              <small>Mở ca, làm hàng, phát túi và chốt báo cáo cuối ngày.</small>
            </button>
          )}
          <button className="app-tile sales" onClick={onOpenSales}>
            <span className="app-tile-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
            </span>
            <span className="app-tile-status ready">OK</span>
            <strong>Bán hàng</strong>
            <small>PG ghi số túi đã bán, hệ thống tự tính doanh thu và KPI.</small>
          </button>
          <button className="app-tile attendance" style={{ display: user.role === 'kitchen' ? 'none' : undefined }} onClick={onOpenAttendance}>
            <span className="app-tile-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
            </span>
            <span className="app-tile-status ready">OK</span>
            <strong>Chấm công</strong>
            <small>Đăng ký ca, check-in bằng selfie, check-out để tính công.</small>
          </button>
          {canUseManagement(user.role) && (
            <button className="app-tile admin" onClick={onOpenManagement}>
              <span className="app-tile-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              </span>
              <span className="app-tile-status ready">OK</span>
              <strong>Tổng hợp quản lý</strong>
              <small>Xem công làm, tồn kho, kiểm kê và cảnh báo theo chi nhánh.</small>
            </button>
          )}
          {canUseKitchen(user.role) && (
            <button className="app-tile kitchen" onClick={onOpenKitchen}>
              <span className="app-tile-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
              </span>
              <span className="app-tile-status ready">OK</span>
              <strong>Đặt bếp</strong>
              <small>Nhận đơn từ ca trưởng và đánh dấu khi đã xử lý xong.</small>
            </button>
          )}
        </div>
      </main>
      <AppFooter />
    </div>
  )
}
