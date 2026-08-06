// Phiên đăng nhập tự hết hạn sau 24 giờ.
// Lý do: nhiều lỗi vận hành ("treo đăng nhập", dữ liệu/quyền cũ dính theo phiên để lâu ngày)
// xuất phát từ việc token + hồ sơ trong localStorage sống vô hạn. Ép đăng nhập lại mỗi ngày
// buộc app nạp lại profile/chi nhánh/quyền mới và cắt các phiên hỏng giữa chừng.

export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000

const STARTED_KEY = 'gustino_session_started_v1'
const EXPIRED_NOTICE_KEY = 'gustino_session_expired_notice_v1'

/** Gọi ngay khi đăng nhập thành công để chốt mốc bắt đầu phiên. */
export function markSessionStart(now = Date.now()) {
  try {
    localStorage.setItem(STARTED_KEY, String(now))
  } catch {
    // Trình duyệt chặn localStorage (chế độ riêng tư) thì bỏ qua — không chặn đăng nhập.
  }
}

/** Gọi khi đăng xuất (tự nguyện hoặc bị ép) để phiên kế tiếp tính mốc mới. */
export function clearSessionStart() {
  try {
    localStorage.removeItem(STARTED_KEY)
  } catch {
    // Bỏ qua như trên.
  }
}

/**
 * Phiên hiện tại đã quá 24 giờ chưa?
 * Phiên cũ (đăng nhập trước khi có tính năng này) chưa có mốc → chốt mốc từ bây giờ
 * thay vì đăng xuất ngay, để không đá toàn bộ người dùng cùng lúc khi cập nhật app.
 */
export function sessionExpired(now = Date.now()): boolean {
  return sessionOverdueMs(now) > 0
}

/**
 * Phiên đã quá hạn bao lâu (ms), 0 nếu chưa quá hạn.
 *
 * Mốc tính từ thời điểm ĐĂNG NHẬP trong localStorage, không phải từ lần đầu phát
 * hiện quá hạn — nhờ vậy một khoảng ân hạn (ví dụ chờ gửi nốt bằng chứng chấm
 * công) không bị làm mới mỗi lần mở lại app.
 */
export function sessionOverdueMs(now = Date.now()): number {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STARTED_KEY)
  } catch {
    return 0
  }
  const startedAt = Number(raw)
  if (!raw || !Number.isFinite(startedAt) || startedAt > now) {
    markSessionStart(now)
    return 0
  }
  return Math.max(0, now - startedAt - SESSION_MAX_AGE_MS)
}

/** Đánh dấu "vừa bị đăng xuất vì quá 24 giờ" để màn đăng nhập giải thích lý do. */
export function setSessionExpiredNotice() {
  try {
    localStorage.setItem(EXPIRED_NOTICE_KEY, '1')
  } catch {
    // Bỏ qua.
  }
}

/** Màn đăng nhập đọc (và xóa) cờ thông báo hết phiên. */
export function consumeSessionExpiredNotice(): boolean {
  try {
    const flagged = localStorage.getItem(EXPIRED_NOTICE_KEY) === '1'
    if (flagged) localStorage.removeItem(EXPIRED_NOTICE_KEY)
    return flagged
  } catch {
    return false
  }
}
