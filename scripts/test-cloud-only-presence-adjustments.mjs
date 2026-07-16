import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [activeUsers, attendanceAdjustments, migration] = await Promise.all([
  readFile('src/lib/activeUsers.ts', 'utf8'),
  readFile('src/lib/attendanceAdjustments.ts', 'utf8'),
  readFile('supabase/migrations/20260709_attendance_documents_active_sessions.sql', 'utf8'),
])

for (const [name, source] of [
  ['activeUsers', activeUsers],
  ['attendanceAdjustments', attendanceAdjustments],
]) {
  assert.ok(!source.includes('localStorage'), `${name} must not persist cloud synchronization data in localStorage`)
  assert.ok(!source.includes('readLocalJson'), `${name} must not read a device-local fallback`)
  assert.ok(!source.includes('isMissingTable'), `${name} must not silently accept a missing production table`)
}

assert.match(activeUsers, /from\('active_user_sessions'\)\.upsert\(/)
assert.match(activeUsers, /if \(error\) throw error/)
assert.match(attendanceAdjustments, /from\('attendance_adjustment_requests'\)\.insert\(/)
assert.match(attendanceAdjustments, /if \(error\) throw error/)
assert.match(migration, /create table if not exists public\.active_user_sessions/)
assert.match(migration, /create table if not exists public\.attendance_adjustment_requests/)
assert.match(migration, /alter table public\.active_user_sessions enable row level security/)
assert.match(migration, /alter table public\.attendance_adjustment_requests enable row level security/)

console.log('CLOUD_ONLY_PRESENCE_ADJUSTMENTS_OK')
