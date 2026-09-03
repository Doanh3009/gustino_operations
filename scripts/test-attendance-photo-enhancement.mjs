import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [attendance, page, styles] = await Promise.all([
  readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/AttendancePage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

const drawStart = attendance.indexOf('context.filter = photoFilter.canvasFilter')
const drawImage = attendance.indexOf('context.drawImage(decoded.source', drawStart)
const smoothing = attendance.indexOf("const smoothingCanvas = document.createElement('canvas')", drawImage)
const smoothingDraw = attendance.indexOf('context.drawImage(smoothingCanvas', smoothing)
const opacityReset = attendance.indexOf('context.globalAlpha = 1', smoothingDraw)
const reset = attendance.indexOf("context.filter = 'none'", opacityReset)
const stampPanel = attendance.indexOf('const panelHeight', reset)

assert.ok(drawStart >= 0 && drawImage > drawStart, 'Filter phải áp trước khi vẽ ảnh selfie.')
assert.ok(smoothing > drawImage && smoothingDraw > smoothing, 'Lớp làm mịn phải phủ sau ảnh gốc.')
assert.ok(opacityReset > smoothingDraw && reset > opacityReset && stampPanel > reset, 'Độ mờ và filter phải reset trước khi vẽ dấu thời gian/GPS.')
assert.match(attendance, /brightness\(1\.07\) contrast\(1\.03\) saturate\(1\.08\)/)
assert.match(attendance, /ATTENDANCE_PHOTO_SMOOTHING_SCALE = 0\.2/)
assert.match(attendance, /ATTENDANCE_PHOTO_SMOOTHING_OPACITY = 0\.34/)
assert.match(attendance, /smoothingContext\.imageSmoothingQuality = 'high'/)
assert.match(attendance, /id: 'natural', label: 'Tự nhiên'/)
assert.match(attendance, /id: 'smooth', label: 'Mịn da'/)
assert.match(attendance, /Da baby, sáng và mịn rõ hơn/)
assert.match(attendance, /id: 'bright', label: 'Sáng'/)
assert.match(attendance, /id: 'warm', label: 'Ấm'/)
assert.match(attendance, /id: 'fresh', label: 'Tươi'/)
assert.match(attendance, /photoFilter: AttendancePhotoFilterPreset = DEFAULT_ATTENDANCE_PHOTO_FILTER/)
assert.match(page, /Chọn filter ảnh chấm công/)
assert.match(page, /filter \{selectedPhotoFilterOption\.label\}/)
assert.match(page, /attendance-selfie-preview pending-enhancement/)
assert.match(page, /style=\{\{ filter: selectedPhotoFilterOption\.previewFilter \}\}/)
assert.match(styles, /\.attendance-photo-filter-picker button\.active/)
assert.doesNotMatch(attendance, /hue-rotate\(|scale\(|translate\(/)

console.log('ATTENDANCE_PHOTO_ENHANCEMENT_OK')
