import type { AdminSection } from '../AdminPage'

export interface AdminRouteDefinition {
  section: AdminSection
  path: string
  label: string
}

export const ADMIN_ROUTE_MAP: AdminRouteDefinition[] = [
  { section: 'overview', path: '/admin/dashboard', label: 'Tổng quan' },
  { section: 'revenue', path: '/admin/orders', label: 'Đơn hàng & doanh thu' },
  { section: 'commission', path: '/admin/sales-performance', label: 'Thi đua nhân viên' },
  { section: 'inventory', path: '/admin/inventory', label: 'Kho' },
  { section: 'accounts', path: '/admin/employees', label: 'Nhân sự & Chi nhánh' },
  { section: 'attendance', path: '/admin/attendance', label: 'Chấm công' },
  { section: 'requests', path: '/admin/purchase-orders', label: 'Đơn hàng bếp' },
]

export function adminRouteForSection(section: AdminSection) {
  return ADMIN_ROUTE_MAP.find((route) => route.section === section)?.path || '/admin/dashboard'
}

export function adminSectionForRoute(path: string): AdminSection {
  if (path.startsWith('/admin/employees') || path.startsWith('/admin/branches')) return 'accounts'
  return ADMIN_ROUTE_MAP.find((route) => path === route.path || path.startsWith(`${route.path}/`))?.section || 'overview'
}
