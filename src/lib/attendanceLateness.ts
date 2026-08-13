/**
 * Quy tắc toàn hệ thống do chủ quán cập nhật ngày 12/08/2026:
 *
 * - Trước 12/08/2026: mốc đúng giờ là giờ bắt đầu ca.
 * - Từ 12/08/2026: mốc đúng giờ là giờ bắt đầu ca trừ 15 phút.
 *
 * Phép tính đổi trạng thái theo phút hoàn chỉnh: ca 07:00 thì cả phút 07:00 vẫn
 * đúng giờ, từ 07:01 mới trễ 1 phút. Với ca 09:00 theo luật mới, cả phút 08:45
 * vẫn đúng giờ và từ 08:46 mới trễ.
 */
export const EARLY_CHECK_IN_REQUIRED_FROM = '2026-08-12'

/** Số phút phải có mặt TRƯỚC giờ vào ca. */
export const EARLY_CHECK_IN_MINUTES = 15

/** Phút kế tiếp sau mốc đúng giờ mới bắt đầu được tính là trễ. */
export const LATE_CHECK_IN_TOLERANCE_MINUTES = 1

export function usesEarlyCheckInRule(workDate: string) {
  return String(workDate || '') >= EARLY_CHECK_IN_REQUIRED_FROM
}

/**
 * Mốc dùng để đếm số phút trễ.
 * - Ca từ 12/08/2026: giờ vào ca − 15 phút.
 * - Ca cũ hơn: đúng giờ vào ca.
 *
 * `graceMinutes` được giữ trong chữ ký để các màn hiện tại không phải đổi API,
 * nhưng không tham gia công thức vì owner đã chốt biên 07:00/07:01 cố định.
 */
export function onTimeCheckInDeadline(
  workDate: string,
  scheduledStart: Date,
  _graceMinutes: number,
): Date {
  return usesEarlyCheckInRule(workDate)
    ? new Date(scheduledStart.getTime() - EARLY_CHECK_IN_MINUTES * 60_000)
    : new Date(scheduledStart.getTime())
}

/** Số phút hoàn chỉnh đã qua mốc đúng giờ. Đúng giờ hoặc vào sớm đều trả 0. */
export function lateMinutesFor(
  workDate: string,
  scheduledStart: Date,
  checkIn: Date | undefined,
  graceMinutes: number,
): number {
  if (!checkIn || !Number.isFinite(checkIn.getTime())) return 0
  const deadline = onTimeCheckInDeadline(workDate, scheduledStart, graceMinutes)
  return Math.max(0, Math.floor((checkIn.getTime() - deadline.getTime()) / 60_000))
}

export function isLateCheckIn(
  workDate: string,
  scheduledStart: Date,
  checkIn: Date | undefined,
  graceMinutes: number,
): boolean {
  return lateMinutesFor(workDate, scheduledStart, checkIn, graceMinutes) >= LATE_CHECK_IN_TOLERANCE_MINUTES
}
