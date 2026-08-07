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
// 07/08/2026: API n8n theo LUẬT ƯU TIÊN MỚI — POS là nguồn chân lý, snapshot chỉ
// dùng cho ngày KHÔNG có hóa đơn. Phải khớp từng chữ với `src/lib/revenue.ts`
// (logic chép tay hai nơi) nếu không app và Zalo sẽ ra hai con số khác nhau.
assert.match(api, /meaningfulSnapshotKeys/)
assert.match(api, /receiptKeys/)
assert.match(api, /allocationKeys/)
assert.match(api, /return \[\.\.\.receiptRows, \.\.\.displayedSnapshots/,
  'API n8n phải xếp POS trước snapshot, giống buildDailyRevenueRows của app.')

console.log('N8N_REVENUE_API_BUILD_OK')
