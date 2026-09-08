import assert from 'node:assert/strict'
import * as assignment from '../src/lib/operationalShiftAssignment.ts'

const staleRegistration = {
  id: 'registration-1',
  userId: 'leader-1',
  userName: 'Trần Minh Lý',
  employmentType: 'full_time',
  positionTitle: 'Nhân viên',
  branchId: 'gold-coast',
  workDate: '2026-09-08',
  startTime: '07:00',
  endTime: '14:30',
  shiftId: 'shift-1',
  status: 'approved',
  note: '',
  createdAt: '2026-09-08T00:00:00.000Z',
}
const workShifts = [{
  id: 'shift-1',
  branchId: 'gold-coast',
  name: 'Ca 1',
  startTime: '07:00',
  endTime: '14:30',
  employmentTypes: ['leader', 'full_time'],
  active: true,
}]

assert.deepEqual(assignment.operationalSequencesFor(staleRegistration, [staleRegistration], workShifts), [])

const currentLeader = assignment.registrationWithAuthenticatedLeaderRole(staleRegistration, {
  id: 'leader-1',
  role: 'shift_leader',
  positionTitle: 'Ca trưởng',
})
assert.deepEqual(assignment.operationalSequencesFor(currentLeader, [currentLeader], workShifts), [1, 2])
assert.equal(assignment.canOpenNextScheduledOperationalShift(currentLeader, [], [currentLeader], workShifts), true)

const currentDeputy = assignment.registrationWithAuthenticatedLeaderRole(staleRegistration, {
  id: 'leader-1',
  role: 'shift_leader',
  positionTitle: 'Ca phó',
})
assert.deepEqual(assignment.operationalSequencesFor(currentDeputy, [currentDeputy], workShifts), [])

const unrelated = assignment.registrationWithAuthenticatedLeaderRole(staleRegistration, {
  id: 'someone-else',
  role: 'shift_leader',
  positionTitle: 'Ca trưởng',
})
assert.equal(unrelated, staleRegistration)

console.log('AUTHENTICATED_SHIFT_LEADER_REGISTRATION_OK')
