import type { BagShiftSession } from '../types'

/**
 * Phân vùng doanh thu theo ca — theo ĐỒNG HỒ, không theo phiên ca (chủ quán chốt
 * 11/08/2026).
 *
 * Lịch sử: bản đầu lọc hóa đơn theo đúng cửa sổ giờ của phiên ca
 * (`startedAt..endedAt`). POS bán liên tục, còn phiên ca do người bấm mở/đóng, nên
 * Ca 2 mở trễ (31/07 Lotte 23/10 mở 17:17 thay vì 15:15) là mọi hóa đơn trong
 * "khoảng trống" giữa hai ca biến mất khỏi CẢ HAI ảnh báo cáo. Bản thứ hai (BUG-117)
 * vá bằng cách cắt ngày tại điểm giao giữa hai phiên ca — hết hở, nhưng ranh giới
 * vẫn trôi theo việc ai bấm nút lúc mấy giờ: ca trưởng chốt muộn 2 tiếng là 2 tiếng
 * doanh thu của Ca 2 bị tính sang Ca 1.
 *
 * Quy tắc hiện tại: **ngày cắt tại đúng 15:15.** Hóa đơn tới 15:15 thuộc Ca 1, sau
 * 15:15 thuộc Ca 2 — bất kể phiên ca mở lúc nào, đóng lúc nào, hay có mở hay không.
 * Ranh giới không còn phụ thuộc thao tác của con người, và tổng hai ca vẫn luôn
 * bằng tổng ngày vì hai vùng liền nhau, không hở không chồng.
 */

/** Giờ cắt ngày giữa Ca 1 và Ca 2 (giờ Việt Nam). */
export const SHIFT_CUTOVER_TIME = '15:15'

/** Múi giờ vận hành — mốc cắt phải neo vào đây, không neo vào giờ máy người xem. */
const OPERATIONS_UTC_OFFSET = '+07:00'

export interface SessionScopeWindow {
  /** Mốc mở vùng (EXCLUSIVE, ISO). Rỗng = từ đầu ngày. */
  fromTs: string
  /** Mốc đóng vùng (INCLUSIVE, ISO). Rỗng = tới cuối ngày. */
  toTs: string
}

/**
 * Mốc cắt của một ngày vận hành, dạng ISO. Trả rỗng khi ngày không hợp lệ — khi đó
 * vùng của ca là cả ngày, thà rộng còn hơn nuốt mất hóa đơn.
 */
export function shiftCutoverTimestamp(businessDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(businessDate || ''))) return ''
  const cutover = new Date(`${businessDate}T${SHIFT_CUTOVER_TIME}:00${OPERATIONS_UTC_OFFSET}`)
  return Number.isFinite(cutover.getTime()) ? cutover.toISOString() : ''
}

/**
 * Vùng doanh thu của một phiên ca, tính THUẦN theo đồng hồ.
 * Ca 1: từ đầu ngày tới hết 15:15. Ca 2 (và mọi ca sau): từ sau 15:15 tới cuối ngày.
 */
export function shiftClockWindow(businessDate: string, sequence: number): SessionScopeWindow {
  const cutover = shiftCutoverTimestamp(businessDate)
  if (!cutover) return { fromTs: '', toTs: '' }
  return sequence <= 1
    ? { fromTs: '', toTs: cutover }
    : { fromTs: cutover, toTs: '' }
}

/**
 * Giữ nguyên chữ ký cũ để mọi màn (Báo cáo, Bàn giao, thi đua ca) dùng chung một
 * cửa; danh sách `sessions` không còn ảnh hưởng tới ranh giới nữa.
 */
export function sessionScopeWindow(target: BagShiftSession, _sessions: BagShiftSession[] = []): SessionScopeWindow {
  return shiftClockWindow(target.businessDate, target.sequence)
}

/**
 * So sánh theo GIÁ TRỊ thời gian, không so chuỗi. Mốc cắt do JS dựng ra kết thúc
 * bằng `Z`, còn `created_at` của PostgREST kết thúc bằng `+00:00`: so chuỗi thì
 * `'…Z' > '…+00:00'` luôn đúng theo bảng mã, và cả ngày doanh thu rơi nhầm ca.
 */
function timeValue(timestamp: string) {
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

export function timestampInScopeWindow(timestamp: string, window: SessionScopeWindow): boolean {
  if (!timestamp) return false
  const value = timeValue(timestamp)
  if (Number.isNaN(value)) return false
  if (window.fromTs) {
    const from = timeValue(window.fromTs)
    if (!Number.isNaN(from) && value <= from) return false
  }
  if (window.toTs) {
    const to = timeValue(window.toTs)
    if (!Number.isNaN(to) && value > to) return false
  }
  return true
}

/** Tiện dụng khi chỉ lọc một lần; vòng lặp lớn nên gọi sessionScopeWindow một lần rồi dùng timestampInScopeWindow. */
export function isTimestampInSessionScope(
  timestamp: string,
  target: BagShiftSession,
  sessions: BagShiftSession[] = [],
): boolean {
  return timestampInScopeWindow(timestamp, sessionScopeWindow(target, sessions))
}
