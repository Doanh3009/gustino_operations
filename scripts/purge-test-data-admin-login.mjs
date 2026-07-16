import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const FROM = '2000-01-01'
const TODAY = localDateKey()
const TO = previousDateKey(TODAY)
const TARGETS = ['sales', 'ledger', 'stock', 'reports', 'requests', 'attendance', 'kpi', 'history']
const YES = process.argv.includes('--yes')

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

function previousDateKey(value) {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() - 1)
  return localDateKey(date)
}

function addCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = (target[key] || 0) + Number(value || 0)
  }
}

function tableMissing(error) {
  const message = String(error?.message || '')
  return /does not exist|schema cache|Could not find|relation/i.test(message)
}

function chunk(items, size = 500) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function deleteMaybe(key, task) {
  const { count, error } = await task()
  if (error) {
    if (tableMissing(error)) return { [key]: 0 }
    throw error
  }
  return { [key]: count || 0 }
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

async function deleteReceiptItemsForBranch(client, branchId) {
  const receipts = await selectAll(client, 'sales_receipts', 'id', (query) =>
    query.eq('branch_id', branchId).gte('business_date', FROM).lte('business_date', TO),
  )
  let deleted = 0
  for (const ids of chunk(receipts.map((item) => item.id))) {
    const { count, error } = await client
      .from('sales_receipt_items')
      .delete({ count: 'exact' })
      .in('receipt_id', ids)
    if (error) {
      if (tableMissing(error)) return { sales_receipt_items_predelete: deleted }
      throw error
    }
    deleted += count || 0
  }
  return { sales_receipt_items_predelete: deleted }
}

async function cleanupFallbacks(client, branchId) {
  const counts = {}
  const registrations = await selectAll(client, 'shift_registrations', 'id', (query) =>
    query.eq('branch_id', branchId).gte('work_date', FROM).lte('work_date', TO),
  )
  for (const ids of chunk(registrations.map((item) => item.id))) {
    addCounts(counts, await deleteMaybe('attendance_records_fallback', () => client
      .from('attendance_records')
      .delete({ count: 'exact' })
      .in('shift_registration_id', ids)))
  }
  addCounts(counts, await deleteMaybe('shift_registrations_fallback', () => client
    .from('shift_registrations')
    .delete({ count: 'exact' })
    .eq('branch_id', branchId)
    .gte('work_date', FROM)
    .lte('work_date', TO)))
  addCounts(counts, await deleteMaybe('payroll_bonus_ledger_fallback', () => client
    .from('payroll_bonus_ledger')
    .delete({ count: 'exact' })
    .eq('branch_id', branchId)
    .gte('bonus_date', FROM)
    .lte('bonus_date', TO)))
  addCounts(counts, await deleteMaybe('payroll_kpi_metrics_fallback', () => client
    .from('payroll_kpi_metrics')
    .delete({ count: 'exact' })
    .eq('branch_id', branchId)
    .gte('metric_date', FROM)
    .lte('metric_date', TO)))
  addCounts(counts, await deleteMaybe('payroll_entries_fallback', () => client
    .from('payroll_entries')
    .delete({ count: 'exact' })
    .eq('branch_id', branchId)
    .gte('period', FROM.slice(0, 7))
    .lte('period', TO.slice(0, 7))))
  addCounts(counts, await deleteMaybe('employee_kpi_targets_fallback', () => client
    .from('employee_kpi_targets')
    .delete({ count: 'exact' })
    .eq('branch_id', branchId)
    .gte('updated_at', `${FROM}T00:00:00`)
    .lte('updated_at', `${TO}T23:59:59`)))
  addCounts(counts, await deleteMaybe('lotte_reconciliation_lines', () => client
    .from('lotte_reconciliation_lines')
    .delete({ count: 'exact' })
    .eq('branch_id', branchId)
    .gte('business_date', FROM)
    .lte('business_date', TO)))
  return counts
}

async function main() {
  if (!YES) {
    throw new Error('Add --yes to confirm deleting launch test/operational data.')
  }
  if (FROM >= TODAY || TO >= TODAY || (FROM <= TODAY && TO >= TODAY)) {
    throw new Error(`Safety stop: this purge must not delete today's data (${TODAY}). Current range is ${FROM}..${TO}.`)
  }

  const env = readEnvFile('.env.local')
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local.')

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

  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError) throw userError
  if (!userData.user?.id) throw new Error('Could not resolve the logged-in admin user id.')

  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('id, role, full_name')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profileError) throw profileError
  if (profile?.role !== 'admin') {
    throw new Error(`Logged in profile is not admin; role=${profile?.role || 'unknown'}.`)
  }

  const branches = await selectAll(client, 'branches', 'id, name', (query) => query.order('name'))
  if (!branches.length) throw new Error('No branches found; aborting purge.')

  const total = {}
  const branchResults = []
  for (const branch of branches) {
    const branchCounts = {}
    addCounts(branchCounts, await deleteReceiptItemsForBranch(client, branch.id))
    const { data, error } = await client.rpc('admin_purge_business_data', {
      p_branch_id: branch.id,
      p_from: FROM,
      p_to: TO,
      p_targets: TARGETS,
    })
    if (error) throw error
    addCounts(branchCounts, data || {})
    addCounts(branchCounts, await cleanupFallbacks(client, branch.id))
    addCounts(total, branchCounts)
    branchResults.push({ branch: branch.name || branch.id, counts: branchCounts })
  }

  addCounts(total, await deleteMaybe('control_audit_entries', () => client
    .from('control_audit_entries')
    .delete({ count: 'exact' })
    .gte('created_at', `${FROM}T00:00:00`)
    .lte('created_at', `${TO}T23:59:59`)))

  console.log(JSON.stringify({
    range: { from: FROM, to: TO },
    preserved: ['profiles/accounts', 'branches', 'products/SKU', 'menu/recipes', 'schedule plans'],
    targets: TARGETS,
    branches: branchResults,
    total,
  }, null, 2))
}

main().catch((error) => {
  console.error(error?.message || error)
  process.exit(1)
})
