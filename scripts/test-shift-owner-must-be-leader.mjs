// CHỦ CA = NGƯỜI BẤM NHẬN CA (luật mới 13/08/2026, chủ hệ thống chốt).
//
// ⚠️ Tên file giữ nguyên để CODEMAP và lịch sử git còn tra được, nhưng LUẬT ĐÃ
// ĐẢO. Luật cũ "chủ ca luôn là ca trưởng, ca phó không đứng tên ca" đã bị gỡ.
//
// Vì sao đảo: luật cũ chữa được lỗi 28/07 (ca phó check-in sớm 67 giây nên chiếm
// Ca 1) nhưng đẻ ra lỗi nặng hơn nhiều — ca phó bị loại khỏi `isLeaderRegistration`
// nên KHÔNG BAO GIỜ được gán phiên ca nào, kéo theo bị chặn tự mở ca, bị thu hồi
// ca đã mở, và màn Bàn giao không hiện nút nào. Ngày 12/08 Nguyễn Thị Yến (ca phó
// Lotte 23/10) có lịch 14:15–22:15 đã duyệt, đã chấm công, mà vẫn không nhận nổi
// Ca 2 — cả chi nhánh đứng hình.
//
// Luật mới: ca trưởng và ca phó NGANG QUYỀN vận hành. Ai vào ca thì người đó bấm
// nhận ca, phiên ca mang đúng tên người bấm, và KHÔNG có cơ chế nào tự chuyển
// quyền chủ ca sau lưng người đang đứng quầy.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function loadTypeScriptModule(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

