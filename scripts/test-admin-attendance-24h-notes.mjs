import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [admin, archive, attendance, timeFields, styles] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AttendanceAdjustmentArchive.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/Time24Field.tsx', import.meta.url), 'utf8').catch(() => ''),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

// Chỉnh công và bổ sung công không phụ thuộc picker 12h của hệ điều hành.
assert.match(admin, /DateTime24Field/)
assert.doesNotMatch(sourceBetween(admin, '<form className="attendance-correction-form"', '</form>'), /type="datetime-local"/)
assert.match(admin, /Dùng giờ theo ca/)
assert.match(admin, /toDateTimeLocalValue\(row\.checkInTime\)[\s\S]*\|\| attendanceScheduledDateTimeLocal\(row\.workDate, row\.scheduledStart\)/)
assert.match(admin, /toDateTimeLocalValue\(row\.checkOutTime\)[\s\S]*row\.scheduledEnd <= row\.scheduledStart/)
assert.match(archive, /Time24Field/)
assert.doesNotMatch(sourceBetween(archive, '<form className="attendance-adjustment-form attendance-supplement-form"', '</form>'), /type="time"/)
assert.match(archive, /supplementEmployeeSearch/)
assert.match(archive, /attendance-supplement-time-pair/)
assert.match(timeFields, /Array\.from\(\{ length: 24 \}/)
assert.match(timeFields, /00–23/)
assert.match(styles, /\.time-24-field/)
assert.match(styles, /\.attendance-supplement-time-pair\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,/)

// Đơn nhân viên phải được tải cùng bảng công, nối đúng ca và hiện trong note UI/Excel.
assert.match(admin, /fetchAttendanceAdjustments/)
assert.match(admin, /attendanceAdjustments/)
assert.match(admin, /buildAttendanceDetailRows\(rangeRegistrations, rangeRecords, graceByShift, rangeAttendanceAdjustments\)/)
assert.match(admin, /attendance-detail-note/)
assert.match(attendance, /AttendanceAdjustmentRequest\[\]/)
assert.match(attendance, /buildAttendanceAdjustmentNoteMap/)

const { buildAttendanceAdjustmentNoteMap } = await import('../src/lib/attendanceNotes.ts')
const notes = buildAttendanceAdjustmentNoteMap([{
  id: 'request-1',
  userId: 'employee-1',
  userName: 'Nguyễn An',
  branchId: 'gold-coast',
  kind: 'early_leave',
  workDate: '2026-08-03',
  scheduledTime: '22:00',
  actualTime: '20:30',
  reason: 'Việc gia đình',
  evidenceNote: 'Đã báo ca trưởng',
  createdBy: 'employee-1',
  createdAt: '2026-08-03T07:30:00.000Z',
}])
const note = notes.get('employee-1|gold-coast|2026-08-03') || ''
assert.match(note, /ĐƠN VỀ SỚM/)
assert.match(note, /Nguyễn An/)
assert.match(note, /03\/08\/2026 14:30/)
assert.match(note, /22:00 → 20:30/)
assert.match(note, /Việc gia đình/)
assert.match(note, /Đã báo ca trưởng/)

console.log('ADMIN_ATTENDANCE_24H_NOTES_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
