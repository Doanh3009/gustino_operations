import { readFile } from 'node:fs/promises'

// Khoá lại bản vá "quên gửi báo cáo tổng ngày" + "bấm nhầm bàn giao ca tối":
//  1) yêu cầu chốt báo cáo sống qua lần đóng app (localStorage, không sessionStorage);
//  2) có bước xác nhận (capybara hỏi lại) trước khi bàn giao;
//  3) AppShell nhắc "báo cáo chưa gửi" ở mọi trang cho ca trưởng;
//  4) mở lại ngày thì bật lại lời nhắc để buộc chốt & gửi lại.

const request = await readFile(new URL('../src/lib/handoverReportRequest.ts', import.meta.url), 'utf8')
const handover = await readFile(new URL('../src/pages/ShiftHandoverPage.tsx', import.meta.url), 'utf8')
const shell = await readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8')
const report = await readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8')

const failures = []

// 1) Yêu cầu chốt báo cáo phải nằm ở localStorage để không mất khi tắt app.
if (!request.includes('window.localStorage')) failures.push('handoverReportRequest chưa chuyển sang localStorage.')
if (request.includes('window.sessionStorage')) failures.push('handoverReportRequest vẫn còn dùng sessionStorage — sẽ mất khi tắt app.')
if (!request.includes('REPORT_PENDING_EVENT') || !request.includes('pendingHandoverReportForToday')) {
  failures.push('handoverReportRequest thiếu sự kiện/nhắc pending cho AppShell.')
}
if (!request.includes("request.businessDate < today") || !request.includes('clearHandoverReportRequest()')) {
  failures.push('Yêu cầu của ngày cũ chưa được dọn để lời nhắc không đu bám sang ngày mới.')
}

// 2) Bàn giao phải qua bước xác nhận, không còn một chạm.
if (!handover.includes('closeArmed') || !handover.includes('setCloseArmed(true)')) {
  failures.push('Nút bàn giao chưa có bước xác nhận (closeArmed).')
}
if (!handover.includes('handover-close-confirm') || !handover.includes('Capy hỏi lại')) {
  failures.push('Chưa có bảng xác nhận kiểu capybara trước khi bàn giao.')
}
if (!handover.includes('CHỐT NGÀY') || !handover.includes('Tổng ngày')) {
  failures.push('Xác nhận ca tối chưa cảnh báo rõ sẽ chốt ngày + gửi báo cáo Tổng ngày.')
}

// 3) AppShell nhắc gửi báo cáo ở mọi trang cho ca trưởng, ẩn khi đang ở màn Báo cáo.
if (!shell.includes('showReportReminder') || !shell.includes('pendingHandoverReportForToday')) {
  failures.push('AppShell chưa nhắc báo cáo chưa gửi.')
}
if (!shell.includes("user.role === 'shift_leader'") || !shell.includes("page !== 'report'")) {
  failures.push('Lời nhắc báo cáo chưa giới hạn đúng ca trưởng / ẩn ở màn Báo cáo.')
}
if (!shell.includes('report-pending-popup') || !shell.includes("onNavigate('report')")) {
  failures.push('Popup nhắc báo cáo chưa có nút mở màn Báo cáo.')
}

// 4) Mở lại ngày phải bật lại lời nhắc (buộc chốt & gửi lại báo cáo đã sửa).
const reopenBlock = report.slice(report.indexOf('async function reopenDay'), report.indexOf('async function reopenDay') + 900)
if (!reopenBlock.includes('writeHandoverReportRequest')) {
  failures.push('Mở lại ngày chưa bật lại lời nhắc gửi lại báo cáo.')
}

if (failures.length) {
  console.error(failures.map((item) => `FAIL: ${item}`).join('\n'))
  process.exit(1)
}
console.log('HANDOVER_REPORT_REMINDER_OK')
