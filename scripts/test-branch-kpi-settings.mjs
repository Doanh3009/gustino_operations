/**
 * BRANCH_KPI_SETTINGS — Admin đổi mức KPI theo chi nhánh trong giao diện.
 *
 * Hợp đồng cần giữ:
 *  1. Không có override thì mọi con số KPI phải y hệt trước khi có tính năng này.
 *  2. Có override thì mức ngày thường / cuối tuần / tháng đổi theo, kể cả KPI team.
 *  3. Kỳ Vũng Tàu 01–15/07/2026 đã chốt số đối soát: override KHÔNG được sửa lại.
 *  4. Chỉ Admin ghi được (lớp lib) và RLS phải chặn thật (lớp migration).
 *  5. Giao diện Quản trị phải có bảng chỉnh và không còn khối ghi chú KPI cứng cũ.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const commissionSource = await read('src/lib/commission.ts')
const start = commissionSource.indexOf('export const DEFAULT_REVENUE_TARGET')
const end = commissionSource.indexOf('const PRODUCT_PRICES')
assert.ok(start >= 0 && end > start, 'Khong tim thay khoi cong thuc KPI thuan trong commission.ts.')

const pure = commissionSource.slice(start, end).replace(/\bexport\s+/g, '')
const compiled = ts.transpileModule(
  `${pure}\nexport { setBranchKpiOverrides, listBranchKpiOverrides, defaultPositionKpiFormula, defaultBranchKpiHeadcount, positionKpiFormula, employeePeriodRevenueTarget, branchTeamPeriodRevenueTarget, employeeCompetitionPeriodRevenueTarget };\n`,
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText
const kpi = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

// ---- 1. Chưa có override: mọi mức phải bằng đúng khung gốc ------------------
kpi.setBranchKpiOverrides([])
check(
  kpi.employeePeriodRevenueTarget('gold-coast', 'staff', 'part_time', '', '2026-09-01', '2026-09-30') === 13900000,
  'Khong co override thi PG part-time Gold Coast tron thang phai giu 13.900.000d.',
)
check(
  kpi.employeePeriodRevenueTarget('lotte-2310', 'staff', 'part_time', '', '2026-09-05', '2026-09-05') === 550000,
  'Khong co override thi PG part-time 23/10 cuoi tuan phai giu 550.000d.',
)
const baselineTeam = kpi.branchTeamPeriodRevenueTarget('gold-coast', '2026-09-01', '2026-09-30')
check(baselineTeam > 0, 'KPI team Gold Coast mac dinh phai lon hon 0.')

// ---- 2. Có override: mọi lớp tính phải đi theo mức mới ----------------------
kpi.setBranchKpiOverrides([
  { branchId: 'gold-coast', position: 'pg_part_time', weekdayTarget: 700000, weekendTarget: 900000, monthlyTarget: 20000000, headcount: 3 },
  { branchId: 'gold-coast', position: 'pg_full_time', weekdayTarget: 1500000, weekendTarget: 1800000, monthlyTarget: 40000000, headcount: 2 },
])
check(
  kpi.employeePeriodRevenueTarget('gold-coast', 'staff', 'part_time', '', '2026-09-07', '2026-09-07') === 700000,
  'Override chua ap vao muc ngay thuong (Thu Hai 07/09/2026).',
)
check(
  kpi.employeePeriodRevenueTarget('gold-coast', 'staff', 'part_time', '', '2026-09-05', '2026-09-05') === 900000,
  'Override chua ap vao muc cuoi tuan (Thu Bay 05/09/2026).',
)
check(
  kpi.employeePeriodRevenueTarget('gold-coast', 'staff', 'part_time', '', '2026-09-01', '2026-09-30') === 20000000,
  'Override chua ap vao moc KPI tron thang.',
)
// Vị trí không được chỉnh vẫn giữ nguyên mức + số người mặc định của chi nhánh
// (Gold Coast mặc định có 2 Ca trưởng), nên team = phần override + phần mặc định.
const leaderDefault = kpi.defaultPositionKpiFormula('gold-coast', 'shift_leader')
const leaderHeadcount = kpi.defaultBranchKpiHeadcount('gold-coast', 'shift_leader')
const expectedTeam = 20000000 * 3 + 40000000 * 2 + leaderDefault.monthlyTarget * leaderHeadcount
check(
  kpi.branchTeamPeriodRevenueTarget('gold-coast', '2026-09-01', '2026-09-30') === expectedTeam,
  `KPI team chua cong dung: cho ${expectedTeam}, nhan ${kpi.branchTeamPeriodRevenueTarget('gold-coast', '2026-09-01', '2026-09-30')}.`,
)
// Chi nhánh khác không được lây override.
check(
  kpi.employeePeriodRevenueTarget('lotte-2310', 'staff', 'part_time', '', '2026-09-01', '2026-09-30') === 11300000,
  'Override cua Gold Coast khong duoc anh huong chi nhanh 23/10.',
)

// Override co ngay ap dung: truoc moc giu KPI cu, tu moc moi lay KPI moi.
kpi.setBranchKpiOverrides([
  { branchId: 'gold-coast', position: 'pg_part_time', weekdayTarget: 700000, weekendTarget: 900000, monthlyTarget: 20000000, headcount: 3, effectiveFrom: '2026-09-10' },
])
check(
  kpi.employeePeriodRevenueTarget('gold-coast', 'staff', 'part_time', '', '2026-09-09', '2026-09-09') === 500000,
  'Override co effectiveFrom khong duoc tac dong cac ngay truoc moc ap dung.',
)
check(
  kpi.employeePeriodRevenueTarget('gold-coast', 'staff', 'part_time', '', '2026-09-10', '2026-09-10') === 700000,
  'Override co effectiveFrom phai co hieu luc tu dung ngay ap dung.',
)
check(
  kpi.employeePeriodRevenueTarget('gold-coast', 'staff', 'part_time', '', '2026-09-01', '2026-09-30') === 20700000,
  'Thang co doi muc KPI giua ky phai cong tung ngay, khong lay binh quan hay monthlyTarget.',
)

// ---- 3. Kỳ Vũng Tàu đã chốt số: override không được sửa lại ----------------
kpi.setBranchKpiOverrides([
  { branchId: 'lotte-vt', position: 'pg_part_time', weekdayTarget: 1, weekendTarget: 1, monthlyTarget: 1, headcount: 9 },
])
check(
  kpi.employeePeriodRevenueTarget('lotte-vt', 'staff', 'part_time', '', '2026-07-06', '2026-07-06') === 550000,
  'Ky Vung Tau 01-15/07/2026 da chot so nhung override lam doi muc ngay thuong.',
)
check(
  kpi.employeePeriodRevenueTarget('lotte-vt', 'staff', 'part_time', '', '2026-07-11', '2026-07-11') === 650000,
  'Ky Vung Tau 01-15/07/2026 da chot so nhung override lam doi muc cuoi tuan.',
)
// Ngoài cửa sổ đã chốt thì override vẫn phải có hiệu lực.
check(
  kpi.employeePeriodRevenueTarget('lotte-vt', 'staff', 'part_time', '', '2026-09-07', '2026-09-07') === 1,
  'Ngoai ky da chot, override Vung Tau phai co hieu luc.',
)
kpi.setBranchKpiOverrides([])

// ---- 4. Lớp lib + RLS phải chặn người không phải Admin ----------------------
const lib = await read('src/lib/branchKpiFormulas.ts')
check(/user\.role !== 'admin'/.test(lib), 'Lib chua chan vai tro khac Admin khi luu muc KPI.')
check(/resetBranchKpiFormulas/.test(lib), 'Thieu duong khoi phuc muc KPI mac dinh.')
check(/isMissingTable\(error\)/.test(lib), 'Thieu nhanh chay tiep khi chua apply migration.')
check(/effective_from/.test(lib), 'Lib chua doc/ghi cot ngay ap dung effective_from.')
check(/isMissingEffectiveFromColumn/.test(lib), 'Lib chua co fallback khi Supabase chua apply cot effective_from.')

const migration = await read('supabase/migrations/20260810_branch_kpi_formulas.sql')
check(/enable row level security/i.test(migration), 'Bang branch_kpi_formulas chua bat RLS.')
check(
  /create policy "admin writes branch kpi formulas"[\s\S]{0,400}'admin'::public\.app_role/.test(migration),
  'RLS chua gioi han quyen GHI cho dung Admin.',
)
check(
  /create policy "everyone reads branch kpi formulas"[\s\S]{0,200}for select/.test(migration),
  'Nhan vien phai DOC duoc muc KPI de biet chi tieu cua chinh minh.',
)
check(
  /primary key \(branch_id, position\)/.test(migration),
  'Thieu khoa chinh (branch_id, position) nen upsert se sinh dong trung.',
)
const effectiveMigration = await read('supabase/migrations/20260812_branch_kpi_effective_from.sql')
check(/effective_from date/i.test(effectiveMigration), 'Migration ngay ap dung KPI chua them cot effective_from date.')

// ---- 5. Giao diện Quản trị -------------------------------------------------
const settingsUi = await read('src/pages/admin/BranchKpiSettings.tsx')
check(/Mức KPI theo chi nhánh/.test(settingsUi), 'Thieu tieu de bang chinh muc KPI.')
check(/Khôi phục mặc định/.test(settingsUi), 'Thieu nut khoi phuc muc mac dinh.')
check(/Ngày thường[\s\S]{0,400}Cuối tuần[\s\S]{0,400}Cả tháng/.test(settingsUi), 'Bang chua du 3 cot muc KPI.')
check(/data-label=/.test(settingsUi), 'Bang thieu nhan cot cho bo cuc dien thoai.')
check(/type="date"/.test(settingsUi), 'Man chinh KPI chua co o chon ngay ap dung.')
check(/effectiveFrom/.test(settingsUi), 'Man chinh KPI chua gan ngay ap dung vao draft luu.')
check(/showInitialLoading/.test(settingsUi), 'Man KPI chua tach loading lan dau de tranh chop/trong bang.')
// 14/08/2026 — chu he thong: "bang chinh kpi bam vao roi van mat them 1 thao tac
// bam mo bang nua". Vao tab Muc KPI DA LA chu dich mo bang; khong duoc co them
// mot lop gap nao nua.
check(
  !/Mở bảng chỉnh KPI/.test(settingsUi),
  'Bang chinh KPI khong duoc co nut "Mo bang chinh KPI" — vao tab la thay bang luon.',
)
check(
  !/\{open && \(/.test(settingsUi),
  'Bang chinh KPI van con lop gap: noi dung phai hien thang, khong cho bam mo.',
)
check(/load\(false, true\)/.test(settingsUi), 'Sau khi luu KPI phai tai lai khong chan man hinh va chi reset draft co chu dich.')
check(/dirtyDraftRef/.test(settingsUi), 'Man chinh KPI chua co guard chan dong bo nen de len o dang nhap.')
check(/kpi-settings-sync/.test(settingsUi), 'Thieu trang thai dong bo nhe khi tai lai KPI.')

// 14/08/2026 — MOT chuc nang chi co MOT cho chinh. Chu he thong: "co cho chinh
// roi thi xoa cho chinh truc tiep o bang di". Muc KPI dat o Cau hinh he thong →
// tab Muc KPI; man Thi dua chi CHAM theo muc do, khong nhung bang chinh vao nua.
const controlCenter = await read('src/pages/ControlCenterPage.tsx')
check(/<BranchKpiSettings/.test(controlCenter), 'Cau hinh he thong phai la noi dat bang chinh muc KPI.')
check(/tab === 'kpi'/.test(controlCenter), 'Thieu tab Muc KPI trong Cau hinh he thong.')

const adminPage = await read('src/pages/AdminPage.tsx')
check(
  !/<BranchKpiSettings/.test(adminPage),
  'Man Thi dua khong duoc nhung bang chinh KPI nua — da co cho chinh o Cau hinh he thong.',
)
check(
  /Chỉnh mức KPI \(Cấu hình hệ thống\)/.test(adminPage),
  'Man Thi dua phai con loi dan sang cho chinh muc KPI, khong bo lung nguoi dung.',
)
check(
  !/competition-kpi-policy/.test(adminPage),
  'Khoi ghi chu KPI cung cu van con — phai bo vi da co bang chinh truc tiep.',
)
check(
  /kpiFormulaVersion/.test(adminPage),
  'Bang xep hang chua tinh lai sau khi luu muc KPI moi.',
)
check(/kpiOverridesReady/.test(adminPage), 'Trang quan tri chua cho muc KPI override san sang truoc khi ve bang KPI.')

// 13/08/2026 — chu he thong: "may chi nhanh con lai dau". Bang CAU HINH phai liet
// ke DU MOI CHI NHANH, khong an theo bo loc chi nhanh o dau trang: dat chi tieu
// thi phai nhin ca chuoi de so. Bo loc chi chi phoi BAO CAO, khong chi phoi cau hinh.
check(
  !/selectedBranchId:/.test(settingsUi),
  'Bang chinh KPI khong duoc nhan bo loc chi nhanh dau trang — no phai hien du moi chi nhanh.',
)
check(
  /branches\.slice\(\)\.sort\(/.test(settingsUi),
  'Bang chinh KPI phai liet ke toan bo chi nhanh, xep theo ten.',
)
check(
  /<BranchKpiSettings[\s\S]{0,200}branches=\{activeBranches\}/.test(controlCenter),
  'Cau hinh he thong phai truyen TOAN BO chi nhanh dang hoat dong cho bang chinh KPI.',
)

assert.deepEqual(failures, [], `\n${failures.join('\n')}`)
console.log('BRANCH_KPI_SETTINGS_OK')
