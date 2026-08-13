import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const DATE = '2026-08-09'
const env = readEnv('.env.local')
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

let authError
for (const email of ['admin@accounts.gustino.vn', 'admin@gustino.vn']) {
  const { error } = await client.auth.signInWithPassword({ email, password: '123456' })
  authError = error
  if (!error) break
}
if (authError) throw authError

const reports = [
  { branchId: 'lotte-2310', name: 'Thảo Nguyên', position: 'shift_leader', amount: 572000, percent: 173 },
  { branchId: 'lotte-2310', name: 'Thanh Ngân', position: 'pg_full_time', amount: 1372000, percent: 124.7 },
  { branchId: 'lotte-2310', name: 'Ngọc Ly', position: 'pg_part_time', amount: 691000, percent: 106 },
  { branchId: 'lotte-2310', name: 'Mỹ Quyên', position: 'pg_part_time', amount: 709000, percent: 128.9 },
  { branchId: 'lotte-vt', name: 'Đặng Thị Khánh Linh', position: 'shift_deputy', amount: 874000, percent: 142.7 },
  { branchId: 'lotte-vt', name: 'Mã Thị Thanh Trúc', position: 'shift_deputy', amount: 556000, percent: 110 },
  { branchId: 'lotte-vt', name: 'Phạm Thị Quỳnh Như', position: 'pg_full_time', amount: 1064000, percent: 101.3 },
  { branchId: 'lotte-vt', name: 'Lê Phúc Phương Nhi', position: 'pg_part_time', amount: 623000, percent: 111.7 },
  { branchId: 'lotte-vt', name: 'Nguyễn Thị Thùy Trang', position: 'pg_part_time', amount: 787000, percent: 130.1 },
  { branchId: 'gold-coast', name: 'Nhật An', position: 'pg_full_time', amount: 1556000, percent: 119.6 },
  { branchId: 'gold-coast', name: 'Minh Khoa', position: 'pg_full_time', amount: 1306000, percent: 104.6 },
]

const [
  { data: profiles, error: profileError },
  { data: receipts, error: receiptError },
  { data: registrations, error: registrationError },
  { data: attendance, error: attendanceError },
] = await Promise.all([
  client.from('profiles')
    .select('id, full_name, branch_id, role, employment_type, position_title, active')
    .in('branch_id', ['lotte-2310', 'lotte-vt', 'gold-coast']),
  client.from('sales_receipts')
    .select('id, branch_id, business_date, seller_id, seller_name, total_amount, sales_receipt_items(line_total, allocation_id)')
    .eq('business_date', DATE)
    .in('branch_id', ['lotte-2310', 'lotte-vt', 'gold-coast']),
  client.from('shift_registrations')
    .select('id, user_id, branch_id, work_date, start_time, end_time, status, employment_type, position_title')
    .eq('work_date', DATE)
    .in('branch_id', ['lotte-2310', 'lotte-vt', 'gold-coast']),
  client.from('attendance_records')
    .select('id, user_id, branch_id, shift_registration_id, check_in_time, check_out_time')
    .in('branch_id', ['lotte-2310', 'lotte-vt', 'gold-coast'])
    .gte('check_in_time', `${DATE}T00:00:00+07:00`)
    .lt('check_in_time', '2026-08-10T00:00:00+07:00'),
])
if (profileError) throw profileError
if (receiptError) throw receiptError
if (registrationError) throw registrationError
if (attendanceError) throw attendanceError

const directRevenueBySeller = new Map()
for (const receipt of receipts || []) {
  const revenue = (receipt.sales_receipt_items || [])
    .filter((line) => !line.allocation_id)
    .reduce((sum, line) => sum + Number(line.line_total || 0), 0)
  const key = receipt.seller_id || `${receipt.branch_id}|${normalizeName(receipt.seller_name)}`
  directRevenueBySeller.set(key, (directRevenueBySeller.get(key) || 0) + revenue)
}

