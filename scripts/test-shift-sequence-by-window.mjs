// Phiên ca bám KHUNG GIỜ CA, không bám thứ tự bản ghi đăng ký.
//
// Sự cố thật — Lotte Mart 23/10, ngày 08/08/2026:
//   · Võ Thảo Quyên      07:15–15:15  (ca trưởng)
//   · Nguyễn Thị Yến     07:15–15:15  (ca trưởng, cùng khung ca sáng)
//   · Nguyễn Bình Thảo Nguyên 14:15–22:15 (ca trưởng ca tối)
// Bản cũ xếp phiên ca theo VỊ TRÍ bản ghi: vị trí 0 → Ca 1, vị trí 1 → Ca 2, còn lại
// → RỖNG. Hai người cùng đăng ký ca sáng nên chị Yến chiếm mất "Ca 2", còn chị Thảo
// Nguyên — người đăng ký ĐÚNG ca tối — ra danh sách rỗng ⇒ ca tối không bao giờ tự mở.
// Chị đứng ngoài quầy với trạng thái "Chờ mở ca", bấm chụp hình quầy thì báo "Chưa tìm
// thấy ca hôm nay để gắn hình", mà màn Bàn giao cũng không hiện nút nào (hệ thống tưởng
// "đã có ca trưởng khác được xếp Ca 2").
import assert from 'node:assert/strict'
import {
  canOpenNextScheduledOperationalShift,
  leaderShiftWindowsInOrder,
  operationalSequencesFor,
  primaryLeadersScheduledFor,
} from '../src/lib/operationalShiftAssignment.ts'

const branchId = 'lotte-2310'
const workDate = '2026-08-08'
const workShifts = [
  { id: 'ca-sang', branchId, startTime: '07:15', endTime: '15:15', employmentTypes: ['leader'], active: true },
  { id: 'ca-toi', branchId, startTime: '14:15', endTime: '22:15', employmentTypes: ['leader'], active: true },
]
const leader = (id, userName, shiftId, startTime, endTime) => ({
  id,
  userId: `u-${id}`,
  userName,
  employmentType: 'leader',
  positionTitle: 'Ca trưởng',
  branchId,
  workDate,
  shiftId,
  startTime,
  endTime,
  status: 'approved',
})

const quyen = leader('r-quyen', 'Võ Thảo Quyên', 'ca-sang', '07:15', '15:15')
const yen = leader('r-yen', 'Nguyễn Thị Yến', 'ca-sang', '07:15', '15:15')
const nguyen = leader('r-nguyen', 'Nguyễn Bình Thảo Nguyên', 'ca-toi', '14:15', '22:15')
const baDangKy = [quyen, yen, nguyen]

// ── 1. Khung giờ mới là thứ quyết định phiên ca ─────────────────────────────
assert.deepEqual(
  leaderShiftWindowsInOrder(workDate, branchId, baDangKy, workShifts),
  ['07:15-15:15', '14:15-22:15'],
  'Hai ca trưởng cùng khung ca sáng chỉ được tính là MỘT khung giờ.',
)
assert.deepEqual(operationalSequencesFor(quyen, baDangKy, workShifts), [1])
assert.deepEqual(
  operationalSequencesFor(yen, baDangKy, workShifts),
  [1],
  'Ca trưởng thứ hai của ca sáng vẫn thuộc Ca 1, không được đẩy sang Ca 2.',
)
assert.deepEqual(
  operationalSequencesFor(nguyen, baDangKy, workShifts),
  [2],
  'Ca trưởng đăng ký đúng khung ca tối PHẢI đứng tên Ca 2.',
)

// ── 2. Sau khi Ca 1 chốt, đúng ca trưởng ca tối mở được Ca 2 ────────────────
const daChotCa1 = [{ branchId, businessDate: workDate, sequence: 1, status: 'closed' }]
assert.equal(canOpenNextScheduledOperationalShift(nguyen, daChotCa1, baDangKy, workShifts), true)
assert.equal(
  canOpenNextScheduledOperationalShift(quyen, daChotCa1, baDangKy, workShifts),
  false,
  'Ca trưởng ca sáng không được tự nhận Ca 2 (giữ nguyên BUG-100).',
)
assert.deepEqual(
  primaryLeadersScheduledFor(2, workDate, baDangKy, workShifts).map((item) => item.userName),
  ['Nguyễn Bình Thảo Nguyên'],
)
assert.deepEqual(
  primaryLeadersScheduledFor(1, workDate, baDangKy, workShifts).map((item) => item.userName),
  ['Võ Thảo Quyên', 'Nguyễn Thị Yến'],
)

// ── 3. Cả ngày chỉ MỘT khung giờ ⇒ khung đó trực cả hai phiên ca ────────────
const chiCaSang = [quyen, yen]
assert.deepEqual(operationalSequencesFor(quyen, chiCaSang, workShifts), [1, 2])
assert.deepEqual(
  operationalSequencesFor(yen, chiCaSang, workShifts),
  [1, 2],
  'Không xếp ai cho ca tối thì người trong khung duy nhất phải mở được Ca 2.',
)

// ── 4. Ngày có 3 khung giờ: sớm nhất Ca 1, muộn nhất Ca 2 ───────────────────
// Khung giữa không đứng tên ca nào, nhưng người đó vẫn còn nút "Nhận ca ngay".
const khungGiua = leader('r-giua', 'Người ca gãy', undefined, '10:00', '18:00')
const baKhung = [quyen, khungGiua, nguyen]
assert.deepEqual(operationalSequencesFor(quyen, baKhung, workShifts), [1])
assert.deepEqual(operationalSequencesFor(khungGiua, baKhung, workShifts), [])
assert.deepEqual(
  operationalSequencesFor(nguyen, baKhung, workShifts),
  [2],
  'Khung muộn nhất luôn là Ca 2, dù có bao nhiêu khung chen giữa.',
)

console.log('SHIFT_SEQUENCE_BY_WINDOW_OK')
