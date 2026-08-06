/**
 * Nhận diện môi trường trình duyệt của máy đang chấm công.
 *
 * Lý do tồn tại (BUG-107): tài khoản Cao Bảo Trân (Samsung SM-A235F / Galaxy A23)
 * mở app bằng **trình duyệt trong ứng dụng (Android WebView của Zalo)** — bằng chứng ở
 * `auth.sessions.user_agent`: `... Android 14; SM-A235F Build/UP1A.231005.007;) ... Version/4.0 Chrome/...`.
 * Android WebView chỉ cấp quyền định vị khi app chủ (Zalo) tự cài `onGeolocationPermissionsShowPrompt`
 * VÀ app chủ đang có quyền vị trí của hệ điều hành; nếu không, `getCurrentPosition()`
 * KHÔNG gọi callback nào cả → chấm công treo vô tận. Cùng tài khoản mở bằng Chrome/Safari
 * thì chạy bình thường. Không thể sửa từ phía web — chỉ có thể phát hiện và hướng dẫn.
 */

export type BrowserKind = 'in-app' | 'samsung-internet' | 'chrome' | 'safari' | 'firefox' | 'other'
export type DevicePlatform = 'android' | 'ios' | 'desktop' | 'unknown'
export type GeolocationPermission = 'granted' | 'denied' | 'prompt' | 'unknown'

export interface DeviceEnvironment {
  userAgent: string
  platform: DevicePlatform
  deviceModel: string
  browserKind: BrowserKind
  browserLabel: string
  /** Tên app chủ đang bọc WebView (Zalo/Facebook/…) nếu nhận ra được. */
  hostAppName: string
  isInAppBrowser: boolean
  isSecureContext: boolean
  hasGeolocation: boolean
}

const HOST_APP_PATTERNS: Array<{ test: RegExp; name: string }> = [
  { test: /Zalo/i, name: 'Zalo' },
  { test: /FBAN|FBAV|FB_IAB|FBIOS/i, name: 'Facebook' },
  { test: /Messenger|MessengerLite/i, name: 'Messenger' },
  { test: /Instagram/i, name: 'Instagram' },
  { test: /TikTok|BytedanceWebview|musical_ly/i, name: 'TikTok' },
  { test: /MicroMessenger/i, name: 'WeChat' },
  { test: /Line\//i, name: 'LINE' },
  { test: /Shopee/i, name: 'Shopee' },
]

function readUserAgent() {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent || ''
}

function detectPlatform(agent: string): DevicePlatform {
  if (/Android/i.test(agent)) return 'android'
  if (/iPhone|iPad|iPod/i.test(agent)) return 'ios'
  if (/Windows|Macintosh|X11|Linux/i.test(agent)) return 'desktop'
  return 'unknown'
}

/** `Android 14; SM-A235F Build/UP1A…` → `SM-A235F`. */
function detectDeviceModel(agent: string) {
  const android = agent.match(/Android[\s\d.]*;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?\s*[;)]/i)
  if (android?.[1]) {
    const model = android[1].trim()
    // Chrome hiện đại rút gọn UA thành `Android 10; K` — không mang thông tin máy.
    return model === 'K' || /^wv$/i.test(model) ? '' : model
  }
  if (/iPhone/i.test(agent)) return 'iPhone'
  if (/iPad/i.test(agent)) return 'iPad'
  return ''
}

/**
 * WebView Android nhận ra qua 3 dấu hiệu (chỉ cần 1):
 * `; wv)` (WebView chuẩn), `Version/4.0` đi kèm `Chrome/` (WebView cũ), hoặc token
 * `Build/…` (Chrome thật đã bỏ token này từ lâu, chỉ WebView còn giữ).
 */
function isAndroidWebView(agent: string) {
  if (!/Android/i.test(agent)) return false
  if (/;\s*wv\)/i.test(agent)) return true
  if (/\bBuild\//i.test(agent)) return true
  return /Version\/\d+(\.\d+)?/i.test(agent) && /Chrome\//i.test(agent)
}

/** WebView trong app trên iOS không có `Safari/` ở cuối UA (khác hẳn Safari thật). */
function isIosWebView(agent: string) {
  if (!/iPhone|iPad|iPod/i.test(agent)) return false
  if (/CriOS|FxiOS|EdgiOS/i.test(agent)) return false
  return !/Safari\//i.test(agent)
}

