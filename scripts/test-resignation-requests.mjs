/**
 * RESIGNATION_REQUESTS — đơn xin nghỉ việc.
 *
 * Hợp đồng nghiệp vụ:
 *  - Nhân viên, Ca trưởng, Ca phó NỘP được đơn cho chính mình.
 *  - Quản lý/Admin và Ca trưởng/Ca phó CÙNG chi nhánh ĐỌC được; ca trưởng chi
 *    nhánh khác thì không.
 *  - Chỉ Quản lý/Admin DUYỆT được; ca trưởng chỉ ghi nhận "đã nắm thông tin".
 *  - Người nộp rút được đơn của mình khi còn chờ, và không tự duyệt được.
 *  - Mỗi người chỉ có tối đa một đơn đang mở.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

// ---- Lớp quyền trong lib chạy thật -----------------------------------------
const libSource = await read('src/lib/resignationRequests.ts')
const guards = libSource
  .split('function rowToRequest')[0]
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/^import\s*\{[\s\S]*?\}\s*from[^\n]*\n/gm, '')
  .replace(/\bexport\s+/g, '')
const compiled = ts.transpileModule(
  `${guards}\nexport { canSubmitResignation, canDecideResignation, canReviewBranchResignations, canViewResignationInbox, OPEN_RESIGNATION_STATUSES, RESIGNATION_STATUS_LABELS };\n`,
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText
const lib = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

for (const role of ['staff', 'shift_leader', 'shift_deputy']) {
  check(lib.canSubmitResignation(role), `${role} phai nop duoc don xin nghi viec.`)
}
for (const role of ['admin', 'manager', 'supmt', 'kitchen', 'cashier']) {
  check(!lib.canSubmitResignation(role), `${role} khong nop don xin nghi viec trong app.`)
}
for (const role of ['admin', 'manager']) {
  check(lib.canDecideResignation(role), `${role} phai duyet duoc don.`)
}
for (const role of ['shift_leader', 'shift_deputy', 'staff', 'supmt', 'cashier', 'kitchen']) {
  check(!lib.canDecideResignation(role), `${role} KHONG duoc duyet don xin nghi viec.`)
}
check(lib.canReviewBranchResignations('shift_leader'), 'Ca truong phai nam duoc don cua chi nhanh minh.')
check(lib.canReviewBranchResignations('shift_deputy'), 'Ca pho phai nam duoc don cua chi nhanh minh.')
check(!lib.canReviewBranchResignations('staff'), 'Nhan vien thuong khong doc don cua nguoi khac.')
check(!lib.canViewResignationInbox('staff'), 'Nhan vien thuong khong co hop thu don nghi viec.')
check(lib.canViewResignationInbox('manager') && lib.canViewResignationInbox('shift_leader'), 'Quan ly va ca truong phai co hop thu don.')
check(
  lib.OPEN_RESIGNATION_STATUSES.join(',') === 'pending,acknowledged',
  'Trang thai "dang mo" phai gom dung pending va acknowledged.',
)
check(
  Object.keys(lib.RESIGNATION_STATUS_LABELS).length === 5,
  'Thieu nhan tieng Viet cho mot trang thai don.',
)

// Lớp lib phải tự chặn trước khi gọi mạng, không phó mặc hết cho RLS.
check(/Chỉ Quản lý hoặc Admin được duyệt/.test(libSource), 'decideResignationRequest chua chan vai tro.')
check(/tối thiểu 10 ký tự/.test(libSource), 'Chua bat buoc ghi ly do nghi viec.')
check(/error\.code === '23505'/.test(libSource), 'Chua dich loi trung don dang mo thanh thong bao doc duoc.')
check(/Tài khoản chưa gắn chi nhánh/.test(libSource), 'Chua chan truong hop ho so thieu chi nhanh.')

// ---- RLS: lớp chặn thật ----------------------------------------------------
const migration = await read('supabase/migrations/20260810_resignation_requests.sql')
check(/enable row level security/i.test(migration), 'Bang resignation_requests chua bat RLS.')
check(
  /create policy "employees submit own resignation"[\s\S]{0,600}employee_id = auth\.uid\(\)[\s\S]{0,400}status = 'pending'/.test(migration),
  'RLS chua bat buoc chi tu nop don cho chinh minh o trang thai cho.',
)
check(
  /create policy "employees submit own resignation"[\s\S]{0,700}'staff', 'shift_leader', 'shift_deputy'/.test(migration),
  'RLS chua gioi han vai tro duoc nop don.',
)
check(
  /create policy "read resignation requests in scope"[\s\S]{0,600}public\.is_branch_shift_leader\(branch_id\)/.test(migration),
  'Ca truong phai doc duoc don CUA CHINH chi nhanh minh.',
)
check(
  /is_branch_shift_leader[\s\S]{0,600}actor\.branch_id = p_branch_id/.test(migration),
  'Ham is_branch_shift_leader phai rang buoc dung chi nhanh, khong cho doc cheo chi nhanh.',
)
check(
  /create policy "branch leaders acknowledge resignation"[\s\S]{0,400}with check[\s\S]{0,200}status = 'acknowledged'/.test(migration),
  'Ca truong chi duoc chuyen sang "da nam thong tin", khong duoc duyet.',
)
check(
  /create policy "employees withdraw own resignation"[\s\S]{0,400}with check[\s\S]{0,200}status = 'withdrawn'/.test(migration),
  'Nguoi nop chi duoc RUT don cua minh, khong duoc tu duyet.',
)
check(
  /create unique index[\s\S]{0,240}where status in \('pending', 'acknowledged'\)/.test(migration),
  'Thieu rang buoc moi nguoi chi co mot don dang mo.',
)
check(
  /can_decide_resignation[\s\S]{0,400}'admin', 'manager'/.test(migration),
  'Quyen duyet o tang DB phai gioi han dung admin/manager.',
)

// ---- Giao diện + điều hướng ------------------------------------------------
const page = await read('src/pages/ResignationPage.tsx')
check(/Đơn xin nghỉ việc/.test(page), 'Thieu tieu de trang don xin nghi viec.')
check(/Ngày làm việc cuối cùng/.test(page), 'Thieu o chon ngay lam viec cuoi cung.')
check(/Rút đơn/.test(page), 'Thieu nut rut don cho nguoi nop.')
check(/Đã nắm thông tin/.test(page), 'Thieu nut ghi nhan cho ca truong chi nhanh.')
check(/Duyệt nghỉ việc/.test(page) && /Không duyệt/.test(page), 'Thieu hai nut quyet dinh cua quan ly.')
check(
  /decision === 'rejected' && !decisionNote\.trim\(\)/.test(page),
  'Tu choi don phai bat buoc ghi ly do de nhan vien biet.',
)
check(/canDecide &&/.test(page), 'Nut duyet chua an theo vai tro.')

// BUG-137: `window.prompt`/`window.confirm` tran bi WebView Zalo/Facebook nuot,
// nguoi bam tuong da luu. Quyet dinh nhan su khong duoc di qua duong do.
// Bo chu thich truoc khi khang dinh "khong co X": chinh cau giai thich vi sao
// KHONG dung X cung chua chu X.
const pageCode = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
check(!/window\.prompt/.test(pageCode), 'Quyet dinh duyet/tu choi khong duoc dung window.prompt (BUG-137).')
check(!/window\.confirm/.test(pageCode), 'Thao tac ghi phai dung confirmRisky thay cho window.confirm (BUG-137).')
check(/confirmRisky/.test(page) && /confirmBlockedMessage/.test(page), 'Thieu lop phan biet "nguoi huy" voi "may nuot hop thoai".')

// Duyet xong phai dong ho so de nguoi do roi bang thi dua va bao cao ky sau.
check(/updateEmployeeCrmDetails/.test(page), 'Duyet nghi viec chua co duong chuyen ho so sang Nghi viec.')
check(/RESIGNATION_REASON_PRESETS/.test(page), 'Thieu danh sach ly do chon san.')
check(/RESIGNATION_HANDOVER_ITEMS/.test(page), 'Thieu checklist ban giao truoc khi nghi.')
check(/noticeDays/.test(page), 'Thieu so ngay bao truoc.')
check(/resignation-timeline/.test(page), 'Thieu dong thoi gian trang thai cua don.')

const shell = await read('src/components/AppShell.tsx')
check(/id: 'resignation'/.test(shell), 'Chua them muc Don nghi viec vao thanh dieu huong.')

const app = await read('src/App.tsx')
check(/page === 'resignation' && <ResignationPage/.test(app), 'Chua gan trang Don nghi viec vao router.')
check(
  /if \(page === 'resignation'\) return canSubmitResignation\(user\.role\) \|\| canViewResignationInbox\(user\.role\)/.test(app),
  'Chua co lop chan quyen cho trang Don nghi viec.',
)

assert.deepEqual(failures, [], `\n${failures.join('\n')}`)
console.log('RESIGNATION_REQUESTS_OK')
