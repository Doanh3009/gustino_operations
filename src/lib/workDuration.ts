type TimestampValue = string | Date | null | undefined

function timestampMillis(value: TimestampValue) {
  if (!value) return Number.NaN
  const date = value instanceof Date ? value : new Date(value)
  return date.getTime()
}

export function durationMinutesBetween(checkInTime: TimestampValue, checkOutTime: TimestampValue) {
  const checkIn = timestampMillis(checkInTime)
  const checkOut = timestampMillis(checkOutTime)
  if (!Number.isFinite(checkIn) || !Number.isFinite(checkOut) || checkOut <= checkIn) return 0
  return Math.max(0, Math.round((checkOut - checkIn) / 60000))
}

export function formatDurationMinutes(totalMinutes: number) {
  const safeMinutes = Number.isFinite(totalMinutes) ? Math.max(0, Math.round(totalMinutes)) : 0
  const hours = Math.floor(safeMinutes / 60)
  const minutes = safeMinutes % 60
  if (hours && minutes) return `${hours} giờ ${minutes} phút`
  if (hours) return `${hours} giờ`
  return `${minutes} phút`
}

export function formatWorkDurationBetween(checkInTime: TimestampValue, checkOutTime: TimestampValue) {
  if (!checkInTime || !checkOutTime) return '—'
  return formatDurationMinutes(durationMinutesBetween(checkInTime, checkOutTime))
}

export function formatDecimalHoursAsDuration(totalHours: number) {
  const safeHours = Number.isFinite(totalHours) ? Math.max(0, totalHours) : 0
  return formatDurationMinutes(safeHours * 60)
}
