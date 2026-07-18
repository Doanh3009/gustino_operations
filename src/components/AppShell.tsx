import { useEffect, useState, type ReactNode } from 'react'
import { canUseAdmin, canUseKitchen, canUseManagement, canUseOperations, canUseSales, displayUserName, roleLabel } from '../lib/access'
import { toggleLang, useLang } from '../lib/i18n'
import { heartbeatActiveUser } from '../lib/activeUsers'
import { fetchAttendanceRecords, fetchShiftRegistrations, findAttendanceRecordForRegistration } from '../lib/attendance'
import { localDateKey } from '../lib/dates'
import type { AppUser } from '../types'
import { AppFooter } from './AppFooter'

export type Page =
  | 'launcher'
  | 'dashboard'
  | 'today'
  | 'sales'
  | 'my-records'
  | 'report-archive'
  | 'restaurant'
  | 'report'
  | 'inventory'
  | 'handover'
  | 'orders'
  | 'attendance'
  | 'management'
  | 'manager-revenue'
  | 'manager-business'
  | 'manager-inventory'
  | 'manager-attendance'
  | 'manager-payroll'
  | 'manager-requests'
  | 'admin-accounts'
  | 'control'
  | 'kitchen'

export type InventoryTab = 'overview' | 'inbound' | 'processing_out' | 'count'

interface Props {
  user: AppUser
  page: Page
  currentSection?: string
  onNavigate: (page: Page, section?: string) => void
  onLogout: () => void
  children: ReactNode
}

interface NavItem {
  id: Page
  label: string
  shortLabel?: string
  icon: ReactNode
  section?: string
  canShow: (user: AppUser) => boolean
}

const MANAGER_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Doanh thu', icon: <IconDashboard />, canShow: () => true },
  { id: 'manager-business', label: 'Kinh doanh', icon: <IconChart />, canShow: () => true },
  { id: 'manager-inventory', label: 'Kho', icon: <IconBox />, canShow: () => true },
  { id: 'manager-attendance', label: 'Bảng công', shortLabel: 'Công', icon: <IconClock />, canShow: (user) => canUseAdmin(user.role) },
  { id: 'manager-payroll', label: 'Lương & KPI', shortLabel: 'Lương', icon: <IconPayroll />, canShow: (user) => canUseAdmin(user.role) },
  { id: 'manager-requests', label: 'Đặt hàng', shortLabel: 'Đặt', icon: <IconClipboard />, canShow: (user) => canUseAdmin(user.role) },
  { id: 'report-archive', label: 'Kho báo cáo', shortLabel: 'Báo cáo', icon: <IconHistory />, canShow: (user) => canUseAdmin(user.role) },
  { id: 'admin-accounts', label: 'Nhân sự', shortLabel: 'Nhân sự', icon: <IconUsers />, canShow: (user) => canUseAdmin(user.role) },
  { id: 'control', label: 'Admin hệ thống', shortLabel: 'Admin', icon: <IconSettings />, canShow: (user) => canUseAdmin(user.role) },
]

const NAV_ITEMS: NavItem[] = [
  {
    id: 'management',
    label: 'Tổng hợp',
    icon: <IconChart />,
    canShow: (user) => canUseManagement(user.role),
  },
  {
    id: 'today',
    label: 'Hôm nay',
    icon: <IconCalendar />,
    canShow: (user) => canUseOperations(user.role),
  },
  {
    id: 'sales',
    label: 'Bán hàng',
    icon: <IconShoppingBag />,
    canShow: (user) => canUseSales(user.role),
  },
  {
    id: 'my-records',
    label: 'Lịch sử & báo cáo',
    shortLabel: 'Lịch sử',
    icon: <IconHistory />,
    canShow: (user) => user.role === 'staff' || user.role === 'shift_leader',
  },
  {
    id: 'handover',
    label: 'Bàn giao ca',
    icon: <IconHandover />,
    canShow: (user) => canUseOperations(user.role),
  },
  {
    id: 'inventory',
    label: 'Kho hàng',
    icon: <IconBox />,
    canShow: (user) => canUseOperations(user.role),
  },
  {
    id: 'orders',
    label: 'Đặt hàng',
    icon: <IconClipboard />,
    canShow: (user) => canUseOperations(user.role),
  },
  {
    id: 'attendance',
    label: 'Chấm công',
    icon: <IconUsers />,
    canShow: (user) => user.role !== 'kitchen',
  },
  {
    id: 'kitchen',
    label: 'Đặt bếp',
    icon: <IconKitchen />,
    canShow: (user) => canUseKitchen(user.role),
  },
]

