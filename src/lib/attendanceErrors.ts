/**
 * Marker bền, máy đọc được cho ca quên check-out do hệ thống tự đóng.
 * Luôn giữ `[CHỐT HÀNH CHÍNH]` ở đầu để khớp constraint bằng chứng hiện có.
 */
export const ATTENDANCE_AUTO_CLOSE_ADDRESS_PREFIX = '[CHỐT HÀNH CHÍNH] [LỖI QUÊN CHECK-OUT]'

/** Nhận cả marker mới và các bản auto-close đã tạo trước khi có marker riêng. */
export function isAttendanceAutoClosedError(checkOutAddress: string | null | undefined) {
  const address = String(checkOutAddress || '').trim()
  if (address.startsWith(ATTENDANCE_AUTO_CLOSE_ADDRESS_PREFIX)) return true
  if (!address.startsWith('[CHỐT HÀNH CHÍNH]')) return false
  const normalized = address.toLocaleLowerCase('vi')
  return normalized.includes('hệ thống tự đóng') || normalized.includes('(auto-close)')
}
