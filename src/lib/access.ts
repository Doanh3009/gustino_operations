import type { Role } from '../types'
import { getLang, T, type Lang } from './i18n'

// Ca phó vận hành ca NGANG Ca trưởng. Từ 13/08/2026 ranh giới cuối cùng cũng
// được gỡ: ca phó đứng tên phiên ca như ca trưởng, ai vào ca thì bấm nhận ca.
export const OPERATION_ROLES: Role[] = ['shift_leader', 'shift_deputy']
export const MANAGEMENT_ROLES: Role[] = ['admin', 'manager']
export const KITCHEN_ROLES: Role[] = ['admin', 'kitchen']

export function canUseAdmin(role: Role) {
  return role === 'admin'
}

export function canUseSales(role: Role) {
  return ['shift_leader', 'shift_deputy', 'staff', 'cashier'].includes(role)
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

/**
 * **Phân vai Admin ↔ Quản lý (chủ hệ thống chốt 13/08/2026).**
 *
 *   · **Quản lý** = người VẬN HÀNH. Làm toàn bộ việc hằng ngày: tổng quan, doanh
 *     thu, kho, chấm công, thi đua, đơn hàng, nhân sự. Đây là những việc trước
 *     đây Admin phải làm.
 *   · **Admin** = người CẤU HÌNH, làm việc kiểu no-code: sản phẩm, giá, khuyến
 *     mãi, chi nhánh, mức KPI, phân quyền, nhật ký. Đổi cách vận hành mà không
 *     phải sửa mã nguồn rồi deploy lại.
 *   · **SUP MT** giám sát: xem đúng những gì Quản lý xem, không ghi được gì.
 *
 * Admin KHÔNG bị tước quyền xem console vận hành — tước đi là mất khả năng đối
 * chiếu khi có sự cố (§86: đổi vai trò không được xoá năng lực). Chỉ khác ở chỗ
 * mặc định vào đâu và thanh điều hướng ưu tiên gì.
 */
export const ADMIN_CONSOLE_ROLES: Role[] = ['admin', 'manager', 'supmt']

export function canOpenAdminConsole(role: Role) {
  return ADMIN_CONSOLE_ROLES.includes(role)
}

/** Console CẤU HÌNH no-code — chỉ Admin. Quản lý không đổi giá/SKU/mức KPI. */
export function canConfigureSystem(role: Role) {
  return role === 'admin'
}

/**
 * Được THAO TÁC (ghi) trong console vận hành: chỉnh công, xóa ca, tạo tài khoản,
 * duyệt đơn… Trước đây các mục này khoá bằng `canUseAdmin` nên Quản lý không mở
 * được — chính là thứ phải chuyển sang cho Quản lý.
 */
export function canOperateConsole(role: Role) {
  return role === 'admin' || role === 'manager'
}

/**
 * Vai trò CHỈ ĐỌC trong trang Quản trị.
 *
 * Dùng để ẩn mọi nút/biểu mẫu ghi dữ liệu (chỉnh công, xóa ca, tạo tài khoản,
 * đổi vai trò, đặt lại mật khẩu, tạo/xóa chi nhánh…). Đây là lớp chặn giao diện;
 * lớp chặn thật nằm ở RLS — `supmt` không có mặt trong bất kỳ policy ghi nào
 * ngoài chấm công/đăng ký ca của CHÍNH họ (xem `20260808_supmt_readonly_access.sql`).
 */
export function isReadOnlyConsoleRole(role: Role) {
  return role === 'supmt'
}

// Vai trò giám sát toàn hệ thống: không gắn chi nhánh, đọc dữ liệu mọi chi nhánh.
export function hasSystemWideScope(role: Role) {
  return role === 'admin' || role === 'supmt'
}

// Vai trò không gắn một chi nhánh cố định. Phải khớp `branchlessRole` trong
// edge function `manage-employee` — lệch nhau là tạo tài khoản lỗi ràng buộc.
export function isBranchlessRole(role: Role) {
  return role === 'manager' || role === 'kitchen' || role === 'supmt'
}

export function normalizeRole(role: Role, positionTitle = ''): Role {
  const title = positionTitle.toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
  if (role === 'shift_deputy' || /(^|[^a-z])ca pho([^a-z]|$)/.test(title)) return 'shift_deputy'
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
  if (employee?.role === 'shift_deputy') return 'Ca phó'
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
      shift_deputy: 'Deputy Shift Leader',
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
    shift_deputy: 'Ca phó',
    staff: tx.roleStaff,
    cashier: 'Thu ngân POS',
    kitchen: tx.roleKitchen,
  }[role]
}
