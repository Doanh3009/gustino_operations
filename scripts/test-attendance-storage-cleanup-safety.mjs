import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('scripts/cleanup-attendance-selfies-month.mjs', 'utf8')

assert.match(source, /const BUCKET = 'attendance-selfies'/, 'Cleanup must remain scoped to the attendance selfie bucket.')
assert.match(source, /const EXECUTE = process\.argv\.includes\('--execute'\)/, 'Cleanup must default to dry-run.')
assert.match(source, /Date\.UTC\([\s\S]+- 7 \* 60 \* 60 \* 1000/, 'Month boundaries must use Vietnam UTC+7.')
assert.match(source, /for \(const protectedPath of protectedReferencedPaths\) candidates\.delete\(protectedPath\)/, 'Non-target attendance references must be excluded from deletion.')
assert.match(source, /protectedRemoved = \[\.\.\.protectedExistingBefore\]\.filter/, 'Cleanup must compare protected objects before and after deletion.')
assert.match(source, /if \(survivors\.length \|\| protectedRemoved\.length\)/, 'Cleanup must fail verification if a protected object is removed.')
assert.doesNotMatch(source, /\.from\(['"]attendance_records['"]\)\.delete|DELETE[^\n]+attendance_records/i, 'Cleanup must never delete attendance rows.')
assert.doesNotMatch(source, /selfie_url\s*:\s*null|check_out_selfie_url\s*:\s*null/, 'Cleanup must not clear attendance evidence references.')

console.log('ATTENDANCE_STORAGE_CLEANUP_SAFETY_OK')
