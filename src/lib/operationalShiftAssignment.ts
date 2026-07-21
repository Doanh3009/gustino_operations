import type { BagShiftSession, ShiftRegistration, WorkShift } from '../types'

/**
 * The operational ledger has exactly two sessions per business date. The
 * leader must be resolved from the configured leader shift, not merely from
 * whichever leader still has an open attendance record after the prior close.
 */
export function scheduledOperationalSequence(
  registration: Pick<ShiftRegistration, 'branchId' | 'shiftId' | 'startTime' | 'endTime'>,
  workShifts: WorkShift[],
) {
  const sequences = scheduledOperationalSequences(registration, workShifts)
  return sequences.length === 1 ? sequences[0] : undefined
}

export function scheduledOperationalSequences(
  registration: Pick<ShiftRegistration, 'branchId' | 'shiftId' | 'startTime' | 'endTime'>,
  workShifts: WorkShift[],
) {
  const leaderShifts = workShifts
    .filter((shift) => shift.branchId === registration.branchId && shift.active !== false)
    .filter((shift) => shift.employmentTypes?.includes('leader'))
    .sort((left, right) => left.startTime.localeCompare(right.startTime) || left.id.localeCompare(right.id))
  if (!registration.shiftId) {
    return leaderShifts
      .map((shift, index) => ({ shift, sequence: index + 1 }))
      .filter(({ shift }) => registrationCoversShift(registration, shift))
      .map(({ sequence }) => sequence)
      .filter((sequence) => sequence <= 2)
  }
  const index = leaderShifts.findIndex((shift) => shift.id === registration.shiftId)
  return index >= 0 && index < 2 ? [index + 1] : []
}

export function canOpenNextScheduledOperationalShift(
  registration: Pick<ShiftRegistration, 'branchId' | 'workDate' | 'shiftId' | 'startTime' | 'endTime' | 'status'>,
  sessions: BagShiftSession[],
  workShifts: WorkShift[],
) {
  if (registration.status !== 'approved') return false
  const assignedSequences = scheduledOperationalSequences(registration, workShifts)
  if (!assignedSequences.length) return false
  const existingSequences = sessions
    .filter((session) => session.branchId === registration.branchId && session.businessDate === registration.workDate)
    .map((session) => session.sequence)
  const nextSequence = existingSequences.length ? Math.max(...existingSequences) + 1 : 1
  return nextSequence <= 2 && assignedSequences.includes(nextSequence)
}

function registrationCoversShift(
  registration: Pick<ShiftRegistration, 'startTime' | 'endTime'>,
  shift: Pick<WorkShift, 'startTime' | 'endTime'>,
) {
  const registrationStart = minutesOfDay(registration.startTime)
  let registrationEnd = minutesOfDay(registration.endTime)
  let shiftStart = minutesOfDay(shift.startTime)
  let shiftEnd = minutesOfDay(shift.endTime)
  if (registrationEnd <= registrationStart) registrationEnd += 24 * 60
  if (shiftEnd <= shiftStart) shiftEnd += 24 * 60
  if (shiftStart < registrationStart && shiftEnd <= registrationEnd) {
    shiftStart += 24 * 60
    shiftEnd += 24 * 60
  }
  return registrationStart <= shiftStart && registrationEnd >= shiftEnd
}

function minutesOfDay(value: string) {
  const [hours = '0', minutes = '0'] = String(value || '').slice(0, 5).split(':')
  return Number(hours) * 60 + Number(minutes)
}
