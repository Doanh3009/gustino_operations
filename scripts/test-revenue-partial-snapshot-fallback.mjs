import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/lib/revenue.ts', import.meta.url), 'utf8')
assert.match(source, /\.filter\(\(row\) => row\.hasRevenueSummary\)/)
assert.match(source, /hasRevenueSummary:\s*typeof snap\.payload\.summary\?\.revenue === 'number'/)
assert.match(source, /liveReceiptRowsAfterSnapshots/)
assert.match(source, /reconciledSnapshotRows = snapshotRows\.map/)
assert.match(source, /displayedSnapshotRows = reconciledSnapshotRows\.filter/)
assert.match(source, /row\.hasRevenueSummary \|\| !receiptRowKeys\.has/)
assert.match(source, /return \[\.\.\.displayedSnapshotRows, \.\.\.receiptRows/)
assert.doesNotMatch(source, /return \[\.\.\.snapshotRows, \.\.\.receiptRows/)

console.log('REVENUE_PARTIAL_SNAPSHOT_FALLBACK_OK')
