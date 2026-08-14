import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [admin, commission, styles] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/commission.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

assert.match(admin, /Xếp hạng doanh thu/)
// 07/08/2026: bỏ đoạn văn giải thích ở tiêu đề bảng. 13/08/2026: bỏ nốt dải thẻ
// tổng đầu màn. Ý "top doanh thu KHÔNG tự sinh thưởng" vẫn phải hiện ở hai chỗ
// đọc được nhanh hơn: dòng quy tắc của màn và dòng phụ của chính ô thưởng.
assert.match(admin, /Chỉ tính thưởng KPI theo từng ngày/,
  'Màn Thi đua phải giữ dòng quy tắc chi phối cột tiền.')
assert.match(admin, /Tổng thưởng KPI theo từng ngày đạt chỉ tiêu/,
  'Cột Thưởng KPI phải nói rõ tiền chỉ đến từ ngày đạt chỉ tiêu.')
assert.match(admin, /data-label="Thưởng KPI"/)
assert.match(admin, /formatMoney\(row\.commission\)/)
assert.match(admin, /Chưa đạt ngưỡng thưởng trong kỳ/)
assert.match(styles, /\.competition-classification-reward/)

// 14/08/2026 — số tiền thưởng do Admin đặt trong bảng Mức KPI, nên cái phải khoá
// là MỨC MẶC ĐỊNH và bậc so sánh, không còn là con số nằm cứng trong hàm.
for (const formula of [
  'pg_part_time: { at100: 20000, at110: 40000 }',
  'shift_deputy: { at100: 30000, at110: 30000 }',
  'shift_leader: { at100: 30000, at110: 30000 }',
  'if (progress >= 110) return bonus.at110',
  'if (progress >= 100) return bonus.at100',
]) assert.ok(commission.includes(formula), `Không được đổi công thức KPI: ${formula}`)

// Tiền KPI = thưởng ngày, không có thưởng tuần/tháng. `dailyBonus` bị ép về 0 cho
// ca trưởng kể từ 11/08/2026 (chưa có chỉ tiêu nên chưa chấm KPI).
assert.match(admin, /const kpiBonus = dailyBonus/)
assert.doesNotMatch(admin, /monthlyKpiBonus\(/)
assert.doesNotMatch(admin, /monthlySpecialBonus\(/)

console.log('KPI_RANKING_REWARD_CLARITY_OK')
