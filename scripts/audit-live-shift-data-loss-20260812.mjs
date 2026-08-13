import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = readEnv('.env.local')
const url = env.VITE_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY
if (!url || !anonKey) throw new Error('Missing VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY in .env.local.')

const targetDate = argValue('--date') || '2026-08-12'
const targetBranch = argValue('--branch') || ''

const client = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

let authError
for (const email of ['admin@accounts.gustino.vn', 'admin@gustino.vn']) {
  const { error } = await client.auth.signInWithPassword({ email, password: '123456' })
  authError = error
  if (!error) break
}
if (authError) throw authError

const [branches, profiles] = await Promise.all([
  selectAll('branches', 'id, name, active', (query) => query.order('name')),
  selectAll('profiles', 'id, full_name, role, branch_id, active', (query) => query),
])

const branchIds = branches
  .filter((branch) => !targetBranch || branch.id === targetBranch)
  .map((branch) => branch.id)
if (!branchIds.length) throw new Error(`No branch matched ${targetBranch || '(all branches)'}.`)

const [
  operationDays,
  sessions,
  allocations,
  receipts,
  movements,
  snapshots,
  registrations,
  attendance,
  auditEntries,
  branchKpiFormulas,
] = await Promise.all([
  selectAll('operation_days', 'id, branch_id, business_date, status, opened_by, opened_at, closed_by, closed_at', (query) =>
    query.in('branch_id', branchIds).eq('business_date', targetDate)),
  selectAll('bag_shift_sessions', 'id, branch_id, business_date, sequence, leader_id, leader_name, status, opening_balances, closing_balances, discrepancy_note, opening_photo_url, closing_photo_url, started_at, ended_at', (query) =>
    query.in('branch_id', branchIds).eq('business_date', targetDate).order('branch_id').order('sequence')),
  selectAll('bag_allocations', 'id, branch_id, shift_id, business_date, employee_name, product_id, issued_quantity, sold_quantity, returned_quantity, damaged_quantity, issued_at, settled_at, posted_at, settlement_shift_id', (query) =>
    query.in('branch_id', branchIds).eq('business_date', targetDate).order('issued_at')),
  selectAll('sales_receipts', 'id, code, branch_id, business_date, seller_id, seller_name, total_amount, total_quantity, created_at, sales_receipt_items(id, product_id, quantity, line_total, allocation_id)', (query) =>
    query.in('branch_id', branchIds).eq('business_date', targetDate).order('branch_id').order('created_at')),
  selectAll('stock_movements', 'id, branch_id, product_id, movement_type, quantity, shift_date, document_id, note, created_by, created_at', (query) =>
    query.in('branch_id', branchIds).eq('shift_date', targetDate).order('branch_id').order('created_at')),
  selectAll('report_snapshots', 'id, branch_id, report_date, payload, created_at', (query) =>
    query.in('branch_id', branchIds).eq('report_date', targetDate)),
  selectAll('shift_registrations', 'id, branch_id, user_id, user_name, work_date, status, shift_id, start_time, end_time', (query) =>
    query.in('branch_id', branchIds).eq('work_date', targetDate)),
  selectAll('attendance_records', 'id, branch_id, user_id, shift_registration_id, check_in_time, check_out_time', (query) =>
    query.in('branch_id', branchIds).gte('check_in_time', `${targetDate}T00:00:00+07:00`).lte('check_in_time', `${targetDate}T23:59:59+07:00`)),
  selectAll('control_audit_entries', 'id, actor_id, actor_name, module, action, detail, before_value, after_value, created_at', (query) =>
    query.gte('created_at', `${targetDate}T00:00:00+07:00`).lte('created_at', `${targetDate}T23:59:59+07:00`).order('created_at', { ascending: false })),
  selectAll('branch_kpi_formulas', 'branch_id, position, weekday_target, weekend_target, monthly_target, headcount, effective_from, note, updated_at', (query) =>
    query.in('branch_id', branchIds).order('branch_id').order('position')),
])

const profilesById = new Map(profiles.map((profile) => [profile.id, profile]))
const branchesById = new Map(branches.map((branch) => [branch.id, branch]))
const sessionIds = new Set(sessions.map((session) => session.id))
const allocationIds = new Set(allocations.map((allocation) => allocation.id))
const receiptIds = new Set(receipts.map((receipt) => receipt.id))

