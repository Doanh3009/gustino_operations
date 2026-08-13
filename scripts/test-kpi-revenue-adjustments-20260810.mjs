import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const migrationPath = 'supabase/migrations/20260810_kpi_revenue_adjustments.sql'
assert.equal(existsSync(migrationPath), true, 'Thiếu migration lưu chứng từ bổ sung KPI riêng, không được giả lập hóa đơn POS.')

const migration = readFileSync(migrationPath, 'utf8')
const library = readFileSync('src/lib/kpiRevenueAdjustments.ts', 'utf8')
const admin = readFileSync('src/pages/AdminPage.tsx', 'utf8')

assert.match(migration, /create table if not exists public\.employee_kpi_revenue_adjustments/i)
assert.match(migration, /amount numeric\(14,2\) not null check \(amount > 0\)/i)
assert.match(migration, /source_key text not null unique/i)
assert.match(migration, /enable row level security/i)
assert.match(migration, /grant select on public\.employee_kpi_revenue_adjustments to authenticated/i)
assert.doesNotMatch(migration, /insert into public\.(sales_receipts|sales_receipt_items|stock_movements|bag_allocations)/i,
  'Bổ sung KPI lịch sử không được tạo hóa đơn, giao túi hoặc trừ kho giả.')
assert.equal((migration.match(/'owner-20260810-/g) || []).length, 27,
  'Phải chỉ ghi 27 khoản thực sự thiếu; 14 dòng đã tồn tại không được cộng lại.')
assert.match(migration, /EXPECTED_OWNER_SUPPLEMENT_TOTAL=19444000/)
assert.match(migration, /2026-07-09-minh-ly-delta[^\n]+33000/i,
  'Minh Lý 09/07 chỉ được bổ sung phần chênh 33.000đ từ 455.000đ lên 488.000đ.')

assert.match(library, /from\('employee_kpi_revenue_adjustments'\)/)
assert.match(library, /business_date/)
assert.match(library, /employeeId/)
assert.match(library, /amount/)

assert.match(admin, /fetchKpiRevenueAdjustments/)
assert.match(admin, /kpiRevenueAdjustments/)
assert.match(admin, /kpiAdjustmentReceipts/)
assert.match(admin, /Bổ sung KPI lịch sử/)
assert.match(admin, /\[\.\.\.salesReceipts, \.\.\.kpiAdjustmentReceipts\]/)

console.log('KPI_REVENUE_ADJUSTMENTS_20260810_OK')
