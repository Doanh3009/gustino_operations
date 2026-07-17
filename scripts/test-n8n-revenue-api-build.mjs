import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const api = await readFile(new URL('../api/n8n/revenue.ts', import.meta.url), 'utf8')
assert.doesNotMatch(api, /from ['"]\.\.\/\.\.\/src\//, 'Vercel API không được nhập module frontend/import.meta.env.')
assert.match(api, /declare const process:/)
assert.match(api, /function buildDailyRevenueRows\(/)
assert.match(api, /fetchProductPrices/)
assert.doesNotMatch(api, /select\('id, branch_id, business_date, product_id/, 'bag_allocations không có cột business_date riêng; phải dùng ngày từ session join.')
assert.match(api, /requireEnv\('SUPABASE_SERVICE_ROLE_KEY'\)/)
assert.match(api, /apiKey !== expected/)
assert.match(api, /snapshotKeys/)
assert.match(api, /receiptKeys/)
assert.match(api, /allocationKeys/)

console.log('N8N_REVENUE_API_BUILD_OK')
