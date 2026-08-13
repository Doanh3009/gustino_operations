import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260810_kpi_revenue_adjustments.sql', 'utf8')
const expected = [...migration.matchAll(/\('([^']+)', '([^']+)', '([^']+)', date '(\d{4}-\d{2}-\d{2})', (\d+),/g)]
  .map((match) => ({
    sourceKey: match[1],
    branchId: match[2],
    employeeId: match[3],
    businessDate: match[4],
    amount: Number(match[5]),
  }))
assert.equal(expected.length, 27)
assert.equal(expected.reduce((sum, row) => sum + row.amount, 0), 19444000)

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

const [{ data: actual, error }, { count: receiptCount, error: receiptError }] = await Promise.all([
  client.from('employee_kpi_revenue_adjustments')
    .select('source_key, branch_id, employee_id, business_date, amount')
    .like('source_key', 'owner-20260810-%')
    .order('source_key'),
  client.from('sales_receipts')
    .select('id', { count: 'exact', head: true })
    .gte('business_date', '2026-07-03')
    .lte('business_date', '2026-07-10'),
])
if (error) throw error
if (receiptError) throw receiptError

const normalizedActual = (actual || []).map((row) => ({
  sourceKey: row.source_key,
  branchId: row.branch_id,
  employeeId: row.employee_id,
  businessDate: row.business_date,
  amount: Number(row.amount),
})).sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
const normalizedExpected = expected.slice().sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
assert.deepEqual(normalizedActual, normalizedExpected)
assert.equal(receiptCount, 187, 'Migration bổ sung KPI không được tạo thêm hóa đơn POS lịch sử.')

const byBranch = normalizedActual.reduce((output, row) => {
  output[row.branchId] = (output[row.branchId] || 0) + row.amount
  return output
}, {})
console.log(JSON.stringify({
  mode: 'READ_ONLY_POST_MIGRATION_VERIFY',
  rowCount: normalizedActual.length,
  adjustmentTotal: normalizedActual.reduce((sum, row) => sum + row.amount, 0),
  existingWebRevenueForRequestedRows: 11235000,
  combinedRequestedRevenue: normalizedActual.reduce((sum, row) => sum + row.amount, 11235000),
  receiptCountInWindow: receiptCount,
  byBranch,
}, null, 2))
console.log('KPI_REVENUE_ADJUSTMENTS_PRODUCTION_20260810_OK')

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
