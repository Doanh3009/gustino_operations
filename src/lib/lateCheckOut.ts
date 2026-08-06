/**
 * Quy tắc giờ cho CHECK-OUT BÙ (BUG-113), tách riêng và KHÔNG phụ thuộc Supabase
 * để chạy được trong test thuần Node — đây là phép tính quyết định số giờ vào bảng
 * công nên phải kiểm chứng được bằng dữ liệu thật, không chỉ đọc mã nguồn.
 *
 * Bối cảnh: ca quên check-out mà bấm nút lúc phát hiện sẽ đóng dấu giờ HIỆN TẠI,
 * đẻ ra những ca 24h/96h/238h trên bảng công. Nhưng chặn cứng thì nhân viên kẹt
 * luôn, phải chờ Admin. Lối thoát: cho tự khai giờ đã về, chặn ở mức không bao giờ
 * vượt quá giờ tan ca theo lịch — khai bằng hoặc ít hơn lịch thì được, tự cộng giờ
 * cho mình thì không.
 */

export interface LateCheckOutWindow {
  workDate: string
  startTime: string
  endTime: string
}

/** Ca kết thúc lúc nào theo lịch; ca qua đêm thì rơi sang ngày hôm sau. */
export function scheduledEndAt(registration: LateCheckOutWindow) {
  const value = new Date(`${registration.workDate}T${registration.endTime.slice(0, 5)}:00`)
  if (registration.endTime <= registration.startTime) value.setDate(value.getDate() + 1)
  return value
}

/**
 * Đổi giờ nhân viên khai (HH:MM) thành mốc thời gian thật, hoặc ném lỗi có thông
 * điệp đọc được nếu giờ đó không hợp lệ.
 */
export function resolveLateCheckOutAt(
  registration: LateCheckOutWindow,
  checkInTime: string,
  declaredTime: string,
  now = new Date(),
) {
  if (!/^\d{2}:\d{2}$/.test(declaredTime)) throw new Error('Hãy chọn giờ bạn đã về theo dạng HH:MM.')
  const checkInAt = new Date(checkInTime)
  if (Number.isNaN(checkInAt.getTime())) throw new Error('Bản ghi này không có giờ vào hợp lệ.')
  const scheduledEnd = scheduledEndAt(registration)
  // Ca qua đêm: giờ khai nhỏ hơn hoặc bằng giờ vào ca thì thuộc về ngày hôm sau.
  const crossesMidnight = registration.endTime <= registration.startTime
  const declaredAt = new Date(`${registration.workDate}T${declaredTime}:00`)
  if (Number.isNaN(declaredAt.getTime())) throw new Error('Giờ đã về không hợp lệ.')
  if (crossesMidnight && declaredTime <= registration.startTime.slice(0, 5)) {
    declaredAt.setDate(declaredAt.getDate() + 1)
  }
  if (declaredAt.getTime() <= checkInAt.getTime()) {
    throw new Error(`Giờ về phải sau giờ vào (${checkInAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}).`)
  }
  if (declaredAt.getTime() > scheduledEnd.getTime()) {
    throw new Error(`Khai bù chỉ được tối đa tới giờ tan ca theo lịch (${registration.endTime.slice(0, 5)}). Về muộn hơn thì hãy gửi đơn chỉnh công để Admin duyệt.`)
  }
  if (declaredAt.getTime() > now.getTime()) throw new Error('Không được khai giờ về trong tương lai.')
  return declaredAt
}
