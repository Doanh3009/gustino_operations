import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const calls = []
let response = { data: 1, error: null }
globalThis.__messageClient = { rpc: async (...args) => { calls.push(args); return response } }
const source = readFileSync('src/lib/messages.ts', 'utf8').replace(/^import .*$/gm, '')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const adapter = await import('data:text/javascript;base64,' + Buffer.from('const supabase = globalThis.__messageClient; const shouldUseLanApi = user => !!user.authToken;\n' + code).toString('base64'))
const admin = { id: 'a1', role: 'admin' }
const employee = { id: 'e1', role: 'staff' }
const adminContact = { id: 'a1', role: 'admin' }
const employeeContact = { id: 'e2', role: 'staff' }
for (const role of ['staff', 'shift_leader', 'cashier', 'manager', 'supmt', 'kitchen']) {
  await assert.rejects(adapter.sendEmployeeMessage({ id: 'e1', role }, employeeContact, 'hello'), /Admin/)
  await assert.rejects(adapter.sendEmployeeMessage({ id: 'e1', role }, null, 'hello'), /Admin/)
}
await assert.rejects(adapter.sendEmployeeMessage(admin, adminContact, 'hello'), /Admin/)
await assert.rejects(adapter.sendEmployeeMessage(employee, adminContact, '   '), /2000/)
await assert.rejects(adapter.sendEmployeeMessage(employee, adminContact, 'x'.repeat(2001)), /2000/)
assert.equal(calls.length, 0)
assert.equal(await adapter.sendEmployeeMessage(employee, adminContact, ' hello '), 1)
assert.deepEqual(calls.at(-1), ['send_employee_message', { p_recipient_id: 'a1', p_body: 'hello' }])
await adapter.sendEmployeeMessage(admin, employeeContact, 'reply')
await adapter.sendEmployeeMessage(admin, null, 'broadcast')
assert.equal(calls.at(-1)[1].p_recipient_id, null)
await assert.rejects(adapter.fetchMessageContacts({ ...employee, authToken: 'lan' }), /LAN/)
response = { data: null, error: { code: 'PGRST202' } }
await assert.rejects(adapter.fetchMessageContacts(employee), /SQL/)
response = { data: null, error: { message: 'denied' } }
await assert.rejects(adapter.sendEmployeeMessage(employee, adminContact, 'test'), /denied/)
console.log('MESSAGING_ADAPTER_OK')
delete globalThis.__messageClient
