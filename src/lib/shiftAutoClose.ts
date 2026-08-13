import { localDateKey } from './dates'
import { serverNow, syncServerClock } from './serverClock'
import { appendSessionNote, closeBagShift, fetchBagShiftSessions } from './shiftLedger'
import type { AppUser, BagShiftSession } from '../types'

/**
 * **Tự chốt ca khi ca trưởng QUÊN chốt** (chủ hệ thống chốt 13/08/2026).
 *
 * Quy tắc:
 *   · Ca 1 chưa bàn giao tới 15:30 → hệ thống tự đóng.
 *   · Ca 2 chưa bàn giao tới 22:30 → hệ thống tự đóng.
 *   · Chốt đúng giờ, chốt tay thì KHÔNG có gì xảy ra ở đây — đường tự động chỉ
 *     là lưới an toàn cho trường hợp quên.
 *
 * **Tuyệt đối không tự ghi tồn.** Đây là ràng buộc cứng của chủ hệ thống và cũng
 * là điều đúng về mặt số liệu: tồn cuối ca là số ĐẾM ĐƯỢC ngoài quầy, không phải
 * số máy suy ra. Nếu tự điền tồn theo sổ thì:
 *   · chênh lệch thật (hao hụt, mất hàng, bán sót) bị xoá sạch — sổ luôn khớp
 *     một cách giả tạo và không ai còn phát hiện được sai ở đâu;
 *   · phiếu bàn giao mang một con số không ai đếm nhưng trông như đã đếm.
 *
 * Vì vậy ca tự chốt được ghi `closingBalances = {}` (rỗng = CHƯA ĐẾM) kèm dấu
 * `[TỰ ĐỘNG CHỐT]` trong ghi chú ca. Màn đối soát ca đã sẵn sàng hiểu tồn cuối
 * rỗng là "Chưa bàn giao / Chưa chốt" nên nó hiện đúng là ca cần rà soát, thay vì
 * lặng lẽ khớp số.
 *
 * Tồn đầu của ca kế tiếp KHÔNG bị ảnh hưởng: `buildOpeningBalances` trong
 * `shiftAutoOpen.ts` đọc lại từ sổ kho thật (`fetchMovements` + `calculateStock`),
 * không lấy từ tồn cuối ca trước.
 */

/** Giờ tự chốt của từng ca (giờ Việt Nam). Muộn hơn mốc gửi báo cáo 15 phút. */
export const SHIFT_AUTO_CLOSE_TIMES: Record<number, string> = {
  1: '15:30',
  2: '22:30',
}

const OPERATIONS_UTC_OFFSET = '+07:00'

/** Dấu nhận biết ca do máy đóng — dùng cho cả UI lẫn test, đừng đổi chuỗi. */
export const AUTO_CLOSE_TAG = '[TỰ ĐỘNG CHỐT]'

export function autoCloseTimeLabel(sequence: number) {
  return SHIFT_AUTO_CLOSE_TIMES[sequence] || ''
}

/** Thời điểm tự chốt của một ca, neo theo NGÀY VẬN HÀNH và múi giờ VN. */
export function autoCloseDueAt(businessDate: string, sequence: number): Date | null {
  const time = SHIFT_AUTO_CLOSE_TIMES[sequence]
  if (!time || !/^\d{4}-\d{2}-\d{2}$/.test(String(businessDate || ''))) return null
  const due = new Date(`${businessDate}T${time}:00${OPERATIONS_UTC_OFFSET}`)
  return Number.isFinite(due.getTime()) ? due : null
}

export function isAutoCloseDue(businessDate: string, sequence: number, now: Date) {
  const due = autoCloseDueAt(businessDate, sequence)
  return Boolean(due && now.getTime() >= due.getTime())
}

/** Mili giây tới mốc tự chốt gần nhất còn ở phía trước (rỗng = hôm nay hết mốc). */
export function msUntilNextAutoClose(businessDate: string, now: Date): number | undefined {
  const waits = Object.keys(SHIFT_AUTO_CLOSE_TIMES)
    .map((sequence) => autoCloseDueAt(businessDate, Number(sequence)))
    .map((due) => (due ? due.getTime() - now.getTime() : -1))
    .filter((wait) => wait > 0)
  return waits.length ? Math.min(...waits) : undefined
}

/** Ca đã bị máy đóng thay người — màn Bàn giao/Đối soát dùng để gắn nhãn. */
export function isAutoClosedShift(session: Pick<BagShiftSession, 'discrepancyNote'>) {
  return String(session.discrepancyNote || '').includes(AUTO_CLOSE_TAG)
}

/** Ca còn mở và đã quá giờ tự chốt của chính phiên ca đó. */
export function overdueOpenShifts(sessions: BagShiftSession[], businessDate: string, now: Date) {
  return sessions
    .filter((session) => session.businessDate === businessDate)
    .filter((session) => session.status === 'open')
    .filter((session) => isAutoCloseDue(businessDate, session.sequence, now))
    .sort((left, right) => left.sequence - right.sequence)
}

export type ShiftAutoCloseReason =
  | 'not-allowed'
  | 'no-session'
  | 'not-due'

export interface ShiftAutoCloseResult {
  /** Ca vừa bị đóng trong lượt chạy này. */
  closed?: { sessionId: string; sequence: number }
  reason?: ShiftAutoCloseReason
}

/** Ai được phép chạy lưới an toàn này: người vận hành ca của chính chi nhánh đó. */
export function canRunShiftAutoClose(role: AppUser['role']) {
  return role === 'shift_leader' || role === 'shift_deputy'
}

/**
 * Một lượt kiểm tra tự chốt. **Idempotent** — trạng thái đọc lại từ máy chủ nên
 * gọi lặp bao nhiêu lần cũng an toàn; ca đã đóng thì lượt sau không thấy gì để làm.
 */
export async function reconcileShiftAutoClose(user: AppUser): Promise<ShiftAutoCloseResult> {
  if (!canRunShiftAutoClose(user.role) || !user.branchId) return { reason: 'not-allowed' }
  await syncServerClock().catch(() => 0)
  const now = serverNow()
  const businessDate = localDateKey(now)

  const sessions = await fetchBagShiftSessions(user, { branchId: user.branchId, date: businessDate })
  if (!sessions.length) return { reason: 'no-session' }

  const overdue = overdueOpenShifts(sessions, businessDate, now)[0]
  if (!overdue) return { reason: 'not-due' }

  const stamp = now.toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const note = appendSessionNote(
    overdue.discrepancyNote,
    `${AUTO_CLOSE_TAG} Ca ${overdue.sequence} tự đóng lúc ${stamp} vì quá giờ `
    + `${autoCloseTimeLabel(overdue.sequence)} mà chưa được chốt tay. `
    + 'TỒN CUỐI CA CHƯA KIỂM ĐẾM — quản lý cần rà soát và bổ sung số đếm thực tế.',
  )

  // `{}` = chưa đếm. Không suy ra tồn từ sổ, không ghi movement nào.
  await closeBagShift(user, overdue, {}, note, [], [])
  return { closed: { sessionId: overdue.id, sequence: overdue.sequence } }
}
