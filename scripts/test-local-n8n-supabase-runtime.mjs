import { readFile } from 'node:fs/promises'

const [lanServer, cloudApi, client] = await Promise.all([
  readFile(new URL('./lan-server.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../api/n8n-report-image.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/n8nReports.ts', import.meta.url), 'utf8'),
])

const failures = []
if (!lanServer.includes('authenticatedSupabaseReportOperator')) failures.push('API local chưa xác thực token Supabase cho người dùng web local.')
if (!lanServer.includes('verifySupabaseReportShiftAndSnapshot')) failures.push('API local chưa kiểm tra ca/snapshot trực tiếp trên Supabase khi phiên là Supabase.')
if (!lanServer.includes('persistSupabaseN8nDelivery')) failures.push('API local chưa lưu trạng thái queue về snapshot Supabase.')
if (!lanServer.includes('N8N_WEBHOOK_TIMEOUT_MS') || !cloudApi.includes('N8N_WEBHOOK_TIMEOUT_MS')) failures.push('Lệnh gọi webhook server chưa có timeout cứng ở cả local và cloud API.')
if (!client.includes('N8N_API_TIMEOUT_MS') || !client.includes('AbortController')) failures.push('Frontend chưa ngắt trạng thái loading nếu API n8n không phản hồi.')
if (!client.includes('quá thời gian chờ')) failures.push('Frontend chưa có thông báo timeout dễ hiểu để người dùng retry.')
if (!client.includes('response.text()')) failures.push('Frontend chưa giữ nội dung phản hồi không phải JSON từ proxy/API local.')
if (!client.includes('response.status')) failures.push('Frontend chưa hiển thị mã HTTP khi hàng đợi n8n lỗi.')
if (!client.includes('API n8n local')) failures.push('Frontend chưa hướng dẫn khởi động lại API n8n local khi proxy trả lỗi.')

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}
console.log('LOCAL_N8N_SUPABASE_RUNTIME_OK')
