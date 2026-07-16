export function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatLocalDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('vi-VN')
}

export function localDayBoundsIso(dateKey: string) {
  const start = new Date(`${dateKey}T00:00:00`)
  const end = new Date(`${dateKey}T23:59:59.999`)
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  }
}