export function detectDeviceEnvironment(): DeviceEnvironment {
  const agent = readUserAgent()
  const platform = detectPlatform(agent)
  const hostApp = HOST_APP_PATTERNS.find((item) => item.test.test(agent))?.name || ''
  const inApp = Boolean(hostApp) || isAndroidWebView(agent) || isIosWebView(agent)
  const browserKind: BrowserKind = inApp
    ? 'in-app'
    : /SamsungBrowser\//i.test(agent)
      ? 'samsung-internet'
      : /Firefox\/|FxiOS/i.test(agent)
        ? 'firefox'
        : /CriOS|Chrome\//i.test(agent)
          ? 'chrome'
          : /Safari\//i.test(agent)
            ? 'safari'
            : 'other'
  return {
    userAgent: agent,
    platform,
    deviceModel: detectDeviceModel(agent),
    browserKind,
    browserLabel: browserLabelFor(browserKind, hostApp),
    hostAppName: hostApp,
    isInAppBrowser: inApp,
    isSecureContext: typeof window === 'undefined' ? true : window.isSecureContext !== false,
    hasGeolocation: typeof navigator !== 'undefined' && Boolean(navigator.geolocation),
  }
}

/**
 * Kết quả một hộp thoại xác nhận. `suppressed` = máy KHÔNG hiện hộp thoại chứ
 * không phải người dùng bấm Hủy.
 */
export type ConfirmOutcome = 'accepted' | 'declined' | 'suppressed'

/**
 * Người thật không thể đọc xong một hộp xác nhận nhiều dòng rồi bấm Hủy trong
 * ngần này. Trả `false` nhanh hơn mốc này = máy tự đóng, không phải người bấm.
 */
const DIALOG_MIN_HUMAN_MS = 250

/**
 * `window.confirm` AN TOÀN — dùng cho mọi thao tác ghi/xoá kho.
 *
 * Vì sao cần (BUG-137): trong Android WebView, `window.confirm()` chỉ hoạt động
 * khi app chủ tự cài `WebChromeClient.onJsConfirm()`. Zalo/Facebook không cài,
 * nên hàm **trả `false` ngay lập tức mà không hiện gì cả** — đúng cùng cơ chế đã
 * làm `getCurrentPosition()` chết câm ở BUG-107, trên cùng nhóm máy đó
 * (`auth.sessions.user_agent` cho thấy SM-A235F chạy WebView trong Zalo).
 *
 * Hậu quả với `if (!window.confirm(...)) return`: ca trưởng bấm Lưu, KHÔNG có
 * hộp thoại, KHÔNG có thông báo, KHÔNG gọi mạng, không ghi gì — mà màn hình vẫn
 * yên như đã lưu. Đây là kiểu hỏng tệ nhất vì nó vô hình.
 *
 * Hàm này phân biệt "người bấm Hủy" với "máy nuốt hộp thoại" để lớp gọi LUÔN
 * nói được điều gì đó. Không bao giờ tự ý coi `suppressed` là đồng ý.
 */
export function confirmRisky(message: string): ConfirmOutcome {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return 'suppressed'
  const startedAt = Date.now()
  let accepted = false
  try {
    accepted = window.confirm(message)
  } catch {
    // Một số WebView ném thẳng thay vì trả false.
    return 'suppressed'
  }
  if (accepted) return 'accepted'
  const instant = Date.now() - startedAt < DIALOG_MIN_HUMAN_MS
  return instant && detectDeviceEnvironment().isInAppBrowser ? 'suppressed' : 'declined'
}

/** Câu thông báo cho lớp UI khi thao tác KHÔNG được thực hiện. Không bao giờ rỗng. */
export function confirmBlockedMessage(outcome: Exclude<ConfirmOutcome, 'accepted'>, action = 'Thao tác'): string {
  if (outcome === 'declined') return `${action} đã hủy — chưa có gì được lưu.`
  const label = detectDeviceEnvironment().browserLabel.toLowerCase()
  return `${action} CHƯA được thực hiện: thiết bị không hiện được hộp xác nhận vì bạn đang mở bằng ${label}.`
    + ' Hãy mở app bằng Chrome hoặc Safari rồi làm lại.'
}

