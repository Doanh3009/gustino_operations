import { readFile } from 'node:fs/promises'

const [today, report, store, zaloApi, zaloClient, lanServer] = await Promise.all([
  readFile(new URL('../src/pages/TodayPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/store.ts', import.meta.url), 'utf8'),
  readFile(new URL('../api/zalo-shift-report.ts', import.meta.url), 'utf8').catch(() => ''),
  readFile(new URL('../src/lib/zaloReports.ts', import.meta.url), 'utf8').catch(() => ''),
  readFile(new URL('./lan-server.mjs', import.meta.url), 'utf8'),
])

const failures = []
if (!today.includes('latestClosedOwnSession')) failures.push('Today chưa mở bước báo cáo ngay sau ca của chính ca trưởng đóng.')
if (!report.includes('defaultReportScopeForLeader')) failures.push('Báo cáo chưa tự chọn đúng Ca 1/Ca 2 theo ca trưởng.')
if (!report.includes('isSecondShiftFinalization')) failures.push('Nút Chốt báo cáo chưa phân biệt Ca 1 với Ca 2 + Tổng ngày.')
if (report.includes("|| [...bagSessions].sort((a, b) => b.sequence - a.sequence)[0]")) failures.push('Ca trưởng có thể chốt nhầm ca của người khác.')
if (!store.includes('saveShiftReportSnapshot')) failures.push('Chưa lưu trạng thái báo cáo từng ca trong snapshot hiện có.')
if (!zaloClient.includes('sendZaloShiftReports')) failures.push('Frontend chưa gọi sender Zalo sau khi chốt thành công.')
if (!zaloApi.includes('ZALO_GMF_GROUP_ID') || !zaloApi.includes('ZALO_OA_ACCESS_TOKEN')) failures.push('Backend Zalo chưa đọc credential từ secret server.')
if (!zaloApi.includes('reportKinds') || !zaloApi.includes('shift-1')) failures.push('Backend Zalo chưa kiểm soát gói 1 báo cáo Ca 1 / 2 báo cáo Ca 2 + Tổng ngày.')
if (!zaloApi.includes('verifyClosedShiftAndSnapshot') || !zaloApi.includes('previousDelivery')) failures.push('Backend Zalo chưa tự kiểm tra ca đã đóng/snapshot và chống gửi trùng.')
if (!lanServer.includes("url.pathname === '/api/zalo-shift-report'") || !lanServer.includes('user.authenticated')) failures.push('Bản test LAN chưa có sender Zalo phía server với phiên đăng nhập thật.')

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}
console.log('SHIFT_REPORT_ZALO_WORKFLOW_OK')
