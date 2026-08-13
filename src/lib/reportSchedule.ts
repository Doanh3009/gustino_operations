import { localDateKey } from './dates'
import { readHandoverReportRequest, writeHandoverReportRequest, type HandoverReportRequest } from './handoverReportRequest'
import { serverNow, syncServerClock } from './serverClock'
import { fetchBagShiftSessions } from './shiftLedger'
import { fetchReportSnapshots } from './store'
import type { AppUser, BagShiftSession } from '../types'

/**
 * **Báo cáo gửi theo ĐỒNG HỒ, không chờ ai bấm** (chủ quán chốt 11/08/2026).
 *
 * Trước đây báo cáo chỉ được tạo và gửi khi ca trưởng bấm "Chốt & bàn giao ca" rồi
 * bấm tiếp "Chốt báo cáo". Ca trưởng về sớm, quên bấm, hoặc bấm bàn giao xong tắt
 * máy trước khi màn Báo cáo kịp dựng ảnh là nhóm Zalo không nhận được gì — mà lúc
 * đó không ai biết, vì hệ thống chỉ im lặng chờ.
 *
 * Giờ thì: tới 15:15 gửi báo cáo Ca 1, tới 22:15 gửi báo cáo Ca 2 + Tổng ngày.
 * Việc ca trưởng chốt ca hay bàn giao KHÔNG còn liên quan tới báo cáo.
 *
 * Ảnh báo cáo vẫn phải dựng trong trình duyệt (html2canvas trên poster ẩn của màn
 * Báo cáo), nên hàm này chỉ ĐẶT CỜ; `App.tsx` thấy cờ thì đưa sang màn Báo cáo và
 * màn đó tự chốt + gửi. Không có ai mở app đúng giờ thì cờ vẫn còn, lần mở app kế
 * tiếp gửi bù ngay — không rơi im lặng như trước.
 */

/** Giờ gửi báo cáo của từng ca (giờ Việt Nam). */
export const REPORT_DUE_TIMES: Record<number, string> = {
  1: '15:15',
  2: '22:15',
}

const OPERATIONS_UTC_OFFSET = '+07:00'

export function reportDueTimeLabel(sequence: number) {
  return REPORT_DUE_TIMES[sequence] || ''
}

/** Thời điểm phải gửi báo cáo của một ca, neo theo NGÀY VẬN HÀNH và múi giờ VN. */
export function reportDueAt(businessDate: string, sequence: number): Date | null {
  const time = REPORT_DUE_TIMES[sequence]
  if (!time || !/^\d{4}-\d{2}-\d{2}$/.test(String(businessDate || ''))) return null
  const due = new Date(`${businessDate}T${time}:00${OPERATIONS_UTC_OFFSET}`)
  return Number.isFinite(due.getTime()) ? due : null
}

export function isReportDue(businessDate: string, sequence: number, now: Date) {
  const due = reportDueAt(businessDate, sequence)
  return Boolean(due && now.getTime() >= due.getTime())
}

/** Mili giây còn lại tới mốc gửi gần nhất còn ở phía trước (rỗng = hôm nay hết mốc). */
export function msUntilNextReportDue(businessDate: string, now: Date): number | undefined {
  const waits = Object.keys(REPORT_DUE_TIMES)
    .map((sequence) => reportDueAt(businessDate, Number(sequence)))
    .map((due) => (due ? due.getTime() - now.getTime() : -1))
    .filter((wait) => wait > 0)
  return waits.length ? Math.min(...waits) : undefined
}

export type ScheduledReportReason =
  | 'not-allowed'
  | 'not-due'
  | 'already-sent'
  | 'no-session'
  | 'already-pending'

export interface ScheduledReportResult {
  /** Yêu cầu vừa được đặt trong lượt chạy này. */
  due?: HandoverReportRequest
  /** Yêu cầu hẹn giờ đặt từ trước, màn Báo cáo chưa gửi xong. */
  pending?: HandoverReportRequest
  reason?: ScheduledReportReason
}

/** Vai trò được phép dựng và gửi báo cáo thay chi nhánh. */
export function canRunScheduledReport(role: AppUser['role']) {
  return role === 'shift_leader' || role === 'shift_deputy'
}

/**
 * Ca đã tới giờ gửi mà báo cáo chưa có trong `report_snapshots`. Trả ca MUỘN NHẤT
 * còn thiếu: 22:15 mà cả Ca 1 lẫn Ca 2 đều chưa gửi thì gửi Ca 1 trước (sequence
 * tăng dần), vì báo cáo Ca 2 luôn kèm Tổng ngày và Tổng ngày phải chốt sau cùng.
 */
export function dueReportSequences(
  sessions: BagShiftSession[],
  sentShiftIds: Set<string>,
  businessDate: string,
  now: Date,
) {
  return sessions
    .filter((session) => session.businessDate === businessDate)
    .filter((session) => isReportDue(businessDate, session.sequence, now))
    .filter((session) => !sentShiftIds.has(session.id))
    .sort((left, right) => left.sequence - right.sequence)
}

/**
 * Một lượt kiểm tra hẹn giờ. **Idempotent** — mọi điều kiện đọc lại từ máy chủ nên
 * gọi lặp bao nhiêu lần cũng an toàn; đã có cờ đang chờ thì không ghi đè.
 */
export async function reconcileScheduledReport(user: AppUser): Promise<ScheduledReportResult> {
  if (!canRunScheduledReport(user.role) || !user.branchId) return { reason: 'not-allowed' }
  await syncServerClock().catch(() => 0)
  const now = serverNow()
  const businessDate = localDateKey(now)

  const sessions = await fetchBagShiftSessions(user, { branchId: user.branchId, date: businessDate })
  if (!sessions.length) return { reason: 'no-session' }
  if (!sessions.some((session) => isReportDue(businessDate, session.sequence, now))) return { reason: 'not-due' }

  const snapshots = await fetchReportSnapshots(user.branchId, user, { from: businessDate, to: businessDate })
    .catch(() => [])
  const shiftReports = snapshots.find((item) => item.reportDate === businessDate)?.payload?.shiftReports || {}
  const sentShiftIds = new Set(Object.keys(shiftReports))
  const due = dueReportSequences(sessions, sentShiftIds, businessDate, now)[0]
  if (!due) return { reason: 'already-sent' }

  // Cờ cũ CHỈ được giữ khi nó còn đúng việc cần làm. Kiểm tra sau khi đã biết ca
  // nào thật sự còn thiếu báo cáo: cờ sót lại của một ca đã gửi xong (màn Báo cáo
  // tắt giữa chừng, máy hết pin) từng khoá luôn ca sau — không ai gửi nữa cả.
  const pending = readHandoverReportRequest()
  if (pending && pending.businessDate === businessDate && pending.shiftId === due.id) {
    return { pending, reason: 'already-pending' }
  }

  const request: HandoverReportRequest = {
    shiftId: due.id,
    sequence: due.sequence,
    businessDate,
    trigger: 'schedule',
  }
  writeHandoverReportRequest(request)
  return { due: request }
}
