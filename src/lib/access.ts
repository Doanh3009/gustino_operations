import type { Role } from '../types'
import { getLang, T, type Lang } from './i18n'

export const OPERATION_ROLES: Role[] = ['shift_leader']
export const MANAGEMENT_ROLES: Role[] = ['admin', 'manager']
export const KITCHEN_ROLES: Role[] = ['admin', 'kitchen']

export function canUseAdmin(role: Role) {
  return role === 'admin'
}

export function canUseSales(role: Role) {
  return ['shift_leader', 'staff', 'cashier'].includes(role)
}

export function canUseOperations(role: Role) {
  return OPERATION_ROLES.includes(role)
}

export function canUseManagement(role: Role) {
  return MANAGEMENT_ROLES.includes(role)
}

export function canUseKitchen(role: Role) {
  return KITCHEN_ROLES.includes(role)
}

// SUP MT (giám sát) + admin: được XEM bảng lương/bảng công của mọi người để đối chiếu
// và trả lời phản hồi về kế toán. SUP MT không sửa được lương — chỉ admin sửa.
export function canReviewPayroll(role: Role) {
  return role === 'admin' || role === 'supmt'
}

export function normalizeRole(role: Role): Role {
  return role
}

// Vị trí nhân viên cho bảng công/Excel: ưu tiên positionTitle (Ca trưởng/Ca phó/Full-time/Part-time),
// fallback theo employmentType, cuối cùng theo role.
export function employeePositionLabel(employee?: { positionTitle?: string; employmentType?: string; role?: string }) {
  const title = employee?.positionTitle?.trim()
  if (title) return title
  const type = employee?.employmentType
  if (type === 'leader') return 'Ca trưởng'
  if (type === 'full_time') return 'Full-time'
  if (type === 'part_time') return 'Part-time'
  return employee?.role === 'shift_leader' ? 'Ca trưởng' : 'Nhân viên'
}

export function displayUserName(user: { name: string }) {
  const trimmed = user.name.trim()
  return trimmed
}

export function roleLabel(role: Role, lang: Lang = getLang()) {
  if (lang === 'en') {
    return {
      admin: 'System Admin',
      manager: 'Manager',
      supmt: 'Supervisor (SUP MT)',
      shift_leader: 'Shift Leader',
      staff: 'Staff',
      cashier: 'POS Cashier',
      kitchen: 'Kitchen',
    }[role]
  }
  const tx = T[lang]
  return {
    admin: tx.roleAdmin,
    manager: tx.roleManager,
    supmt: 'Giám sát (SUP MT)',
    shift_leader: tx.roleShiftLeader,
    staff: tx.roleStaff,
    cashier: 'Thu ngân POS',
    kitchen: tx.roleKitchen,
  }[role]
}
