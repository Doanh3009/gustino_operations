import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, handover, report] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ShiftHandoverPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8'),
])

assert.match(
  handover,
  /todaySessions\.some\(\(item\) => item\.status === 'closed'\)[\s\S]*Xem báo cáo ngày/,
  'Trang Bàn giao phải hiện nút xem báo cáo sau khi đã có ca bàn giao.',
)
assert.match(
  handover,
  /onClick=\{\(\) => onNavigate\('report'\)\}[\s\S]*Xem báo cáo ngày/,
  'Nút xem báo cáo ngày phải mở route báo cáo hiện có.',
)
assert.match(
  app,
  /\{page === 'report' && <ReportPage/,
  'Route báo cáo ngày phải render ReportPage.',
)
assert.match(
  app,
  /if \(page === 'report'\) return canUseOperations\(user\.role\)/,
  'Ca trưởng phải tiếp tục được phép mở route báo cáo ngày.',
)
assert.match(
  report,
  /className="secondary-button report-backup-image-button"[\s\S]*onClick=\{\(\) => void exportInfographicImage\(\)\}[\s\S]*Lưu ảnh/,
  'Báo cáo ngày phải có nút Lưu ảnh được nối với hàm xuất ảnh.',
)
assert.doesNotMatch(
  report,
  /handoverComplete \? 'Lưu ảnh' : 'Tải ảnh'/,
  'Nút lưu ảnh không được đổi tên thành Tải ảnh khi mở lại báo cáo.',
)

console.log('HANDOVER_DAILY_REPORT_ACCESS_OK')
