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
const accountListSource = admin.slice(
  admin.indexOf('const accountEmployees ='),
  admin.indexOf('const unassignedEmployeeReceipts ='),
)
if (!accountListSource.includes('employees.filter') || accountListSource.includes('employee.active !== false')) {
  failures.push('Danh sách quản trị tài khoản vẫn giấu hồ sơ inactive dù username còn tồn tại trong Auth.')
}
if (!admin.includes('Tên đăng nhập vẫn được giữ cho đến khi Admin bấm “Xóa sạch test”')) {
  failures.push('UI chưa giải thích hồ sơ inactive vẫn giữ username trong Auth.')
}
if (!/title="Xóa vĩnh viễn tài khoản test[\s\S]*?disabled=\{accountBusyId === employee\.id \|\| employee\.id === user\.id\}/.test(admin)) {
  failures.push('Nút Xóa sạch test vẫn chưa khả dụng cho hồ sơ inactive để giải phóng username cũ.')
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
