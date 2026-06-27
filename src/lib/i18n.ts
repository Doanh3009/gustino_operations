import { useEffect, useState } from 'react'

export type Lang = 'vi' | 'en'
const STORAGE_KEY = 'gustino_lang'

export function getLang(): Lang {
  return 'vi'
}

export function toggleLang() {
  localStorage.setItem(STORAGE_KEY, 'vi')
  window.dispatchEvent(new CustomEvent('lang-change'))
}

export function useLang(): Lang {
  const [lang, setLang] = useState<Lang>(getLang)
  useEffect(() => {
    const handler = () => setLang(getLang())
    window.addEventListener('lang-change', handler)
    return () => window.removeEventListener('lang-change', handler)
  }, [])
  return lang
}

export const T = {
  vi: {
    // Nav items
    today: 'Hôm nay',
    inventory: 'Làm hàng',
    handover: 'Bàn giao',
    report: 'Cuối ca',
    history: 'Lịch sử',
    restaurant: 'Quản lý cửa hàng',
    management: 'Tổng hợp',
    attendance: 'Chấm công',
    kitchen: 'Đặt bếp',
    // App shell
    myApps: 'Chọn ứng dụng',
    logout: 'Đăng xuất',
    // Launcher
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
    // Kitchen
    kitchenEyebrow: 'MÀN HÌNH BẾP',
    kitchenHeading: 'Đơn đặt bếp từ ca trưởng',
    kitchenHint: 'Giữ màn hình này mở. Khi có đơn mới, bếp sẽ thấy thẻ màu vàng và nghe chuông sau khi bật âm thanh.',
    kitchenBellOn: 'BẬT',
    kitchenBellEnable: 'BẬT',
    kitchenBellEnabled: 'Chuông đang bật',
    kitchenBellButton: 'Bật chuông bếp',
    kitchenBellFeedback: 'Đã bật chuông bếp. Hãy giữ trang này mở để nghe đơn mới.',
    kitchenPending: 'Chờ bếp nhận',
    kitchenWorking: 'Đang xử lý',
    kitchenDone: 'Đã xong',
    kitchenNewOrders: 'Đơn mới',
    kitchenInProgress: 'Đang làm',
    kitchenCompleted: 'Đã hoàn thành',
    kitchenLoading: 'Đang tải đơn...',
    kitchenNoNew: 'Chưa có đơn mới.',
    kitchenNoWorking: 'Chưa có đơn đang xử lý.',
    kitchenNoDone: 'Chưa có đơn hoàn thành.',
    kitchenAccept: 'Bếp đã nhận',
    kitchenFinish: 'Hoàn thành',
    kitchenSaving: 'Đang lưu...',
    kitchenAcceptedFeedback: 'Bếp đã nhận đơn.',
    kitchenFinishedFeedback: 'Đơn đã hoàn thành.',
    kitchenUpdateError: 'Không thể cập nhật đơn.',
    kitchenLoadError: 'Không thể tải đơn đặt bếp.',
    kitchenNotificationTitle: 'Có đơn đặt bếp mới',
    kitchenNotificationFallback: 'Ca trưởng vừa gửi đơn mới.',
    roleAdmin: 'Admin',
    roleManager: 'Admin',
    roleShiftLeader: 'Ca trưởng',
    roleStaff: 'Nhân viên',
    roleKitchen: 'Bếp',
  },
  en: {
    // Nav items
    today: 'Hôm nay',
    inventory: 'Làm hàng',
    handover: 'Bàn giao',
    report: 'Cuối ca',
    history: 'Lịch sử',
    restaurant: 'Quản lý cửa hàng',
    management: 'Tổng hợp',
    attendance: 'Chấm công',
    kitchen: 'Đặt bếp',
    // App shell
    myApps: 'Chọn ứng dụng',
    logout: 'Đăng xuất',
    // Launcher
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
    // Kitchen
    kitchenEyebrow: 'MÀN HÌNH BẾP',
    kitchenHeading: 'Đơn đặt bếp từ ca trưởng',
    kitchenHint: 'Giữ màn hình này mở. Khi có đơn mới, bếp sẽ thấy thẻ màu vàng và nghe chuông sau khi bật âm thanh.',
    kitchenBellOn: 'BẬT',
    kitchenBellEnable: 'BẬT',
    kitchenBellEnabled: 'Chuông đang bật',
    kitchenBellButton: 'Bật chuông bếp',
    kitchenBellFeedback: 'Đã bật chuông bếp. Hãy giữ trang này mở để nghe đơn mới.',
    kitchenPending: 'Chờ bếp nhận',
    kitchenWorking: 'Đang xử lý',
    kitchenDone: 'Đã xong',
    kitchenNewOrders: 'Đơn mới',
    kitchenInProgress: 'Đang làm',
    kitchenCompleted: 'Đã hoàn thành',
    kitchenLoading: 'Đang tải đơn...',
    kitchenNoNew: 'Chưa có đơn mới.',
    kitchenNoWorking: 'Chưa có đơn đang xử lý.',
    kitchenNoDone: 'Chưa có đơn hoàn thành.',
    kitchenAccept: 'Bếp đã nhận',
    kitchenFinish: 'Hoàn thành',
    kitchenSaving: 'Đang lưu...',
    kitchenAcceptedFeedback: 'Bếp đã nhận đơn.',
    kitchenFinishedFeedback: 'Đơn đã hoàn thành.',
    kitchenUpdateError: 'Không thể cập nhật đơn.',
    kitchenLoadError: 'Không thể tải đơn đặt bếp.',
    kitchenNotificationTitle: 'Có đơn đặt bếp mới',
    kitchenNotificationFallback: 'Ca trưởng vừa gửi đơn mới.',
    roleAdmin: 'Admin',
    roleManager: 'Admin',
    roleShiftLeader: 'Ca trưởng',
    roleStaff: 'Nhân viên',
    roleKitchen: 'Bếp',
  },
} as const
