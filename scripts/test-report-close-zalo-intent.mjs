import { readFile } from 'node:fs/promises'

const [reportPage, deliveryIntent, store, types] = await Promise.all([
  readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/reportDeliveryIntent.ts', import.meta.url), 'utf8').catch(() => ''),
  readFile(new URL('../src/lib/store.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/types.ts', import.meta.url), 'utf8'),
])

const failures = []
const saveCloudStart = reportPage.indexOf('async function saveCloud(')
const saveCloudEnd = reportPage.indexOf('async function reopenDay()', saveCloudStart)
const saveCloud = saveCloudStart >= 0 && saveCloudEnd > saveCloudStart
  ? reportPage.slice(saveCloudStart, saveCloudEnd)
  : ''

if (!deliveryIntent.includes("sequence === 1 ? ['shift-1'] : ['shift-2', 'day']")) {
  failures.push('Chưa khóa quy tắc Ca 1 chỉ yêu cầu shift-1, Ca 2 yêu cầu shift-2 và day.')
}
if (!deliveryIntent.includes("status: 'pending_connection'")) {
  failures.push('Chưa có trạng thái ý định gửi Zalo chờ bạn tích hợp kết nối.')
}
if (!saveCloud.includes('createZaloReportIntent')) {
  failures.push('Nút Chốt báo cáo chưa tạo ý định gửi Zalo trong snapshot.')
}
if (!saveCloud.includes('zaloIntent')) {
  failures.push('Luồng chốt chưa lưu zaloIntent theo ca.')
}
if (!saveCloud.includes('queueCurrentReportImages(freshLeaderShiftSession, true)')) {
  failures.push('Bàn giao chưa tự động đưa đúng gói ảnh báo cáo vào n8n để gửi ngay.')
}
if (!saveCloud.includes('saveShiftReportSnapshot(user, businessDate, shiftEntry)')) {
  failures.push('Ca 1 không còn lưu riêng snapshot ca.')
}
if (!saveCloud.includes('finalizeDailyReport(user, businessDate')) {
  failures.push('Ca 2 không còn chốt báo cáo ngày.')
}
if (!saveCloud.includes('freshDailyReport.openShiftCount > 0')) {
  failures.push('Ca 2 thiếu chốt chặn không được đóng ngày khi còn ca mở.')
}
if (!reportPage.includes("window.sessionStorage.removeItem('gustino:handover-report')")) {
  failures.push('Ý định bàn giao chưa được xóa sau khi lưu và gửi báo cáo thành công.')
}
if (!reportPage.includes('Về màn hình chính')) {
  failures.push('Màn hoàn tất bàn giao chưa có lối về màn hình chính.')
}
if (!store.includes('zaloIntent?: Record<string, unknown>') || !types.includes('zaloIntent?: Record<string, unknown>')) {
  failures.push('Kiểu snapshot chưa chừa trường zaloIntent cho phần tích hợp sau.')
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}

console.log('REPORT_CLOSE_ZALO_INTENT_OK')
