import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const app = read('src/App.tsx')
const shell = read('src/components/AppShell.tsx')
const page = read('src/pages/PayrollPage.tsx')
const payroll = read('src/lib/payroll.ts')
const migration = read('supabase/migrations/20260910_admin_payslips.sql')

assert.match(shell, /label: 'Báo cáo'[\s\S]*label: 'Phiếu lương'/, 'Phiếu lương phải nằm ngay sau Báo cáo trong menu Admin.')
assert.match(shell, /id: 'manager-payroll'[\s\S]*canShow: \(user\) => canUseAdmin\(user\.role\)/, 'Menu Phiếu lương phải chỉ hiện cho Admin.')
assert.match(app, /page === 'manager-payroll'[\s\S]*user\.role === 'admin'/, 'Route Phiếu lương phải có chặn quyền Admin khi render.')
assert.match(app, /if \(page === 'manager-payroll'\) return canUseAdmin\(user\.role\)/, 'Bộ kiểm tra route phải chặn mọi vai trò ngoài Admin.')

for (const label of [
  'Lương cơ bản',
  'Phụ cấp trách nhiệm',
  'Phụ cấp chuyên cần',
  'Phụ cấp cơm và xăng xe',
  'Lương thỏa thuận',
  'Lương 1 ngày công',
  'Lương theo ngày công tính lương',
  'Số giờ làm thêm',
  'Thưởng KPI',
  'Lương thực lãnh',
]) assert.ok(page.includes(label), `Thiếu trường phiếu lương: ${label}`)

assert.match(page, /fetchEmployees[\s\S]*fetchAttendanceRecords[\s\S]*calculatePersonalKpiReward/, 'Phiếu lương phải tái sử dụng dữ liệu nhân viên, chấm công và KPI.')
assert.match(page, /Xem chi tiết/, 'Danh sách nhân viên phải có nút Xem chi tiết.')
const detailFooter = page.slice(page.indexOf('<footer>'), page.indexOf('</footer>'))
assert.match(detailFooter, /error &&[\s\S]*role="alert"/, 'Lỗi phải hiện trong footer dialog, không bị backdrop che.')
assert.match(detailFooter, /feedback &&[\s\S]*role="status"/, 'Kết quả lưu phải hiện trong footer dialog.')
assert.match(page, /branchId/, 'Danh sách phải hỗ trợ nhóm/lọc theo chi nhánh.')
assert.match(payroll, /from\('payroll_entries'\)/, 'Dữ liệu phiếu lương phải lưu bền vững trong payroll_entries.')
assert.match(payroll, /user\.role !== 'admin'/, 'Lớp dữ liệu phải chặn ghi/xem phiếu lương ngoài Admin.')
assert.match(migration, /role\) = 'admin'/, 'RLS phiếu lương phải giới hạn Admin.')

console.log('ADMIN_PAYSLIP_CONTRACT_OK')