const branchSummaries = branchIds.map((branchId) => {
  const branchSessions = sessions.filter((row) => row.branch_id === branchId)
  const branchReceipts = receipts.filter((row) => row.branch_id === branchId)
  const branchMovements = movements.filter((row) => row.branch_id === branchId)
  const branchSnapshots = snapshots.filter((row) => row.branch_id === branchId)
  const branchAllocations = allocations.filter((row) => row.branch_id === branchId)
  const branchRegistrations = registrations.filter((row) => row.branch_id === branchId)
  const branchAttendance = attendance.filter((row) => row.branch_id === branchId)
  const snapshotShiftReports = branchSnapshots.flatMap((snapshot) =>
    Object.values(snapshot.payload?.shiftReports || {}).map((entry) => ({
      shiftId: entry.shiftId,
      sequence: entry.sequence,
      scope: entry.scope,
      leaderName: entry.leaderName,
      finalizedAt: entry.finalizedAt,
      revenue: entry.report?.totals?.revenue ?? entry.report?.summary?.revenue ?? null,
      sold: entry.report?.totals?.sold ?? entry.report?.summary?.totalSold ?? null,
    })),
  )
  const receiptLines = branchReceipts.flatMap((receipt) => receipt.sales_receipt_items || [])
  return {
    branchId,
    branchName: branchesById.get(branchId)?.name || branchId,
    operationDay: operationDays.find((row) => row.branch_id === branchId) || null,
    sessions: branchSessions.map((session) => ({
      id: session.id,
      sequence: session.sequence,
      leaderName: session.leader_name,
      leaderRole: profilesById.get(session.leader_id)?.role || null,
      status: session.status,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      openingKeys: Object.keys(session.opening_balances || {}).length,
      closingKeys: Object.keys(session.closing_balances || {}).length,
      hasOpeningPhoto: Boolean(session.opening_photo_url),
      hasClosingPhoto: Boolean(session.closing_photo_url),
      note: session.discrepancy_note || '',
      stockMovementRowsByThisSession: branchMovements.filter((movement) => movement.document_id === session.id).length,
      allocationsOnThisSession: branchAllocations.filter((allocation) => allocation.shift_id === session.id || allocation.settlement_shift_id === session.id).length,
    })),
    counts: {
      registrations: branchRegistrations.length,
      approvedRegistrations: branchRegistrations.filter((row) => row.status === 'approved').length,
      attendance: branchAttendance.length,
      openAttendance: branchAttendance.filter((row) => !row.check_out_time).length,
      allocations: branchAllocations.length,
      settledAllocations: branchAllocations.filter((row) => row.settled_at).length,
      receipts: branchReceipts.length,
      receiptItems: receiptLines.length,
      stockMovements: branchMovements.length,
      reportSnapshots: branchSnapshots.length,
      snapshotShiftReports: snapshotShiftReports.length,
      kpiFormulaRows: branchKpiFormulas.filter((row) => row.branch_id === branchId).length,
    },
    revenue: {
      receiptHeaderTotal: sum(branchReceipts, (row) => row.total_amount),
      receiptLineTotal: sum(receiptLines, (row) => row.line_total),
      receiptQuantityTotal: sum(branchReceipts, (row) => row.total_quantity),
    },
    movementTypes: countBy(branchMovements, (row) => row.movement_type),
    movementDocumentLinks: {
      fromSessions: branchMovements.filter((movement) => sessionIds.has(movement.document_id)).length,
      fromAllocations: branchMovements.filter((movement) => allocationIds.has(movement.document_id)).length,
      fromReceipts: branchMovements.filter((movement) => receiptIds.has(movement.document_id)).length,
      withoutDocument: branchMovements.filter((movement) => !movement.document_id).length,
    },
    snapshotShiftReports,
    recentReceipts: branchReceipts.slice(-5).map((receipt) => ({
      code: receipt.code,
      sellerName: receipt.seller_name,
      amount: Number(receipt.total_amount || 0),
      quantity: Number(receipt.total_quantity || 0),
      createdAt: receipt.created_at,
      itemCount: (receipt.sales_receipt_items || []).length,
    })),
  }
})

const destructiveAuditEntries = auditEntries.filter((entry) =>
  /delete|x[oó]a|purge|d[oọ]n|hard_delete|delete_receipt|admin_delete|ch[oố]t|m[oở] l[aạ]i/i
    .test(`${entry.module} ${entry.action} ${entry.detail}`),
)

const result = {
  auditedAt: new Date().toISOString(),
  mode: 'READ_ONLY',
  target: { date: targetDate, branch: targetBranch || 'all' },
  totalCounts: {
    branches: branchIds.length,
    operationDays: operationDays.length,
    sessions: sessions.length,
    allocations: allocations.length,
    receipts: receipts.length,
    receiptItems: receipts.reduce((count, receipt) => count + (receipt.sales_receipt_items || []).length, 0),
    stockMovements: movements.length,
    snapshots: snapshots.length,
    registrations: registrations.length,
    attendance: attendance.length,
    auditEntries: auditEntries.length,
    destructiveAuditEntries: destructiveAuditEntries.length,
    branchKpiFormulas: branchKpiFormulas.length,
  },
  branches: branchSummaries,
  destructiveAuditEntries: destructiveAuditEntries.slice(0, 30).map((entry) => ({
    createdAt: entry.created_at,
    actorName: entry.actor_name,
    module: entry.module,
    action: entry.action,
    detail: entry.detail,
    hasBefore: Boolean(entry.before_value),
    hasAfter: Boolean(entry.after_value),
  })),
  kpiRows: branchKpiFormulas,
}

console.log(JSON.stringify(result, null, 2))
console.log('LIVE_SHIFT_DATA_LOSS_READONLY_AUDIT_OK')

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

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

async function selectAll(table, columns, configure) {
  const rows = []
  const pageSize = 500
  for (let from = 0; ; from += pageSize) {
    let query = client.from(table).select(columns).range(from, from + pageSize - 1)
    query = configure(query)
    const { data, error } = await query
    if (error) {
      const message = String(error.message || '')
      if (/does not exist|schema cache|Could not find|relation/i.test(message)) return []
      throw new Error(`${table}: ${message}`)
    }
    rows.push(...(data || []))
    if (!data || data.length < pageSize) return rows
  }
}

function sum(rows, pick) {
  return rows.reduce((total, row) => total + Number(pick(row) || 0), 0)
}

function countBy(rows, pick) {
  return rows.reduce((counts, row) => {
    const key = pick(row) || 'unknown'
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
}
