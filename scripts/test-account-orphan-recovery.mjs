import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const [edge, admin] = await Promise.all([
  readFile(new URL('../supabase/functions/manage-employee/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
])
const failures = []

if (!edge.includes('findAuthUserByEmail')) failures.push('Tạo tài khoản chưa dò auth.users mồ côi theo đúng email đăng nhập.')
if (!edge.includes('recoverOrphanedAuthUser')) failures.push('Chưa có luồng khôi phục auth user bị mất profile thay vì báo tên đăng nhập đã dùng.')
if (!/if \(deleteAuthUser\)[\s\S]*?auth\.admin\.deleteUser\(employeeId\)[\s\S]*?deleteMaybe\(client, 'profiles'/.test(edge)) {
  failures.push('Xóa tài khoản vẫn có thể xóa profile trước auth user, làm tài khoản biến khỏi danh sách nhưng giữ tên đăng nhập trong Auth.')
}
if (!edge.includes(".from('profiles')") || !edge.includes(".maybeSingle()")) {
  failures.push('Khôi phục tài khoản chưa xác nhận auth user thật sự không còn profile.')
}
if (!admin.includes('Xóa nhân viên') || !admin.includes('Xác nhận xóa')) {
  failures.push('UI chưa hiển thị một thao tác xóa hẳn nhân viên có xác nhận hai bước.')
}
if (admin.includes('Vô hiệu hóa tài khoản') || admin.includes('Xóa sạch test')) {
  failures.push('UI vẫn còn nhánh vô hiệu hóa hoặc xóa-test gây nhầm lẫn.')
}
if (!/if \(crmEmployeeId === employee\.id\)[\s\S]*?setCrmEmployeeId\(''\)[\s\S]*?navigateAdminHash\('\/admin\/employees'\)/.test(admin)) {
  failures.push('Xóa nhân viên chưa thoát route chi tiết về danh sách, có thể để lại màn hình trắng.')
}
if (!admin.includes('admin-crm-missing-employee') || /if \(!employee\) return null/.test(admin)) {
  failures.push('Route hồ sơ nhân viên đã mất vẫn có thể render null thay vì trạng thái phục hồi.')
}

const edgeDiagnostics = ts.transpileModule(edge, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'supabase/functions/manage-employee/index.ts',
  reportDiagnostics: true,
}).diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) || []
if (edgeDiagnostics.length) {
  failures.push(`Edge Function không biên dịch được: ${edgeDiagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')).join('; ')}`)
}

if (failures.length) {
  console.error(failures.map((item) => `FAIL: ${item}`).join('\n'))
  process.exit(1)
}

console.log('ACCOUNT_ORPHAN_RECOVERY_OK')
