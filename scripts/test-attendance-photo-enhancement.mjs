import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [attendance, page, styles] = await Promise.all([
  readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/AttendancePage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

const drawImage = attendance.indexOf('context.drawImage(decoded.source')
const stampPanel = attendance.indexOf('const panelHeight', drawImage)

assert.ok(drawImage >= 0 && stampPanel > drawImage, 'Ảnh gốc phải được vẽ trước khi đóng dấu thông tin.')
assert.doesNotMatch(attendance, /ATTENDANCE_PHOTO_FILTER_OPTIONS|photoFilter|smoothingCanvas|context\.filter/)
assert.doesNotMatch(page, /ATTENDANCE_PHOTO_FILTER_OPTIONS|selectedPhotoFilter|selfieFilters|filter ảnh chấm công|Camera selfie có filter/)
assert.doesNotMatch(styles, /attendance-photo-filter-picker|attendance-camera-filter-strip/)

console.log('ATTENDANCE_PHOTO_ENHANCEMENT_OK')
