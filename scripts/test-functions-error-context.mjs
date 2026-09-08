import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/functionsError.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
const { functionsErrorMessage, functionsErrorStatus } = await import(moduleUrl)

const networkError = {
  message: 'Failed to send a request to the Edge Function',
  context: new TypeError('Failed to fetch'),
}
assert.equal(functionsErrorStatus(networkError), undefined)
assert.equal(await functionsErrorMessage(networkError, 'fallback'), 'Failed to fetch')

const responseError = {
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(JSON.stringify({ error: 'Admin session expired' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  }),
}
assert.equal(functionsErrorStatus(responseError), 401)
assert.equal(await functionsErrorMessage(responseError, 'fallback'), 'Admin session expired')

const responseWithoutClone = {
  message: 'Relay failed',
  context: { status: 502, json: async () => ({ message: 'Gateway unavailable' }) },
}
assert.equal(functionsErrorStatus(responseWithoutClone), 502)
assert.equal(await functionsErrorMessage(responseWithoutClone, 'fallback'), 'Gateway unavailable')

assert.equal(await functionsErrorMessage({}, 'fallback'), 'fallback')

const adminSource = await readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8')
for (const handler of ['saveEmployeeCrm', 'saveEmployeeDetails']) {
  const start = adminSource.indexOf(`async function ${handler}`)
  const body = adminSource.slice(start, start + 500)
  assert(start >= 0 && body.includes("setError('')") && body.includes("setFeedback('')"), `${handler} must clear stale banners before saving.`)
}
console.log('FUNCTIONS_ERROR_CONTEXT_OK')
