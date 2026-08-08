// Phân quyền SUP MT (Supervisor Market Trade) — vai trò GIÁM SÁT chỉ đọc.
//
// Bối cảnh: role `supmt` có trong `src/types.ts` từ 2026-08-04 nhưng enum `app_role`
// của Postgres KHÔNG có giá trị này ⇒ không tạo nổi tài khoản SUP MT thật, và mọi
// policy RLS đọc dữ liệu đều chỉ liệt kê admin/manager/shift_leader ⇒ nếu có tài khoản
// thì cũng thấy trắng bảng. Bản 2026-08-08 mở đủ quyền XEM toàn hệ thống + đúng một
// quyền ghi: chấm công của chính họ.
//
// Test này khoá 4 điều:
//   1. `access.ts` phân biệt đúng "được vào trang Quản trị" với "được ghi dữ liệu".
//   2. Luật điều hướng của App.tsx cho supmt vào #management và các trang cá nhân,
//      KHÔNG cho vào trang vận hành (kho, bàn giao, POS, bếp, đặt hàng).
//   3. Migration cấp SELECT cho supmt trên đủ bảng mà trang Quản trị đọc, và KHÔNG
//      cấp update/delete ở bất kỳ đâu — insert duy nhất là đăng ký ca của chính họ.
//   4. AdminPage khóa mọi biểu mẫu/nút ghi bằng cờ `readOnly`.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function loadModule(relativePath) {
  let source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  source = source.replace(/^import\s[^\n]+\n/gm, '')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

const access = await loadModule('../src/lib/access.ts')

// 1. Ranh giới xem/ghi -------------------------------------------------------
assert.equal(access.canOpenAdminConsole('supmt'), true, 'SUP MT phải vào được trang Quản trị')
assert.equal(access.canOpenAdminConsole('admin'), true)
for (const role of ['manager', 'shift_leader', 'staff', 'cashier', 'kitchen']) {
  assert.equal(access.canOpenAdminConsole(role), false, `${role} không được vào trang Quản trị`)
}
assert.equal(access.isReadOnlyConsoleRole('supmt'), true, 'SUP MT là vai trò chỉ xem')
assert.equal(access.isReadOnlyConsoleRole('admin'), false, 'Admin vẫn thao tác được')
assert.equal(access.canUseSales('supmt'), false, 'SUP MT không bán hàng')
assert.equal(access.canUseOperations('supmt'), false, 'SUP MT không vận hành ca')
assert.equal(access.canUseManagement('supmt'), false, 'SUP MT không phải quản lý chi nhánh')
assert.equal(access.canUseAdmin('supmt'), false, 'SUP MT không có quyền admin')
assert.equal(access.hasSystemWideScope('supmt'), true, 'SUP MT đối chiếu toàn hệ thống')
assert.equal(access.isBranchlessRole('supmt'), true, 'SUP MT không gắn chi nhánh cố định')

// Phải khớp `branchlessRole` của edge function manage-employee, nếu không thì tạo
// tài khoản SUP MT sẽ đòi chi nhánh ở một phía và bỏ trống ở phía kia.
const manageEmployee = await readFile(new URL('../supabase/functions/manage-employee/index.ts', import.meta.url), 'utf8')
assert.match(
  manageEmployee,
  /branchlessRole = role === 'manager' \|\| role === 'kitchen' \|\| role === 'supmt'/,
  'edge function phải coi supmt là vai trò không gắn chi nhánh',
)

// 2. Luật điều hướng ---------------------------------------------------------
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
assert.match(appSource, /if \(page === 'management'\) return canOpenAdminConsole\(user\.role\)/,
  'canAccessPage phải mở #management cho SUP MT')
assert.match(appSource, /if \(user\.role === 'supmt'\) return 'management'/,
  'SUP MT đăng nhập vào thẳng trang Quản trị')
assert.match(appSource, /page === 'management' && canOpenAdminConsole\(user\.role\) && <ManagementPage/,
  'nhánh render ManagementPage phải dùng chung điều kiện với canAccessPage')
