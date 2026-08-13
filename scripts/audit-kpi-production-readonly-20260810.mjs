import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = readEnv('.env.local')
const url = env.VITE_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY
if (!url || !anonKey) throw new Error('Thiếu VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY trong .env.local.')

const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
let authError
for (const email of ['admin@accounts.gustino.vn', 'admin@gustino.vn']) {
  const { error } = await client.auth.signInWithPassword({ email, password: '123456' })
  authError = error
  if (!error) break
}
if (authError) throw authError

const branchId = 'lotte-vt'
const from = '2026-07-01'
const to = '2026-08-10'

const [profiles, receipts, allocations, registrations, attendance, overrides] = await Promise.all([
  selectAll('profiles', 'id, full_name, role, employment_type, position_title, active', (query) => query.eq('branch_id', branchId)),
  selectAll(
    'sales_receipts',
    'id, business_date, seller_id, total_amount, total_quantity, sales_receipt_items(quantity, unit_price, line_total, allocation_id)',
    (query) => query.eq('branch_id', branchId).gte('business_date', from).lte('business_date', to),
  ),
  selectAll('bag_allocations', 'id, business_date, sold_quantity, settled_at', (query) =>
    query.eq('branch_id', branchId).gte('business_date', from).lte('business_date', to)),
  selectAll('shift_registrations', 'id, user_id, work_date, status', (query) =>
    query.eq('branch_id', branchId).gte('work_date', from).lte('work_date', to)),
  selectAll('attendance_records', 'id, user_id, shift_registration_id, check_in_time, check_out_time', (query) =>
    query.eq('branch_id', branchId).gte('check_in_time', `${from}T00:00:00`).lt('check_in_time', '2026-08-11T00:00:00')),
  selectAll('employee_kpi_targets', 'employee_key, target_revenue', (query) => query.eq('branch_id', branchId)),
])

const months = ['2026-07', '2026-08'].map((month) => {
  const monthReceipts = receipts.filter((row) => row.business_date.startsWith(month))
  const headerRevenue = monthReceipts.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)
  const lineRevenue = monthReceipts.reduce((sum, row) => sum + (row.sales_receipt_items || [])
    .reduce((lineSum, line) => lineSum + Number(line.line_total ?? Number(line.quantity || 0) * Number(line.unit_price || 0)), 0), 0)
  const mismatchCount = monthReceipts.filter((row) => {
    const total = (row.sales_receipt_items || []).reduce((sum, line) => sum + Number(line.line_total || 0), 0)
    return Math.abs(total - Number(row.total_amount || 0)) > 0.5
  }).length
  const dates = new Set(monthReceipts.map((row) => row.business_date))
  return {
    month,
    receiptCount: monthReceipts.length,
    businessDateCount: dates.size,
    headerRevenue,
    lineRevenue,
    mismatchCount,
    saturdayReceiptCount: monthReceipts.filter((row) => new Date(`${row.business_date}T00:00:00Z`).getUTCDay() === 6).length,
    sundayReceiptCount: monthReceipts.filter((row) => new Date(`${row.business_date}T00:00:00Z`).getUTCDay() === 0).length,
  }
})

const activeProfiles = profiles.filter((row) => row.active !== false)
const positionCounts = activeProfiles.reduce((counts, row) => {
  const key = positionOf(row)
  counts[key] = (counts[key] || 0) + 1
  return counts
}, {})

