// Khóa hồi quy cho lỗi chấm công hiện lại Check-in sau khi đã chấm và cho tải
// realtime nhiều nhân viên. Đây là test hợp đồng nguồn có kèm ca tái hiện múi giờ;
// QA browser nhiều context vẫn phải chạy riêng khi Browser khả dụng.
import { readFile } from 'node:fs/promises'

const [page, shell, attendance, outbox, dates, lan] = await Promise.all([
  readFile(new URL('../src/pages/AttendancePage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/attendanceOutbox.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/dates.ts', import.meta.url), 'utf8'),
  readFile(new URL('./lan-server.mjs', import.meta.url), 'utf8'),
])

const failures = []
const requireMatch = (source, pattern, message) => {
  if (!pattern.test(source)) failures.push(message)
}
const forbidMatch = (source, pattern, message) => {
  if (pattern.test(source)) failures.push(message)
}

// Tái hiện chính xác cửa sổ lỗi: 00:30 ngày 03/08 tại Việt Nam vẫn là 02/08
// trên thiết bị đặt UTC. UI phải dùng ngày nghiệp vụ Việt Nam, không dùng getter
// theo timezone của thiết bị.
const incident = new Date('2026-08-02T17:30:00.000Z')
const utcDeviceKey = [
  incident.getUTCFullYear(),
  String(incident.getUTCMonth() + 1).padStart(2, '0'),
  String(incident.getUTCDate()).padStart(2, '0'),
].join('-')
const vietnamKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(incident)
if (utcDeviceKey !== '2026-08-02' || vietnamKey !== '2026-08-03') {
  failures.push(`Fixture timezone sai: UTC=${utcDeviceKey}, VN=${vietnamKey}.`)
}
const datesRuntime = await import('../src/lib/dates.ts')
if (datesRuntime.localDateKey(incident) !== '2026-08-03') {
  failures.push(`localDateKey runtime phải trả 2026-08-03, nhận ${datesRuntime.localDateKey(incident)}.`)
}
if (datesRuntime.addLocalDateKeyDays('2026-08-03', -1) !== '2026-08-02'
  || datesRuntime.addLocalDateKeyDays('2026-12-31', 1) !== '2027-01-01') {
  failures.push('addLocalDateKeyDays sai khi trừ ngày hoặc đi qua ranh giới năm.')
}
requireMatch(page, /from ['"]\.\.\/lib\/dates['"]/, 'AttendancePage phải import nguồn ngày nghiệp vụ Việt Nam dùng chung.')
requireMatch(page, /VN_UTC_OFFSET/, 'Giờ bắt đầu/kết thúc ca phải neo offset Việt Nam +07:00.')
requireMatch(page, /addLocalDateKeyDays/, 'Đi tuần/ngày phải dùng phép cộng date-key không phụ thuộc timezone thiết bị.')
forbidMatch(page, /function localDateKey\s*\(/, 'AttendancePage không được tự định nghĩa localDateKey theo timezone thiết bị.')
forbidMatch(page, /date\.getFullYear\(\)|date\.getMonth\(\)|date\.getDate\(\)/, 'AttendancePage còn tính ngày nghiệp vụ bằng getter timezone thiết bị.')
requireMatch(page, /T\$\{registration\.startTime\}:00\$\{VN_UTC_OFFSET\}/, 'Cửa sổ check-in chưa neo giờ bắt đầu theo +07:00.')

// Không vẽ hành động Check-in khi một phiên khác đang mở hoặc check-in trước
// đang chờ outbox; guard sau cú click là quá muộn và gây cảm giác chấm lại.
requireMatch(page, /hasOwnOpenRecord/, 'UI phải biết có bất kỳ phiên chấm công nào của chính người dùng đang mở.')
requireMatch(page, /hasPendingCheckIn/, 'UI phải xem check-in trong outbox là trạng thái đang xử lý.')
requireMatch(page, /canCheckIn[\s\S]{0,260}!hasOwnOpenRecord[\s\S]{0,160}!hasPendingCheckIn/, 'Nút Check-in chưa bị khóa ngay từ render bởi phiên mở/outbox.')
requireMatch(page, /setOptimisticRecords\(\(current\)[\s\S]{0,700}attendanceTimestampMatches\(server\.checkInTime, optimistic\.checkInTime\)/, 'Optimistic record chưa được dọn sau khi server xác nhận, có thể che realtime mới.')
requireMatch(page, /const \[outboxLoaded, setOutboxLoaded\] = useState\(false\)/, 'UI chưa khởi tạo trạng thái outbox ở chế độ fail-closed.')
requireMatch(page, /inspectAttendanceOutbox\(user\.id\)[\s\S]{0,360}setOutboxLoaded\(snapshot\.authoritative\)/, 'UI chưa dùng trạng thái authoritative của IndexedDB trước khi cho Check-in.')
requireMatch(page, /canCheckIn[\s\S]{0,220}outboxLoaded[\s\S]{0,180}!hasOwnOpenRecord/, 'Nút Check-in có thể xuất hiện trước khi tải xong outbox.')
requireMatch(page, /if \(needs\.has\('records'\)\)[\s\S]{0,420}setRecordsLoaded\(false\)/, 'Refresh records lỗi vẫn tin snapshot cũ và có thể hiện Check-in sai.')
const boardNeeds = page.match(/board:\s*\[([\s\S]*?)\],\s*report:/)?.[1] || ''
if (boardNeeds.includes("'records'")) failures.push('Tab Bảng lịch vẫn tải toàn bộ attendance records dù không sử dụng.')
requireMatch(page, /const \[boardRange,\s*setBoardRange\]/, 'Tab Bảng lịch chưa đưa tuần đang xem lên refresh context để giới hạn query.')
requireMatch(page, /refreshContext\.tab === 'board'[\s\S]{0,180}refreshContext\.boardRange/, 'Query Bảng lịch vẫn dùng filter rỗng thay vì đúng tuần đang xem.')

// Realtime phải được lọc theo user/chi nhánh và gộp burst; một event của nhân
// viên A không được làm toàn bộ nhân viên tải lại mọi bảng.
requireMatch(page, /burstGuard/, 'AttendancePage chưa gộp burst sự kiện realtime.')
requireMatch(page, /filter:\s*`user_id=eq\.\$\{user\.id\}`|filter:\s*`branch_id=eq\.\$\{branchId\}`/, 'Realtime AttendancePage chưa lọc theo user/chi nhánh.')
requireMatch(page, /reloadSoon\.cancel\(\)/, 'Timer gộp realtime chưa được hủy khi rời trang.')
const boardRealtime = page.match(/if \(tab === 'board'\) \{([\s\S]*?)\}\s*else if \(personalScope\)/)?.[1] || ''
if (!boardRealtime.includes('shift_registrations') || boardRealtime.includes('attendance_records')) {
  failures.push('Tab Bảng lịch phải chỉ nghe shift_registrations, không nghe attendance_records không sử dụng.')
}

// Popup toàn app cần chống response cũ ghi đè response mới, đọc cả ngày trước
// để thấy phiên qua đêm, có timeout, và không giữ popup Check-in khi đọc lỗi.
requireMatch(shell, /attendanceReminderRequestRef/, 'Popup chưa có request generation chống response cũ ghi đè trạng thái mới.')
requireMatch(shell, /withAttendanceReadDeadline/, 'Popup chưa có deadline đọc dữ liệu.')
requireMatch(shell, /addLocalDateKeyDays\(today,\s*-1\)/, 'Popup chưa đọc ngày trước để phát hiện phiên còn mở qua ngày.')
requireMatch(shell, /hasOwnOpenRecord/, 'Popup chưa chặn nhắc Check-in khi còn bất kỳ phiên mở nào.')
requireMatch(shell, /setAttendanceReminder\(null\)/, 'Lỗi đọc popup phải xóa trạng thái cũ thay vì giữ nhắc Check-in sai.')
requireMatch(shell, /filter:\s*`user_id=eq\.\$\{user\.id\}`/, 'Realtime popup chưa giới hạn vào chính người dùng.')
requireMatch(shell, /page === 'attendance'[\s\S]{0,120}setAttendanceReminder\(null\)/, 'AppShell vẫn chạy watcher trùng khi đang ở trang Chấm công.')
requireMatch(shell, /fetchOwnOpenAttendanceRecords/, 'AppShell chưa dùng query nhỏ dành riêng cho phiên đang mở.')

// Thành công local/outbox phải báo cho mọi surface trong tab hiện tại hội tụ ngay.
requireMatch(attendance, /function notifyAttendanceUpdated|const notifyAttendanceUpdated/, 'Thiếu một điểm phát sự kiện cập nhật chấm công dùng chung.')
requireMatch(attendance, /const confirmOutbox = \(\) => \{[\s\S]{0,220}notifyAttendanceUpdated\(\)/, 'Check-in/check-out thành công chưa phát sự kiện hội tụ UI.')
requireMatch(attendance, /if \(confirmed > 0\) notifyAttendanceUpdated\(\)/, 'Outbox gửi thành công chưa phát sự kiện hội tụ UI.')
forbidMatch(attendance, /flushAttendanceOutbox[\s\S]{0,180}attendanceOutboxFastCount\(user\.id\) === 0/, 'Flush vẫn tin localStorage fast-count=0 và có thể bỏ quên op còn trong IndexedDB.')
forbidMatch(attendance, /saveAttendanceOutboxOp\(outboxOp\)\.catch\(\(\) => undefined\)/, 'Lỗi lưu bằng chứng outbox vẫn đang bị nuốt âm thầm.')

// Dữ liệu lớn không được im lặng dừng ở giới hạn mặc định của PostgREST.
requireMatch(attendance, /ATTENDANCE_PAGE_SIZE/, 'Thiếu kích thước trang tải dữ liệu chấm công.')
requireMatch(attendance, /\.range\(offset,\s*offset \+ ATTENDANCE_PAGE_SIZE - 1\)/, 'Danh sách chấm công/lịch chưa phân trang đầy đủ.')

// Ảnh retry/outbox dùng cùng một đường dẫn; nếu mỗi retry sinh Date.now() mới sẽ
// để lại file rác và tăng tải Storage khi đông nhân viên.
requireMatch(outbox, /selfiePath\?: string/, 'Outbox chưa lưu đường dẫn ảnh ổn định cho các lần retry.')
requireMatch(attendance, /outboxOp\.selfiePath/, 'Luồng gửi lại chưa tái dùng đường dẫn ảnh ổn định.')
requireMatch(attendance, /dataUrl,\s*selfiePath:\s*stablePath/, 'Upload LAN chưa gửi stable selfie path nên retry vẫn có thể sinh ảnh rác.')
requireMatch(outbox, /authoritative:\s*false/, 'Lỗi đọc IndexedDB chưa được phân biệt với hộp thư rỗng.')
requireMatch(outbox, /function transactionToPromise|const transactionToPromise/, 'Outbox chưa đợi IndexedDB transaction commit/abort thật.')
requireMatch(outbox, /transactionToPromise\(transaction\)[\s\S]{0,260}Promise\.all\([\s\S]{0,180}completion/, 'Outbox xóa bản RAM trước khi transaction IndexedDB hoàn tất.')
forbidMatch(outbox, /MAX_OP_AGE_MS|isExpired\(/, 'Outbox vẫn tự xóa bằng chứng chưa được server xác nhận theo tuổi.')
requireMatch(attendance, /isSingleOpenSessionViolation\(error\)[\s\S]{0,300}markAttendanceOutboxNeedsReview/, 'Conflict một phiên mở chưa được giữ để rà soát thay vì tự replay/xóa.')
requireMatch(attendance, /verifyExistingCheckIn\(user\.id, op\.registrationId\)/, '23505 chưa được read-back đúng registration trước khi xóa outbox.')
requireMatch(attendance, /replayedFromOutbox:\s*true/, 'LAN outbox replay chưa được tách khỏi write bình thường dùng giờ máy chủ.')
const permanentReplayQuarantines = attendance.match(/isPermanentAttendanceReplayRejection\(error\)[\s\S]{0,300}quarantineAttendanceOutboxOp/g) || []
if (permanentReplayQuarantines.length < 2) failures.push('Timestamp replay bị LAN từ chối vĩnh viễn chưa được giữ needs-review cho cả check-in và check-out.')
forbidMatch(attendance, /if \(!op\.recordId\) return drop\(\)/, 'Check-out thiếu recordId vẫn bị xóa dù server chưa xác nhận.')
forbidMatch(attendance, /if \(!existing \|\| existing\.checkOutTime\) return drop\(\)/, 'Check-out không tìm thấy record vẫn bị xóa bằng chứng.')
requireMatch(attendance, /AttendanceReplayNeedsReviewError/, 'Op lỗi vĩnh viễn chưa có tín hiệu quarantine để flush tiếp tục các op độc lập.')
requireMatch(attendance, /error instanceof AttendanceReplayNeedsReviewError[\s\S]{0,80}continue/, 'Một op đã quarantine vẫn chặn toàn bộ outbox phía sau.')

// LAN chỉ nhận field bằng chứng được whitelist; danh tính/chi nhánh/giờ vào và
// metadata commit phải lấy từ session + registration/server.
requireMatch(lan, /const record = \{[\s\S]{0,360}userId:\s*user\.id[\s\S]{0,180}branchId:\s*registration\.branchId/, 'LAN POST vẫn tin userId/branchId do client gửi.')
requireMatch(lan, /const patch = \{[\s\S]{0,500}checkOutSelfieUrl:\s*payload\.checkOutSelfieUrl/, 'LAN PATCH chưa whitelist field check-out.')
requireMatch(lan, /const stableStem = `\$\{safeUserId\}-/, 'Tên selfie LAN chưa bị namespace theo user đã xác thực.')

// Helper trung tâm phải thể hiện đúng ngày Việt Nam và phép cộng ngày an toàn.
requireMatch(dates, /Asia\/Ho_Chi_Minh/, 'Nguồn ngày trung tâm thiếu timezone Việt Nam.')
requireMatch(dates, /export function addLocalDateKeyDays/, 'Thiếu helper cộng ngày nghiệp vụ an toàn.')

if (failures.length) {
  console.error('ATTENDANCE_REALTIME_NEXT_DAY_FAIL')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}

console.log('ATTENDANCE_REALTIME_NEXT_DAY_OK')
