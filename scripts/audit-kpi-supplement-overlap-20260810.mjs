import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const FROM = '2026-07-03'
const TO = '2026-07-10'
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

const [
  branchResult,
  profileResult,
  receiptResult,
  sessionResult,
  registrationResult,
  attendanceResult,
  snapshotResult,
  productResult,
  adjustmentResult,
] = await Promise.all([
  client.from('branches').select('id, name, active'),
  client.from('profiles').select('id, full_name, branch_id, role, employment_type, position_title'),
  client.from('sales_receipts')
    .select('id, branch_id, business_date, seller_id, seller_name, total_amount, sales_receipt_items(allocation_id, line_total)')
    .gte('business_date', FROM).lte('business_date', TO),
  client.from('bag_shift_sessions')
    .select('id, branch_id, business_date, status, leader_id, leader_name')
    .gte('business_date', FROM).lte('business_date', TO),
  client.from('shift_registrations')
    .select('id, branch_id, user_id, work_date')
    .gte('work_date', FROM).lte('work_date', TO),
  client.from('attendance_records')
    .select('id, branch_id, user_id, check_in_time, check_out_time')
    .gte('check_in_time', '2026-07-02T17:00:00Z').lt('check_in_time', '2026-07-10T17:00:00Z'),
  client.from('report_snapshots')
    .select('id, branch_id, report_date, revenue')
    .gte('report_date', FROM).lte('report_date', TO),
  client.from('products').select('id, price'),
  client.from('employee_kpi_revenue_adjustments')
    .select('id, source_key, branch_id, employee_id, business_date, amount')
    .like('source_key', 'owner-20260810-%'),
])
for (const result of [branchResult, profileResult, receiptResult, sessionResult, registrationResult, attendanceResult, snapshotResult, productResult, adjustmentResult]) {
  if (result.error) throw result.error
}

const branches = new Map((branchResult.data || []).map((row) => [row.id, row]))
const profiles = new Map((profileResult.data || []).map((row) => [row.id, row]))
const receipts = receiptResult.data || []
const sessions = sessionResult.data || []
const registrations = registrationResult.data || []
const attendance = attendanceResult.data || []
const snapshots = snapshotResult.data || []
const prices = new Map((productResult.data || []).map((row) => [row.id, Number(row.price || 0)]))
const adjustments = adjustmentResult.data || []
const sessionIds = sessions.map((row) => row.id)
const allocationResult = sessionIds.length
  ? await client.from('bag_allocations')
    .select('id, shift_id, branch_id, employee_id, employee_name, product_id, issued_quantity, returned_quantity, damaged_quantity, sold_quantity, settled_at')
    .in('shift_id', sessionIds)
  : { data: [], error: null }
if (allocationResult.error) throw allocationResult.error
const allocations = allocationResult.data || []
const sessionById = new Map(sessions.map((row) => [row.id, row]))

const allocationRows = allocations.map((row) => {
  const sold = row.sold_quantity === null || row.sold_quantity === undefined
    ? row.settled_at ? Math.max(0, Number(row.issued_quantity || 0) - Number(row.returned_quantity || 0) - Number(row.damaged_quantity || 0)) : 0
    : Math.max(0, Number(row.sold_quantity || 0))
  const fallbackPrices = {
    'chestnut-110': 33000, 'snow-110': 33000, 'grilled-110': 33000,
    'chestnut-330': 89000, 'snow-330': 89000, 'grilled-330': 89000,
    'chestnut-500': 169000, 'snow-500': 169000, 'grilled-500': 169000,
    'chestnut-1kg': 330000, 'snow-1kg': 330000, 'grilled-1kg': 330000,
  }
  const price = prices.get(row.product_id) || fallbackPrices[row.product_id] || 0
  return {
    ...row,
    businessDate: sessionById.get(row.shift_id)?.business_date || '',
    sold,
    revenue: Math.round(sold * price),
  }
})

