import type { Role } from '../types'
import { getLang, T, type Lang } from './i18n'

export const OPERATION_ROLES: Role[] = ['shift_leader']
export const MANAGEMENT_ROLES: Role[] = ['admin', 'manager']
export const KITCHEN_ROLES: Role[] = ['admin', 'manager', 'kitchen']

export function canUseSales(_role: Role) {
  return true
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

export function normalizeRole(role: Role): Role {
  return role === 'admin' ? 'manager' : role
}

export function displayUserName(user: { name: string }) {
  const trimmed = user.name.trim()
  return trimmed.toLowerCase() === 'quản lý' ? 'Admin' : trimmed
}

export function roleLabel(role: Role, lang: Lang = getLang()) {
  const tx = T[lang]
  return {
    admin: tx.roleAdmin,
    manager: tx.roleManager,
    shift_leader: tx.roleShiftLeader,
    staff: tx.roleStaff,
    kitchen: tx.roleKitchen,
  }[role]
}
