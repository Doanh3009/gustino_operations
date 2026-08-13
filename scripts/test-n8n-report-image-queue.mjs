import { readFile } from 'node:fs/promises'

const [reportPage, n8nClient, n8nApi, lanServer, store, types, envExample] = await Promise.all([
  readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/n8nReports.ts', import.meta.url), 'utf8').catch(() => ''),
  readFile(new URL('../api/n8n-report-image.ts', import.meta.url), 'utf8').catch(() => ''),
  readFile(new URL('./lan-server.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/store.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/types.ts', import.meta.url), 'utf8'),
  readFile(new URL('../.env.example', import.meta.url), 'utf8'),
])

const failures = []

if (!reportPage.includes('queueN8nReportImages')) failures.push('Trang báo cáo chưa gọi hàng đợi ảnh n8n khi chốt.')
if (!reportPage.includes('captureReportPosterBlob')) failures.push('Trang báo cáo chưa tái sử dụng bộ chụp ReportPoster hiện có.')
if (!reportPage.includes("'shift-1'") || !reportPage.includes("'shift-2'") || !reportPage.includes("'day'")) {
  failures.push('Trang báo cáo chưa chuẩn bị đủ ảnh Ca 1, Ca 2 và Tổng ngày.')
}
if (!reportPage.includes('n8nPosterRefs') || !reportPage.includes('<ReportPoster')) {
  failures.push('Ảnh tự động chưa dùng chính component ReportPoster của web.')
}
if (!reportPage.includes('sendReportToZalo') || !reportPage.includes('Gửi Zalo')) {
  failures.push('Báo cáo đã chốt chưa giữ một hành động gửi/retry Zalo tinh gọn.')
}
if (!reportPage.includes('window.confirm') || !reportPage.includes('có thể gửi trùng')) {
  failures.push('Gửi Zalo chưa cảnh báo nguy cơ gửi trùng trước khi bypass idempotency.')
}

if (!n8nClient.includes("fetch('/api/n8n-report-image'")) failures.push('Thiếu client gọi API proxy n8n cùng origin.')
if (!n8nClient.includes('imageBase64')) failures.push('Client chưa gửi ảnh infographic dạng base64 cho server.')
if (!n8nClient.includes('Bearer')) failures.push('Client n8n chưa gửi token phiên đăng nhập để server xác thực.')
if (!n8nClient.includes('sendNow?: boolean') || !n8nClient.includes('gửi ngay')) {
  failures.push('Client n8n chưa có contract và thông báo gửi ngay.')
}