const audited = reports.map((report) => {
  const profile = (profiles || []).find((row) =>
    row.branch_id === report.branchId && normalizeName(row.full_name).includes(normalizeName(report.name)))
  const fallbackKey = `${report.branchId}|${normalizeName(report.name)}`
  const systemRevenue = profile
    ? directRevenueBySeller.get(profile.id) || directRevenueBySeller.get(fallbackKey) || 0
    : directRevenueBySeller.get(fallbackKey) || 0
  const target = weekendTarget(report.branchId, report.position)
  const systemPercent = target > 0 ? systemRevenue / target * 100 : 0
  const profilePosition = profile ? positionOf(profile) : null
  const profileTarget = profilePosition ? weekendTarget(report.branchId, profilePosition) : 0
  const profileSystemPercent = profileTarget > 0 ? systemRevenue / profileTarget * 100 : 0
  const reportedImpliedTarget = report.percent > 0 ? report.amount / (report.percent / 100) : 0
  const profileRegistrations = (registrations || []).filter((row) => row.user_id === profile?.id)
  const profileAttendance = (attendance || []).filter((row) => row.user_id === profile?.id)
  return {
    branchId: report.branchId,
    reportName: report.name,
    databaseName: profile?.full_name || null,
    profileRole: profile?.role || null,
    profileEmploymentType: profile?.employment_type || null,
    profilePositionTitle: profile?.position_title || null,
    profileActive: profile?.active ?? null,
    profilePosition,
    declaredReportPosition: report.position,
    registrationCount: profileRegistrations.length,
    registeredHours: round(profileRegistrations.reduce((sum, row) => sum + clockHours(row.start_time, row.end_time), 0)),
    attendanceCount: profileAttendance.length,
    attendedHours: round(profileAttendance.reduce((sum, row) => sum + timestampHours(row.check_in_time, row.check_out_time), 0)),
    reportedRevenue: report.amount,
    systemRevenue,
    revenueMatches: systemRevenue === report.amount,
    declaredPositionWeekendTarget: target,
    currentProfileWeekendTarget: profileTarget,
    reportedPercent: report.percent,
    percentAtDeclaredPosition: round(systemPercent),
    currentProfileSystemPercent: round(profileSystemPercent),
    declaredPercentMatches: Math.abs(systemPercent - report.percent) < 0.11,
    reportedImpliedTarget: Math.round(reportedImpliedTarget),
  }
})

console.log(JSON.stringify({
  auditedAt: new Date().toISOString(),
  date: DATE,
  utcDay: new Date(`${DATE}T00:00:00Z`).getUTCDay(),
  mode: 'READ_ONLY',
  receiptCount: receipts?.length || 0,
  audited,
}, null, 2))
console.log('DAILY_KPI_REPORT_20260809_READONLY_AUDIT_OK')

function weekendTarget(branchId, position) {
  const targets = {
    'lotte-2310': { pg_part_time: 550000, pg_full_time: 1100000, shift_deputy: 330000, shift_leader: 330000 },
    'lotte-vt': { pg_part_time: 650000, pg_full_time: 1300000, shift_deputy: 500000, shift_leader: 0 },
    'gold-coast': { pg_part_time: 650000, pg_full_time: 1300000, shift_deputy: 390000, shift_leader: 390000 },
  }
  return targets[branchId]?.[position] || 0
}

function positionOf(profile) {
  const title = normalizeName(profile.position_title)
  if (title.includes('ca pho')) return 'shift_deputy'
  if (title.includes('ca truong') || profile.role === 'shift_leader') return 'shift_leader'
  return profile.employment_type === 'full_time' ? 'pg_full_time' : 'pg_part_time'
}

function normalizeName(value = '') {
  return String(value).trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function round(value) {
  return Math.round(value * 10) / 10
}

function clockHours(start, end) {
  const [startHour, startMinute] = String(start || '00:00').slice(0, 5).split(':').map(Number)
  const [endHour, endMinute] = String(end || '00:00').slice(0, 5).split(':').map(Number)
  let minutes = endHour * 60 + endMinute - startHour * 60 - startMinute
  if (minutes < 0) minutes += 24 * 60
  return minutes / 60
}

function timestampHours(start, end) {
  if (!start || !end) return 0
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 3600000)
}

function readEnv(path) {
  const output = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index > 0) output[trimmed.slice(0, index)] = trimmed.slice(index + 1)
  }
  return output
}
