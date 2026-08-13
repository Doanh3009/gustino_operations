import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const requested = [
  ['2026-07-03', 'Ly', 560000],
  ['2026-07-04', 'Mỹ Quyên', 603000],
  ['2026-07-04', 'Hoàn Vy', 1135000],
  ['2026-07-05', 'Lệ Quyên', 576000],
  ['2026-07-05', 'Uyên Thư', 1303000],
  ['2026-07-05', 'Thùy Trinh', 1365000],
  ['2026-07-06', 'Phương Anh', 1118000],
  ['2026-07-06', 'Phụng Quỳnh', 582000],
  ['2026-07-06', 'Lệ Quyên', 867000],
  ['2026-07-06', 'Thùy Trinh', 1669000],
  ['2026-07-06', 'Minh Lý', 409000],
  ['2026-07-06', 'Trương Thị Phương', 328000],
  ['2026-07-07', 'Lệ Quyên', 455000],
  ['2026-07-07', 'Uyên Thư', 854000],
  ['2026-07-07', 'Thùy Trinh', 1129000],
  ['2026-07-07', 'Nhật An', 1180000],
  ['2026-07-07', 'Bảo Linh', 546000],
  ['2026-07-07', 'Minh Lý', 346000],
  ['2026-07-08', 'Đình Phát', 577000],
  ['2026-07-08', 'Thùy Trinh', 1050000],
  ['2026-07-08', 'Mỹ Quyên', 511000],
  ['2026-07-08', 'Lệ Quyên', 402000],
  ['2026-07-08', 'Yến', 333000],
  ['2026-07-08', 'Thảo Nguyên', 366000],
  ['2026-07-09', 'Uyên Thư', 897000],
  ['2026-07-09', 'Thùy Trinh', 866000],
  ['2026-07-09', 'Ngọc Ly', 587000],
  ['2026-07-09', 'Mỹ Quyên', 564000],
  ['2026-07-09', 'Yến', 247000],
  ['2026-07-09', 'Khánh Linh', 817000],
  ['2026-07-09', 'Thanh Trúc', 1005000],
  ['2026-07-09', 'Huỳnh Phương Anh', 1279000],
  ['2026-07-09', 'Đình Phát', 854000],
  ['2026-07-09', 'Bảo Linh', 960000],
  ['2026-07-09', 'Bảo Trân', 608000],
  ['2026-07-09', 'Ngọc Trâm', 539000],
  ['2026-07-09', 'Minh Lý', 488000],
  ['2026-07-10', 'Ngọc Trâm', 558000],
  ['2026-07-10', 'Bảo Trân', 519000],
  ['2026-07-10', 'Khánh Linh', 826000],
  ['2026-07-10', 'Thanh Trúc', 801000],
].map(([date, name, amount]) => ({ date, name, amount }))

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

const [profileResult, receiptResult, registrationResult, attendanceResult] = await Promise.all([
  client.from('profiles').select('id, full_name, branch_id, role, employment_type, position_title, active'),
  client.from('sales_receipts')
    .select('id, code, branch_id, business_date, seller_id, seller_name, total_amount, sales_receipt_items(allocation_id, quantity, line_total)')
    .gte('business_date', '2026-07-03').lte('business_date', '2026-07-10'),
  client.from('shift_registrations')
    .select('id, user_id, branch_id, work_date, start_time, end_time, status, employment_type, position_title')
    .gte('work_date', '2026-07-03').lte('work_date', '2026-07-10'),
  client.from('attendance_records')
    .select('id, user_id, branch_id, shift_registration_id, check_in_time, check_out_time')
    .gte('check_in_time', '2026-07-02T17:00:00Z').lt('check_in_time', '2026-07-10T17:00:00Z'),
])
for (const result of [profileResult, receiptResult, registrationResult, attendanceResult]) {
  if (result.error) throw result.error
}

const profiles = profileResult.data || []
const receipts = receiptResult.data || []
const registrations = registrationResult.data || []
const attendance = attendanceResult.data || []

const audited = requested.map((request) => {
  const candidates = profiles.filter((profile) => nameMatches(profile.full_name, request.name))
  const candidateRows = candidates.map((profile) => {
    const matchingReceipts = receipts.filter((receipt) =>
      receipt.business_date === request.date
      && receipt.branch_id === profile.branch_id
      && (receipt.seller_id === profile.id
        || (!receipt.seller_id && normalizeName(receipt.seller_name) === normalizeName(profile.full_name))),
    )
    const directRevenue = matchingReceipts.reduce((sum, receipt) => sum + (receipt.sales_receipt_items || [])
      .filter((item) => !item.allocation_id)
      .reduce((itemSum, item) => itemSum + Number(item.line_total || 0), 0), 0)
    return {
      id: profile.id,
      name: profile.full_name,
      branchId: profile.branch_id,
      role: profile.role,
      employmentType: profile.employment_type,
      positionTitle: profile.position_title,
      active: profile.active,
      registrationCount: registrations.filter((row) => row.user_id === profile.id && row.work_date === request.date).length,
      attendanceCount: attendance.filter((row) => row.user_id === profile.id && localDateKey(row.check_in_time) === request.date).length,
      receiptCount: matchingReceipts.length,
      receiptTotal: matchingReceipts.reduce((sum, receipt) => sum + Number(receipt.total_amount || 0), 0),
      directRevenue,
      receipts: matchingReceipts.map((receipt) => ({ id: receipt.id, code: receipt.code, total: Number(receipt.total_amount || 0) })),
    }
  })
  return {
    ...request,
    candidateCount: candidateRows.length,
    candidates: candidateRows,
  }
})

const output = {
  mode: 'READ_ONLY',
  requestedCount: requested.length,
  requestedTotal: requested.reduce((sum, row) => sum + row.amount, 0),
  receiptCountInWindow: receipts.length,
  audited,
}
console.log(JSON.stringify(process.env.AUDIT_SUMMARY_ONLY === '1'
  ? {
      ...output,
      audited: audited.map((row) => ({
        date: row.date,
        requestedName: row.name,
        requestedAmount: row.amount,
        candidates: row.candidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          branchId: candidate.branchId,
          role: candidate.role,
          employmentType: candidate.employmentType,
          positionTitle: candidate.positionTitle,
          registrationCount: candidate.registrationCount,
          attendanceCount: candidate.attendanceCount,
          receiptCount: candidate.receiptCount,
          directRevenue: candidate.directRevenue,
          difference: row.amount - candidate.directRevenue,
        })),
      })),
    }
  : output, null, 2))
console.log('KPI_REVENUE_SUPPLEMENTS_20260810_READONLY_OK')

function nameMatches(fullName, requestedName) {
  const full = normalizeName(fullName)
  const requested = normalizeName(requestedName)
  return full === requested || full.endsWith(` ${requested}`)
}

function normalizeName(value = '') {
  return String(value).trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ')
}

function localDateKey(value) {
  const date = new Date(value)
  const local = new Date(date.getTime() + 7 * 60 * 60 * 1000)
  return local.toISOString().slice(0, 10)
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