const kpiByMonth = months.map((monthRow) => {
  const monthReceipts = receipts.filter((row) => row.business_date.startsWith(monthRow.month))
  const revenueBySeller = new Map()
  monthReceipts.forEach((receipt) => {
    if (!receipt.seller_id) return
    revenueBySeller.set(receipt.seller_id, (revenueBySeller.get(receipt.seller_id) || 0) + Number(receipt.total_amount || 0))
  })
  const employees = activeProfiles.map((profile) => {
    const position = positionOf(profile)
    const revenue = position === 'ca_truong' ? monthRow.headerRevenue : revenueBySeller.get(profile.id) || 0
    const target = position === 'part_time' ? 14900000
      : position === 'full_time' ? 28800000
        : position === 'ca_pho' ? 13000000
          : 128200000
    const progress = target > 0 ? revenue / target * 100 : 0
    const monthlyBonus = position === 'full_time' || position === 'ca_pho'
      ? tierBonus(progress, [2500000, 2000000, 1500000, 1000000, 500000])
      : position === 'ca_truong'
        ? tierBonus(progress, [5000000, 4000000, 3000000, 2000000, 1000000])
        : 0
    return { name: profile.full_name, position, revenue, target, progress, monthlyBonus }
  })
  const byPosition = {}
  employees.forEach((employee) => {
    const current = byPosition[employee.position] || { employeeCount: 0, revenue: 0, target: 0, monthlyBonus: 0, reachedMonthlyTierCount: 0 }
    current.employeeCount += 1
    current.revenue += employee.revenue
    current.target += employee.target
    current.monthlyBonus += employee.monthlyBonus
    current.reachedMonthlyTierCount += employee.monthlyBonus > 0 ? 1 : 0
    byPosition[employee.position] = current
  })
  return {
    month: monthRow.month,
    byPosition,
    employees,
    unattributedReceiptCount: monthReceipts.filter((row) => !row.seller_id).length,
    unattributedRevenue: monthReceipts.filter((row) => !row.seller_id).reduce((sum, row) => sum + Number(row.total_amount || 0), 0),
  }
})

const result = {
  auditedAt: new Date().toISOString(),
  scope: { branchId, from, to, mode: 'READ_ONLY' },
  months,
  sourceCounts: {
    profiles: profiles.length,
    allocations: allocations.length,
    settledAllocations: allocations.filter((row) => row.settled_at).length,
    registrations: registrations.length,
    approvedRegistrations: registrations.filter((row) => row.status === 'approved').length,
    attendance: attendance.length,
    closedAttendance: attendance.filter((row) => row.check_out_time).length,
    employeeKpiOverrides: overrides.length,
    overrideTargets: Array.from(new Set(overrides.map((row) => Number(row.target_revenue || 0)))).sort((a, b) => a - b),
  },
  positionCounts,
  kpiByMonth,
}

if (!receipts.length) throw new Error('Audit không đọc được hóa đơn Vũng Tàu trong tháng 7–8/2026.')
if (months.some((row) => row.mismatchCount > 0 || row.headerRevenue !== row.lineRevenue)) {
  throw new Error(`Doanh thu header/item không khớp: ${JSON.stringify(months)}`)
}
if (months[0].saturdayReceiptCount === 0) throw new Error('Tháng 7 không có hóa đơn Thứ Bảy để đối soát dữ liệu lịch sử.')

console.log(JSON.stringify(result, null, 2))
console.log('KPI_PRODUCTION_READONLY_AUDIT_OK')

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

async function selectAll(table, columns, configure) {
  const output = []
  const pageSize = 500
  for (let fromIndex = 0; ; fromIndex += pageSize) {
    let query = client.from(table).select(columns).range(fromIndex, fromIndex + pageSize - 1)
    query = configure(query)
    const { data, error } = await query
    if (error) {
      if (/does not exist|schema cache|Could not find|relation/i.test(String(error.message || ''))) return []
      throw error
    }
    output.push(...(data || []))
    if (!data || data.length < pageSize) return output
  }
}

function positionOf(profile) {
  const title = String(profile.position_title || '').toLocaleLowerCase('vi')
  if (title.includes('phó')) return 'ca_pho'
  if (title.includes('trưởng') || profile.role === 'shift_leader') return 'ca_truong'
  return profile.employment_type === 'full_time' ? 'full_time' : 'part_time'
}

function tierBonus(progress, [tier120, tier110, tier100, tier90, tier80]) {
  if (progress >= 120) return tier120
  if (progress >= 110) return tier110
  if (progress >= 100) return tier100
  if (progress >= 90) return tier90
  if (progress >= 80) return tier80
  return 0
}
