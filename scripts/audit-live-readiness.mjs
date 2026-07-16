import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const TODAY = localDateKey()
const TOMORROW = offsetDateKey(TODAY, 1)
let auditStep = 'init'
const OPERATIONAL_TABLES = [
  ['sales_receipts', 'business_date', 'date'],
  ['sales_receipt_items', null, null],
  ['stock_movements', 'shift_date', 'date'],
  ['bag_shift_sessions', 'business_date', 'date'],
  ['bag_allocations', 'business_date', 'date'],
  ['operation_days', 'business_date', 'date'],
  ['report_snapshots', 'report_date', 'date'],
  ['inventory_reports', 'report_date', 'date'],
  ['supply_requests', 'created_at', 'timestamp'],
  ['shift_registrations', 'work_date', 'date'],
  ['attendance_records', 'check_in_time', 'timestamp'],
  ['payroll_bonus_ledger', 'bonus_date', 'date'],
  ['payroll_kpi_metrics', 'metric_date', 'date'],
  ['payroll_entries', 'period', 'month'],
  ['employee_kpi_targets', 'updated_at', 'timestamp'],
  ['lotte_reconciliation_lines', 'business_date', 'date'],
  ['control_audit_entries', 'created_at', 'timestamp'],
]

function readEnvFile(path) {
  const text = readFileSync(path, 'utf8')
  const env = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index === -1) continue
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1)
  }
  return env
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function offsetDateKey(value, days) {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  return localDateKey(date)
}

function tableMissing(error) {
  const message = String(error?.message || '')
  return /does not exist|schema cache|Could not find|relation/i.test(message)
}

async function countRows(client, table, configure) {
  let query = client.from(table).select('*', { count: 'exact', head: true })
  query = configure ? configure(query) : query
  const { count, error } = await query
  if (error) {
    if (tableMissing(error)) return null
    throw error
  }
  return count || 0
}