function browserLabelFor(kind: BrowserKind, hostApp: string) {
  if (kind === 'in-app') return hostApp ? `Trình duyệt trong ${hostApp}` : 'Trình duyệt trong ứng dụng'
  if (kind === 'samsung-internet') return 'Samsung Internet'
  if (kind === 'chrome') return 'Chrome'
  if (kind === 'safari') return 'Safari'
  if (kind === 'firefox') return 'Firefox'
  return 'Trình duyệt khác'
}

/** Trạng thái quyền vị trí, KHÔNG bật hộp thoại xin quyền. `unknown` nếu máy không hỗ trợ Permissions API. */
export async function readGeolocationPermission(): Promise<GeolocationPermission> {
  try {
    const permissions = navigator.permissions
    if (!permissions?.query) return 'unknown'
    const status = await permissions.query({ name: 'geolocation' as PermissionName })
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') return status.state
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

export function attendanceAppUrl() {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}#attendance`
}

/**
 * Thoát khỏi WebView sang trình duyệt hệ thống.
 * Android dùng `intent://` (Chrome); nếu app chủ chặn thì người dùng vẫn còn nút sao chép link.
 */
export function openInSystemBrowser(url = attendanceAppUrl()) {
  if (!url || typeof window === 'undefined') return false
  const environment = detectDeviceEnvironment()
  if (environment.platform === 'android') {
    const withoutScheme = url.replace(/^https?:\/\//i, '')
    window.location.href = `intent://${withoutScheme}#Intent;scheme=https;package=com.android.chrome;end`
    return true
  }
  const opened = window.open(url, '_blank', 'noopener')
  return Boolean(opened)
}

/** Sao chép link; WebView cũ thiếu Clipboard API nên có nhánh dự phòng bằng textarea. */
export async function copyAttendanceLink(url = attendanceAppUrl()) {
  if (!url) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
      return true
    }
  } catch {
    // rơi xuống nhánh dự phòng
  }
  try {
    const field = document.createElement('textarea')
    field.value = url
    field.setAttribute('readonly', 'true')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    return copied
  } catch {
    return false
  }
}

export interface DeviceReadinessIssue {
  id: 'in-app-browser' | 'insecure-context' | 'no-geolocation' | 'location-denied'
  level: 'blocker' | 'warning'
  title: string
  detail: string
}

/** Những rào cản khiến máy KHÔNG chấm công được, diễn đạt để nhân viên tự xử lý. */
export function deviceReadinessIssues(
  environment: DeviceEnvironment,
  permission: GeolocationPermission,
): DeviceReadinessIssue[] {
  const issues: DeviceReadinessIssue[] = []
  if (environment.isInAppBrowser) {
    const host = environment.hostAppName || 'ứng dụng khác'
    issues.push({
      id: 'in-app-browser',
      level: 'blocker',
      title: `Bạn đang mở app trong ${host}, không chấm công được`,
      detail: `Trình duyệt bên trong ${host} không cấp được quyền định vị cho web, nên nút chấm công sẽ quay mãi hoặc báo lỗi vị trí. Hãy mở bằng Chrome (Android) hoặc Safari (iPhone) rồi đăng nhập lại.`,
    })
  }
  if (!environment.isSecureContext) {
    issues.push({
      id: 'insecure-context',
      level: 'blocker',
      title: 'Đường link không phải HTTPS',
      detail: 'Trình duyệt chỉ cho lấy vị trí trên link HTTPS. Hãy mở đúng địa chỉ https://gustino-operations.vercel.app.',
    })
  }
  if (!environment.hasGeolocation) {
    issues.push({
      id: 'no-geolocation',
      level: 'blocker',
      title: 'Trình duyệt này không có chức năng định vị',
      detail: 'Hãy mở app bằng Chrome hoặc Safari bản mới để chấm công.',
    })
  }
  if (permission === 'denied') {
    issues.push({
      id: 'location-denied',
      level: 'blocker',
      title: 'Quyền vị trí đang bị chặn',
      detail: environment.platform === 'ios'
        ? 'Vào Cài đặt → Quyền riêng tư & Bảo mật → Dịch vụ định vị → Safari Websites → Khi dùng ứng dụng, đồng thời bật Vị trí chính xác.'
        : 'Bấm biểu tượng ổ khoá cạnh địa chỉ web → Quyền → bật Vị trí, đồng thời bật Vị trí (GPS) trong Cài đặt máy rồi tải lại trang.',
    })
  }
  return issues
}
