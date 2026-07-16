import { readFile } from 'node:fs/promises'

const [admin, report, commission] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/commission.ts', import.meta.url), 'utf8'),
])

const failures = []
if (admin.includes('<EmployeeRevenueChart rows=')) failures.push('Biểu đồ nhân viên trùng ý nghĩa vẫn còn render.')
for (const token of ['monthlyCompetitionRows', 'dailyCompetitionRows', 'leaderCompetitionRows']) {
  if (!admin.includes(token)) failures.push(`Thiếu dữ liệu ${token}.`)
}
if (!admin.includes('TOP 10 NHÂN VIÊN THEO THÁNG')) failures.push('Thiếu nhãn top 10 nhân viên theo tháng.')
// Yêu cầu 2026-07-16 thay thế hai mini-card bằng một bảng có bộ phân loại.
if (!admin.includes('aria-label="Phân loại bảng thi đua"')) failures.push('Thiếu bộ phân loại bảng thi đua dùng chung.')
if (!admin.includes('<option value="daily">Theo ngày</option>')) failures.push('Thiếu phân loại nhân viên theo ngày.')
if (!admin.includes('<option value="monthly">Theo tháng</option>')) failures.push('Thiếu phân loại nhân viên theo tháng.')
if (!admin.includes('<option value="leaders">Ca trưởng theo tháng</option>')) failures.push('Thiếu phân loại doanh thu ca trưởng theo tháng.')
if (!admin.includes('.filter((row) => row.revenue > 0)')) failures.push('Ranking vẫn có thể giữ người chỉ đăng ký giờ nhưng không bán.')
if (!report.includes('POS fallback: đã bán không bao giờ được hiển thị với số nhận bằng 0')) failures.push('Chưa sửa trường hợp 7/0 sản phẩm khi thiếu allocation đồng bộ.')

const expectedFormulaSnippets = [
  "'gold-coast', position: 'pg_part_time', weekdayTarget: 500000, weekendTarget: 650000, monthlyTarget: 13900000",
  "'gold-coast', position: 'pg_full_time', weekdayTarget: 1000000, weekendTarget: 1300000, monthlyTarget: 27800000",
  "'gold-coast', position: 'shift_leader', weekdayTarget: 300000, weekendTarget: 390000, monthlyTarget: 8340000",
  "'lotte-vt', position: 'pg_part_time', weekdayTarget: 600000, weekendTarget: 780000, monthlyTarget: 16680000",
  "'lotte-2310', position: 'pg_part_time', weekdayTarget: 400000, weekendTarget: 550000, monthlyTarget: 11300000",
]
for (const snippet of expectedFormulaSnippets) {
  if (!commission.includes(snippet)) failures.push(`Công thức KPI không khớp mốc đã lưu: ${snippet}`)
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}
console.log('BUSINESS_COMPETITION_KPI_OK')
