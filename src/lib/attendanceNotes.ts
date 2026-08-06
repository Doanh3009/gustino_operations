import type { AttendanceAdjustmentRequest } from '../types'

/**
 * Gom ghi chú đơn theo đúng nhân viên × chi nhánh × ngày công để bảng ngày/tháng
 * và Excel dùng cùng một nguồn, không dò tên mơ hồ.
 */
export function buildAttendanceAdjustmentNoteMap(requests: AttendanceAdjustmentRequest[]) {
  const grouped = new Map<string, AttendanceAdjustmentRequest[]>()
  for (const request of requests) {
    const key = `${request.userId}|${request.branchId}|${request.workDate}`
    const rows = grouped.get(key) || []
    rows.push(request)
    grouped.set(key, rows)
  }
  const notes = new Map<string, string>()
  grouped.forEach((rows, key) => {
    notes.set(key, rows
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(formatAttendanceAdjustmentNote)
      .join(' | '))
  })
  return notes
}

function formatAttendanceAdjustmentNote(request: AttendanceAdjustmentRequest) {
  const label = request.kind === 'late_arrival'
    ? 'ĐƠN ĐI TRỄ'
    : request.kind === 'early_leave'
      ? 'ĐƠN VỀ SỚM'
      : 'ĐƠN QUÊN CHECK-OUT'
  const submittedAt = formatVietnamDateTime(request.createdAt)
  const evidence = request.evidenceNote ? ` · Ghi chú: ${request.evidenceNote}` : ''
  return `[${label}] ${request.userName} gửi ${submittedAt} · ${request.scheduledTime} → ${request.actualTime} · Lý do: ${request.reason || 'Không ghi'}${evidence}`
}

function formatVietnamDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`
}
