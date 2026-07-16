import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [
  login,
  attendance,
  sales,
  orders,
  kitchen,
  inventory,
  admin,
  control,
] = await Promise.all([
  readFile(new URL('../src/pages/LoginPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/SalesPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/OrdersPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/KitchenPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/InventoryPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ControlCenterPage.tsx', import.meta.url), 'utf8'),
])

const failures = []
const requireMatch = (source, pattern, message) => {
  if (!pattern.test(source)) failures.push(message)
}

requireMatch(login, /!profile \|\| profile\.active === false/, 'Đăng nhập cloud chưa chặn profile inactive.')
requireMatch(login, /branch\.active === false/, 'Đăng nhập nhân viên chưa chặn chi nhánh inactive.')
requireMatch(login, /finally\s*\{\s*setLoading\(false\)/, 'Nút đăng nhập có thể bị kẹt loading sau lỗi.')

requireMatch(sales, /receipt\.createdBy === user\.id \|\| receipt\.sellerId === user\.id/, 'Nhân viên chưa bị giới hạn xóa hóa đơn của chính mình.')
requireMatch(sales, /isOwn && receipt\.businessDate === today/, 'Nhân viên chưa bị giới hạn xóa hóa đơn trong ngày hiện tại.')
requireMatch(sales, /window\.confirm\(`Xóa hóa đơn/, 'Xóa hóa đơn thiếu bước xác nhận.')

requireMatch(orders, /Number\.isFinite\(line\.quantity\) && line\.quantity > 0/, 'Nút gửi đặt hàng chưa loại số lượng không hợp lệ.')
requireMatch(orders, /window\.confirm\(`Hủy đơn/, 'Hủy đơn đặt hàng thiếu bước xác nhận.')
requireMatch(orders, /window\.confirm\(`Xóa vĩnh viễn đơn/, 'Xóa đơn đặt hàng thiếu bước xác nhận vĩnh viễn.')
requireMatch(orders, /request\.status === 'pending' \|\| request\.status === 'acknowledged'/, 'UI đang cho hủy đơn ngoài hai trạng thái đang xử lý.')

requireMatch(kitchen, /onNext=\{\(request\) => void changeStatus\(request, 'acknowledged'\)\}/, 'Nút bếp nhận đơn không chuyển pending → acknowledged.')
requireMatch(kitchen, /onNext=\{\(request\) => void changeStatus\(request, 'fulfilled'\)\}/, 'Nút bếp hoàn thành không chuyển acknowledged → fulfilled.')

requireMatch(inventory, /Tồn kho chưa đủ cho phiếu xuất:[\s\S]*window\.confirm|window\.confirm\(`Tồn kho chưa đủ cho phiếu xuất:/, 'Phiếu xuất vượt tồn không cảnh báo/xác nhận.')
requireMatch(inventory, /window\.confirm\(`Xóa \$\{label\}\? Toàn bộ các dòng/, 'Xóa chứng từ kho thiếu bước xác nhận.')

requireMatch(admin, /if \(pendingDeleteId !== employee\.id\)[\s\S]*Bấm “Xác nhận xóa” lần nữa/, 'Xóa tài khoản chưa có xác nhận hai bước.')
requireMatch(admin, /employee\.id === user\.id/, 'UI chưa khóa thao tác xóa tài khoản đang đăng nhập.')
requireMatch(admin, /upsertPayrollEntry\(user,[\s\S]{0,900}\.catch\(\(error\) =>[\s\S]{0,220}setError\(/, 'Lỗi tự lưu lương nhân viên đang bị nuốt, UI có thể báo dữ liệu chưa lưu như đã lưu.')
requireMatch(admin, /upsertRoleSalaryDefault\(user,[\s\S]{0,500}\.catch\(\(error\) =>[\s\S]{0,220}setError\(/, 'Lỗi tự lưu lương mặc định đang bị nuốt, UI có thể báo dữ liệu chưa lưu như đã lưu.')

const branchDeleteConfirmations = (control.match(/window\.confirm/g) || []).length
if (branchDeleteConfirmations < 6) failures.push('Các thao tác xóa quan trọng trong Control Center thiếu lớp xác nhận.')
requireMatch(control, /from >= todayKey \|\| to >= todayKey/, 'Dọn dữ liệu chưa chặn ngày hiện tại.')
requireMatch(control, /function updateLowStock[\s\S]*?syncConfiguredProducts\(user, next\)\.catch\(\(error\) =>[\s\S]{0,240}setMasterFeedback\(/, 'Lỗi đồng bộ ngưỡng tồn thấp đang bị nuốt, thiết bị khác có thể không nhận thay đổi.')

// Nếu RPC cấu hình chi nhánh không có và fallback upsert cũng lỗi, phải ném lỗi
// fallback thực tế để nút Thêm chi nhánh hiển thị đúng nguyên nhân.
requireMatch(attendance, /if \(directError\) throw directError/, 'Fallback đồng bộ chi nhánh đang che mất lỗi upsert Supabase thực tế.')

assert.deepEqual(failures, [], failures.join('\n'))
console.log('CORE_BUSINESS_BUTTON_GUARDS_OK')
