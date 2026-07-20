import { readFile } from 'node:fs/promises'

const report = await readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

const failures = []

if (!report.includes('className="report-scope-select"') || !report.includes('<select') || !report.includes('value={reportScope}')) {
  failures.push('Bộ chọn phạm vi báo cáo chưa dùng dropdown thật.')
}
for (const option of ['value="shift-1"', 'value="shift-2"', 'value="day"']) {
  if (!report.includes(option)) failures.push(`Dropdown thiếu lựa chọn ${option}.`)
}
if (report.includes('Dữ liệu Ca 1</button>') || report.includes('Dữ liệu Ca 2</button>') || report.includes('Tổng cả ngày</button>')) {
  failures.push('Bộ chọn ca cũ vẫn render thành nhiều nút.')
}
if (report.includes('Gửi lại ảnh Zalo</button>') || report.includes('Gửi ngay Zalo</button>')) {
  failures.push('Hai nút Zalo trùng chức năng chưa được gộp.')
}
if (report.includes('↻ Đồng bộ dữ liệu mới</button>')) {
  failures.push('Nút đồng bộ thủ công vẫn chiếm chỗ dù trang đã realtime.')
}
if (!/>\s*Lưu ảnh\s*<\/button>/.test(report) || !report.includes('report-backup-image-button')) {
  failures.push('Thanh công cụ chưa giữ hành động lưu ảnh backup độc lập với n8n.')
}
if (!report.includes('friendlyReportMessage') || !report.includes('report-feedback')) {
  failures.push('Lỗi kỹ thuật n8n vẫn có thể lộ nguyên văn trên giao diện người dùng.')
}
if (!report.includes('Chưa gửi được Zalo. Vui lòng thử lại; nếu vẫn lỗi, báo quản trị.')) {
  failures.push('Thông báo lỗi gửi Zalo chưa được rút gọn cho người vận hành.')
}
for (const technicalCopy of [
  'Node phản hồi cuối chưa trả dữ liệu xác nhận.',
  'Node phản hồi cuối chưa trả JSON hợp lệ.',
  'Webhook đang phản hồi trước khi Sheet chạy xong.',
  'Node phản hồi cuối trả sai job_key hoặc thiếu trạng thái READY.',
  'Kiểm tra workflow n8n rồi thử lại.',
]) {
  if (report.includes(`return '${technicalCopy}'`)) failures.push(`Giao diện vẫn trả ghi chú kỹ thuật: ${technicalCopy}`)
}
if (report.includes('report-technical-details') || report.includes('Chi tiết lỗi n8n') || report.includes('report-finalize-hint')) {
  failures.push('Toolbar deploy vẫn hiện ghi chú kỹ thuật hoặc dòng hướng dẫn dài cho người vận hành.')
}
if (!styles.includes('.report-toolbar-controls') || !styles.includes('.report-scope-select select')) {
  failures.push('Thiếu CSS riêng cho toolbar/dropdown mới.')
}
if (!styles.includes('grid-template-columns: minmax(0, 1fr) auto;') || !styles.includes('@media (max-width: 760px)')) {
  failures.push('Toolbar mới chưa có bố cục mobile không tràn ngang.')
}

if (failures.length) {
  console.error(failures.map((item) => `FAIL: ${item}`).join('\n'))
  process.exit(1)
}

console.log('REPORT_TOOLBAR_MOBILE_OK')
