import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const source = readFileSync('src/lib/payroll.ts', 'utf8').replace(/^import .*$/gm, '')
const calls = []
let response = { data: { id: 'p1', employee_id: 'e1', period: '2026-09', net_salary: 500 }, error: null }
const query = {}
for (const method of ['from', 'update', 'delete', 'upsert', 'eq', 'select']) query[method] = (...args) => { calls.push([method, ...args]); return query }
query.single = async () => response
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const fixture = `const supabase = globalThis.__payrollQuery; const shouldUseLanApi = user => !!user.authToken;\n`
globalThis.__payrollQuery = query
const payroll = await import('data:text/javascript;base64,' + Buffer.from(fixture + compiled).toString('base64'))
const admin = { id: 'a1', role: 'admin' }
for (const role of ['staff', 'shift_leader', 'cashier', 'manager', 'supmt', 'kitchen']) {
  const before = calls.length
  await assert.rejects(payroll.revokePayrollEntry({ role }, 'p1'), /Admin/)
  await assert.rejects(payroll.deletePayrollEntry({ role }, 'p1'), /Admin/)
  assert.equal(calls.length, before)
}
await assert.rejects(payroll.deletePayrollEntry(admin, ''), /chưa được lưu/)
await assert.rejects(payroll.revokePayrollEntry({ ...admin, authToken: 'lan' }, 'p1'), /LAN/)
const revoked = await payroll.revokePayrollEntry(admin, 'p1')
assert.equal(revoked.netSalary, 500)
assert.equal(revoked.publishedAt, undefined)
const payload = calls.find(([method]) => method === 'update')[1]
assert.equal(payload.published_at, null)
assert.equal(payload.published_by, null)
assert.equal(payload.employee_viewed_at, null)
assert.ok(!Object.hasOwn(payload, 'net_salary'))
assert.ok(calls.some(([method, key, value]) => method === 'eq' && key === 'id' && value === 'p1'))
calls.length = 0
await payroll.deletePayrollEntry(admin, 'p1')
assert.deepEqual(calls.filter(([method]) => method === 'from' || method === 'eq'), [['from', 'payroll_entries'], ['eq', 'id', 'p1']])
response = { data: null, error: new Error('denied') }
await assert.rejects(payroll.revokePayrollEntry(admin, 'p1'), /denied/)
await assert.rejects(payroll.deletePayrollEntry(admin, 'p1'), /denied/)
response = { data: { id: 'saved', published_at: '2026-09-12', employee_id: 'e1', period: '2026-09' }, error: null }
const saved = await payroll.upsertPayrollEntry(admin, { employeeId: 'e1', period: '2026-09' })
assert.equal(saved.id, 'saved')
assert.equal(saved.publishedAt, '2026-09-12')
const page = readFileSync('src/pages/PayrollPage.tsx', 'utf8')
assert.ok(page.includes('window.confirm(message)'))
assert.ok(page.includes('Thu hồi phiếu lương'))
assert.ok(page.includes('Xóa phiếu lương'))
console.log('PAYSLIP_REVOKE_DELETE_OK')
let rpcCalls = 0
query.rpc = async (name, args) => {
  rpcCalls++
  assert.equal(name, 'confirm_own_payslip')
  assert.deepEqual(args, { p_entry_id: 'p1', p_published_at: '2026-09-12' })
  return response
}
const employee = { id: 'e1', role: 'staff' }
const ownEntry = { id: 'p1', employeeId: 'e1', publishedAt: '2026-09-12' }
await assert.rejects(payroll.confirmOwnPayslip(admin, ownEntry), /chính mình/)
await assert.rejects(payroll.confirmOwnPayslip(employee, { ...ownEntry, employeeId: 'e2' }), /chính mình/)
await assert.rejects(payroll.confirmOwnPayslip(employee, { ...ownEntry, publishedAt: undefined }), /thu hồi/)
assert.equal(rpcCalls, 0)
response = { data: '2026-09-12T12:00:00Z', error: null }
assert.equal(await payroll.confirmOwnPayslip(employee, ownEntry), response.data)
response = { data: null, error: { code: 'PGRST202' } }
await assert.rejects(payroll.confirmOwnPayslip(employee, ownEntry), /migration/)
response = { data: null, error: new Error('revoked') }
await assert.rejects(payroll.confirmOwnPayslip(employee, ownEntry), /revoked/)
console.log('PAYSLIP_CONFIRMATION_ADAPTER_OK')
const events = []
globalThis.window = { dispatchEvent: event => events.push(event) }
globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options?.detail } }
query.rpc = async (name, args) => {
  assert.equal(name, 'mark_own_payslip_viewed')
  assert.deepEqual(args, { p_entry_id: 'p1' })
  return response
}
response = { data: null, error: { code: 'PGRST202' } }
await assert.rejects(payroll.markOwnPayslipViewed(employee, 'p1'), /SQL/)
assert.equal(events.length, 0)
response = { data: null, error: null }
await payroll.markOwnPayslipViewed(employee, 'p1')
assert.equal(events.length, 1)
assert.equal(events[0].detail.entryId, 'p1')
assert.ok(events[0].detail.viewedAt)
delete globalThis.window
delete globalThis.CustomEvent
console.log('PAYSLIP_VIEWED_ACKNOWLEDGEMENT_OK')
delete globalThis.__payrollQuery

