import fs from 'node:fs'

const today = fs.readFileSync('src/pages/TodayPage.tsx', 'utf8')
const report = fs.readFileSync('src/pages/ReportPage.tsx', 'utf8')
const styles = fs.readFileSync('src/styles.css', 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(today.includes('className="shift-photo-quick-actions"'), 'Thiếu cụm thao tác chụp hình nhanh trong hero Hôm nay.')
assert(today.includes('onPick={(file) => void saveOpeningPhoto(file)}'), 'Nút nhanh đầu ca không dùng luồng lưu ảnh hiện tại.')
assert(today.includes('onPick={(file) => void saveClosingPhoto(file)}'), 'Nút nhanh cuối ca không dùng luồng lưu ảnh hiện tại.')
assert(today.includes('const photoSession = openBagSession || latestClosedOwnSession'), 'Nút chụp chưa hỗ trợ ca đã kết thúc.')
assert(today.includes("prefix={photoSession?.openingPhotoUrl ? 'Đổi hình đầu ca' : 'Chụp hình đầu ca'}"), 'Nút đầu ca vẫn bị khóa theo ca đang mở.')
assert(today.includes("prefix={photoSession?.closingPhotoUrl ? 'Đổi hình cuối ca' : 'Chụp hình cuối ca'}"), 'Nút cuối ca vẫn bị khóa theo ca đang mở.')
assert(!today.includes('📷 Check-in để chụp hình ca'), 'Nút chụp vẫn điều hướng sang Chấm công.')
assert(today.includes("await uploadBagShiftPhoto(user, photoSession, 'opening', dataUrl)"), 'Hình đầu ca chưa gắn vào ca mở hoặc ca vừa kết thúc.')
assert(today.includes("await uploadBagShiftPhoto(user, photoSession, 'closing', dataUrl)"), 'Hình cuối ca chưa gắn vào ca mở hoặc ca vừa kết thúc.')
assert(!today.includes('id="today-opening-photo"'), 'Trang Hôm nay vẫn còn khối chụp đầu ca trùng lặp.')
assert(!today.includes('id="today-closing-photo"'), 'Trang Hôm nay vẫn còn khối chụp cuối ca trùng lặp.')
assert(today.includes('id="shift-photo-quick-actions"'), 'Cụm chụp hình duy nhất chưa có đích cuộn từ tiến độ.')
assert(!styles.includes('.today-opening-photo-card'), 'CSS của khối chụp ảnh trùng lặp chưa được dọn.')
assert(styles.includes('.shift-photo-quick-actions') && styles.includes('@media (max-width: 640px)'), 'Thiếu giao diện responsive cho nút chụp hình nhanh.')

assert(report.includes('resolveShiftLeaderName(morningSession, todayRegistrations, todayAttendanceRecords)'), 'Tên Ca 1 chưa được đối chiếu theo phiên/chấm công.')
assert(report.includes('resolveShiftLeaderName(eveningSession, todayRegistrations, todayAttendanceRecords)'), 'Tên Ca 2 chưa được đối chiếu độc lập theo phiên/chấm công.')
assert(report.includes("registration.employmentType === 'leader'"), 'Đối chiếu tên ca trưởng chưa giới hạn đúng nhóm ca trưởng.')
assert(report.includes('Math.abs(new Date(a.attendance!.checkInTime).getTime() - sessionStart)'), 'Đối chiếu ca trưởng chưa ưu tiên giờ check-in gần lúc mở từng ca.')
assert(!report.includes("const morningLeaderName = todaySessions.find((item) => item.sequence === 1)?.leaderName || ''"), 'Báo cáo vẫn chỉ dùng tên lưu cứng trên phiên Ca 1.')

console.log('SHIFT_PHOTO_ACTIONS_AND_LEADER_NAMES_OK')
