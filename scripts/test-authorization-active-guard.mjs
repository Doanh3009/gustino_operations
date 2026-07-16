import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
const branchCore = readFileSync(new URL('../supabase/migrations/20260701_branch_core_repair.sql', import.meta.url), 'utf8')
const deactivation = readFileSync(new URL('../supabase/migrations/20260702_branch_deactivate_accounts.sql', import.meta.url), 'utf8')

function functionBody(sql, functionName) {
  const marker = `function public.${functionName}`
  const start = sql.toLowerCase().indexOf(marker.toLowerCase())
  assert.notEqual(start, -1, `Không tìm thấy ${functionName}`)
  const bodyStart = sql.indexOf('as $$', start)
  const bodyEnd = sql.indexOf('$$;', bodyStart + 5)
  assert.notEqual(bodyStart, -1, `Không tìm thấy body ${functionName}`)
  assert.notEqual(bodyEnd, -1, `Không tìm thấy cuối body ${functionName}`)
  return sql.slice(bodyStart + 5, bodyEnd).toLowerCase()
}

assert.match(
  deactivation,
  /old sessions and old schedule data cannot keep operating/i,
  'Migration không còn tuyên bố contract khóa old session',
)

const currentProfileBody = functionBody(schema, 'current_profile')
const canManageBranchBody = functionBody(branchCore, 'can_manage_branch')
const activeGuard = /active\s*=\s*true|active\s+is\s+true/

assert.ok(
  activeGuard.test(currentProfileBody) || activeGuard.test(canManageBranchBody),
  'Authorization helper không loại profile active=false; old authenticated session vẫn có thể thỏa RLS theo role/branch',
)

console.log('AUTH_ACTIVE_GUARD_OK')