async function selectAll(client, table, columns, configure) {
  const rows = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    let query = client.from(table).select(columns).range(from, from + pageSize - 1)
    query = configure ? configure(query) : query
    const { data, error } = await query
    if (error) {
      if (tableMissing(error)) return []
      throw error
    }
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

function applyTodayFilter(query, column, type) {
  if (!column) return query
  if (type === 'timestamp') return query.gte(column, `${TODAY}T00:00:00`).lt(column, `${TOMORROW}T00:00:00`)
  if (type === 'month') return query.eq(column, TODAY.slice(0, 7))
  return query.eq(column, TODAY)
}

function applyHistoricalFilter(query, column, type) {
  if (!column) return query
  if (type === 'timestamp') return query.lt(column, `${TODAY}T00:00:00`)
  if (type === 'month') return query.lt(column, TODAY.slice(0, 7))
  return query.lt(column, TODAY)
}

function applyFutureFilter(query, column, type) {
  if (!column) return query
  if (type === 'timestamp') return query.gte(column, `${TOMORROW}T00:00:00`)
  if (type === 'month') return query.gt(column, TODAY.slice(0, 7))
  return query.gt(column, TODAY)
}

function duplicateValues(rows, selector) {
  const seen = new Map()
  const duplicates = []
  for (const row of rows) {
    const value = selector(row)
    if (!value) continue
    const key = String(value).trim().toLowerCase()
    if (!key) continue
    seen.set(key, (seen.get(key) || 0) + 1)
  }
  for (const [value, count] of seen.entries()) {
    if (count > 1) duplicates.push({ value, count })
  }
  return duplicates
}

async function main() {
  const setStep = (value) => { auditStep = value }
  setStep('init')
  const env = readEnvFile('.env.local')
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Missing Supabase env in .env.local.')

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let authError
  setStep('auth')
  for (const email of ['admin@accounts.gustino.vn', 'admin@gustino.vn']) {
    const { error } = await client.auth.signInWithPassword({ email, password: '123456' })
    authError = error
    if (!error) break
  }
  if (authError) throw authError

  setStep('get-user')
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError) throw userError

  setStep('admin-profile')
  const { data: adminProfile, error: profileError } = await client
    .from('profiles')
    .select('id, full_name, email, role, branch_id, active')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profileError) throw profileError
  if (adminProfile?.role !== 'admin') throw new Error('Admin login did not resolve to an admin profile.')

  setStep('branches')
  const branches = await selectAll(client, 'branches', 'id, name, active')
  setStep('profiles')
  const profiles = await selectAll(client, 'profiles', 'id, full_name, email, role, branch_id, active')
  setStep('products')
  const products = await selectAll(client, 'products', 'id, sku, name, unit, category, active, price, source, inbound_unit, inbound_pack_kg, inbound_pack_quantity, recipe')

  const branchIds = new Set(branches.map((item) => item.id))
  const profileIds = new Set(profiles.map((item) => item.id))
  const productIds = new Set(products.map((item) => item.id))
  const activeProducts = products.filter((item) => item.active !== false && !item.deleted_at)

  const anomalies = []
  const warnings = []

  const duplicateSkus = duplicateValues(activeProducts, (item) => item.sku)
  if (duplicateSkus.length) anomalies.push({ type: 'duplicate_active_sku', rows: duplicateSkus })

  const duplicateEmails = duplicateValues(profiles.filter((item) => item.active !== false), (item) => item.email)
  if (duplicateEmails.length) anomalies.push({ type: 'duplicate_active_profile_email', rows: duplicateEmails })

  const badProducts = activeProducts.filter((item) => !item.id || !item.sku || !item.name || !item.unit || !item.category)
  if (badProducts.length) anomalies.push({ type: 'bad_active_product_master', count: badProducts.length })

  const badRecipes = []
  for (const item of activeProducts) {
    if (!Array.isArray(item.recipe)) continue
    for (const line of item.recipe) {
      if (!productIds.has(line?.productId) || !Number.isFinite(Number(line?.quantity)) || Number(line?.quantity) <= 0) {
        badRecipes.push({ product: item.sku || item.id, line })
      }
    }
  }
  if (badRecipes.length) anomalies.push({ type: 'bad_menu_recipe_lines', rows: badRecipes.slice(0, 20), count: badRecipes.length })

  const branchlessWorkers = profiles.filter((item) =>
    item.active !== false && ['shift_leader', 'staff'].includes(item.role) && !branchIds.has(item.branch_id),
  )
  if (branchlessWorkers.length) anomalies.push({ type: 'active_worker_without_valid_branch', count: branchlessWorkers.length })

  const testBranches = branches.filter((item) => /test/i.test(item.name || item.id))
  if (testBranches.length) warnings.push({ type: 'test_named_branches_still_present', rows: testBranches.map((item) => item.name || item.id) })

  const counts = {}
  for (const [table, dateColumn, dateType] of OPERATIONAL_TABLES) {
    setStep(`count:${table}`)
    try {
      const total = await countRows(client, table)
      if (total === null) {
        counts[table] = { exists: false }
        continue
      }
      counts[table] = {
        exists: true,
        total,
        historicalBeforeToday: dateColumn ? await countRows(client, table, (query) => applyHistoricalFilter(query, dateColumn, dateType)) : null,
        today: dateColumn ? await countRows(client, table, (query) => applyTodayFilter(query, dateColumn, dateType)) : null,
        futureAfterToday: dateColumn ? await countRows(client, table, (query) => applyFutureFilter(query, dateColumn, dateType)) : null,
      }
    } catch (error) {
      counts[table] = {
        exists: true,
        error: error?.message || 'unknown count error',
        code: error?.code,
      }
      warnings.push({ type: 'table_count_error', table, message: error?.message || 'unknown count error', code: error?.code })
    }
  }

  setStep('stock-movements')
  const stockMovements = await selectAll(client, 'stock_movements', 'id, branch_id, product_id, source_product_id, created_by, shift_date')
  const badStockMovements = stockMovements.filter((item) =>
    !branchIds.has(item.branch_id) || !productIds.has(item.product_id) || (item.source_product_id && !productIds.has(item.source_product_id)),
  )
  if (badStockMovements.length) anomalies.push({ type: 'stock_movements_bad_refs', count: badStockMovements.length })

  setStep('receipts')
  const receipts = await selectAll(client, 'sales_receipts', 'id, branch_id, seller_id, created_by, business_date')
  const receiptIds = new Set(receipts.map((item) => item.id))
  const badReceipts = receipts.filter((item) => !branchIds.has(item.branch_id) || (item.seller_id && !profileIds.has(item.seller_id)))
  if (badReceipts.length) anomalies.push({ type: 'sales_receipts_bad_refs', count: badReceipts.length })

  setStep('receipt-items')
  const receiptItems = await selectAll(client, 'sales_receipt_items', 'id, receipt_id, product_id')
  const badReceiptItems = receiptItems.filter((item) => !receiptIds.has(item.receipt_id) || (item.product_id && !productIds.has(item.product_id)))
  if (badReceiptItems.length) anomalies.push({ type: 'sales_receipt_items_bad_refs', count: badReceiptItems.length })

  setStep('registrations')
  const registrations = await selectAll(client, 'shift_registrations', 'id, user_id, branch_id, work_date')
  const registrationIds = new Set(registrations.map((item) => item.id))
  const badRegistrations = registrations.filter((item) => !branchIds.has(item.branch_id) || !profileIds.has(item.user_id))
  if (badRegistrations.length) anomalies.push({ type: 'shift_registrations_bad_refs', count: badRegistrations.length })

  setStep('attendance')
  const attendance = await selectAll(client, 'attendance_records', 'id, user_id, branch_id, shift_registration_id, check_in_time')
  const badAttendance = attendance.filter((item) =>
    !branchIds.has(item.branch_id) || !profileIds.has(item.user_id) || (item.shift_registration_id && !registrationIds.has(item.shift_registration_id)),
  )
  if (badAttendance.length) anomalies.push({ type: 'attendance_records_bad_refs', count: badAttendance.length })

  let purgeTodayGuard = { status: 'unknown' }
  if (branches[0]?.id) {
    setStep('purge-guard-noop')
    const { data, error } = await client.rpc('admin_purge_business_data', {
      p_branch_id: branches[0].id,
      p_from: TODAY,
      p_to: TODAY,
      p_targets: [],
    })
    purgeTodayGuard = error
      ? { status: 'blocked_by_db', message: error.message }
      : { status: 'not_blocked_by_db_noop_returned', data }
    if (!error) warnings.push({ type: 'db_purge_today_guard_not_applied', detail: 'RPC accepted today range when p_targets is empty. App/script guards still block destructive calls.' })
  }

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    today: TODAY,
    connection: {
      supabaseAuth: 'ok',
      adminProfile: { id: adminProfile.id, role: adminProfile.role, active: adminProfile.active !== false },
    },
    masterData: {
      branches: branches.length,
      activeBranches: branches.filter((item) => item.active !== false).length,
      profiles: profiles.length,
      activeProfiles: profiles.filter((item) => item.active !== false).length,
      products: products.length,
      activeProducts: activeProducts.length,
      menuProducts: activeProducts.filter((item) => Array.isArray(item.recipe) && item.recipe.length).length,
    },
    operationalCounts: counts,
    purgeTodayGuard,
    anomalies,
    warnings,
    verdict: anomalies.length ? 'needs_attention' : 'readiness_checks_passed',
  }, null, 2))
}

main().catch((error) => {
  console.error(JSON.stringify({
    step: auditStep,
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
    code: error?.code,
    error,
  }, null, 2))
  process.exit(1)
})
