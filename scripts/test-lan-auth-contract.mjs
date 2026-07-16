import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const server = readFileSync(new URL('./lan-server.mjs', import.meta.url), 'utf8')
const client = readFileSync(new URL('../src/lib/core.ts', import.meta.url), 'utf8')

function between(text, start, end) {
  const startIndex = text.indexOf(start)
  const endIndex = text.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `Không tìm thấy ${start}`)
  assert.notEqual(endIndex, -1, `Không tìm thấy ${end}`)
  return text.slice(startIndex, endIndex)
}

const actorBody = between(server, 'function actor(request)', 'function canAccessBranch')
const loginBody = between(server, "if (url.pathname === '/api/attendance/login'", 'const user = actor(request)')
const branchPutBody = between(server, "if (url.pathname === '/api/branches' && request.method === 'PUT')", "if (url.pathname === '/api/commission-rules'")

assert.match(loginBody, /sessions\.set\(authToken/, 'LAN login không lưu server-issued session token')
assert.match(client, /Authorization:\s*`Bearer \$\{user\.authToken\}`/, 'Client không gửi server-issued Bearer token')
assert.doesNotMatch(actorBody, /x-user-(id|role|branch|branches)/i, 'Invalid/missing token vẫn lấy identity/role từ spoofable X-User headers')
assert.match(branchPutBody, /user\.authenticated/, 'Privileged branch update không bắt buộc authenticated actor')

console.log('LAN_AUTH_CONTRACT_OK')
