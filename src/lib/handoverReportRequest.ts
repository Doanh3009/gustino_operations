/**
 * Ca trưởng chốt bàn giao ở màn Bàn giao rồi mới sang màn Báo cáo để chốt số
 * và gửi Zalo. Yêu cầu chốt báo cáo của ca VỪA đóng được ghi lại ở đây để hai
 * màn hình cùng đọc: màn Báo cáo lấy đúng ca cần chốt (không phải "ca có
 * sequence lớn nhất"), màn Bàn giao biết chưa được tự mở ca kế tiếp.
 *
 * Dùng localStorage (KHÔNG phải sessionStorage) để yêu cầu SỐNG QUA lần đóng
 * app: ca trưởng hay bấm bàn giao rồi tắt máy trước khi màn Báo cáo kịp tạo +
 * gửi ảnh, nên báo cáo Tổng ngày bị quên. Còn yêu cầu chưa chốt thì AppShell
 * còn nhắc "báo cáo chưa gửi" ở mọi trang, và màn Báo cáo mở lại vẫn tự chốt.
 */
const STORAGE_KEY = 'gustino:handover-report'
export const REPORT_PENDING_EVENT = 'gustino-report-pending-updated'

export interface HandoverReportRequest {
  shiftId: string
  sequence: number
  businessDate: string
  /**
   * Ai đặt yêu cầu này. `handover` = ca trưởng vừa bấm chốt & bàn giao ca.
   * `schedule` = tới giờ gửi báo cáo (15:15 / 22:15) nên hệ thống tự đặt — đường
   * này KHÔNG đòi ca phải đóng, vì báo cáo không còn phụ thuộc việc bàn giao.
   */
  trigger?: 'handover' | 'schedule'
}

function emitPendingChanged() {
  try {
    window.dispatchEvent(new Event(REPORT_PENDING_EVENT))
  } catch {
    // Môi trường không có window (test/SSR) thì bỏ qua — chỉ là tín hiệu nhắc.
  }
}

export function readHandoverReportRequest(): HandoverReportRequest | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw)
    if (!value?.shiftId || !value?.businessDate || ![1, 2].includes(Number(value.sequence))) return null
    return {
      shiftId: String(value.shiftId),
      sequence: Number(value.sequence),
      businessDate: String(value.businessDate),
      trigger: value.trigger === 'schedule' ? 'schedule' : 'handover',
    }
  } catch {
    return null
  }
}

export function writeHandoverReportRequest(request: HandoverReportRequest) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(request))
    emitPendingChanged()
  } catch {
    // Storage can be unavailable in a private mobile browser. The manual
    // finalize action remains available in that case.
  }
}

export function clearHandoverReportRequest() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    emitPendingChanged()
  } catch {
    // Storage can be unavailable in a private mobile browser. The manual
    // finalize action remains available in that case.
  }
}

/**
 * Yêu cầu chốt báo cáo còn treo của HÔM NAY (nếu có). Yêu cầu của ngày cũ được
 * dọn luôn tại đây để lời nhắc không đu bám sang ngày mới (máy để app qua đêm).
 */
export function pendingHandoverReportForToday(today: string): HandoverReportRequest | null {
  const request = readHandoverReportRequest()
  if (!request) return null
  if (request.businessDate === today) return request
  if (request.businessDate < today) clearHandoverReportRequest()
  return null
}
