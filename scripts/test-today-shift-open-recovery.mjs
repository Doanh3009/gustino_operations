import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const today = await readFile(new URL('../src/pages/TodayPage.tsx', import.meta.url), 'utf8')

assert.match(today, /reconcileOperationalShift, type ShiftAutoOpenResult/)
assert.match(today, /async function syncOperationalShift\(showFeedback = false\)/)
assert.match(today, /const result = await reconcileOperationalShift\(user\)/)
assert.match(today, /const nextSessions = await fetchBagShiftSessions/)
assert.match(today, /void syncOperationalShift\(false\)/)
assert.match(today, /Thử mở ca lại/)
assert.match(today, /result\.reason === 'not-checked-in'/)
assert.match(today, /result\.reason === 'not-scheduled'/)
assert.match(today, /result\.reason === 'deputy-not-owner'/)

console.log('TODAY_SHIFT_OPEN_RECOVERY_OK')
