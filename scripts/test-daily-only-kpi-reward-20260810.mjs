import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const admin = await readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8')
const start = admin.indexOf('function buildCommissionRows(')
const end = admin.indexOf('\nfunction normalizeName', start)
assert.ok(start >= 0 && end > start, 'Không tìm thấy bộ tính thưởng KPI.')
const builder = admin.slice(start, end)

// `dailyBonus` = row.dailyBonus, nhưng ép về 0 cho ca trưởng (chưa chấm KPI từ 11/08/2026).
assert.ok(builder.includes('const kpiBonus = dailyBonus'), 'Tổng tiền KPI chưa giới hạn ở thưởng ngày.')
assert.ok(!builder.includes('weekWins'), 'Bộ tính vẫn cộng thưởng tuần.')
assert.ok(!builder.includes('monthlyKpiBonus('), 'Bộ tính vẫn cộng thưởng tháng.')
assert.ok(!builder.includes('monthlySpecialBonus({'), 'Bộ tính vẫn cộng giải đặc biệt tháng.')
assert.ok(!builder.includes('monthlyRewardPeriod'), 'Bộ tính vẫn kích hoạt kỳ thưởng tháng.')
assert.ok(builder.includes("dailyBonus > 0 ? `Thưởng ngày"), 'Chi tiết tiền KPI chưa ghi rõ thưởng ngày.')
assert.ok(admin.includes('Chỉ tính thưởng KPI theo từng ngày'), 'Giao diện chưa giải thích quy tắc mới.')

const commissionExportStart = admin.indexOf("const commissionSheet = workbook.addWorksheet('KPI doanh thu')")
const commissionExportEnd = admin.indexOf("const kpiByNameSheet = workbook.addWorksheet", commissionExportStart)
const commissionExport = admin.slice(commissionExportStart, commissionExportEnd)
assert.ok(!commissionExport.includes("header: 'Thưởng tuần'"), 'Excel vẫn xuất cột thưởng tuần.')
assert.ok(!commissionExport.includes("header: 'Thưởng tháng'"), 'Excel vẫn xuất cột thưởng tháng.')
assert.ok(!commissionExport.includes("header: 'Thưởng đặc biệt"), 'Excel vẫn xuất cột thưởng đặc biệt tháng.')
assert.ok(!commissionExport.includes("header: 'Thưởng chờ Admin"), 'Excel vẫn xuất khoản chờ xác nhận theo tháng.')

console.log('DAILY_ONLY_KPI_REWARD_20260810_OK')