const assignment = await loadTypeScriptModule('../src/lib/operationalShiftAssignment.ts')
const autoOpenSource = await readFile(new URL('../src/lib/shiftAutoOpen.ts', import.meta.url), 'utf8')
const handoverSource = await readFile(new URL('../src/pages/ShiftHandoverPage.tsx', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const ledgerSource = await readFile(new URL('../src/lib/shiftLedger.ts', import.meta.url), 'utf8')

const { isDeputyShiftLeader, primaryLeadersScheduledFor, nextOperationalSequence } = assignment

// 1. Vẫn nhận diện được chức danh ca phó — nhưng CHỈ để chấm KPI theo chức danh,
//    không còn dùng để chặn ai đứng tên ca.
assert.equal(isDeputyShiftLeader({ positionTitle: 'Ca phó' }), true)
assert.equal(isDeputyShiftLeader({ positionTitle: 'CA PHÓ' }), true)
assert.equal(isDeputyShiftLeader({ positionTitle: 'Phó quản lý ca' }), true)
assert.equal(isDeputyShiftLeader({ positionTitle: 'Ca phó (8h)' }), true, 'Hồ sơ thật của Nguyễn Thị Yến ghi "Ca phó (8h)".')
assert.equal(isDeputyShiftLeader({ positionTitle: 'Ca trưởng' }), false)
assert.equal(isDeputyShiftLeader({ positionTitle: 'Full-time' }), false)
// Chức danh rỗng = ca trưởng, nếu không cả chi nhánh không ai mở được ca.
assert.equal(isDeputyShiftLeader({ positionTitle: '' }), false)
assert.equal(isDeputyShiftLeader(undefined), false)

// 2. Đúng tình huống Lotte 23/10 ngày 12/08: ca tối có một ca trưởng và một ca
//    phó cùng khung giờ. Ca phó PHẢI được lịch xếp vào phiên ca như ca trưởng.
const workShifts = [
  { id: 'shift-morning', branchId: 'lotte-2310', name: 'Ca sáng', startTime: '07:15', endTime: '15:15', graceMinutes: 15, recommendedStaff: 3, employmentTypes: ['leader'], active: true },
  { id: 'shift-evening', branchId: 'lotte-2310', name: 'Ca tối', startTime: '14:15', endTime: '22:15', graceMinutes: 15, recommendedStaff: 3, employmentTypes: ['leader'], active: true },
]
const registration = (userId, userName, positionTitle, shiftId, startTime, endTime) => ({
  id: `reg-${userId}`,
  userId,
  userName,
  positionTitle,
  employmentType: 'leader',
  branchId: 'lotte-2310',
  workDate: '2026-08-12',
  startTime,
  endTime,
  shiftId,
  status: 'approved',
  note: '',
  createdAt: '2026-08-11T00:00:00.000Z',
})
const registrations = [
  registration('morning-leader', 'Nguyễn Bình Thảo Nguyên', 'Ca trưởng', 'shift-morning', '07:15', '15:15'),
  registration('deputy', 'Nguyễn Thị Yến', 'Ca phó (8h)', 'shift-evening', '14:15', '22:15'),
]

assert.equal(nextOperationalSequence([]), 1)
assert.equal(nextOperationalSequence([{ sequence: 1 }]), 2)

// ĐÂY LÀ HỒI QUY CỦA LỖI 12/08: trước bản vá danh sách này RỖNG vì ca phó bị
// `isLeaderRegistration` loại ra, nên Ca 2 không thuộc về ai.
const scheduledForShiftTwo = primaryLeadersScheduledFor(2, '2026-08-12', registrations, workShifts)
assert.deepEqual(
  scheduledForShiftTwo.map((item) => item.userName),
  ['Nguyễn Thị Yến'],
  'Ca phó phải được lịch xếp đứng Ca 2 như ca trưởng.',
)
assert.deepEqual(
  primaryLeadersScheduledFor(1, '2026-08-12', registrations, workShifts).map((item) => item.userName),
  ['Nguyễn Bình Thảo Nguyên'],
)
// Ngày khác không được kéo lịch sang.
assert.equal(primaryLeadersScheduledFor(1, '2026-08-13', registrations, workShifts).length, 0)

// Cả ngày chỉ có mình ca phó ⇒ ca phó ôm cả hai phiên ca, y như một ca trưởng.
const deputyOnly = [registrations[1]]
assert.deepEqual(
  primaryLeadersScheduledFor(1, '2026-08-12', deputyOnly, workShifts).map((item) => item.userName),
  ['Nguyễn Thị Yến'],
)
assert.deepEqual(
  primaryLeadersScheduledFor(2, '2026-08-12', deputyOnly, workShifts).map((item) => item.userName),
  ['Nguyễn Thị Yến'],
)

// 3. Bộ dò ca: không còn tầng chặn ca phó, không còn tự giật ca.
assert.doesNotMatch(autoOpenSource, /blockedAsDeputy/, 'Tầng chặn ca phó đã gỡ.')
assert.doesNotMatch(autoOpenSource, /reclaimShiftForPrimaryLeader/, 'Cơ chế tự giật quyền chủ ca đã gỡ.')
assert.doesNotMatch(autoOpenSource, /\[CA PHÓ ĐỨNG THAY\]/, 'Không còn khái niệm "ca phó đứng thay".')
assert.match(
  autoOpenSource,
  /if \(sessions\.some\(\(item\) => item\.status === 'open'\)\) return skip\('shift-already-open'\)/,
  'Ca đang mở thì bộ dò ca phải để yên, không đụng vào quyền chủ ca.',
)
assert.match(
  autoOpenSource,
  /user\.role !== 'shift_leader' && user\.role !== 'shift_deputy'/,
  'Bộ dò ca phải phục vụ cả ca phó.',
)
assert.match(
  autoOpenSource,
  /!\['shift_leader', 'shift_deputy'\]\.includes\(user\.role\)/,
  'Cửa nhận ca thủ công phải cho cả Ca trưởng và Ca phó bấm nhận ca.',
)
// Chuyển quyền chủ ca vẫn còn ở tầng thư viện để quản trị dùng khi cần, chỉ là
// không còn ai gọi tự động.
assert.match(ledgerSource, /export async function transferBagShiftLeadership/)

// 4. App.tsx phải cho ca phó chạy bộ dò ca (một trong các tầng từng chặn Yến).
assert.match(
  appSource,
  /user\.role !== 'shift_leader' && user\.role !== 'shift_deputy'/,
  'Vòng dò ca trong App.tsx phải nhận cả ca phó.',
)

// 5. Màn Bàn giao: MỘT nút nhận ca chung, không còn đường "mở ca thay".
assert.match(handoverSource, /Nhận ca ngay/)
assert.match(handoverSource, /const deputyMustWaitForPrimary = false/, 'Ca phó không còn phải chờ ca trưởng.')
assert.doesNotMatch(handoverSource, /Xác nhận mở .* thay ca trưởng/, 'Nút "mở ca thay" đã gỡ.')

console.log('OK — ca trưởng và ca phó ngang quyền; ai bấm nhận ca thì ca mang tên người đó.')
