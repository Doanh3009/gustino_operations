import { readFile } from 'node:fs/promises'

const [shell, attendanceLib, attendancePage, supabaseSource, reverseApi, lanServer] = await Promise.all([
  readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/AttendancePage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8'),
  readFile(new URL('../api/reverse-geocode.ts', import.meta.url), 'utf8'),
  readFile(new URL('./lan-server.mjs', import.meta.url), 'utf8'),
])

const failures = []
if (!shell.includes('attendanceReminder')) failures.push('AppShell chưa có popup nhắc check-in/check-out theo dữ liệu ca hôm nay.')
if (!shell.includes('fetchAttendanceRecords') || !shell.includes('fetchShiftRegistrations')) failures.push('Popup chưa kiểm tra dữ liệu chấm công thật.')
if (attendancePage.includes('FilteredAttendanceCamera')) failures.push('Trang chấm công vẫn ép mở camera live riêng, có thể làm màn hình đen trên iPhone.')
if (attendancePage.includes('requestAttendanceLocationPermission') || attendancePage.includes('attendance-location-permission')) failures.push('Trang vẫn bắt người dùng qua bước xin/kiểm tra định vị thủ công.')
if (!/type="file"[\s\S]{0,120}accept="image\/\*"[\s\S]{0,120}capture=/.test(attendancePage)) failures.push('Trang chưa trả về bộ chụp ảnh gốc của điện thoại.')
if (/camera[^'"\n]{0,40}filter|filter[^'"\n]{0,40}camera/i.test(attendancePage)) failures.push('Giao diện vẫn ghi mô tả camera/filter thay vì chỉ hiển thị thao tác chụp ảnh.')
if (!attendanceLib.includes('const location = await getAttendanceLocation()')) failures.push('Check-in/check-out chưa tự lấy định vị trong lúc chấm công.')
if (!attendanceLib.includes('navigator.geolocation.getCurrentPosition')) failures.push('Luồng chấm công chưa tự gọi định vị gốc của trình duyệt.')
if (attendanceLib.includes('navigator.geolocation.watchPosition')) failures.push('Luồng định vị vẫn mở thêm GPS watcher song song thay vì một lần xin quyền như luồng cũ trên Safari.')
if (!attendanceLib.includes('maximumAge: 0')) failures.push('GPS vẫn cho phép dùng lại tọa độ cũ trong cache thay vì buộc lấy vị trí mới lúc chấm công.')
if (!attendanceLib.includes('targetAccuracyMetres') || !attendanceLib.includes('requestFreshGeolocationPosition')) failures.push('GPS chưa lấy thêm mẫu khi vị trí đầu tiên còn sai số lớn để chọn tọa độ tốt nhất.')
if (!attendanceLib.includes('link HTTP')) failures.push('Thông báo GPS chưa phân biệt Safari chặn link HTTP với quyền định vị bị tắt thật.')
if (attendanceLib.includes('context.filter =')) failures.push('Ảnh chấm công vẫn bị áp filter hậu kỳ thay vì giữ ảnh camera gốc.')
if (!attendanceLib.includes('details.address')) failures.push('Dấu ảnh chấm công chưa in địa chỉ cụ thể.')
if (!attendanceLib.includes('`GPS ${details.latitude.toFixed(6)}, ${details.longitude.toFixed(6)} · sai số ±${Math.round(details.accuracy)}m`')) {
  failures.push('Dấu ảnh chấm công chưa in tọa độ GPS và sai số theo kiểu ghi nhận cũ được chủ hệ thống yêu cầu khôi phục.')
}
// BUG-120: cả hai nguồn dịch địa chỉ cùng hỏng thì KHÔNG được chặn chấm công —
// dùng địa chỉ tự khai có tiền tố rõ ràng kèm toạ độ GPS thật (bằng chứng gốc),
// tuyệt đối không trả tọa độ trần giả làm địa chỉ bình thường.
if (!attendanceLib.includes('resolveAttendanceAddress') || !attendanceLib.includes('UNRESOLVED_ADDRESS_PREFIX')) {
  failures.push('Luồng chấm công phải dùng địa chỉ tự khai có tiền tố khi dịch vụ bản đồ hỏng, không được chặn chấm công.')
}
if (attendanceLib.includes('requireConcreteAttendanceAddress')) {
  failures.push('Chốt chặn địa chỉ cụ thể cũ vẫn còn — nó chặn đứng chấm công khi nhà cung cấp bản đồ sập (BUG-120).')
}
if (reverseApi.includes('coordinateLabel(') || reverseApi.includes("source: 'coordinates'")) failures.push('API địa chỉ vẫn trả tọa độ giả làm địa chỉ khi reverse geocode thất bại.')
if (lanServer.includes('Vị trí GPS ${latitude.toFixed(6)}')) failures.push('Máy chủ LAN vẫn trả tọa độ thay vì reverse geocode địa chỉ.')
if (!supabaseSource.includes('persistSession: true')) failures.push('Supabase chưa khai báo lưu phiên đăng nhập rõ ràng.')
if (!supabaseSource.includes('autoRefreshToken: true')) failures.push('Supabase chưa tự làm mới token đăng nhập.')

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}
console.log('ATTENDANCE_NATIVE_CAMERA_LOCATION_OK')
