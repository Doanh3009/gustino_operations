import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [
  activeSessionMigration,
  attendanceMigration,
  attendance,
  admin,
  inventory,
  orders,
  styles,
] = await Promise.all([
  readFile('supabase/migrations/20260716_active_session_own_read.sql', 'utf8'),
  readFile('supabase/migrations/20260716_admin_attendance_correction.sql', 'utf8'),
  readFile('src/lib/attendance.ts', 'utf8'),
  readFile('src/pages/AdminPage.tsx', 'utf8'),
  readFile('src/pages/InventoryPage.tsx', 'utf8'),
  readFile('src/pages/OrdersPage.tsx', 'utf8'),
  readFile('src/styles.css', 'utf8'),
])

assert.match(activeSessionMigration, /user_id\s*=\s*auth\.uid\(\)/)
assert.match(activeSessionMigration, /role\s*=\s*'admin'/)

assert.match(attendanceMigration, /admin_update_attendance_record/)
assert.match(attendanceMigration, /security definer/)
assert.match(attendanceMigration, /role is distinct from 'admin'/)
assert.match(attendanceMigration, /control_audit_entries/)
assert.match(attendanceMigration, /v_check_out\s*<=\s*v_check_in/)
assert.match(attendanceMigration, /interval '18 hours'/)

assert.match(attendance, /export async function updateAttendanceRecordByAdmin/)
assert.match(attendance, /rpc\('admin_update_attendance_record'/)
assert.match(attendance, /attendanceRecordId\?: string/)
assert.match(attendance, /attendanceRecordId: record\?\.id/)
assert.match(admin, /attendance-detail-list/)
assert.match(admin, /Chỉnh công/)
assert.match(admin, /Lý do điều chỉnh/)
assert.match(admin, /updateAttendanceRecordByAdmin/)
assert.match(admin, /const ATTENDANCE_EDIT_PAGE_SIZE = 20/)
assert.match(admin, /useState<'date' \| 'employee'>\('date'\)/)
assert.match(admin, /const \[attendanceListDate, setAttendanceListDate\]/)
assert.match(admin, /const \[attendanceListEmployeeId, setAttendanceListEmployeeId\]/)
assert.match(admin, /attendanceListFilteredRows/)
assert.match(admin, /attendanceListPageRows\.map/)
assert.match(admin, /Theo ngày/)
assert.match(admin, /Theo nhân viên/)
assert.match(admin, /Chọn nhân viên/)
assert.match(admin, /attendance-correction-filters/)
assert.match(admin, /attendance-correction-pagination/)
assert.doesNotMatch(admin, /\{attendanceListRows\.map\(/)
assert.match(styles, /\.attendance-correction-filters/)
assert.match(styles, /\.attendance-correction-pagination/)
assert.ok(!admin.includes('coreKpiCards.map'), 'Hai card KPI tổng quan dư thừa vẫn còn được render.')

assert.match(inventory, /inventory-infographic/)
assert.match(styles, /\.inventory-infographic\s*\{[^}]*width:\s*1080px/s)
assert.match(inventory, /configuredBranchName\(user\.branchId\)/)
assert.match(inventory, /image\/png/)
assert.match(inventory, /InventoryCountPoster/)
assert.match(inventory, /posterRef/)
assert.match(inventory, /const captureHeight = Math\.ceil\(posterRef\.current\.scrollHeight\)/)
assert.match(inventory, /inventory-count-poster-snapshot/)
assert.match(styles, /\.inventory-count-poster\s*\{[^}]*width:\s*1080px/s)
assert.doesNotMatch(styles, /\.inventory-count-poster\s*\{[^}]*height:\s*1920px/s)
assert.match(styles, /\.inventory-count-poster\s*\{[^}]*border-top:\s*14px solid/s)
assert.match(styles, /\.inventory-count-poster-row\.head\s*\{[^}]*background:\s*#3a3631/s)

assert.match(orders, /order-entry-table/)
assert.match(orders, /order-report-sheet-export/)
assert.match(orders, /image\/png/)
assert.match(orders, /width:\s*1080/)
assert.match(orders, /height:\s*1350/)
assert.match(styles, /\.order-report-sheet-export/)
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.order-entry-row/)

console.log('ADMIN_ATTENDANCE_REPORT_POLISH_OK')
