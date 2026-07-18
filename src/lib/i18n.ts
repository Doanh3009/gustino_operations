import { useEffect, useState } from 'react'

export type Lang = 'vi' | 'en'
const STORAGE_KEY = 'gustino_lang'

export function getLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'vi'
  } catch {
    return 'vi'
  }
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Some mobile/private browsers block storage; the event still refreshes the UI.
  }
  window.dispatchEvent(new CustomEvent('lang-change'))
  window.requestAnimationFrame(() => applyLanguageToDocument(lang))
}

export function toggleLang() {
  setLang(getLang() === 'en' ? 'vi' : 'en')
}

export function useLang(): Lang {
  const [lang, setCurrentLang] = useState<Lang>(() => getLang())
  useEffect(() => {
    const handler = () => setCurrentLang(getLang())
    window.addEventListener('lang-change', handler)
    return () => window.removeEventListener('lang-change', handler)
  }, [])
  return lang
}

export function applyLanguageToDocument(lang: Lang = getLang()) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang
  document.body.dataset.lang = lang
  if (document.title && /dashboard|management|inventory|payroll|handover|close shift/i.test(document.title)) {
    document.title = 'GUSTINO'
  }
}

const VI_TEXT = {
  today: 'Hôm nay',
  inventory: 'Làm hàng',
  handover: 'Bàn giao',
  report: 'Cuối ca',
  history: 'Lịch sử',
  restaurant: 'Quản lý cửa hàng',
  management: 'Tổng hợp',
  attendance: 'Chấm công',
  kitchen: 'Đặt bếp',
  myApps: 'Chọn ứng dụng',
  logout: 'Đăng xuất',
  launcherSubtitle: 'HẠT DẺ ÔNG LÝ',
  launcherHeading: 'Hôm nay bạn muốn làm gì?',
  launcherHint: 'Chạm vào một biểu tượng để bắt đầu.',
  chooseApp: 'CHỌN ỨNG DỤNG',
  tileOperations: 'Vận hành cửa hàng',
  tileOperationsSub: 'Kho · Bán hàng · Báo cáo ca',
  tileAttendance: 'Chấm công',
  tileAttendanceSub: 'Thêm ca · Check-in selfie · Bảng công',
  tileManagement: 'Tổng hợp quản lý',
  tileManagementSub: 'Công làm · Tồn kho · Kiểm kê · Cảnh báo',
  tileKitchen: 'Đặt bếp',
  tileKitchenSub: 'Nhận đơn từ ca trưởng, bật chuông và xác nhận đã xử lý.',
  kitchenEyebrow: 'MÀN HÌNH BẾP',
  kitchenHeading: 'Đơn đặt bếp từ ca trưởng',
  kitchenHint: 'Giữ màn hình này mở. Khi có đơn mới, bếp sẽ thấy thẻ màu vàng và nghe chuông sau khi bật âm thanh.',
  kitchenBellOn: 'BẬT',
  kitchenBellEnable: 'BẬT',
  kitchenBellEnabled: 'Chuông đang bật',
  kitchenBellButton: 'Bật chuông bếp',
  kitchenBellFeedback: 'Đã bật chuông bếp. Hãy giữ trang này mở để nghe đơn mới.',
  kitchenPending: 'Chờ xác nhận',
  kitchenWorking: 'Đã xác nhận',
  kitchenDone: 'Đã gửi',
  kitchenNewOrders: 'Đơn mới',
  kitchenInProgress: 'Đã xác nhận',
  kitchenCompleted: 'Đã gửi',
  kitchenLoading: 'Đang tải đơn...',
  kitchenNoNew: 'Chưa có đơn mới.',
  kitchenNoWorking: 'Chưa có đơn đã xác nhận.',
  kitchenNoDone: 'Chưa có đơn đã gửi.',
  kitchenAccept: 'Xác nhận đơn',
  kitchenFinish: 'Đã gửi hàng',
  kitchenSaving: 'Đang lưu...',
  kitchenAcceptedFeedback: 'Bếp đã xác nhận đơn.',
  kitchenFinishedFeedback: 'Bếp đã đánh dấu đã gửi hàng.',
  kitchenUpdateError: 'Không thể cập nhật đơn.',
  kitchenLoadError: 'Không thể tải đơn đặt bếp.',
  kitchenNotificationTitle: 'Có đơn đặt bếp mới',
  kitchenNotificationFallback: 'Ca trưởng vừa gửi đơn mới.',
  roleAdmin: 'Quản trị hệ thống',
  roleManager: 'Quản lý',
  roleShiftLeader: 'Ca trưởng',
  roleStaff: 'Nhân viên',
  roleKitchen: 'Bếp',
} as const

const EN_TEXT: Record<keyof typeof VI_TEXT, string> = {
  today: 'Today',
  inventory: 'Inventory',
  handover: 'Shift handover',
  report: 'Close shift',
  history: 'History',
  restaurant: 'Store management',
  management: 'Management',
  attendance: 'Attendance',
  kitchen: 'Kitchen',
  myApps: 'Choose app',
  logout: 'Log out',
  launcherSubtitle: 'GUSTINO OPERATIONS',
  launcherHeading: 'What would you like to do today?',
  launcherHint: 'Tap an app to start.',
  chooseApp: 'CHOOSE APP',
  tileOperations: 'Store operations',
  tileOperationsSub: 'Inventory · Sales · Shift reports',
  tileAttendance: 'Attendance',
  tileAttendanceSub: 'Add shifts · Selfie check-in · Timesheets',
  tileManagement: 'Management overview',
  tileManagementSub: 'Hours · Stock · Counts · Alerts',
  tileKitchen: 'Kitchen',
  tileKitchenSub: 'Receive orders from shift leaders, keep the bell on, and confirm progress.',
  kitchenEyebrow: 'KITCHEN SCREEN',
  kitchenHeading: 'Kitchen orders from shift leaders',
  kitchenHint: 'Keep this screen open. New orders appear in yellow and the bell rings after sound is enabled.',
  kitchenBellOn: 'ON',
  kitchenBellEnable: 'ON',
  kitchenBellEnabled: 'Bell enabled',
  kitchenBellButton: 'Enable kitchen bell',
  kitchenBellFeedback: 'Kitchen bell enabled. Keep this page open to hear new orders.',
  kitchenPending: 'Awaiting confirmation',
  kitchenWorking: 'Confirmed',
  kitchenDone: 'Sent',
  kitchenNewOrders: 'New orders',
  kitchenInProgress: 'Confirmed',
  kitchenCompleted: 'Sent',
  kitchenLoading: 'Loading orders...',
  kitchenNoNew: 'No new orders.',
  kitchenNoWorking: 'No confirmed orders.',
  kitchenNoDone: 'No sent orders.',
  kitchenAccept: 'Confirm order',
  kitchenFinish: 'Mark as sent',
  kitchenSaving: 'Saving...',
  kitchenAcceptedFeedback: 'Kitchen confirmed the order.',
  kitchenFinishedFeedback: 'Kitchen marked the order as sent.',
  kitchenUpdateError: 'Could not update the order.',
  kitchenLoadError: 'Could not load kitchen orders.',
  kitchenNotificationTitle: 'New kitchen order',
  kitchenNotificationFallback: 'A shift leader sent a new order.',
  roleAdmin: 'System Admin',
  roleManager: 'Manager',
  roleShiftLeader: 'Shift Leader',
  roleStaff: 'Staff',
  roleKitchen: 'Kitchen',
} as const

export const T = {
  vi: VI_TEXT,
  en: EN_TEXT,
} as const
