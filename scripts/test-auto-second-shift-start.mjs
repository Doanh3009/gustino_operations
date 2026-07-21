import assert from 'node:assert/strict'
import {
  canOpenNextScheduledOperationalShift,
  scheduledOperationalSequence,
  scheduledOperationalSequences,
} from '../src/lib/operationalShiftAssignment.ts'

const workShifts = [
  { id: 'ca-1', branchId: 'lotte-vt', name: 'Ca 1', startTime: '07:15', endTime: '15:15', employmentTypes: ['leader'], active: true },
  { id: 'ca-2', branchId: 'lotte-vt', name: 'Ca 2', startTime: '14:15', endTime: '22:15', employmentTypes: ['leader'], active: true },
  { id: 'staff-2', branchId: 'lotte-vt', name: 'Ca 2 NV', startTime: '14:15', endTime: '22:15', employmentTypes: ['full_time'], active: true },
]
const ca1 = { branchId: 'lotte-vt', workDate: '2026-07-20', shiftId: 'ca-1', startTime: '07:15', endTime: '15:15', status: 'approved' }
const ca2 = { branchId: 'lotte-vt', workDate: '2026-07-20', shiftId: 'ca-2', startTime: '14:15', endTime: '22:15', status: 'approved' }
const allDayLeader = { branchId: 'lotte-vt', workDate: '2026-07-21', shiftId: undefined, startTime: '07:15', endTime: '22:15', status: 'approved' }
const unmatchedCustomShift = { branchId: 'lotte-vt', workDate: '2026-07-21', shiftId: undefined, startTime: '10:00', endTime: '18:00', status: 'approved' }
const closedCa1 = [{ branchId: 'lotte-vt', businessDate: '2026-07-20', sequence: 1, status: 'closed' }]

assert.equal(scheduledOperationalSequence(ca1, workShifts), 1)
assert.equal(scheduledOperationalSequence(ca2, workShifts), 2)
assert.equal(canOpenNextScheduledOperationalShift(ca1, [], workShifts), true)
assert.equal(canOpenNextScheduledOperationalShift(ca2, [], workShifts), false)
assert.equal(canOpenNextScheduledOperationalShift(ca1, closedCa1, workShifts), false)
assert.equal(canOpenNextScheduledOperationalShift(ca2, closedCa1, workShifts), true)
assert.deepEqual(scheduledOperationalSequences(allDayLeader, workShifts), [1, 2])
assert.equal(canOpenNextScheduledOperationalShift(allDayLeader, [], workShifts), true)
assert.equal(canOpenNextScheduledOperationalShift(allDayLeader, closedCa1, workShifts), true)
assert.equal(canOpenNextScheduledOperationalShift(unmatchedCustomShift, [], workShifts), false)

console.log('AUTO_SECOND_SHIFT_START_OK')
