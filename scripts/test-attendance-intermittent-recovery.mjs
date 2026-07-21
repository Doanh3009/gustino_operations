import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [attendance, lan] = await Promise.all([
  readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8'),
  readFile(new URL('./lan-server.mjs', import.meta.url), 'utf8'),
])

const attendanceApi = sourceBetween(attendance, 'async function attendanceApi', '\nfunction shouldUseAttendanceApi')
const checkout = sourceBetween(attendance, 'export async function checkOut(', '\nasync function verifyExistingCheckIn')
const upload = sourceBetween(attendance, 'async function uploadSelfie(', '\nasync function uploadAttendanceSelfieWithRetry')
const lanGeocode = sourceBetween(lan, 'async function reverseGeocodeAddress(', '\nfunction draftKey')

assert.match(attendanceApi, /status:\s*response\.status/, 'Lỗi HTTP LAN chưa giữ status nên retry 408\/429\/5xx có thể không chạy.')
assert.match(upload, /withAttendanceWriteRetry\([\s\S]*attendanceApi/, 'Upload selfie qua LAN chưa retry khi mạng chập chờn.')
assert.match(checkout, /catch \(error\)[\s\S]*\/records\?userId=/, 'LAN checkout chưa đọc lại bản ghi sau khi mất response.')
assert.match(checkout, /existing\?\.checkOutTime|existing && existing\.checkOutTime/, 'LAN checkout chưa xác nhận server đã lưu giờ ra trước khi báo thành công.')
assert.match(lanGeocode, /Promise\.any\(\[/, 'LAN reverse geocode vẫn gọi hai nhà cung cấp tuần tự, dễ vượt timeout chấm công.')
assert.match(lanGeocode, /preferDetailedLanAddress/, 'LAN reverse geocode chưa ưu tiên địa chỉ chi tiết trước nguồn hành chính dự phòng.')
assert.match(lanGeocode, /first\.source === 'nominatim'/, 'LAN reverse geocode chưa nhận diện nguồn địa chỉ đường\/phường ưu tiên.')

console.log('ATTENDANCE_INTERMITTENT_RECOVERY_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
