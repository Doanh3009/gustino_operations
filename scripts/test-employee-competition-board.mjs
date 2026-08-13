/**
 * EMPLOYEE_COMPETITION_BOARD — bảng thi đua cho nhân viên + KPI cá nhân.
 *
 * Yêu cầu nghiệp vụ: mọi nhân viên đều xem được bảng thi đua để cố gắng, nhưng
 *  - KHÔNG xuất được Excel/ảnh,
 *  - KHÔNG thấy giờ làm, số ca hay tiền thưởng của người khác,
 *  - xem được KPI của CHÍNH MÌNH ngay trong màn Xem công.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

// ---- Bộ dựng bảng chạy thật trên dữ liệu giả -------------------------------
const commissionSource = await read('src/lib/commission.ts')
const kpiStart = commissionSource.indexOf('export const DEFAULT_REVENUE_TARGET')
const kpiEnd = commissionSource.indexOf('const PRODUCT_PRICES')
const commissionPure = commissionSource.slice(kpiStart, kpiEnd).replace(/\bexport\s+/g, '')

const accessSource = await read('src/lib/access.ts')
const positionLabel = accessSource
  .slice(accessSource.indexOf('export function employeePositionLabel'))
  .split('export function displayUserName')[0]
  .replace(/\bexport\s+/g, '')

// Quy tắc "đã nghỉ việc" nằm ở module riêng và bảng thi đua phụ thuộc vào nó,
// nên nạp thật chứ không giả lập — nếu quy tắc đổi thì test này phải đổi theo.
const employmentSource = (await read('src/lib/employmentStatus.ts'))
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/\bexport\s+/g, '')

const boardSource = (await read('src/lib/employeeCompetitionBoard.ts'))
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/^\}\s*from[^\n]*\n/gm, '')
  .replace(/\bexport\s+/g, '')

const compiled = ts.transpileModule(
  [
    // `localDateKey` là tiện ích ngày dùng chung; bản rút gọn đủ cho fixture.
    "function localDateKey(value = new Date()) {",
    "  const y = value.getFullYear(), m = value.getMonth() + 1, d = value.getDate();",
    "  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;",
    "}",
    commissionPure,
    positionLabel,
    employmentSource,
    boardSource,
    'export { buildCompetitionBoardRows, summarizeCompetitionTeam };',
  ].join('\n'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText
const board = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const employees = [
  { id: 'me', name: 'Nguyễn Thị A', role: 'staff', branchId: 'gold-coast', employmentType: 'part_time', active: true },
  { id: 'peer', name: 'Trần Văn B', role: 'staff', branchId: 'gold-coast', employmentType: 'part_time', active: true },
  { id: 'quiet', name: 'Lê Thị C', role: 'staff', branchId: 'gold-coast', employmentType: 'part_time', active: true },
  { id: 'other-branch', name: 'Phạm Văn D', role: 'staff', branchId: 'lotte-2310', employmentType: 'part_time', active: true },
  { id: 'left', name: 'Đã nghỉ', role: 'staff', branchId: 'gold-coast', employmentType: 'part_time', active: false },
  { id: 'kitchen', name: 'Bếp', role: 'kitchen', branchId: 'gold-coast', active: true },
]
const receipt = (id, sellerId, branchId, amount) => ({
  id, branchId, businessDate: '2026-09-07', sellerId, sellerKey: sellerId,
  sellerName: '', totalQuantity: 1, totalAmount: amount, lines: [], createdAt: '', createdBy: '',
})

const rows = board.buildCompetitionBoardRows({
  receipts: [
    receipt('r1', 'me', 'gold-coast', 400000),
    receipt('r2', 'peer', 'gold-coast', 900000),
    receipt('r3', 'other-branch', 'lotte-2310', 5000000),
  ],
  adjustments: [{ id: 'a1', sourceKey: 'k', branchId: 'gold-coast', employeeId: 'me', businessDate: '2026-09-07', amount: 100000, reason: '', createdAt: '' }],
  employees,
  branchId: 'gold-coast',
  from: '2026-09-07',
  to: '2026-09-07',
  meId: 'me',
})

check(rows.length === 3, `Bang phai co dung 3 nguoi ban hang dang lam tai chi nhanh, dang co ${rows.length}.`)
check(!rows.some((row) => row.branchId !== 'gold-coast'), 'Bang lot nguoi cua chi nhanh khac.')
check(!rows.some((row) => row.employeeKey === 'left'), 'Bang van hien nguoi da nghi viec.')
check(!rows.some((row) => row.employeeKey === 'kitchen'), 'Bep khong thuoc bang thi dua ban hang.')
check(rows[0].employeeKey === 'peer', 'Bang phai xep theo doanh thu giam dan.')

const me = rows.find((row) => row.isMe)
check(!!me, 'Khong danh dau duoc dong cua chinh nguoi dang xem.')
// 400.000đ POS + 100.000đ bổ sung lịch sử = 500.000đ.
check(me.revenue === 500000, `Doanh thu cua toi phai gom ca khoan bo sung lich su, dang la ${me.revenue}.`)
// 07/09/2026 là Thứ Hai ⇒ mức ngày thường Gold Coast part-time = 500.000đ ⇒ đạt 100%.
check(me.target === 500000, `Chi tieu ngay thuong phai la 500.000d, dang la ${me.target}.`)
check(Math.round(me.progress) === 100, `Phai dat 100%, dang la ${me.progress}.`)
check(me.rank === 'A', `Dat 100% phai xep loai A, dang la ${me.rank}.`)

const quiet = rows.find((row) => row.employeeKey === 'quiet')
check(!!quiet && quiet.revenue === 0, 'Nguoi chua ban duoc gi van phai co mat tren bang voi doanh thu 0.')

/**
 * Bảng chỉ được mang đúng những trường không nhạy cảm. Thêm trường mới vào đây
 * là một QUYẾT ĐỊNH có ý thức, không phải thao tác dọn test:
 *  - `positionGroup`  : nhóm vị trí, để so người cùng vị trí — không phải dữ liệu cá nhân.
 *  - `achievedDays`   : số ngày ĐẠT CHỈ TIÊU. Không phải số ca đi làm, không phải giờ công.
 *  - `activeDays`     : số ngày có phát sinh doanh thu, mẫu số của tỉ lệ ngày đạt.
 * Tuyệt đối KHÔNG thêm giờ công, giờ check-in/out, số ca hay tiền thưởng.
 */
