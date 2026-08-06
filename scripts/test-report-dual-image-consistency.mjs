// Khóa hợp đồng báo cáo 2026-07-27: hai ảnh (Ca + Tổng ngày) của MỘT lần gửi
// phải render từ MỘT bộ dữ liệu đóng băng; ảnh lỗi được gửi lại có giới hạn và
// không gửi trùng; việc tạo/gửi không phụ thuộc tab đang mở; cờ nhắc chỉ tắt
// khi đã gửi đủ.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [reportPage, n8nReports, apiHandler] = await Promise.all([
  readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/n8nReports.ts', import.meta.url), 'utf8'),
  readFile(new URL('../api/n8n-report-image.ts', import.meta.url), 'utf8'),
])

// (1) Snapshot dữ liệu chung cho cả hai poster ẩn khi chốt/gửi.
assert.match(reportPage, /frozenPosterModels/)
assert.match(reportPage, /setFrozenPosterModels\(freshIsSecondShiftFinalization/)
assert.match(reportPage, /frozenPosterModels\?\.\[scope\] \?\? reportModelForScope\(scope\)/)

// (2) Gửi lại ảnh thiếu từ số liệu SNAPSHOT đã chốt, không chốt lại.
assert.match(reportPage, /function frozenModelsFromSnapshotEntry/)
assert.match(reportPage, /async function resendReportImages/)
assert.match(reportPage, /automaticResendAttemptRef/)

// (3) Poster ẩn chưa render → hẹn thử lại, không bỏ qua im lặng.
assert.match(reportPage, /posterRetryTick/)

// (4) Cờ nhắc chỉ tắt khi delivered; saveCloud trả về {saved, delivered}.
assert.match(reportPage, /saved: true, delivered/)
assert.match(reportPage, /if \(!result\.saved \|\| !result\.delivered\) return/)

// (5) businessDate bám đồng hồ (không giữ ngày cũ qua nửa đêm).
assert.match(reportPage, /localDateKey\(new Date\(clockTick\)\)/)

// (6) Client: gửi từng ảnh độc lập + retry giới hạn; ảnh sau không chết theo ảnh trước.
assert.match(n8nReports, /postSingleReport/)
assert.match(n8nReports, /attempt <= 2/)
assert.match(n8nReports, /failures\.push/)

// (7) Server: idempotent thật (chỉ force mới gửi lại job đã queued) + maxDuration.
assert.match(apiHandler, /const force = input\.force === true/)
assert.match(apiHandler, /previousJob\?\.queued === true && !force/)
assert.match(apiHandler, /maxDuration: 60/)

console.log('REPORT_DUAL_IMAGE_CONSISTENCY_OK')
