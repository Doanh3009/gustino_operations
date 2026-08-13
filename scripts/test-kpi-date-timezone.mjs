import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/commission.ts', import.meta.url), 'utf8')
const start = source.indexOf('export const DEFAULT_REVENUE_TARGET')
const end = source.indexOf('const PRODUCT_PRICES')

assert.ok(start >= 0 && end > start, 'Khong tim thay khoi cong thuc KPI thuan de chay fixture.')

const pureSource = source
  .slice(start, end)
  .replace(/\bexport\s+/g, '')
  .concat('\nexport { employeePeriodRevenueTarget, isFullCalendarMonth, dateRange, isWeekend };\n')
const compiled = ts.transpileModule(pureSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText

const previousTimezone = process.env.TZ
process.env.TZ = 'Asia/Bangkok'

try {
  const formula = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

  assert.deepEqual(
    formula.dateRange('2026-08-08', '2026-08-10'),
    ['2026-08-08', '2026-08-09', '2026-08-10'],
    'Khoang ngay KPI bi lui ngay khi chay o mui gio Viet Nam.',
  )
  assert.equal(formula.isWeekend('2026-08-08'), true, 'Thu Bay phai dung muc KPI cuoi tuan.')
  assert.equal(formula.isWeekend('2026-08-09'), true, 'Chu Nhat phai dung muc KPI cuoi tuan.')
  assert.equal(formula.isWeekend('2026-08-10'), false, 'Thu Hai phai dung muc KPI ngay thuong.')
  assert.equal(
    formula.isFullCalendarMonth('2026-08-01', '2026-08-31'),
    true,
    'Khoang tron thang phai nhan dung moc KPI thang co dinh.',
  )

  assert.equal(
    formula.employeePeriodRevenueTarget('gold-coast', 'staff', 'part_time', '', '2026-08-08', '2026-08-08'),
    650000,
    'PG part-time Gold Coast thu Bay phai co KPI 650.000d.',
  )
  assert.equal(
    formula.employeePeriodRevenueTarget('gold-coast', 'staff', 'part_time', '', '2026-08-10', '2026-08-10'),
    500000,
    'PG part-time Gold Coast thu Hai phai co KPI 500.000d.',
  )
  assert.equal(
    formula.employeePeriodRevenueTarget('gold-coast', 'staff', 'part_time', '', '2026-08-01', '2026-08-31'),
    13900000,
    'PG part-time Gold Coast tron thang phai dung moc 13.900.000d.',
  )
  assert.equal(
    formula.employeePeriodRevenueTarget('lotte-vt', 'staff', 'full_time', '', '2026-08-01', '2026-08-31'),
    33360000,
    'PG full-time Vung Tau thang 08 phai quay ve muc cu 33.360.000d.',
  )
  assert.equal(
    formula.employeePeriodRevenueTarget('lotte-2310', 'shift_leader', 'leader', 'Ca truong', '2026-08-01', '2026-08-31'),
    6780000,
    'Ca truong 23/10 tron thang phai dung moc 6.780.000d.',
  )
} finally {
  if (previousTimezone === undefined) delete process.env.TZ
  else process.env.TZ = previousTimezone
}

console.log('KPI_DATE_TIMEZONE_OK')
