import type { BagShiftSession } from '../types'

/**
 * Phân vùng doanh thu theo ca — KHÔNG HỞ, KHÔNG CHỒNG (BUG-117).
 *
 * Trước đây báo cáo từng ca lọc hóa đơn theo đúng cửa sổ giờ của phiên ca
 * (`startedAt..endedAt`). POS thì bán liên tục, còn phiên ca do người bấm mở/đóng:
 * Ca 2 mở trễ (31/07 Lotte 23/10 mở 17:17 thay vì 15:15) là mọi hóa đơn trong
 * "khoảng trống" giữa hai ca biến mất khỏi CẢ HAI ảnh báo cáo; hóa đơn tạo trước
 * giờ mở Ca 1 cũng mất; hai ca chồng giờ thì bị đếm trùng. Tổng ngày luôn đúng
 * (đọc theo business_date) nên nhìn ảnh Ca 1 + Ca 2 lệch tổng ngày là tưởng
 * "lỗi đồng bộ doanh thu".
 *
 * Quy tắc mới: một NGÀY được cắt thành các vùng liền nhau bằng đúng MỘT điểm cắt
 * giữa hai ca kề nhau = giờ đóng ca trước (nếu đóng trước khi ca sau mở), ngược
 * lại là giờ mở ca sau. Ca đầu nhận từ đầu ngày, ca cuối nhận tới cuối ngày.
 * Nhờ vậy tổng các ca LUÔN bằng tổng ngày, bất kể phiên ca mở/đóng lúc nào.
 */
export interface SessionScopeWindow {
  /** Mốc mở vùng (EXCLUSIVE, ISO). Rỗng = từ đầu ngày. */
  fromTs: string
  /** Mốc đóng vùng (INCLUSIVE, ISO). Rỗng = tới cuối ngày. */
  toTs: string
}

/** Điểm cắt duy nhất giữa hai ca kề nhau: min(giờ đóng ca trước, giờ mở ca sau). */
function cutBetween(prev: BagShiftSession, next: BagShiftSession): string {
  return prev.endedAt && prev.endedAt <= next.startedAt ? prev.endedAt : next.startedAt
}

export function sessionScopeWindow(target: BagShiftSession, sessions: BagShiftSession[]): SessionScopeWindow {
  const sameDay = sessions
    .filter((item) => item.branchId === target.branchId && item.businessDate === target.businessDate)
    .slice()
  if (!sameDay.some((item) => item.id === target.id)) sameDay.push(target)
  sameDay.sort((a, b) => a.sequence - b.sequence || a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))
  const index = sameDay.findIndex((item) => item.id === target.id)
  const prev = index > 0 ? sameDay[index - 1] : undefined
  const next = index < sameDay.length - 1 ? sameDay[index + 1] : undefined
  return {
    fromTs: prev ? cutBetween(prev, target) : '',
    toTs: next ? cutBetween(target, next) : '',
  }
}

export function timestampInScopeWindow(timestamp: string, window: SessionScopeWindow): boolean {
  if (!timestamp) return false
  if (window.fromTs && timestamp <= window.fromTs) return false
  if (window.toTs && timestamp > window.toTs) return false
  return true
}

/** Tiện dụng khi chỉ lọc một lần; vòng lặp lớn nên gọi sessionScopeWindow một lần rồi dùng timestampInScopeWindow. */
export function isTimestampInSessionScope(
  timestamp: string,
  target: BagShiftSession,
  sessions: BagShiftSession[],
): boolean {
  return timestampInScopeWindow(timestamp, sessionScopeWindow(target, sessions))
}
