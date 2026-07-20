import assert from 'node:assert/strict'
import fs from 'node:fs'

const control = fs.readFileSync('src/pages/ControlCenterPage.tsx', 'utf8')
const page = fs.readFileSync('src/pages/AttendancePage.tsx', 'utf8')
const attendance = fs.readFileSync('src/lib/attendance.ts', 'utf8')
const reverseGeocodeApi = fs.readFileSync('api/reverse-geocode.ts', 'utf8')

assert.doesNotMatch(control, /\['cleanup', 'Dọn dữ liệu'\]/, 'Admin vẫn còn nút/tab Dọn dữ liệu.')
assert.doesNotMatch(control, /tab === 'cleanup' && \(\s*<section/, 'Admin vẫn render màn dọn dữ liệu phá hủy.')
assert.doesNotMatch(control, />🗑 Xóa dữ liệu đã chọn</, 'Admin vẫn render nút xóa dữ liệu đã chọn.')

assert.match(page, /const \[optimisticRecords, setOptimisticRecords\]/, 'UI chưa giữ trạng thái chấm công vừa lưu khi refresh tạm lỗi.')
assert.match(page, /mergeAttendanceRecords\(records, optimisticRecords\)/, 'Bản ghi vừa lưu chưa được ghép vào danh sách đang hiển thị.')
assert.match(page, /const saved = await checkOut\(/, 'Check-out chưa trả bản ghi đã lưu cho UI xác nhận ngay.')
assert.match(page, /await onChanged\(\)\.catch\(\(\) => undefined\)[\s\S]{0,180}onFeedback\(`Check-in thành công/, 'Thông báo check-in thành công vẫn có thể bị refresh tạm lỗi ghi đè.')
assert.match(page, /await onChanged\(\)\.catch\(\(\) => undefined\)[\s\S]{0,180}onFeedback\('Check-out thành công/, 'Thông báo check-out thành công vẫn có thể bị refresh tạm lỗi ghi đè.')
assert.match(attendance, /async function reverseGeocodeAttendanceWithRetry/, 'Reverse geocode chưa có retry giới hạn.')
assert.match(attendance, /const ATTENDANCE_GEOCODE_MAX_ATTEMPTS = 2/, 'Reverse geocode retry phải có giới hạn rõ ràng.')
assert.match(attendance, /reverse-geocode[\s\S]{0,180}6500/, 'Client chấm công vẫn dừng chờ trước timeout tối đa của dịch vụ địa chỉ.')
assert.match(reverseGeocodeApi, /Promise\.any\(\[/, 'API địa chỉ vẫn gọi tuần tự hai nhà cung cấp, dễ vượt timeout chấm công.')
assert.match(reverseGeocodeApi, /concreteProviderResult\('nominatim'/, 'API địa chỉ chưa kiểm tra kết quả Nominatim cụ thể.')
assert.match(reverseGeocodeApi, /concreteProviderResult\('bigdatacloud'/, 'API địa chỉ chưa có nhà cung cấp dự phòng chạy song song.')
assert.match(attendance, /return\s*\{[\s\S]{0,80}\.\.\.record,[\s\S]{0,40}checkOutTime/, 'Check-out cloud chưa trả lại trạng thái hoàn tất cho optimistic UI.')

console.log('ADMIN_CLEANUP_ATTENDANCE_RESILIENCE_OK')
