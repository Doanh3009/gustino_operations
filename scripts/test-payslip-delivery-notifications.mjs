import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const admin = read('src/pages/PayrollPage.tsx')
const employee = read('src/pages/MyPayslipsPage.tsx')
const shell = read('src/components/AppShell.tsx')
const app = read('src/App.tsx')
const payroll = read('src/lib/payroll.ts')
const migration = read('supabase/migrations/20260910_admin_payslips.sql')
const styles = read('src/styles.css')

for (const marker of ['Đã chọn', 'Bỏ chọn', 'Chọn tất cả trên DS', 'Gửi phiếu lương']) {
  assert.ok(admin.includes(marker), `Thiếu thao tác chọn/gửi: ${marker}`)
}
assert.match(admin, /type="checkbox"/, 'Danh sách Admin phải có checkbox chọn nhân viên.')
assert.match(admin, /selectedIds/, 'Admin phải theo dõi đúng tập nhân viên đã chọn.')
assert.match(admin, /publishPayrollEntries/, 'Nút gửi phải phát hành phiếu lương bền vững.')
assert.match(shell, /payslip-notification/, 'Nhân viên phải có thông báo phiếu lương trong AppShell.')
assert.match(shell, /fetchOwnPublishedPayslips/, 'Thông báo phải đọc phiếu đã gửi của chính tài khoản.')
assert.match(app, /page === 'my-payslips'/, 'Phải có route để nhân viên mở phiếu lương của mình.')
assert.ok(employee.includes('Phiếu lương của tôi'), 'Thiếu trang phiếu lương nhân viên.')
assert.match(employee, /markOwnPayslipViewed/, 'Mở phiếu phải ghi nhận đã xem qua API an toàn.')
assert.match(payroll, /employeeId.*user\.id|user\.id.*employeeId/s, 'Lớp dữ liệu phải khóa phiếu nhân viên theo tài khoản hiện tại.')
assert.match(migration, /employee reads own published payslips/, 'RLS phải chỉ cho nhân viên đọc phiếu đã phát hành của chính họ.')
assert.match(migration, /mark_own_payslip_viewed/, 'Phải dùng RPC riêng để đánh dấu đã xem, không cấp quyền sửa phiếu cho nhân viên.')
assert.match(styles, /payslip-row-check[\s\S]{0,260}min-height:\s*18px\s*!important[\s\S]{0,160}padding:\s*0\s*!important/, 'Checkbox phiếu lương phải thoát style input 50px/padding gây viền chữ nhật dọc.')

console.log('PAYSLIP_DELIVERY_NOTIFICATIONS_OK')
