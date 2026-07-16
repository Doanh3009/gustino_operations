import { readFile } from 'node:fs/promises'

const report = await readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8')
const failures = []

if (!report.includes('canResumeSecondShiftFinalization')) {
  failures.push('Ca 2 chưa có nhánh tiếp tục chốt Tổng ngày khi snapshot ca đã lưu dở từ lần lỗi trước.')
}
if (!report.includes('nextShiftReports')) {
  failures.push('Chốt Ca 2 chưa gộp snapshot ca vào payload finalize Tổng ngày trong cùng luồng.')
}
if (report.includes('disabled={busy || !canFinalize}')) {
  failures.push('Nút Chốt báo cáo vẫn bị khóa cứng nên người dùng không nhận được lý do/không thể retry.')
}
if (!report.includes('finalizeBlockedReason')) {
  failures.push('Trang báo cáo chưa hiển thị lý do cụ thể khi chưa đủ điều kiện chốt.')
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}
console.log('REPORT_FINALIZATION_RETRY_OK')
