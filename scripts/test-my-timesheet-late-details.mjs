import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [page, styles] = await Promise.all([
  readFile(new URL('../src/pages/MyTimesheetPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

// Chi tiết chỉ lọc từ cùng `lateMinutes`/attendanceRecordId đang dùng cho KPI; không tính lại nghiệp vụ.
assert.match(page, /const lateRows = useMemo\(\(\) => rows[\s\S]{0,260}row\.attendanceRecordId[\s\S]{0,120}row\.lateMinutes > 0/)
assert.match(page, /className=\{summary\.late \? 'tsheet-summary-late warn'/)
assert.match(page, /aria-controls="tsheet-late-details"/)
assert.match(page, /onClick=\{\(\) => setShowLateDetails/)
assert.match(page, /Ca \{row\.scheduledStart\}–\{row\.scheduledEnd\}/)
assert.match(page, /Check-in <b>\{formatClock\(row\.checkInTime\)\}<\/b>/)
assert.match(page, /Trễ \{row\.lateMinutes\} phút/)
assert.match(styles, /\.tsheet-late-details\s*\{/)
assert.match(styles, /\.tsheet-late-list article\s*\{[\s\S]{0,180}grid-template-columns:/)

console.log('MY_TIMESHEET_LATE_DETAILS_OK')
