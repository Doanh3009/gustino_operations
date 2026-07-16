import { readFile } from 'node:fs/promises'

const attendance = await readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8')
const browser = await readFile(new URL('../src/lib/browser.ts', import.meta.url), 'utf8')
const report = await readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8')

const failures = []

if (!attendance.includes('decodeImageForCanvas')) {
  failures.push('Ảnh chấm công chưa có nhánh decode tương thích khi createImageBitmap không dùng được trên iPhone/HEIC.')
}
if (!attendance.includes('getTrustedTimestamp')) {
  failures.push('Ảnh/bản ghi chấm công vẫn lấy giờ trực tiếp từ đồng hồ thiết bị, chưa ưu tiên giờ máy chủ.')
}
if (!browser.includes('shareOrDownloadBlob')) {
  failures.push('Tiện ích xuất file chưa có Share Sheet cho Safari/iPhone.')
}
if (/link\.href\s*=\s*canvas\.toDataURL[\s\S]{0,160}link\.click\(\)/.test(report)) {
  failures.push('Báo cáo vẫn click data URL trực tiếp rồi báo tải thành công; Safari iPhone có thể không lưu ảnh.')
}

if (failures.length) {
  console.error(failures.map((item) => `FAIL: ${item}`).join('\n'))
  process.exit(1)
}

console.log('MOBILE_ATTENDANCE_EXPORT_OK')