const allowedFields = new Set([
  'employeeKey', 'employeeId', 'employeeName', 'branchId',
  'positionLabel', 'positionGroup', 'revenue', 'target', 'progress', 'rank',
  'achievedDays', 'activeDays', 'isMe',
])
const forbiddenFieldNames = /hour|hours|shiftcount|checkin|checkout|salary|bonus|commission|luong|thuong/i
const leakedSensitive = Object.keys(rows[0]).filter((key) => forbiddenFieldNames.test(key))
check(!leakedSensitive.length, `Bang thi dua lo du lieu nhay cam: ${leakedSensitive.join(', ')}`)
const leakedFields = Object.keys(rows[0]).filter((key) => !allowedFields.has(key))
check(!leakedFields.length, `Bang thi dua lo them truong: ${leakedFields.join(', ')}`)

// ---- Trang bảng thi đua ----------------------------------------------------
/** Bỏ chú thích trước khi khẳng định "không có X": câu giải thích vì sao KHÔNG
 *  làm X cũng chứa chữ X, nếu không bỏ thì test đỏ oan. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const page = await read('src/pages/CompetitionBoardPage.tsx')
const pageCode = stripComments(page)
check(/Bảng thi đua/.test(page), 'Thieu tieu de Bang thi dua.')
check(!/exceljs|xuất excel|exportKpi|html2canvas|xuất ảnh/i.test(pageCode), 'Bang thi dua cua nhan vien khong duoc co nut xuat Excel/anh.')
check(!/totalHours|shiftCount|fetchAttendanceRecords|fetchShiftRegistrations/.test(pageCode), 'Bang thi dua khong duoc doc/hien gio cong cua nguoi khac.')
check(!/dailyKpiBonus|Thưởng/.test(pageCode), 'Bang thi dua khong duoc hien tien thuong cua nguoi khac.')
check(/loadBranchKpiOverrides/.test(pageCode), 'Bang thi dua phai dung chung muc KPI Admin da chinh.')

// ---- KPI cá nhân trong màn Xem công ---------------------------------------
const timesheet = await read('src/pages/MyTimesheetPage.tsx')
check(/KPI CỦA TÔI/.test(timesheet), 'Man Xem cong chua co khoi KPI cua chinh minh.')
check(/employeeCompetitionPeriodRevenueTarget/.test(timesheet), 'KPI ca nhan phai dung chung cong thuc voi trang Quan tri.')
check(/dailyKpiBonus/.test(timesheet), 'Chua hien thuong KPI cua dung ngay dang chon.')
check(/isOwnReceipt/.test(timesheet), 'Phai loc hoa don ve dung nguoi dang dang nhap.')
check(
  /adjustment\.employeeId === user\.id/.test(timesheet),
  'Khoan bo sung KPI phai loc ve dung nguoi dang dang nhap.',
)

// ---- Điều hướng + quyền ----------------------------------------------------
const shell = await read('src/components/AppShell.tsx')
check(/id: 'competition'/.test(shell), 'Chua them muc Bang thi dua vao thanh dieu huong.')
check(/canShow: \(user\) => canUseSales\(user\.role\)/.test(shell), 'Bang thi dua phai mo cho moi vai tro ban hang.')

const app = await read('src/App.tsx')
check(/page === 'competition' && <CompetitionBoardPage/.test(app), 'Chua gan trang Bang thi dua vao router.')
check(
  /if \(page === 'competition'\) return canUseSales\(user\.role\)/.test(app),
  'Chua co lop chan quyen cho trang Bang thi dua.',
)

assert.deepEqual(failures, [], `\n${failures.join('\n')}`)
console.log('EMPLOYEE_COMPETITION_BOARD_OK')
