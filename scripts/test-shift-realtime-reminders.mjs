import { readFile } from 'node:fs/promises'

const attendance = await readFile(new URL('../src/pages/AttendancePage.tsx', import.meta.url), 'utf8')
const today = await readFile(new URL('../src/pages/TodayPage.tsx', import.meta.url), 'utf8')
const handover = await readFile(new URL('../src/pages/ShiftHandoverPage.tsx', import.meta.url), 'utf8')
const shell = await readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8')
const lan = await readFile(new URL('./lan-server.mjs', import.meta.url), 'utf8')

const failures = []
if (!attendance.includes('openShiftAfterLeaderCheckIn')) failures.push('Check-in ca trưởng chưa nối với tự mở ca.')
if (!today.includes("title: 'Chụp hình quầy đầu ca'") || !today.includes("title: 'Chụp hình quầy cuối ca'")) failures.push('Trang Hôm nay chưa đặt ảnh đầu ca ở bước 1 và ảnh cuối ca ở bước cuối.')
if (handover.includes('>Nhận ca</button>')) failures.push('Trang Bàn giao vẫn phụ thuộc nút Nhận ca thủ công.')
if (!handover.includes('autoStartAttemptRef')) failures.push('Trang Bàn giao chưa tự phục hồi việc mở ca sau check-in.')
if (!today.includes("table: 'sales_receipts'") || !today.includes("table: 'bag_shift_sessions'") || !today.includes('8000')) failures.push('Trang Hôm nay chưa realtime/poll liên tục dữ liệu bán và ca.')
if (!shell.includes('new Date().getDay() === 0') || !shell.includes('sunday-shift-popup')) failures.push('Chưa có popup đăng ký ca chỉ vào Chủ nhật.')
if (!shell.includes('CapybaraMascot') || !today.includes('capybara-mascot')) failures.push('Nhắc việc chưa có capybara chuyển động.')
if (!lan.includes("item.businessDate !== session.businessDate") || !lan.includes('session.sequence = store.bagShiftSessions.filter')) failures.push('LAN chưa tự đóng ca ngày cũ và tính sequence riêng theo ngày.')

if (failures.length) {
  console.error(failures.map((item) => `FAIL: ${item}`).join('\n'))
  process.exit(1)
}
console.log('SHIFT_REALTIME_REMINDERS_OK')
