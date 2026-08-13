import fs from 'node:fs'

const admin = fs.readFileSync('src/pages/AdminPage.tsx', 'utf8')
const page = fs.readFileSync('src/pages/admin/BranchesPage.tsx', 'utf8')
const styles = fs.readFileSync('src/styles.css', 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(admin.includes('async function removeBranchFromOperations'), 'Thiếu xử lý xóa chi nhánh an toàn.')
assert(admin.includes("user.role !== 'admin'"), 'Xóa chi nhánh chưa giới hạn Admin.')
assert(admin.includes('active: branch.id === branchToRemove.id ? false'), 'Xóa chi nhánh đang không dùng trạng thái ngưng hoạt động.')
assert(admin.includes('Dữ liệu lịch sử vẫn được giữ nguyên'), 'Thông báo chưa xác nhận bảo toàn dữ liệu lịch sử.')
assert(admin.includes('await syncConfiguredBranchRows(user, next)'), 'Trạng thái chi nhánh chưa đồng bộ cloud.')
// 13/08/2026: Quản lý nhận việc vận hành nên cũng xóa được chi nhánh ngưng hoạt
// động; nút vẫn phải giới hạn theo VAI TRÒ, không hiện cho mọi người.
assert(admin.includes('onDeleteBranch={canOperateConsole(user.role)'), 'Danh sách chưa giới hạn nút xóa theo vai trò.')
assert(!admin.includes('hardDeleteConfiguredBranch('), 'Admin CRM không được gọi xóa vĩnh viễn dây chuyền.')
assert(page.includes("deletingId === branch.id ? 'Đang xóa…' : 'Xóa'"), 'Thiếu trạng thái nút xóa chi nhánh.')
assert(page.includes('event.stopPropagation()'), 'Nút xóa có thể vô tình mở trang chi tiết.')
assert(styles.includes('.admin-branch-row-actions') && styles.includes('.admin-row-action.danger'), 'Thiếu style thao tác xóa chi nhánh.')

console.log('ADMIN_BRANCH_SAFE_REMOVE_OK')
