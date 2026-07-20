import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { transform } from 'esbuild'

const [admin, fairnessSource] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/competitionFairness.ts', import.meta.url), 'utf8'),
])
const compiled = await transform(fairnessSource, { loader: 'ts', format: 'esm', target: 'es2022' })
const fairness = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`)

assert.match(admin, /aria-label="Vai trò thi đua"/, 'Thiếu bộ lọc vai trò thi đua.')
assert.match(admin, /aria-label="Loại ngày thi đua"/, 'Thiếu bộ lọc ngày thường\/cuối tuần.')
assert.match(admin, /aria-label="Số ca tối thiểu"/, 'Thiếu ngưỡng số ca tối thiểu.')
assert.match(admin, /aria-label="Số ca tối đa"/, 'Thiếu ngưỡng số ca tối đa.')
assert.match(admin, /row\.shiftCount >= minimumCompetitionShifts/, 'Ngưỡng số ca tối thiểu chưa được áp dụng vào bảng xếp hạng.')
assert.match(admin, /row\.shiftCount <= maximumCompetitionShifts/, 'Ngưỡng số ca tối đa chưa được áp dụng vào bảng xếp hạng.')
assert.match(admin, /filterCompetitionAttendanceRecords\(/, 'Bộ lọc thi đua chưa lọc các ca có chấm công theo kỳ\/loại ngày.')
assert.match(admin, /buildCompetitionAttendanceMetrics\(/, 'Số ca thi đua chưa được tính từ bản ghi check-in thực tế.')
assert.doesNotMatch(
  sourceBetween(admin, 'function buildCompetitionRows(', '\nfunction formatInventoryQuantity'),
  /for \(const registration of registrations/,
  'Số ca thi đua vẫn đang đếm lịch đăng ký, kể cả người không đi làm.',
)
assert.match(admin, /'Ca có check-in'/, 'Nhãn bộ lọc chưa nói rõ số ca là ca có check-in.')
assert.match(admin, /row\.shiftCount\)} ca có check-in/, 'Bảng xếp hạng chưa hiển thị số ca có check-in để đối chiếu bộ lọc.')
assert.match(admin, /\{ label: 'Số ca tối thiểu'/, 'Excel bằng chứng chưa lưu bộ lọc số ca tối thiểu.')
assert.match(admin, /\{ label: 'Loại ngày'/, 'Excel bằng chứng chưa lưu bộ lọc loại ngày.')

const registrations = [
  { id: 'shift-friday', workDate: '2026-07-17' },
  { id: 'shift-saturday', workDate: '2026-07-18' },
]
const attendanceRecords = [
  attendanceRecord('record-friday', 'shift-friday', '2026-07-17T17:45:00.000Z', '2026-07-18T02:15:00.000Z'),
  attendanceRecord('record-saturday', 'shift-saturday', '2026-07-18T03:00:00.000Z'),
]
const weekdayRecords = fairness.filterCompetitionAttendanceRecords(attendanceRecords, registrations, {
  from: '2026-07-17', to: '2026-07-18', dayType: 'weekday', branchId: 'branch-a',
})
const weekendRecords = fairness.filterCompetitionAttendanceRecords(attendanceRecords, registrations, {
  from: '2026-07-17', to: '2026-07-18', dayType: 'weekend', branchId: 'branch-a',
})
assert.deepEqual(weekdayRecords.map((record) => record.id), ['record-friday'], 'Ca qua nửa đêm phải thuộc ngày làm trong đăng ký, không bị đẩy sang cuối tuần.')
assert.deepEqual(weekendRecords.map((record) => record.id), ['record-saturday'])

const metrics = fairness.buildCompetitionAttendanceMetrics(attendanceRecords)
assert.equal(metrics.length, 1)
assert.equal(metrics[0].shiftCount, 2, 'Ca có check-in phải được đếm, kể cả ca đang làm chưa checkout.')
assert.equal(metrics[0].totalHours, 8.5, 'Giờ dùng đối chiếu phải là giờ chấm công thực tế, không phải giờ lịch đăng ký.')

console.log('COMPETITION_FAIRNESS_FILTERS_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}

function attendanceRecord(id, shiftRegistrationId, checkInTime, checkOutTime) {
  return {
    id,
    userId: 'employee-a',
    userName: 'Nhân viên A',
    branchId: 'branch-a',
    shiftRegistrationId,
    checkInTime,
    checkOutTime,
    selfieUrl: `${id}.jpg`,
    createdAt: checkInTime,
    updatedAt: checkOutTime || checkInTime,
  }
}