// Trang vận hành rơi vào nhánh mặc định `canUseOperations` ⇒ supmt bị chặn. Nếu ai đó
// đổi nhánh mặc định thành canUseManagement/true thì test này gãy đúng chỗ.
assert.match(appSource, /\r?\n  return canUseOperations\(user\.role\)\r?\n\}/,
  'canAccessPage phải kết thúc bằng canUseOperations (chặn SUP MT khỏi trang vận hành)')

// 3. Quyền ở tầng dữ liệu ----------------------------------------------------
const enumMigration = await readFile(new URL('../supabase/migrations/20260808_supmt_role_enum.sql', import.meta.url), 'utf8')
assert.match(enumMigration, /alter type public\.app_role add value if not exists 'supmt'/,
  'phải bổ sung giá trị enum supmt cho app_role')
assert.doesNotMatch(enumMigration, /create policy/i,
  'giá trị enum vừa thêm không dùng được trong cùng transaction — file này chỉ được chứa ALTER TYPE')

const rlsMigration = await readFile(new URL('../supabase/migrations/20260808_supmt_readonly_access.sql', import.meta.url), 'utf8')
const readTables = [
  'public.profiles',
  'public.shift_registrations',
  'public.attendance_records',
  'public.attendance_adjustment_requests',
  'public.sales_receipts',
  'public.sales_receipt_items',
  'public.bag_allocations',
  'public.bag_shift_sessions',
  'public.commission_rules',
  'public.employee_kpi_targets',
  'public.stock_movements',
  'public.inventory_reports',
  'public.operation_days',
  'public.report_snapshots',
  'public.supply_requests',
]
for (const table of readTables) {
  const pattern = new RegExp(`create policy "supmt [^"]+" on ${table.replace('.', '\\.')}\\s*\\n\\s*for select`, 'i')
  assert.match(rlsMigration, pattern, `thiếu policy SELECT cho supmt trên ${table}`)
}

const writeStatements = rlsMigration
  .split('\n')
  .filter((line) => /for (insert|update|delete|all)\b/i.test(line))
assert.equal(writeStatements.length, 1, `SUP MT chỉ được đúng 1 policy ghi, đang có ${writeStatements.length}`)
assert.match(writeStatements[0], /for insert/i, 'quyền ghi duy nhất phải là INSERT')
assert.match(rlsMigration, /create policy "supmt adds own shift anywhere" on public\.shift_registrations/,
  'quyền ghi duy nhất là tự đăng ký ca (để chấm công được)')
assert.match(rlsMigration, /user_id = \(select auth\.uid\(\)\)/,
  'policy ghi phải giới hạn đúng dòng của chính SUP MT')

// 4. Giao diện Quản trị khóa thao tác ----------------------------------------
const adminSource = await readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8')
assert.match(adminSource, /const readOnly = isReadOnlyConsoleRole\(user\.role\)/,
  'ManagementPage phải tính cờ readOnly từ vai trò')
const readOnlyGuards = [
  { pattern: /\{!readOnly && \(row\.attendanceRecordId \?/, label: 'nút Chỉnh công/Xóa ca' },
  { pattern: /showCreateAccount && !readOnly/, label: 'biểu mẫu tạo tài khoản' },
  { pattern: /showCreateBranch && !readOnly/, label: 'biểu mẫu tạo chi nhánh' },
  { pattern: /onToggleCreate=\{readOnly \? undefined :/, label: 'nút Tạo mới ở danh mục' },
  { pattern: /employeeProfileTab === 'account' && !readOnly/, label: 'tab Tài khoản (đổi vai trò, đặt lại mật khẩu, xóa)' },
  { pattern: /employeeProfileTab === 'overview' && !readOnly/, label: 'biểu mẫu sửa hồ sơ nhân viên' },
]
for (const guard of readOnlyGuards) {
  assert.match(adminSource, guard.pattern, `thiếu khóa readOnly cho ${guard.label}`)
}

// Nút "Tạo mới" chỉ hiện khi có handler — ErpListToolbar bỏ qua nếu thiếu một trong hai.
const toolbar = await readFile(new URL('../src/components/admin/ErpListToolbar.tsx', import.meta.url), 'utf8')
assert.match(toolbar, /\{primaryLabel && onPrimary &&/, 'ErpListToolbar phải ẩn nút chính khi không có handler')

console.log('SUPMT_READONLY_PERMISSIONS_OK — xem toàn hệ thống, ghi duy nhất ca của chính mình')
