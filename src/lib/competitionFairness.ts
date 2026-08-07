import type { AttendanceRecord, ShiftRegistration } from '../types'

export type CompetitionDayType = 'all' | 'weekday' | 'weekend'

export interface CompetitionAttendanceMetric {
  employeeKey: string
  employeeName: string
  branchId: string
  shiftCount: number
  totalHours: number
  /** Số NGÀY công khác nhau — một người trực 2 ca cùng ngày vẫn chỉ là 1 ngày. */
  dayCount: number
  /** Số THÁNG khác nhau có đi làm, để tính trung bình mỗi tháng bán được bao nhiêu. */
  monthCount: number
}

export function competitionDayMatches(dateKey: string, filter: CompetitionDayType) {
  if (filter === 'all') return true
  const day = new Date(`${dateKey}T12:00:00`).getDay()
  const weekend = day === 0 || day === 6
  return filter === 'weekend' ? weekend : !weekend
}

export function competitionDateKeys(from: string, to: string, filter: CompetitionDayType) {
  const dates: string[] = []
  const cursor = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  while (cursor <= end) {
    const key = localCalendarDateKey(cursor)
    if (competitionDayMatches(key, filter)) dates.push(key)
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

export function filterCompetitionAttendanceRecords(
  records: AttendanceRecord[],
  registrations: ShiftRegistration[],
  filters: { from: string; to: string; dayType: CompetitionDayType; branchId?: string },
) {
  const workDateByRegistration = new Map(registrations.map((registration) => [registration.id, registration.workDate]))
  return records.filter((record) => {
    const workDate = workDateByRegistration.get(record.shiftRegistrationId)
      || vietnamDateKey(record.checkInTime)
    return workDate >= filters.from
      && workDate <= filters.to
      && competitionDayMatches(workDate, filters.dayType)
      && (!filters.branchId || record.branchId === filters.branchId)
  })
}

/**
 * `registrations` là tuỳ chọn nhưng NÊN truyền: ngày công lấy theo `workDate`
 * của đăng ký ca, không phải theo giờ check-in. Ca qua nửa đêm mà suy ngày từ
 * `checkInTime` sẽ bị đếm nhầm sang ngày hôm sau — đúng lớp lỗi của BUG-109.
 */
export function buildCompetitionAttendanceMetrics(
  records: AttendanceRecord[],
  registrations: ShiftRegistration[] = [],
) {
  const workDateByRegistration = new Map(registrations.map((registration) => [registration.id, registration.workDate]))
  const metrics = new Map<string, CompetitionAttendanceMetric & { days: Set<string>; months: Set<string> }>()
  records.forEach((record) => {
    const key = `${record.branchId}-${record.userId}`
    const current = metrics.get(key) || {
      employeeKey: record.userId,
      employeeName: record.userName,
      branchId: record.branchId,
      shiftCount: 0,
      totalHours: 0,
      dayCount: 0,
      monthCount: 0,
      days: new Set<string>(),
      months: new Set<string>(),
    }
    const workedHours = record.checkOutTime
      ? Math.max(0, (new Date(record.checkOutTime).getTime() - new Date(record.checkInTime).getTime()) / 3600000)
      : 0
    const workDate = workDateByRegistration.get(record.shiftRegistrationId) || vietnamDateKey(record.checkInTime)
    current.shiftCount += 1
    current.totalHours = Number((current.totalHours + workedHours).toFixed(2))
    current.days.add(workDate)
    current.months.add(workDate.slice(0, 7))
    metrics.set(key, current)
  })
  return Array.from(metrics.values()).map(({ days, months, ...metric }) => ({
    ...metric,
    dayCount: days.size,
    monthCount: months.size,
  }))
}

function vietnamDateKey(value: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const valueFor = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`
}

function localCalendarDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}