if (!n8nApi.includes('N8N_REPORT_WEBHOOK_URL') || !n8nApi.includes('N8N_REPORT_WEBHOOK_TOKEN')) {
  failures.push('API n8n chưa đọc webhook/token từ secret server.')
}
if (!n8nApi.includes("'x-gustino-token'")) failures.push('API n8n chưa gửi Header Auth đã thống nhất với workflow.')
if (!n8nApi.includes('webhookResponse.status === 403') || !n8nApi.includes('IP Whitelist')) {
  failures.push('API cloud chưa hướng dẫn đúng Header Auth/IP Whitelist khi n8n trả 403.')
}
if (!n8nApi.includes('await webhookResponse.text()') || !n8nApi.includes('N8N_ERROR_DETAIL_MAX_CHARS') || !n8nApi.includes('Executions')) {
  failures.push('API cloud chưa giữ chi tiết JSON có giới hạn khi workflow n8n trả 500.')
}
// Lịch gửi phải khớp `REPORT_DUE_TIMES` (src/lib/reportSchedule.ts): Ca 1 lúc 15:15,
// Ca 2 và Tổng ngày lúc 22:15 — đúng hai mốc mà app tự chốt & gửi báo cáo.
if (!n8nApi.includes("'shift-1': '15:15'") || !n8nApi.includes("'shift-2': '22:15'") || !n8nApi.includes("day: '22:15'")) {
  failures.push('API n8n chưa khóa đúng lịch 15:15 và 22:15.')
}
if (!n8nApi.includes('verifyClosedShiftAndSnapshot') || !n8nApi.includes('previousDelivery')) {
  failures.push('API n8n chưa tự kiểm tra ca đã đóng/snapshot và chống queue trùng.')
}
// Chống gửi trùng ở API cloud bám `force`, KHÔNG bám `sendNow`: app luôn gửi
// sendNow=true nên `!sendNow` từng làm chống-trùng vô hiệu. Chỉ nút "Gửi Zalo" thủ
// công (người dùng đã xác nhận chấp nhận trùng) mới đặt force=true.
if (!n8nApi.includes('input.sendNow === true') || !n8nApi.includes('previousJob?.queued === true && !force') || !n8nApi.includes('send_now: sendNow')) {
  failures.push('API cloud chưa cho gửi ngay bypass đúng queued short-circuit và báo cờ cho n8n.')
}
if (!n8nApi.includes('n8nImmediateOnlyAck') || !n8nApi.includes('When Last Node Finishes')) {
  failures.push('API cloud vẫn có thể đánh dấu queued khi n8n chỉ trả ACK Immediately trước Drive/Sheet.')
}
if (!n8nApi.includes('n8nCompletedIngestion') || !n8nApi.includes('expectedJobKey') || !n8nApi.includes('row_number') || !n8nApi.includes("toUpperCase() === 'READY'") || !n8nApi.includes('chưa xác nhận đã ghi Sheet')) {
  failures.push('API cloud chưa chấp nhận bằng chứng Sheet tương thích: đúng job_key và row_number hoặc status READY.')
}
if (!n8nApi.includes('image_base64') || !n8nApi.includes('job_key') || !n8nApi.includes('send_at')) {
  failures.push('Payload webhook chưa khớp các field đã cấu hình trong n8n.')
}
if (n8nApi.includes('VITE_N8N_') || envExample.includes('VITE_N8N_')) {
  failures.push('Secret n8n không được phép đặt trong biến VITE_ phía trình duyệt.')
}

if (!lanServer.includes("url.pathname === '/api/n8n-report-image'") || !lanServer.includes('N8N_REPORT_WEBHOOK_URL')) {
  failures.push('LAN server chưa có proxy n8n tương đương.')
}
if (!lanServer.includes('webhookResponse.status === 403') || !lanServer.includes('IP Whitelist')) {
  failures.push('LAN server chưa hướng dẫn đúng Header Auth/IP Whitelist khi n8n trả 403.')
}
if (!lanServer.includes('await webhookResponse.text()') || !lanServer.includes('N8N_ERROR_DETAIL_MAX_CHARS') || !lanServer.includes('Executions')) {
  failures.push('LAN server chưa giữ chi tiết JSON có giới hạn khi workflow n8n trả 500.')
}
if (!lanServer.includes('user.authenticated')) failures.push('LAN proxy n8n chưa yêu cầu phiên đăng nhập thật.')
if (!lanServer.includes('input.sendNow === true') || !lanServer.includes('previousJob?.queued === true && !sendNow') || !lanServer.includes('send_now: sendNow')) {
  failures.push('LAN server chưa cho gửi ngay bypass đúng queued short-circuit và báo cờ cho n8n.')
}
if (!lanServer.includes('n8nImmediateOnlyAck') || !lanServer.includes('When Last Node Finishes')) {
  failures.push('LAN server vẫn có thể đánh dấu queued khi n8n chỉ trả ACK Immediately trước Drive/Sheet.')
}
if (!lanServer.includes('n8nCompletedIngestion') || !lanServer.includes('expectedJobKey') || !lanServer.includes('row_number') || !lanServer.includes("toUpperCase() === 'READY'") || !lanServer.includes('chưa xác nhận đã ghi Sheet')) {
  failures.push('LAN server chưa chấp nhận bằng chứng Sheet tương thích: đúng job_key và row_number hoặc status READY.')
}
if (!store.includes('n8nDelivery') || !types.includes('n8nDelivery')) failures.push('Snapshot chưa lưu trạng thái queue n8n để retry/idempotent.')
if (!envExample.includes('N8N_REPORT_WEBHOOK_URL') || !envExample.includes('N8N_REPORT_ENABLED')) {
  failures.push('.env.example chưa tài liệu hóa cấu hình n8n server-only.')
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}

console.log('N8N_REPORT_IMAGE_QUEUE_OK')
