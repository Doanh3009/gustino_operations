/**
 * Toàn bộ nghiệp vụ (ngày vận hành, ngày chấm công, business_date) neo theo giờ
 * Việt Nam — nơi các chi nhánh hoạt động — chứ KHÔNG theo múi giờ thiết bị.
 * Trước đây dùng getFullYear()/getMonth() của thiết bị: máy để sai múi giờ
 * (UTC, roaming…) sẽ tính "hôm nay" lệch một ngày trong khung 00:00–07:00 VN,
 * sinh ra lỗi "lấy nhầm bản ghi ngày hôm trước". VN không có DST nên offset
 * luôn là +07:00.
 */
const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh'
export const VN_UTC_OFFSET = '+07:00'

// en-CA cho ra dạng YYYY-MM-DD đúng chuẩn key ngày của hệ thống.
const vnDateKeyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: VN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function localDateKey(date = new Date()) {
  return vnDateKeyFormat.format(date)
}

/**
 * Cộng/trừ ngày trên key YYYY-MM-DD mà không đi qua múi giờ của thiết bị.
 * Neo ở 12:00 UTC để cả phép cộng lẫn format ISO luôn nằm trong đúng ngày đích.
 */
export function addLocalDateKeyDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw new Error(`Ngày không hợp lệ: ${dateKey}`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Chủ nhật = 0 … Thứ bảy = 6, tính trực tiếp từ date-key. */
export function localDateKeyWeekday(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw new Error(`Ngày không hợp lệ: ${dateKey}`)
  return date.getUTCDay()
}

export function formatLocalDate(value: string) {
  return new Date(`${value}T00:00:00${VN_UTC_OFFSET}`).toLocaleDateString('vi-VN', { timeZone: VN_TIME_ZONE })
}

export function localDayBoundsIso(dateKey: string) {
  const start = new Date(`${dateKey}T00:00:00${VN_UTC_OFFSET}`)
  const end = new Date(`${dateKey}T23:59:59.999${VN_UTC_OFFSET}`)
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  }
}
