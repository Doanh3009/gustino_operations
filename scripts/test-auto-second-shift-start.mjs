// Phiên ca được xếp theo THỨ TỰ VÀO CA của các ca trưởng trong ngày (luật chủ quán
// xác nhận 08/08/2026): mỗi chi nhánh chỉ có 2 ca trưởng — người vào sớm đứng Ca 1,
// người còn lại Ca 2; nếu cả ngày chỉ một ca trưởng thì người đó trực cả hai ca.
import assert from 'node:assert/strict'
import {
  canOpenNextScheduledOperationalShift,
  operationalSequencesFor,
  scheduledOperationalSequence,
} from '../src/lib/operationalShiftAssignment.ts'

const workShifts = [
  { id: 'ca-1', branchId: 'lotte-vt', name: 'Ca 1', startTime: '07:15', endTime: '15:15', employmentTypes: ['leader'], active: true },
  { id: 'ca-2', branchId: 'lotte-vt', name: 'Ca 2', startTime: '14:15', endTime: '22:15', employmentTypes: ['leader'], active: true },
  { id: 'staff-2', branchId: 'lotte-vt', name: 'Ca 2 NV', startTime: '14:15', endTime: '22:15', employmentTypes: ['full_time'], active: true },
]

const leader = (id, userId, workDate, shiftId, startTime, endTime) => ({
  id,
  userId,
  userName: userId,
  employmentType: 'leader',
  positionTitle: 'Ca trưởng',
  branchId: 'lotte-vt',
  workDate,
  shiftId,
  startTime,
  endTime,
  status: 'approved',
})

// ── Ngày có ĐỦ HAI ca trưởng ────────────────────────────────────────────────
const ca1 = leader('r-ca1', 'u-som', '2026-07-20', 'ca-1', '07:15', '15:15')
const ca2 = leader('r-ca2', 'u-toi', '2026-07-20', 'ca-2', '14:15', '22:15')
const twoLeaders = [ca1, ca2]
const closedCa1 = [{ branchId: 'lotte-vt', businessDate: '2026-07-20', sequence: 1, status: 'closed' }]

assert.equal(scheduledOperationalSequence(ca1, twoLeaders, workShifts), 1)
assert.equal(scheduledOperationalSequence(ca2, twoLeaders, workShifts), 2)
assert.equal(canOpenNextScheduledOperationalShift(ca1, [], twoLeaders, workShifts), true)
assert.equal(canOpenNextScheduledOperationalShift(ca2, [], twoLeaders, workShifts), false)
assert.equal(canOpenNextScheduledOperationalShift(ca1, closedCa1, twoLeaders, workShifts), false)
assert.equal(canOpenNextScheduledOperationalShift(ca2, closedCa1, twoLeaders, workShifts), true)

// ── Ngày chỉ có MỘT ca trưởng: người đó trực cả hai ca ──────────────────────
const allDay = leader('r-allday', 'u-mot-minh', '2026-07-21', undefined, '07:15', '22:15')
const closedCa1Day21 = [{ branchId: 'lotte-vt', businessDate: '2026-07-21', sequence: 1, status: 'closed' }]
assert.deepEqual(operationalSequencesFor(allDay, [allDay], workShifts), [1, 2])
assert.equal(canOpenNextScheduledOperationalShift(allDay, [], [allDay], workShifts), true)
assert.equal(canOpenNextScheduledOperationalShift(allDay, closedCa1Day21, [allDay], workShifts), true)

// Cùng một ca trưởng đăng ký HAI ca trong ngày (Vũng Tàu hay xếp kiểu này):
// hai bản ghi, mỗi bản ghi một phiên ca.
const samePersonCa1 = leader('r-a', 'u-mot-nguoi', '2026-07-22', 'ca-1', '07:15', '15:15')
const samePersonCa2 = leader('r-b', 'u-mot-nguoi', '2026-07-22', 'ca-2', '14:15', '22:15')
const bothByOne = [samePersonCa1, samePersonCa2]
assert.deepEqual(operationalSequencesFor(samePersonCa1, bothByOne, workShifts), [1])
assert.deepEqual(operationalSequencesFor(samePersonCa2, bothByOne, workShifts), [2])

// ── Người KHÔNG phải ca trưởng không bao giờ đứng tên phiên ca ──────────────
const partTimer = {
  ...leader('r-pt', 'u-pt', '2026-07-21', undefined, '10:00', '18:00'),
  employmentType: 'part_time',
  positionTitle: 'Part-time',
}
assert.deepEqual(operationalSequencesFor(partTimer, [allDay, partTimer], workShifts), [])
assert.equal(canOpenNextScheduledOperationalShift(partTimer, [], [allDay, partTimer], workShifts), false)
// Part-time có mặt cũng KHÔNG làm ca trưởng duy nhất mất quyền trực cả hai ca.
assert.deepEqual(operationalSequencesFor(allDay, [allDay, partTimer], workShifts), [1, 2])

// Ca phó không đứng tên phiên ca, kể cả khi vào ca sớm nhất.
const deputy = {
  ...leader('r-deputy', 'u-deputy', '2026-07-20', 'ca-1', '06:00', '15:15'),
  positionTitle: 'Ca phó',
}
assert.deepEqual(operationalSequencesFor(deputy, [deputy, ca1, ca2], workShifts), [])
// Ca phó lọt vào danh sách cũng không đẩy thứ tự của hai ca trưởng thật.
assert.deepEqual(operationalSequencesFor(ca1, [deputy, ca1, ca2], workShifts), [1])
assert.deepEqual(operationalSequencesFor(ca2, [deputy, ca1, ca2], workShifts), [2])

console.log('AUTO_SECOND_SHIFT_START_OK')
