/**
 * DEPUTY_AND_ATTENDANCE_RULES — hai luật nghiệp vụ chốt ngày 10/08/2026.
 *
 * A. Ca phó truy cập ngang Ca trưởng.
 *    Triệu chứng chủ hệ thống báo: "set quyền cho ca phó rồi nhưng vẫn không được".
 *    Nguyên nhân gốc nằm ở HAI tầng và test này khoá cả hai:
 *      1. `storedRole()` ghi Ca phó xuống DB thành `staff`, trong khi enum
 *         `app_role` không có `shift_deputy` và mọi policy RLS của bảng vận hành
 *         chỉ cho `shift_leader` ⇒ Ca phó bị chặn ở tầng database.
 *      2. `OPERATION_ROLES` chỉ có `shift_leader` ⇒ giao diện tự khoá họ ra ngoài
 *         ngay cả khi DB đã cho phép.
 *    Bất biến phải giữ: Ca phó vẫn KHÔNG được đứng tên phiên ca khi chi nhánh đã
 *    xếp ca trưởng — luật đó theo chức danh, không theo vai trò.
 *
 * B. Công: đăng ký ca mà không làm = VẮNG; không đăng ký = ô trống.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

// ---------------------------------------------------------------- A. Ca phó
const accessSource = await read('src/lib/access.ts')
const accessPure = accessSource
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/\bexport\s+/g, '')
  .split('export function roleLabel')[0]
  .split('function roleLabel')[0]
const compiled = ts.transpileModule(
  `${accessPure}\nexport { canUseOperations, canUseSales, normalizeRole, OPERATION_ROLES };\n`,
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText
const access = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

check(access.canUseOperations('shift_deputy'), 'Ca pho phai vao duoc cac man van hanh (Hom nay/Kho/Ban giao/Dat hang/Bao cao).')
check(access.canUseOperations('shift_leader'), 'Ca truong van phai vao duoc man van hanh.')
check(!access.canUseOperations('staff'), 'Nhan vien thuong KHONG duoc vao man van hanh.')
check(!access.canUseOperations('cashier'), 'Thu ngan KHONG duoc vao man van hanh.')
check(access.canUseSales('shift_deputy'), 'Ca pho phai ban hang duoc.')
// Chức danh "Ca phó" phải suy ra đúng vai trò ứng dụng dù hồ sơ lưu role nào.
check(access.normalizeRole('shift_leader', 'Ca phó') === 'shift_deputy', 'Chuc danh Ca pho phai suy ra vai tro shift_deputy.')
check(access.normalizeRole('shift_leader', 'Ca phó (8h)') === 'shift_deputy', 'Chuc danh "Ca pho (8h)" cung phai suy ra shift_deputy.')
check(access.normalizeRole('shift_leader', 'Ca trưởng') === 'shift_leader', 'Ca truong khong duoc bien thanh Ca pho.')

// Tầng ghi xuống DB: phải lưu `shift_leader`, KHÔNG được lưu `staff`.
const attendanceSource = await read('src/lib/attendance.ts')
const storedRoleBlock = attendanceSource.slice(
  attendanceSource.indexOf('function storedRole'),
  attendanceSource.indexOf('function authHeaders'),
)
check(
  /role === 'shift_deputy' \? 'shift_leader' : role/.test(storedRoleBlock),
  'storedRole phai luu Ca pho thanh shift_leader; luu thanh staff la bi RLS chan het bang van hanh.',
)
check(
  !/'shift_deputy' \? 'staff'/.test(storedRoleBlock),
  'storedRole van con map Ca pho -> staff (dung nguyen nhan goc cua loi "set quyen roi ma khong vao duoc").',
)

// Edge function chỉ nhận các giá trị enum thật; `shift_deputy` bị từ chối.
const edgeFn = await read('supabase/functions/manage-employee/index.ts')
const allowedRoles = edgeFn.match(/\[([^\]]*)\]\.includes\(role\)/)
check(!!allowedRoles, 'Khong tim thay danh sach vai tro hop le trong edge function.')
if (allowedRoles) {
  check(!allowedRoles[1].includes('shift_deputy'), 'Edge function khong nhan shift_deputy, nen client bat buoc phai quy doi truoc khi gui.')
  check(allowedRoles[1].includes('shift_leader'), 'Edge function phai nhan shift_leader.')
}

// Bất biến: Ca phó không đứng tên phiên ca khi đã có ca trưởng theo lịch.
const autoOpen = await read('src/lib/shiftAutoOpen.ts')
check(
  !/blockedAsDeputy/.test(autoOpen),
  'Lop chan Ca pho dung ten phien ca phai bi go (13/08/2026): no gay loi 12/08 cua Nguyen Thi Yen.',
)
check(
  !/reclaimShiftForPrimaryLeader/.test(autoOpen),
  'Khong con co che tu giat quyen chu ca: ai bam nhan ca thi ca mang ten nguoi do.',
)
check(
  /!\['shift_leader', 'shift_deputy'\]\.includes\(user\.role\)/.test(autoOpen),
  'Nut nhan ca thu cong phai cho ca truong va ca pho cung nhan ca.',
)
const assignment = await read('src/lib/operationalShiftAssignment.ts')
check(/isDeputyShiftLeader/.test(assignment), 'Mat lop phan biet Ca pho theo chuc danh (isDeputyShiftLeader).')

const todayPage = await read('src/pages/TodayPage.tsx')
check(
  /\['shift_leader', 'shift_deputy'\]\.includes\(user\.role\)/.test(todayPage),
  'Man Hom nay chua hien nut nhan ca cho role shift_deputy.',
)

// Điều hướng: Ca phó mở app vào màn vận hành như ca trưởng, không rơi về Bán hàng.
const app = await read('src/App.tsx')
check(
  !/user\.role === 'staff' \|\| user\.role === 'shift_deputy' \|\| user\.role === 'cashier'\) return 'sales'/.test(app),
  'Ca pho khong con mac dinh roi ve man Ban hang.',
)

// ------------------------------------------------------------- B. Quy tắc công
const timesheet = await read('src/pages/MyTimesheetPage.tsx')
check(
  /const absent = !hasRecord && dayRows\.some\(\(row\) => row\.status === 'absent'\)/.test(timesheet),
  'Ngay CO dang ky ma khong cham cong phai duoc danh dau vang.',
)
check(
  /tone-empty/.test(timesheet),
  'Ngay KHONG dang ky phai co trang thai rieng (o trong), khong phai vang.',
)
check(
  /absent: Array\.from\(rowsByDate\.entries\(\)\)/.test(timesheet),
  'Thieu bo dem so ngay vang trong bang tong hop thang.',
)
check(
  /không đăng ký ca nên để trống — không bị tính vắng/.test(timesheet),
  'Thieu cau giai thich cho ngay khong dang ky ca.',
)

// Nguồn sự thật của trạng thái: chỉ đăng ký CHƯA BỊ TỪ CHỐI mới sinh dòng, và
// chỉ thành 'absent' khi đã qua giờ tan ca.
const attendanceLib = attendanceSource
check(
  /registrations\.filter\(\(item\) => item\.status !== 'rejected'\)/.test(attendanceLib),
  'Dang ky da bi tu choi khong duoc tinh la co lich.',
)
check(
  /now > scheduledEnd \? 'absent' : 'scheduled'/.test(attendanceLib),
  'Chi duoc tinh vang SAU khi da qua gio tan ca; truoc do la "co lich".',
)

// -------------------------------------------- Gộp Xem công vào trang Chấm công
const attendancePage = await read('src/pages/AttendancePage.tsx')
check(/id: 'timesheet', label: 'Xem công'/.test(attendancePage), 'Chua co tab Xem cong trong trang Cham cong.')
check(/<MyTimesheetContent user=\{user\} \/>/.test(attendancePage), 'Tab Xem cong chua render noi dung bang cong.')
const shell = await read('src/components/AppShell.tsx')
check(
  !/id: 'my-timesheet'/.test(shell),
  'Van con muc "Xem cong" rieng o thanh dieu huong — phai gop vao trang Cham cong.',
)
check(
  /page === 'attendance' \|\| page === 'my-timesheet'/.test(app),
  'Link cu #my-timesheet phai mo thang tab Xem cong thay vi gay.',
)

assert.deepEqual(failures, [], `\n${failures.join('\n')}`)
console.log('DEPUTY_AND_ATTENDANCE_RULES_OK')