const overlaps = adjustments.map((adjustment) => {
  const profile = profiles.get(adjustment.employee_id)
  const matchingAllocations = allocationRows.filter((row) =>
    row.branch_id === adjustment.branch_id
    && row.businessDate === adjustment.business_date
    && (row.employee_id === adjustment.employee_id
      || (!row.employee_id && normalizeName(row.employee_name) === normalizeName(profile?.full_name))),
  )
  const matchingReceipts = receipts.filter((receipt) =>
    receipt.branch_id === adjustment.branch_id
    && receipt.business_date === adjustment.business_date
    && (receipt.seller_id === adjustment.employee_id
      || (!receipt.seller_id && normalizeName(receipt.seller_name) === normalizeName(profile?.full_name))),
  )
  const allocationRevenue = matchingAllocations.reduce((sum, row) => sum + row.revenue, 0)
  const directReceiptRevenue = matchingReceipts.reduce((sum, receipt) => sum + (receipt.sales_receipt_items || [])
    .filter((line) => !line.allocation_id)
    .reduce((lineSum, line) => lineSum + Number(line.line_total || 0), 0), 0)
  return {
    sourceKey: adjustment.source_key,
    date: adjustment.business_date,
    branchId: adjustment.branch_id,
    employee: profile?.full_name || adjustment.employee_id,
    adjustment: Number(adjustment.amount),
    preexistingAllocationRevenue: allocationRevenue,
    preexistingDirectReceiptRevenue: directReceiptRevenue,
    overlapRevenue: allocationRevenue + directReceiptRevenue,
    allocationCount: matchingAllocations.length,
    receiptCount: matchingReceipts.length,
  }
})

const activity = []
for (const branchId of ['lotte-2310', 'lotte-vt', 'gold-coast']) {
  for (const date of dateRange(FROM, TO)) {
    const dayReceipts = receipts.filter((row) => row.branch_id === branchId && row.business_date === date)
    const dayAllocations = allocationRows.filter((row) => row.branch_id === branchId && row.businessDate === date)
    const daySessions = sessions.filter((row) => row.branch_id === branchId && row.business_date === date)
    const dayRegistrations = registrations.filter((row) => row.branch_id === branchId && row.work_date === date)
    const dayAttendance = attendance.filter((row) => row.branch_id === branchId && localDateKey(row.check_in_time) === date)
    const daySnapshots = snapshots.filter((row) => row.branch_id === branchId && row.report_date === date)
    activity.push({
      date,
      branchId,
      branch: branches.get(branchId)?.name || branchId,
      configuredActive: branches.get(branchId)?.active ?? null,
      registrations: dayRegistrations.length,
      attendance: dayAttendance.length,
      shiftSessions: daySessions.length,
      allocations: dayAllocations.length,
      allocationRevenue: dayAllocations.reduce((sum, row) => sum + row.revenue, 0),
      posReceipts: dayReceipts.length,
      posRevenue: dayReceipts.reduce((sum, row) => sum + Number(row.total_amount || 0), 0),
      reportSnapshots: daySnapshots.length,
      snapshotRevenue: daySnapshots.reduce((sum, row) => sum + Number(row.revenue || 0), 0),
      hadOperationalEvidence: dayRegistrations.length + dayAttendance.length + daySessions.length + dayAllocations.length + dayReceipts.length + daySnapshots.length > 0,
    })
  }
}

console.log(JSON.stringify({
  mode: 'READ_ONLY',
  window: { from: FROM, to: TO },
  overlapCount: overlaps.filter((row) => row.overlapRevenue > 0).length,
  overlapAmount: overlaps.reduce((sum, row) => sum + row.overlapRevenue, 0),
  overlaps: overlaps.filter((row) => row.overlapRevenue > 0),
  nonOverlappingAdjustmentCount: overlaps.filter((row) => row.overlapRevenue === 0).length,
  activity,
}, null, 2))
console.log('KPI_SUPPLEMENT_OVERLAP_READONLY_20260810_OK')

function normalizeName(value = '') {
  return String(value).trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ')
}

function localDateKey(value) {
  const date = new Date(value)
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function dateRange(from, to) {
  const dates = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
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
