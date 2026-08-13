import { localDateKey } from './dates'
import type { EmployeeProfile } from '../types'

/**
 * Nhân viên đã nghỉ việc — quy tắc chung cho MỌI báo cáo (chốt 10/08/2026).
 *
 * Yêu cầu của chủ hệ thống: đổi trạng thái sang "Nghỉ việc" thì người đó **biến
 * mất khỏi các báo cáo tới và khỏi bảng thi đua**, nhưng **dữ liệu cũ không được
 * mất** — mở lại tháng họ còn đi làm thì vẫn phải thấy đủ doanh thu, giờ công.
 *
 * Vì vậy có HAI câu hỏi khác nhau, đừng dùng lẫn:
 *  - `hasLeftCompany`      → "người này đã nghỉ chưa?"  (dùng cho bảng thi đua,
 *                             danh sách chọn người, mọi thứ mang tính hiện tại)
 *  - `wasEmployedDuring`   → "trong kỳ ĐANG XEM họ còn làm không?" (dùng cho báo
 *                             cáo theo kỳ — kỳ cũ vẫn giữ nguyên số liệu)
 */

export function hasLeftCompany(employee: Pick<EmployeeProfile, 'employmentStatus' | 'active'>) {
  return employee.employmentStatus === 'ended' || employee.active === false
}

/**
 * Người này có còn đi làm trong khoảng `from…to` không?
 *
 * Chưa nghỉ ⇒ luôn đúng. Đã nghỉ ⇒ chỉ đúng khi ngày nghỉ rơi vào hoặc sau đầu
 * kỳ, tức là họ thực sự có làm ít nhất một phần của kỳ đó. Đã nghỉ mà KHÔNG khai
 * ngày nghỉ thì coi như nghỉ từ lâu và bị loại khỏi mọi kỳ — buộc phải khai ngày
 * nghỉ mới giữ được số liệu lịch sử, đúng như biểu mẫu hồ sơ đang bắt buộc.
 */
export function wasEmployedDuring(
  employee: Pick<EmployeeProfile, 'employmentStatus' | 'active' | 'employmentEndDate'>,
  from?: string,
  to?: string,
  today = localDateKey(),
) {
  if (!hasLeftCompany(employee)) return true
  // Hồ sơ nghỉ việc mà KHÔNG khai ngày (Admin được phép để trống) thì coi như
  // nghỉ từ hôm nay: kỳ đã qua giữ nguyên số liệu, chỉ các kỳ SAU mới ẩn họ đi.
  const endDate = (employee.employmentEndDate || '').slice(0, 10) || today
  // Không có mốc đầu kỳ thì chỉ còn cách hiểu là "kỳ hiện tại".
  if (!from) return endDate >= today
  void to
  return endDate >= from
}

/** Nhãn ngắn để bảng nào có hiện người đã nghỉ thì nói rõ vì sao họ còn ở đó. */
export function employmentStatusNote(
  employee: Pick<EmployeeProfile, 'employmentStatus' | 'active' | 'employmentEndDate'>,
) {
  if (!hasLeftCompany(employee)) return ''
  const endDate = (employee.employmentEndDate || '').slice(0, 10)
  if (!endDate) return 'Đã nghỉ việc'
  const [year, month, day] = endDate.split('-')
  return `Đã nghỉ từ ${day}/${month}/${year}`
}
