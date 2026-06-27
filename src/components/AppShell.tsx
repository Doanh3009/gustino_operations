import { useState, type ReactNode } from 'react'
import { canUseKitchen, canUseManagement, canUseOperations, canUseSales, displayUserName, roleLabel } from '../lib/access'
import type { AppUser } from '../types'
import { AppFooter } from './AppFooter'

export type Page =
  | 'launcher'
  | 'dashboard'
  | 'today'
  | 'sales'
  | 'restaurant'
  | 'report'
  | 'inventory'
  | 'handover'
  | 'orders'
  | 'attendance'
  | 'management'
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
  { id: 'dashboard', label: 'Tổng quan', icon: <IconDashboard />, canShow: () => true },
  { id: 'management', label: 'Quản lý', icon: <IconChart />, canShow: () => true },
  { id: 'management', section: 'inventory', label: 'Kho', icon: <IconBox />, canShow: () => true },
  { id: 'management', section: 'payroll', label: 'Lương nhân viên', shortLabel: 'Lương', icon: <IconUsers />, canShow: () => true },
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
    id: 'handover',
    label: 'Phát túi / Bàn giao',
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
    id: 'report',
    label: 'Cuối ca',
    icon: <IconReport />,
    canShow: (user) => canUseOperations(user.role),
  },
  {
    id: 'orders',
    label: 'Đặt hàng',
    icon: <IconHistory />,
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
  { id: 'inventory', label: 'Kho & chế biến', shortLabel: 'Kho', icon: '2', canShow: (user) => canUseOperations(user.role) },
  { id: 'handover', label: 'Bàn giao túi', shortLabel: 'Bàn giao', icon: '3', canShow: (user) => canUseOperations(user.role) },
  { id: 'sales', label: 'Bán hàng', shortLabel: 'Bán', icon: '4', canShow: (user) => canUseOperations(user.role) || canUseSales(user.role) },
  { id: 'orders', label: 'Đặt hàng', shortLabel: 'Đặt', icon: '5', canShow: (user) => canUseOperations(user.role) },
  { id: 'report', label: 'Báo cáo cuối ngày', shortLabel: 'Báo cáo', icon: '6', canShow: (user) => canUseOperations(user.role) },
]

const OPERATION_GUIDE_PAGES: Page[] = ['today', 'inventory', 'handover', 'sales', 'orders', 'report']

function loadCollapsed(): boolean {
  try { return localStorage.getItem('gustino_sidebar_collapsed') === '1' } catch { return false }
}
function saveCollapsed(val: boolean) {
  try { localStorage.setItem('gustino_sidebar_collapsed', val ? '1' : '0') } catch { /* */ }
}

export function AppShell({ user, page, currentSection, onNavigate, onLogout, children }: Props) {
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [menuOpen, setMenuOpen] = useState(false)
  const baseNav = canUseManagement(user.role) ? MANAGER_NAV : NAV_ITEMS
  const visibleNav = baseNav.filter((item) => item.canShow(user))
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
  const showOperationGuide = canUseOperations(user.role) && OPERATION_GUIDE_PAGES.includes(page)

  function toggleCollapse() {
    const next = !collapsed
    setCollapsed(next)
    saveCollapsed(next)
  }

  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`} onClick={() => setMenuOpen(false)}>
      {/* ===== DESKTOP LEFT SIDEBAR ===== */}
      <aside className="app-sidebar">
        {/* Brand */}
        <div className="sidebar-brand" onClick={() => onNavigate('launcher')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onNavigate('launcher')}>
          <span className="sidebar-brand-mark">G</span>
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
          <span className="sidebar-avatar">{initials}</span>
          {!collapsed && (
            <div className="sidebar-user-info">
              <strong>{shownName}</strong>
              <small>{roleLabel(user.role)}</small>
            </div>
          )}
        </div>

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
          <span className="mh-logo">G</span>
          <span className="mh-title">{activeLabel}</span>
        </button>
        <div className="mh-right">
          <button
            className={`mh-avatar${menuOpen ? ' open' : ''}`}
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
            aria-label="Tài khoản"
            aria-expanded={menuOpen}
          >
            {initials}
          </button>
          {menuOpen && (
            <div className="mh-menu" role="menu" onClick={(e) => e.stopPropagation()}>
              <div className="mh-menu-user">
                <strong>{shownName}</strong>
                <small>{roleLabel(user.role)}</small>
              </div>
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

function IconKitchen() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2" /><path d="M7 2v20" /><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" />
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
