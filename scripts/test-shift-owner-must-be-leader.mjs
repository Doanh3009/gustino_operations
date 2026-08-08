// Chủ ca phải là CA TRƯỞNG. Ca phó dùng chung role `shift_leader` nên trước đây
// ai check-in trước thì thành chủ ca — 28/07 tại Gold Coast ca phó bấm sớm hơn
// ca trưởng 67 giây và cả Ca 1 mang tên ca phó (KPI ca cũng tính theo ca phó).
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
const ledgerSource = await readFile(new URL('../src/lib/shiftLedger.ts', import.meta.url), 'utf8')

const { isDeputyShiftLeader, primaryLeadersScheduledFor, nextOperationalSequence } = assignment

// 1. Nhận diện ca phó theo chức danh, không theo role.
assert.equal(isDeputyShiftLeader({ positionTitle: 'Ca phó' }), true)
assert.equal(isDeputyShiftLeader({ positionTitle: 'CA PHÓ' }), true)
assert.equal(isDeputyShiftLeader({ positionTitle: 'Phó quản lý ca' }), true)
assert.equal(isDeputyShiftLeader({ positionTitle: 'Ca trưởng' }), false)
assert.equal(isDeputyShiftLeader({ positionTitle: 'Full-time' }), false)
// Chức danh rỗng = ca trưởng, nếu không cả chi nhánh không ai mở được ca.
assert.equal(isDeputyShiftLeader({ positionTitle: '' }), false)
assert.equal(isDeputyShiftLeader(undefined), false)

// 2. Đúng tình huống Gold Coast 28/07: hai người cùng đăng ký khung ca leader
//    07:15-15:15, một ca trưởng và một ca phó.
const workShifts = [
  { id: 'shift-morning', branchId: 'gold-coast', name: 'Ca sáng', startTime: '07:15', endTime: '15:15', graceMinutes: 15, recommendedStaff: 3, employmentTypes: ['leader'], active: true },
  { id: 'shift-evening', branchId: 'gold-coast', name: 'Ca tối', startTime: '14:15', endTime: '22:15', graceMinutes: 15, recommendedStaff: 3, employmentTypes: ['leader'], active: true },
]
const registration = (userId, userName, positionTitle, shiftId, startTime, endTime) => ({
  id: `reg-${userId}`,
  userId,
  userName,
  positionTitle,
  employmentType: 'leader',
  branchId: 'gold-coast',
  workDate: '2026-07-28',
  startTime,
  endTime,
  shiftId,
  status: 'approved',
  note: '',
  createdAt: '2026-07-27T00:00:00.000Z',
})
const registrations = [
  registration('deputy', 'Minh Thiện', 'Ca phó', 'shift-morning', '07:15', '15:15'),
  registration('primary', 'Trương Thị Phương', 'Ca trưởng', 'shift-morning', '07:15', '15:15'),
  registration('evening', 'Trần Minh Lý', 'Ca trưởng', 'shift-evening', '14:15', '22:15'),
]

assert.equal(nextOperationalSequence([]), 1)
assert.equal(nextOperationalSequence([{ sequence: 1 }]), 2)

const primariesForShiftOne = primaryLeadersScheduledFor(1, '2026-07-28', registrations, workShifts)
assert.deepEqual(primariesForShiftOne.map((item) => item.userName), ['Trương Thị Phương'])

const primariesForShiftTwo = primaryLeadersScheduledFor(2, '2026-07-28', registrations, workShifts)
assert.deepEqual(primariesForShiftTwo.map((item) => item.userName), ['Trần Minh Lý'])

// Ngày khác không được kéo lịch sang.
assert.equal(primaryLeadersScheduledFor(1, '2026-07-29', registrations, workShifts).length, 0)

// Chi nhánh chỉ xếp ca phó cho Ca 1 -> không có ca trưởng nào chặn, ca phó vẫn mở được ca.
const deputyOnly = [registrations[0]]
assert.equal(primaryLeadersScheduledFor(1, '2026-07-28', deputyOnly, workShifts).length, 0)

// 3. Bộ dò ca chặn ca phó tự đứng tên và trả quyền chủ ca cho ca trưởng.
assert.match(autoOpenSource, /deputy-not-owner/)
assert.match(autoOpenSource, /blockedAsDeputy\(user, sequence, today, registrations, workShifts\)/)
assert.match(autoOpenSource, /reclaimShiftForPrimaryLeader/)
// 07/08/2026 — chỉ bỏ qua khi người giữ ca ĐÚNG là chủ ca của phiên ca đó.
// Gold Coast 07/08: Ca 2 mở dưới tên ca trưởng CA 1; vì người giữ cũng là "ca trưởng"
// nên bản cũ bỏ qua ⇒ ca trưởng Ca 2 vĩnh viễn "Chưa nhận ca", không chốt được ca.
// Ca 1 chưa bàn giao vẫn không bị chiếm: người giữ có lịch đúng sequence 1.
assert.match(
  autoOpenSource,
  /const holderOwnsThisSequence = Boolean\(holder\)\s*\n\s*&& !isDeputyShiftLeader\(holder\)\s*\n\s*&& operationalSequencesFor\(holder!, registrations, workShifts\)\.includes\(session\.sequence\)/,
  'Phải xét người giữ ca có lịch đúng phiên ca này hay không, không chỉ xét ca phó.',
)
assert.match(autoOpenSource, /if \(holderOwnsThisSequence\) return skip\('shift-already-open'\)/)
assert.doesNotMatch(
  autoOpenSource,
  /if \(!holder \|\| !isDeputyShiftLeader\(holder\)\) return skip\('shift-already-open'\)/,
  'Luật cũ chỉ giành lại từ ca phó — đã thay.',
)
assert.match(ledgerSource, /export async function transferBagShiftLeadership/)

// 4. Màn Bàn giao: ca phó không tự nhận ca, nhưng vẫn mở thay được khi ca trưởng vắng.
assert.match(
  handoverSource,
  /const canAutoStartScheduledShift = Boolean\(startableRegistration\) && !deputyMustWaitForPrimary/,
)
assert.match(handoverSource, /canStandInForPrimary/)
assert.match(handoverSource, /CA PHÓ ĐỨNG THAY/)

console.log('OK — chủ ca luôn là ca trưởng, ca phó vẫn làm việc trong ca.')
