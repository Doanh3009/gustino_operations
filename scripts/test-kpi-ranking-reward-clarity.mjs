import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [admin, commission, styles] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/commission.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

assert.match(admin, /Xếp hạng doanh thu/)
// 07/08/2026: bỏ đoạn văn giải thích ở tiêu đề bảng. Ý "top doanh thu KHÔNG
// tự sinh thưởng" vẫn phải hiện ở chỗ đọc được nhanh hơn: thẻ tổng Thưởng KPI
// và dòng phụ của chính ô thưởng từng người.
assert.match(admin, /Chỉ phát sinh khi đạt ngưỡng KPI ngày\/tuần/)
assert.match(admin, /data-label="Thưởng KPI"/)
assert.match(admin, /formatMoney\(row\.commission\)/)
assert.match(admin, /Chưa đạt ngưỡng ngày\/tuần/)
assert.match(styles, /\.competition-classification-reward/)

for (const formula of [
  "if (position === 'shift_leader') return progress >= 100 ? 30000 : 0",
  'if (progress >= 110) return 40000',
  'if (progress >= 100) return 20000',
  'if (perfectWeekDays >= 6) return 200000',
  'if (achievedDays >= 5) return 100000',
]) assert.ok(commission.includes(formula), `Không được đổi công thức KPI: ${formula}`)

console.log('KPI_RANKING_REWARD_CLARITY_OK')
