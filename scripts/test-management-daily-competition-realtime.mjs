import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [admin, styles] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

assert.match(admin, /useState<'daily' \| 'monthly' \| 'leaders'>\('daily'\)/, 'Thiếu trạng thái phân loại bảng thi đua.')
assert.match(admin, /const \[competitionDate, setCompetitionDate\] = useState\(todayKey\)/, 'Thiếu ngày xem thi đua.')
assert.match(admin, /allocationReportDate\(item\) === competitionDate/, 'Thi đua ngày chưa lọc đúng ngày được chọn.')
assert.match(admin, /receipt\.businessDate === competitionDate/, 'Doanh thu thi đua ngày chưa lọc đúng ngày được chọn.')
assert.match(
  admin,
  /filterCompetitionAttendanceRecords\(records, registrations,[\s\S]{0,180}from: competitionDate,[\s\S]{0,80}to: competitionDate/,
  'Ca có check-in của thi đua ngày chưa lọc đúng ngày được chọn.',
)
assert.doesNotMatch(admin, /TOP 3 NHÂN VIÊN HÔM NAY/, 'Thi đua ngày vẫn là card Top 3 cố định.')
assert.doesNotMatch(admin, /<CompetitionMiniBoard/, 'Thi đua vẫn render bằng card riêng thay vì một bảng phân loại.')
assert.match(admin, /aria-label="Phân loại bảng thi đua"/, 'Thiếu điều khiển phân loại thi đua rõ nghĩa.')
assert.match(admin, /value="daily">Theo ngày</, 'Thiếu phân loại thi đua theo ngày.')
assert.match(admin, /value="monthly">Theo tháng</, 'Thiếu phân loại thi đua theo tháng.')
assert.match(admin, /value="leaders">Ca trưởng theo tháng</, 'Thiếu phân loại thi đua ca trưởng.')
assert.match(admin, /className=\{`competition-classification-table\$\{showReward \? ' with-reward' : ''\}`\}/, 'Thiếu bảng thi đua dùng chung cho các phân loại và biến thể cột thưởng.')
assert.match(admin, /window\.addEventListener\('focus', refreshWhenActive\)/, 'Trang quản lý chưa làm mới khi quay lại tab.')
assert.match(admin, /document\.addEventListener\('visibilitychange', refreshWhenVisible\)/, 'Trang quản lý chưa làm mới khi tab hiện lại.')
// 14/08/2026 — nhịp nền vẫn PHẢI có (realtime rớt thì đây là lưới an toàn duy
// nhất), nhưng hạ từ 30 giây xuống 2 phút: mỗi nhịp cũ đọc lại đủ 13 nguồn, có
// cả sổ kho toàn lịch sử ×3 chi nhánh — chính là phần "load hơi lâu". Chi tiết
// ở §64 CODEMAP.
assert.match(admin, /window\.setInterval\(refreshWhenActive, MANAGEMENT_POLL_INTERVAL_MS\)/, 'Trang quản lý thiếu nhịp kiểm tra dự phòng khi realtime gián đoạn.')
assert.match(admin, /MANAGEMENT_POLL_INTERVAL_MS = 120000/, 'Nhịp nền của trang quản lý phải là 2 phút.')
assert.match(styles, /\.competition-classification-table/, 'Thiếu CSS bảng phân loại thi đua.')
assert.match(styles, /\.competition-ranking-controls/, 'Thiếu CSS bộ lọc thi đua responsive.')

console.log('MANAGEMENT_DAILY_COMPETITION_REALTIME_OK')
