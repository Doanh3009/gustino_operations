// Bảo vệ 2 sửa lỗi khiến chi nhánh ít ca trưởng (vd Lotte Vũng Tàu) kẹt ở
// "chưa nhận được ca" trong khi các chi nhánh nhiều ca trưởng không bị:
//  1. Ca trưởng được xếp CẢ Ca 1 lẫn Ca 2 phải mở được Ca 2 sau khi chốt Ca 1.
//  2. Khi mở ca tự động lỗi (mạng chập chờn) phải có nút nhận ca thủ công.
import fs from 'node:fs'
import {
  canOpenNextScheduledOperationalShift,
  scheduledOperationalSequences,
} from '../src/lib/operationalShiftAssignment.ts'

const handover = fs.readFileSync('src/pages/ShiftHandoverPage.tsx', 'utf8')
const attendance = fs.readFileSync('src/pages/AttendancePage.tsx', 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

// --- 1. Chọn đăng ký: xét MỌI bản ghi chấm công còn mở, không chỉ bản ghi đầu ---
assert(
  handover.includes('const openAttendances = myAttendance.filter((record) => !record.checkOutTime)'),
  'Bàn giao vẫn chỉ lấy một bản ghi chấm công đang mở.',
)
assert(
  handover.includes('const startableRegistration = myApprovedRegistrations.find((registration) =>')
  && handover.includes('openAttendances.some((record) => record.shiftRegistrationId === registration.id)'),
  'Bàn giao chưa xét mọi đăng ký đã duyệt mà ca trưởng đang check-in.',
)
assert(
  !handover.includes('registration.id === activeAttendance.shiftRegistrationId'),
  'Vẫn còn cách chọn đăng ký cũ theo bản ghi chấm công đầu tiên.',
)

// --- 2. Nút nhận ca thủ công khi tự mở thất bại ---
assert(
  handover.includes('setAutoStartFailed(true)'),
  'Lỗi mở ca tự động không được ghi nhận để bật lối khắc phục.',
)
assert(
  handover.includes('if (autoStartFailed) return'),
  'Vòng tự mở ca vẫn lặp lại sau khi đã lỗi.',
)
assert(
  handover.includes("onClick={() => void handleStartShift()}") && handover.includes('Nhận ca ngay'),
  'Thiếu nút "Nhận ca ngay" để ca trưởng tự khắc phục.',
)
assert(
  attendance.includes('Hãy vào mục Bàn giao và bấm "Nhận ca ngay"'),
  'Thông báo check-in lỗi chưa chỉ đường sang màn Bàn giao.',
)

// --- 3. Kiểm chứng logic thật: cùng ca trưởng giữ Ca 1 và Ca 2 trong ngày ---
const branchId = 'lotte-vt'
const workDate = '2026-07-23'
const workShifts = [
  { id: 'ca-1', branchId, startTime: '07:15', endTime: '15:15', employmentTypes: ['leader', 'full_time'], active: true },
  { id: 'ca-2', branchId, startTime: '14:15', endTime: '22:15', employmentTypes: ['leader', 'full_time'], active: true },
  { id: 'ca-pt', branchId, startTime: '09:00', endTime: '13:00', employmentTypes: ['part_time'], active: true },
]
const regCa1 = { branchId, workDate, shiftId: 'ca-1', startTime: '07:15', endTime: '15:15', status: 'approved' }
const regCa2 = { branchId, workDate, shiftId: 'ca-2', startTime: '14:15', endTime: '22:15', status: 'approved' }
const closedCa1 = [{ branchId, businessDate: workDate, sequence: 1, status: 'closed' }]

assert(
  canOpenNextScheduledOperationalShift(regCa1, [], workShifts),
  'Đăng ký Ca 1 phải mở được ca vận hành đầu tiên.',
)
assert(
  !canOpenNextScheduledOperationalShift(regCa1, closedCa1, workShifts),
  'Đăng ký Ca 1 không được phép mở Ca 2 (giữ nguyên quy tắc BUG-100).',
)
assert(
  canOpenNextScheduledOperationalShift(regCa2, closedCa1, workShifts),
  'Đăng ký Ca 2 phải mở được Ca 2 sau khi Ca 1 đã chốt, kể cả khi cùng một ca trưởng.',
)
// Chính là tình huống Vũng Tàu: một người giữ cả 2 đăng ký, Ca 1 đã chốt.
const bothRegistrations = [regCa1, regCa2]
const picked = bothRegistrations.find((registration) =>
  canOpenNextScheduledOperationalShift(registration, closedCa1, workShifts),
)
assert(picked === regCa2, 'Khi giữ cả 2 đăng ký, hệ thống phải chọn đúng đăng ký Ca 2 để mở Ca 2.')

// --- 4. Ngày chỉ xếp một ca trưởng: nhận tiếp có xác nhận, không tự động ---
assert(
  handover.includes('const anotherLeaderScheduledForNext = registrations.some((registration) =>')
  && handover.includes("registration.employmentType === 'leader'")
  && handover.includes('scheduledOperationalSequences(registration, workShifts).includes(nextSequence)'),
  'Chưa kiểm tra xem có ca trưởng khác được xếp sequence kế tiếp hay không.',
)
assert(
  handover.includes('!canAutoStartScheduledShift')
  && handover.includes('&& !anotherLeaderScheduledForNext'),
  'Nhận tiếp ca phải bị chặn khi đã có ca trưởng khác được xếp ca đó (giữ BUG-100).',
)
assert(
  handover.includes('takeOverArmed') && handover.includes('handleStartShift({ takeOver: true })'),
  'Nhận tiếp ca phải qua bước xác nhận, không chạy thẳng.',
)
// Vòng tự mở ca chỉ được gọi handleStartShift() KHÔNG tham số → luôn theo lịch,
// không bao giờ tự nhận tiếp ca của người khác.
assert(
  /autoStartAttemptRef\.current = key\s*\r?\n\s*void handleStartShift\(\)/.test(handover),
  'Vòng tự mở ca phải giữ nguyên đường theo lịch, không được tự nhận tiếp.',
)
assert(
  handover.split('handleStartShift({ takeOver: true })').length - 1 === 1,
  'Nhận tiếp ca chỉ được gọi từ đúng nút xác nhận.',
)

// Ca trưởng khác CÓ lịch Ca 2 → không được phép nhận tiếp (chống BUG-100).
const otherLeaderCa2 = { ...regCa2, userId: 'other', employmentType: 'leader' }
assert(
  scheduledOperationalSequences(otherLeaderCa2, workShifts).includes(2),
  'Đăng ký Ca 2 của ca trưởng khác phải được nhận diện là giữ sequence 2.',
)
// PG part-time không bao giờ được tính là ca trưởng giữ ca vận hành.
const partTimer = { branchId, workDate, shiftId: 'ca-pt', startTime: '09:00', endTime: '13:00', status: 'approved' }
assert(
  scheduledOperationalSequences(partTimer, workShifts).length === 0,
  'Ca part-time không được coi là ca trưởng giữ ca vận hành.',
)

// --- 5. Bộ dò ca chạy từ mọi trang, không chỉ Chấm công/Bàn giao ---
const app = fs.readFileSync('src/App.tsx', 'utf8')
const autoOpen = fs.readFileSync('src/lib/shiftAutoOpen.ts', 'utf8')
assert(
  app.includes('reconcileOperationalShift') && app.includes("user.role !== 'shift_leader'"),
  'App chưa chạy bộ dò ca cho ca trưởng ở mọi trang.',
)
assert(
  /window\.setInterval\(\(\) => void attempt\(\), 60000\)/.test(app),
  'Bộ dò ca chưa chạy lặp định kỳ.',
)
// Từ 2026-07-28 ca đang mở không skip thẳng nữa mà đi qua reclaimShiftForPrimaryLeader
// (chuyển quyền chủ ca về đúng ca trưởng); các điều kiện dừng còn lại giữ nguyên.
assert(
  autoOpen.includes('if (openSession) return reclaimShiftForPrimaryLeader(user, openSession, today)')
  && autoOpen.includes("if (sessions.length >= 2) return skip('day-complete')")
  && autoOpen.includes("if (day?.status === 'closed') return skip('day-closed')"),
  'Bộ dò ca thiếu điều kiện dừng, có thể mở ca sai.',
)
assert(
  autoOpen.includes('canOpenNextScheduledOperationalShift(item, sessions, workShifts)')
  && autoOpen.includes('openAttendances.some((record) => record.shiftRegistrationId === item.id)'),
  'Bộ dò ca phải giữ quy tắc BUG-100: đúng lịch VÀ đang check-in.',
)
// Tồn đầu ca phải đọc lại từ kho, không tin movement của trang đang mở.
assert(
  autoOpen.includes('const movements = await fetchMovements(user.branchId, user)'),
  'Tồn đầu ca có thể bị ghi 0 khi mở ca từ trang không tải movement.',
)

// --- 6. Check-out KHÔNG được tự chốt ca / tự ghi tồn ---
assert(
  attendance.includes('const openShift = await findOwnOpenShift(user).catch(() => undefined)')
  && attendance.includes('setPendingCheckOut({ registrationId: registration.id, sequence: openShift.sequence })'),
  'Check-out của ca trưởng chưa chặn mềm khi ca vận hành còn mở.',
)
assert(
  attendance.includes("handleCheckOut(record!, registration, { force: true })"),
  'Thiếu lối vượt có chủ đích cho sự cố thật.',
)
assert(
  !/closeBagShift/.test(attendance),
  'Chấm công không được phép tự chốt ca vận hành.',
)
// Đánh dấu chỉ ghi chú, tuyệt đối không đổi status hay ghi tồn cuối ca.
assert(
  autoOpen.includes('markShiftLeftWithoutHandover')
  && autoOpen.includes("update({ discrepancy_note:")
  && !autoOpen.includes("closing_balances")
  && !/update\(\{[^}]*status: 'closed'/.test(autoOpen),
  'Đánh dấu "chưa kiểm đếm" không được đổi trạng thái ca hay ghi tồn cuối ca.',
)

// --- 7. Ca trưởng trước bỏ ca đang mở: người sau phải có lối chốt thay ---
// Đây là chỗ kẹt cuối cùng của chuỗi BUG-112: ca vẫn "open" nên chi nhánh không mở
// được ca mới, mà giao diện chỉ hiện một dòng chữ thụ động "Đang chờ ca trưởng trước
// bàn giao" — không nút nào thoát ra, cả chi nhánh treo tới khi cron chạy nửa đêm.
assert(
  handover.includes('const canCoverForeignShift = Boolean('),
  'Không có điều kiện nào cho phép chốt thay ca trưởng đã bỏ ca.',
)
assert(
  handover.includes('const coveringSession = coverArmed && canCoverForeignShift ? foreignOpenSession : undefined')
  && handover.includes('const openSession = ownOpenSession || coveringSession'),
  'Chốt thay phải đi qua đúng biểu mẫu đếm tồn của bàn giao, không được là đường tắt riêng.',
)
// Phải bấm + xác nhận: không bao giờ tự động chiếm ca của người khác (giữ BUG-100).
assert(
  handover.includes('onClick={() => setCoverArmed(true)}')
  && !handover.includes('setCoverArmed(true)\n      void handleCloseShift'),
  'Chốt thay không được tự động, phải do người dùng chủ động bấm.',
)
// Bắt buộc ghi lý do và ghi rõ ai chốt thay ai — bằng chứng duy nhất cho quản lý.
assert(
  handover.includes('if (coveringSession && !discrepancyNote.trim())')
  && handover.includes('`[CHỐT THAY ${coveringSession.leaderName} bởi ${user.name}] ${discrepancyNote.trim()}`')
  && handover.includes('noteForClose'),
  'Chốt thay phải bắt buộc lý do và ghi lại tên người chốt.',
)
// Người ngoài ca không được chốt hộ: phải đang check-in và có lịch hôm nay.
assert(
  handover.includes("(user.role === 'shift_leader' && activeAttendance && myApprovedRegistrations.length > 0)"),
  'Chốt thay đang mở cho cả ca trưởng không có lịch/chưa check-in.',
)
assert(
  handover.includes('&& !dayLocked'),
  'Ngày đã chốt thì không được chốt thay thêm ca.',
)

// --- 8. Vị trí công việc rỗng không được biến thành "chưa xếp ai" ---
// `employmentType` đến từ join hồ sơ nên có thể rỗng. Coi rỗng là "không phải ca
// trưởng" sẽ mời ca trưởng Ca 1 nhận tiếp Ca 2 dù đã xếp người khác (tái phát BUG-100).
assert(
  handover.includes("(registration.employmentType === 'leader' || registration.employmentType === undefined)"),
  'Đăng ký thiếu vị trí công việc đang bị bỏ qua khi xét "đã có ca trưởng cho ca kế tiếp".',
)

console.log('HANDOVER_SHIFT_RECOVERY_OK')