const OPERATION_GUIDE_ITEMS: Array<{
  id: Page
  label: string
  shortLabel: string
  icon: string
  canShow: (user: AppUser) => boolean
}> = [
  { id: 'today', label: 'Hôm nay', shortLabel: 'Tổng quan', icon: '1', canShow: (user) => canUseOperations(user.role) },
  { id: 'inventory', label: 'Kho & rang', shortLabel: 'Kho', icon: '2', canShow: (user) => canUseOperations(user.role) },
  { id: 'sales', label: 'Bán hàng', shortLabel: 'Bán', icon: '3', canShow: (user) => canUseOperations(user.role) || canUseSales(user.role) },
  { id: 'handover', label: 'Bàn giao ca', shortLabel: 'Bàn giao', icon: '4', canShow: (user) => canUseOperations(user.role) },
]

const OPERATION_GUIDE_PAGES: Page[] = ['today', 'inventory', 'sales', 'handover']

const EN_NAV_LABELS: Partial<Record<Page, { label: string; shortLabel?: string }>> = {
  dashboard: { label: 'Revenue' },
  'manager-revenue': { label: 'Business' },
  'manager-business': { label: 'Business' },
  'manager-inventory': { label: 'Inventory' },
  attendance: { label: 'Schedule', shortLabel: 'Schedule' },
  'manager-attendance': { label: 'Timesheets', shortLabel: 'Time' },
  'manager-payroll': { label: 'Payroll & KPI', shortLabel: 'Payroll' },
  'report-archive': { label: 'Report archive', shortLabel: 'Reports' },
  'manager-requests': { label: 'Orders', shortLabel: 'Orders' },
  'admin-accounts': { label: 'People', shortLabel: 'People' },
  control: { label: 'System Admin', shortLabel: 'Admin' },
  management: { label: 'Overview' },
  today: { label: 'Today' },
  sales: { label: 'Sales' },
  'my-records': { label: 'History & reports', shortLabel: 'History' },
  handover: { label: 'Shift handover', shortLabel: 'Handover' },
  inventory: { label: 'Inventory' },
  report: { label: 'Close shift' },
  orders: { label: 'Orders' },
  kitchen: { label: 'Kitchen' },
}

function loadCollapsed(): boolean {
  try { return localStorage.getItem('gustino_sidebar_collapsed') === '1' } catch { return false }
}
function saveCollapsed(val: boolean) {
  try { localStorage.setItem('gustino_sidebar_collapsed', val ? '1' : '0') } catch { /* */ }
}

