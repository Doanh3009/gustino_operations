// Lịch CẢ NGÀY không được giành ca của ca trưởng xếp ĐÍCH DANH ca đó.
//
// Sự cố thật (Lotte Vũng Tàu 07–08/08/2026):
//   · Chi nhánh có ca trưởng thừa "07:15-22:15" (0 đăng ký, tạo nhầm 01/08) trùng giờ
//     bắt đầu với Ca 1 nên chen vào vị trí 2, đẩy "Ca 2" THẬT xuống vị trí 3.
//     `scheduledOperationalSequences` chỉ nhận vị trí 1–2 ⇒ ai đăng ký đúng "Ca 2" ra
//     danh sách RỖNG ⇒ không bao giờ tự nhận được ca.
//   · Ca trưởng Lưu Thị Thanh Ngân đăng ký 07:15–22:15 KHÔNG gắn ca (`shiftId` rỗng)
//     ⇒ phủ cả hai ca ⇒ được coi là chủ CẢ Ca 1 lẫn Ca 2, giành mất ca của người được
//     xếp đích danh Ca 2 — người đó thì "Chưa nhận ca" và không chốt được ca.
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
const { scheduledOperationalSequences, primaryLeadersScheduledFor } = assignment

const leaderShift = (id, startTime, endTime, active = true) => ({
  id,
  branchId: 'lotte-vt',
  name: id,
  startTime,
  endTime,
  graceMinutes: 15,
  recommendedStaff: 3,
  employmentTypes: ['leader'],
  active,
})

// Cấu hình ĐÚNG: mỗi chi nhánh đúng 2 ca trưởng.
const healthyShifts = [
  leaderShift('ca-1', '07:15', '15:15'),
  leaderShift('ca-2', '14:15', '22:15'),
]

// Cấu hình HỎNG như Lotte VT trước 08/08: có ca trưởng thừa phủ cả ngày.
const brokenShifts = [
  leaderShift('ca-1', '07:15', '15:15'),
  leaderShift('junk-all-day', '07:15', '22:15'),
  leaderShift('ca-2', '14:15', '22:15'),
]

const reg = (userId, userName, shiftId, startTime, endTime, positionTitle = 'Ca trưởng') => ({
  id: `reg-${userId}`,
  userId,
  userName,
  positionTitle,
  employmentType: 'leader',
  branchId: 'lotte-vt',
  workDate: '2026-08-08',
  shiftId,
  startTime,
  endTime,
  status: 'approved',
})

// ── 1. Ca trưởng thừa làm ca trưởng THẬT của Ca 2 mất sạch lịch ───────────────
const ca2Registration = reg('u-phuong', 'Ca trưởng Ca 2', 'ca-2', '14:15', '22:15')
assert.deepEqual(
  scheduledOperationalSequences(ca2Registration, brokenShifts),
  [],
  'Bẫy đã xảy ra thật: ca trưởng thừa đẩy "Ca 2" xuống vị trí 3 nên người đăng ký Ca 2 ra rỗng.',
)
assert.deepEqual(
  scheduledOperationalSequences(ca2Registration, healthyShifts),
  [2],
  'Dọn ca thừa thì Ca 2 phải về đúng sequence 2.',
)

// ── 2. Đăng ký cả ngày (không gắn ca) phủ CẢ HAI ca ───────────────────────────
const allDayRegistration = reg('u-ngan', 'Ngân (cả ngày)', undefined, '07:15', '22:15')
assert.deepEqual(
  scheduledOperationalSequences(allDayRegistration, healthyShifts),
  [1, 2],
  'Đăng ký cả ngày phủ cả hai ca — đây chính là nguồn gốc việc giành ca.',
)
// Người được xếp đích danh thì chỉ đúng MỘT ca.
assert.equal(scheduledOperationalSequences(ca2Registration, healthyShifts).length, 1)
assert.equal(scheduledOperationalSequences(allDayRegistration, healthyShifts).length > 1, true)

// ── 3. Luật phân xử: lịch cụ thể THẮNG lịch cả ngày ──────────────────────────
// Mô phỏng đúng biểu thức `blockedByScheduledPrimary` / `mustDeferToScheduledPrimary`.
function mustDefer(mine, sequence, all, shifts) {
  if (scheduledOperationalSequences(mine, shifts).length <= 1) return false
  return primaryLeadersScheduledFor(sequence, mine.workDate, all, shifts).some((item) =>
    item.userId !== mine.userId
    && scheduledOperationalSequences(item, shifts).length === 1)
}

const both = [allDayRegistration, ca2Registration]
assert.equal(
  mustDefer(allDayRegistration, 2, both, healthyShifts),
  true,
  'Lịch cả ngày phải nhường Ca 2 cho người được xếp đích danh.',
)
assert.equal(
  mustDefer(ca2Registration, 2, both, healthyShifts),
  false,
  'Người được xếp đích danh Ca 2 KHÔNG bao giờ bị chặn.',
)
// Ca 1 không có ai xếp đích danh -> lịch cả ngày vẫn mở được Ca 1 như cũ.
assert.equal(
  mustDefer(allDayRegistration, 1, both, healthyShifts),
  false,
  'Không có ai xếp đích danh Ca 1 thì lịch cả ngày vẫn được mở Ca 1.',
)

// ── 4. Hai ca trưởng cùng xếp đích danh Ca 2 thì KHÔNG ai bị chặn ────────────
// Nếu chặn cả hai thì không ai mở được ca — hỏng nặng hơn lỗi đang sửa.
const ca2Second = reg('u-khac', 'Ca trưởng Ca 2 thứ hai', 'ca-2', '14:15', '22:15')
const twoSpecific = [ca2Registration, ca2Second]
assert.equal(mustDefer(ca2Registration, 2, twoSpecific, healthyShifts), false)
assert.equal(mustDefer(ca2Second, 2, twoSpecific, healthyShifts), false)

// ── 5. Luật phải được nối vào CẢ hai cửa mở ca, không chỉ giao diện ──────────
assert.match(autoOpenSource, /function blockedByScheduledPrimary/)
assert.match(
  autoOpenSource,
  /if \(blockedByScheduledPrimary\(registration, sequence, today, registrations, workShifts\)\)/,
  'Bộ dò ca nền phải áp luật, nếu không giao diện chặn mà nền vẫn mở ca.',
)
assert.match(
  autoOpenSource,
  /blockedByScheduledPrimary\(registration, sequence, registration\.workDate, registrations, workShifts\)/,
  'Đường mở ca ngay sau check-in cũng phải áp luật.',
)
assert.match(autoOpenSource, /'defer-to-scheduled-leader'/)
assert.match(
  handoverSource,
  /&& !mustDeferToScheduledPrimary/,
  'Màn Bàn giao không được tự mở ca khi phải nhường người xếp đích danh.',
)
assert.match(
  handoverSource,
  /const mustDeferToScheduledPrimary = Boolean\(\s*\n\s*myScheduledSequences\.length > 1 && specificPrimaryForNextShift\.length,\s*\n\s*\)/,
  'Chỉ chặn khi lịch của mình mơ hồ VÀ người kia được xếp đích danh.',
)

console.log('OK — lịch cụ thể thắng lịch cả ngày; ca trưởng đích danh không bị giành ca.')