export function AppShell({ user, page, currentSection, onNavigate, onLogout, children }: Props) {
  const lang = useLang()
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sundayReminderDismissed, setSundayReminderDismissed] = useState(false)
  const [attendanceReminderDismissed, setAttendanceReminderDismissed] = useState(false)
  const [attendanceReminder, setAttendanceReminder] = useState<'check-in' | 'check-out' | null>(null)
  const baseNav = canUseManagement(user.role) ? MANAGER_NAV : NAV_ITEMS
  const visibleNav = baseNav.filter((item) => item.canShow(user)).map((item) => ({
    ...item,
    ...(lang === 'en' ? EN_NAV_LABELS[item.id] : null),
  }))
  const shownName = displayUserName(user)
  const initials = shownName.slice(0, 2).toUpperCase() || 'G'
  const isActive = (item: NavItem) => {
    if (item.id !== page) return false
    if (item.id === 'management' && canUseManagement(user.role)) {
      return item.section ? currentSection === item.section : !currentSection
    }
    return item.section ? (currentSection || 'revenue') === item.section : true
  }
  const activeLabel = visibleNav.find(isActive)?.label || 'GUSTINO'
  const navKey = (item: NavItem) => `${item.id}:${item.section || ''}`
  const operationGuide = OPERATION_GUIDE_ITEMS.filter((item) => item.canShow(user))
  const showOperationGuide = false
  const showSundayReminder = new Date().getDay() === 0
    && (user.role === 'staff' || user.role === 'shift_leader')
    && page !== 'attendance'
    && !sundayReminderDismissed
  const showAttendanceReminder = Boolean(attendanceReminder)
    && (user.role === 'staff' || user.role === 'shift_leader')
    && page !== 'attendance'
    && !attendanceReminderDismissed

  function toggleCollapse() {
    const next = !collapsed
    setCollapsed(next)
    saveCollapsed(next)
  }

  useEffect(() => {
    let active = true
    const beat = () => {
      if (!active) return
      void heartbeatActiveUser(user, page).catch(() => null)
    }
    beat()
    const timer = window.setInterval(beat, 30000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [user.id, user.name, user.role, user.branchId, page])

  useEffect(() => {
    if (user.role !== 'staff' && user.role !== 'shift_leader') return
    let active = true
    const today = localDateKey()
    const refreshReminder = async () => {
      try {
        const [registrations, records] = await Promise.all([
          fetchShiftRegistrations(user, { branchId: user.branchId, userId: user.id, from: today, to: today }),
          fetchAttendanceRecords(user, { branchId: user.branchId, userId: user.id, from: today, to: today }),
        ])
        if (!active) return
        const own = registrations.filter((item) => item.userId === user.id && item.status !== 'rejected')
        const openRecord = own.some((item) => {
          const record = findAttendanceRecordForRegistration(records, item)
          return Boolean(record && !record.checkOutTime)
        })
        const waitingCheckIn = own.some((item) => !findAttendanceRecordForRegistration(records, item))
        setAttendanceReminder(openRecord ? 'check-out' : waitingCheckIn ? 'check-in' : null)
      } catch {
        // Popup là nhắc việc hỗ trợ; lỗi mạng không được làm crash toàn bộ AppShell.
      }
    }
    void refreshReminder()
    const timer = window.setInterval(refreshReminder, 30000)
    const reload = () => void refreshReminder()
    window.addEventListener('focus', reload)
    window.addEventListener('gustino-attendance-updated', reload)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', reload)
      window.removeEventListener('gustino-attendance-updated', reload)
    }
  }, [user.id, user.role, user.branchId])

  useEffect(() => setAttendanceReminderDismissed(false), [attendanceReminder])

  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`} onClick={() => setMenuOpen(false)}>
      {/* ===== DESKTOP LEFT SIDEBAR ===== */}
      <aside className="app-sidebar">
        {/* Brand */}
        <div className="sidebar-brand" onClick={() => onNavigate('launcher')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onNavigate('launcher')}>
          <span className="sidebar-brand-mark"><img src="/gustino-logo.jpg" alt="GUSTINO" /></span>
          {!collapsed && <strong className="sidebar-brand-name">GUSTINO</strong>}
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {visibleNav.map((item) => (
            <button
              key={navKey(item)}
              className={`sidebar-nav-item${isActive(item) ? ' active' : ''}`}
              onClick={() => onNavigate(item.id, item.section)}
              title={collapsed ? item.label : undefined}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              {!collapsed && <span className="sidebar-nav-label">{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Spacer */}
        <div className="sidebar-spacer" />

        {/* User info */}
        <div className="sidebar-user">
          <span className="sidebar-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}</span>
          {!collapsed && (
            <div className="sidebar-user-info">
              <strong>{shownName}</strong>
              <small>{roleLabel(user.role, lang)}</small>
            </div>
          )}
        </div>

        {/* Language */}
        <button className="sidebar-lang-toggle" onClick={toggleLang} title={lang === 'en' ? 'Tiếng Việt' : 'English'}>
          {lang === 'en' ? 'VI' : 'EN'}
        </button>

        {/* Logout */}
        {!collapsed && (
          <button className="sidebar-logout" onClick={onLogout}>
            <IconLogout />
            Đăng xuất
          </button>
        )}
        {collapsed && (
          <button className="sidebar-logout sidebar-logout-icon" onClick={onLogout} title="Đăng xuất">
            <IconLogout />
          </button>
        )}

        {/* Collapse toggle */}
        <button className="sidebar-toggle" onClick={toggleCollapse} title={collapsed ? 'Mở rộng' : 'Thu gọn'}>
          <span className={`sidebar-toggle-icon${collapsed ? ' rotated' : ''}`}>
            <IconChevron />
          </span>
        </button>
      </aside>

      {/* ===== MOBILE HEADER ===== */}
      <header className="mobile-header">
        <button className="mh-brand" onClick={() => onNavigate('launcher')} aria-label="Về trang chủ">
          <span className="mh-logo"><img src="/gustino-logo.jpg" alt="GUSTINO" /></span>
          <span className="mh-title">{activeLabel}</span>
        </button>
        <div className="mh-right">
          <button
            className={`mh-avatar${menuOpen ? ' open' : ''}`}
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
            aria-label="Tài khoản"
            aria-expanded={menuOpen}
          >
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}
          </button>
          {menuOpen && (
            <div className="mh-menu" role="menu" onClick={(e) => e.stopPropagation()}>
              <div className="mh-menu-user">
                <strong>{shownName}</strong>
                <small>{roleLabel(user.role, lang)}</small>
              </div>
              <button className="mh-menu-lang" onClick={toggleLang}>
                {lang === 'en' ? 'Tiếng Việt' : 'English'}
              </button>
              <button className="mh-menu-logout" onClick={onLogout}>
                <IconLogout />
                Đăng xuất
              </button>
            </div>
          )}
        </div>
      </header>

      {showOperationGuide && (
        <nav className="operation-guide" aria-label="Quy trình vận hành">
          {operationGuide.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? 'active' : ''}
              onClick={() => onNavigate(item.id)}
              title={item.label}
              aria-current={page === item.id ? 'page' : undefined}
            >
              <span>{item.icon}</span>
              <strong>{item.shortLabel}</strong>
            </button>
          ))}
        </nav>
      )}

      {/* ===== MAIN CONTENT ===== */}
      <main className={`app-main${showOperationGuide ? ' has-operation-guide' : ''}`}>
        {children}
        <AppFooter />
      </main>

      {showAttendanceReminder && (
        <aside className="sunday-shift-popup attendance-check-popup" role="dialog" aria-label="Nhắc chấm công hôm nay">
          <button className="sunday-shift-popup-close" type="button" aria-label="Đóng" onClick={() => setAttendanceReminderDismissed(true)}>×</button>
          <img className="attendance-capybara-image attendance-popup-capybara" src="/mascots/capy-attendance-camera.png" alt="" width="256" height="256" decoding="async" aria-hidden="true" />
          <div>
            <small>CAPY NHẮC CHẤM CÔNG ✨</small>
            <strong>{attendanceReminder === 'check-out' ? 'Bạn chưa check-out ca đang làm' : 'Bạn có ca hôm nay chưa check-in'}</strong>
            <span>{attendanceReminder === 'check-out' ? 'Chụp ảnh cuối ca, lưu GPS rồi check-out nhé.' : 'Mở chấm công, cho phép định vị và chụp ảnh trước khi vào ca.'}</span>
          </div>
          <button type="button" onClick={() => { setAttendanceReminderDismissed(true); onNavigate('attendance') }}>{attendanceReminder === 'check-out' ? 'Đi check-out' : 'Đi check-in'}</button>
        </aside>
      )}

      {showSundayReminder && !showAttendanceReminder && (
        <aside className="sunday-shift-popup" role="dialog" aria-label="Nhắc đăng ký ca tuần mới">
          <button className="sunday-shift-popup-close" type="button" aria-label="Đóng" onClick={() => setSundayReminderDismissed(true)}>×</button>
          <CapybaraMascot />
          <div>
            <small>CHỈ NHẮC VÀO CHỦ NHẬT</small>
            <strong>Capy nhắc bạn đăng ký ca tuần mới ✨</strong>
            <span>Chọn ca sớm để ca trưởng sắp lịch tuần tới nhé.</span>
          </div>
          <button type="button" onClick={() => { setSundayReminderDismissed(true); onNavigate('attendance') }}>Đăng ký ca</button>
        </aside>
      )}

      {/* ===== MOBILE BOTTOM NAV ===== */}
      <nav className="mobile-nav" aria-label="Chức năng chính">
        {visibleNav.map((item) => (
          <button key={navKey(item)} className={isActive(item) ? 'active' : ''} onClick={() => onNavigate(item.id, item.section)}>
            <span className="mn-icon">{item.icon}</span>
            <small>{item.shortLabel || item.label.split(' / ')[0]}</small>
          </button>
        ))}
      </nav>
    </div>
  )
}

function CapybaraMascot() {
  return <span className="capybara-mascot" aria-hidden="true"><i className="capy-ear left" /><i className="capy-ear right" /><i className="capy-eye left" /><i className="capy-eye right" /><i className="capy-nose" /></span>
}

// ===== SVG ICON COMPONENTS =====

function IconChart() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}

function IconDashboard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 13a8 8 0 1116 0" /><path d="M12 13l4-4" /><path d="M3 21h18" /><path d="M7 17h10" />
    </svg>
  )
}

function IconCalendar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function IconShoppingBag() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" />
    </svg>
  )
}

function IconHandover() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 014-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 01-4 4H3" />
    </svg>
  )
}

function IconBox() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  )
}

function IconReport() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  )
}

function IconClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function IconClipboard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <line x1="9" y1="11" x2="15" y2="11" /><line x1="9" y1="15" x2="13" y2="15" />
    </svg>
  )
}

function IconHistory() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-3.16" />
    </svg>
  )
}

function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  )
}

function IconPayroll() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8h10" />
      <path d="M7 12h4" />
      <path d="M15 12h2" />
      <path d="M7 16h4" />
      <path d="M15 16h2" />
    </svg>
  )
}

function IconKitchen() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2" /><path d="M7 2v20" /><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 005 15.08a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 008.92 5a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09A1.65 1.65 0 0015 4.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019 8.92a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09A1.65 1.65 0 0019.4 15z" />
    </svg>
  )
}

function IconLogout() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

function IconChevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}
