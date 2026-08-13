// Ai đứng tên phiên ca nào — xếp theo THỨ TỰ VÀO CA của ca trưởng trong NGÀY ĐÓ,
// không suy từ vị trí bản ghi trong bảng cấu hình `shifts`.
//
// Luật nghiệp vụ (chủ quán xác nhận 08/08/2026): mỗi chi nhánh chỉ có 2 ca trưởng.
// Một ngày hoặc hai người đăng ký — người vào ca sớm nhận Ca 1, người còn lại Ca 2 —
// hoặc chỉ một ca trưởng làm cả hai ca.
//
// Hai sự cố thật mà luật này xoá tận gốc:
//   · Lotte Vũng Tàu: ca trưởng thừa "07:15-22:15" (0 đăng ký, tạo nhầm 01/08) trùng
//     giờ mở với Ca 1 nên chen vào vị trí 2, đẩy "Ca 2" THẬT xuống vị trí 3. Bản cũ chỉ
//     nhận vị trí 1–2 ⇒ ai đăng ký đúng Ca 2 ra danh sách RỖNG ⇒ vĩnh viễn "Chưa nhận
//     ca", không chốt được ca.
//   · Đăng ký cả ngày (07:15–22:15, không gắn ca) phủ giờ CẢ HAI ca ⇒ bản cũ cho người
//     đó ôm luôn Ca 2 của ca trưởng được xếp đích danh.
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
const { operationalSequencesFor, primaryLeadersScheduledFor, leaderRegistrationsInOrder } = assignment

const leaderShift = (id, startTime, endTime) => ({
  id,
  branchId: 'lotte-vt',
  name: id,
  startTime,
  endTime,
  employmentTypes: ['leader'],
  active: true,
})

// Cấu hình ĐÚNG.
const healthyShifts = [leaderShift('ca-1', '07:15', '15:15'), leaderShift('ca-2', '14:15', '22:15')]
// Cấu hình HỎNG như Lotte VT trước 08/08: có ca trưởng thừa phủ cả ngày.
const brokenShifts = [
  leaderShift('ca-1', '07:15', '15:15'),
  leaderShift('junk-all-day', '07:15', '22:15'),
  leaderShift('ca-2', '14:15', '22:15'),
]

const reg = (id, userId, shiftId, startTime, endTime, extra = {}) => ({
  id,
  userId,
  userName: userId,
  employmentType: 'leader',
  positionTitle: 'Ca trưởng',
  branchId: 'lotte-vt',
  workDate: '2026-08-08',
  shiftId,
  startTime,
  endTime,
  status: 'approved',
  ...extra,
})

// ── 1. Hai ca trưởng: vào sớm đứng Ca 1, người còn lại Ca 2 ─────────────────
const som = reg('r-som', 'u-tu', 'ca-1', '07:15', '15:15')
const toi = reg('r-toi', 'u-ngan', 'ca-2', '14:15', '22:15')
const hai = [som, toi]
assert.deepEqual(operationalSequencesFor(som, hai, healthyShifts), [1])
assert.deepEqual(operationalSequencesFor(toi, hai, healthyShifts), [2])

// Và luật này MIỄN NHIỄM với cấu hình ca có rác — đây là điểm chính.
assert.deepEqual(
  operationalSequencesFor(toi, hai, brokenShifts),
  [2],
  'Ca trưởng thừa trong cấu hình không được làm ca trưởng Ca 2 mất lịch nữa.',
)
assert.deepEqual(operationalSequencesFor(som, hai, brokenShifts), [1])

// ── 2. Đăng ký cả ngày KHÔNG còn giành được ca của người xếp đích danh ──────
const caNgay = reg('r-ngay', 'u-ngan', undefined, '07:15', '22:15')
const ngayVaToi = [caNgay, toi]
assert.deepEqual(
  operationalSequencesFor(caNgay, ngayVaToi, healthyShifts),
  [1],
  'Có ca trưởng thứ hai thì lịch cả ngày chỉ còn đứng Ca 1.',
)
assert.deepEqual(
  operationalSequencesFor(toi, ngayVaToi, healthyShifts),
  [2],
  'Người xếp đích danh Ca 2 phải giữ được Ca 2.',
)

// ── 3. Cả ngày chỉ MỘT ca trưởng: trực cả hai ca ───────────────────────────
assert.deepEqual(
  operationalSequencesFor(caNgay, [caNgay], healthyShifts),
  [1, 2],
  'Một ca trưởng làm cả 2 ca là trường hợp hợp lệ.',
)

// ── 4. primaryLeadersScheduledFor bám cùng một luật ────────────────────────
assert.deepEqual(
  primaryLeadersScheduledFor(2, '2026-08-08', ngayVaToi, healthyShifts).map((item) => item.id),
  ['r-toi'],
)
assert.deepEqual(
  primaryLeadersScheduledFor(1, '2026-08-08', ngayVaToi, healthyShifts).map((item) => item.id),
  ['r-ngay'],
)
// Một ca trưởng duy nhất thì đứng tên cả hai phiên ca.
assert.deepEqual(primaryLeadersScheduledFor(1, '2026-08-08', [caNgay], healthyShifts).length, 1)
assert.deepEqual(primaryLeadersScheduledFor(2, '2026-08-08', [caNgay], healthyShifts).length, 1)

// ── 5. Part-time không chen vào thứ tự; ca phó thì CÓ (đổi 13/08/2026) ──────
// Ca phó nay ngang ca trưởng nên được xếp phiên ca như mọi người vận hành khác.
// Part-time vẫn tuyệt đối không đứng tên ca.
const caPho = reg('r-pho', 'u-pho', 'ca-1', '06:30', '15:15', { positionTitle: 'Ca phó' })
const partTime = reg('r-pt', 'u-pt', undefined, '06:00', '14:00', { employmentType: 'part_time', positionTitle: 'Part-time' })
const lanXanh = [caPho, partTime, som, toi]
assert.deepEqual(operationalSequencesFor(partTime, lanXanh, healthyShifts), [], 'Part-time không bao giờ đứng tên ca.')
// Ca phó vào 06:30 là khung sớm nhất ⇒ đứng Ca 1; ca trưởng 07:15 thành khung
// giữa nên không đứng ca nào, nhưng vẫn còn nút "Nhận ca ngay" để tự nhận.
assert.deepEqual(operationalSequencesFor(caPho, lanXanh, healthyShifts), [1])
assert.deepEqual(operationalSequencesFor(som, lanXanh, healthyShifts), [])
assert.deepEqual(operationalSequencesFor(toi, lanXanh, healthyShifts), [2])
assert.deepEqual(
  leaderRegistrationsInOrder('2026-08-08', 'lotte-vt', lanXanh, healthyShifts).map((item) => item.id),
  ['r-pho', 'r-som', 'r-toi'],
)

// ── 6. Đăng ký chưa duyệt không chiếm chỗ ──────────────────────────────────
const choDuyet = reg('r-cho', 'u-cho', 'ca-1', '07:00', '15:15', { status: 'pending' })
assert.deepEqual(operationalSequencesFor(choDuyet, [choDuyet, som, toi], healthyShifts), [])
assert.deepEqual(operationalSequencesFor(som, [choDuyet, som, toi], healthyShifts), [1])

// ── 7. Đăng ký của chi nhánh khác không lẫn vào ────────────────────────────
const chiNhanhKhac = { ...reg('r-khac', 'u-khac', 'ca-1', '06:00', '15:15'), branchId: 'gold-coast' }
assert.deepEqual(operationalSequencesFor(som, [chiNhanhKhac, som, toi], healthyShifts), [1])

// ── 8. Luật phải được nối vào mọi cửa mở ca, không chỉ giao diện ───────────
assert.match(
  autoOpenSource,
  /canOpenNextScheduledOperationalShift\(item, sessions, registrations, workShifts\)/,
  'Bộ dò ca nền phải xếp ca theo danh sách đăng ký của ngày.',
)
assert.match(
  autoOpenSource,
  /canOpenNextScheduledOperationalShift\(registration, sessions, registrations, workShifts\)/,
  'Đường mở ca sau check-in cũng phải dùng danh sách đăng ký của ngày.',
)
// 13/08/2026: không còn "trả quyền chủ ca" tự động. Ca đang mở thì bộ dò ca để
// yên — ai bấm nhận ca thì ca mang tên người đó cho tới khi chốt & bàn giao.
assert.doesNotMatch(
  autoOpenSource,
  /operationalSequencesFor\(holder!, registrations, workShifts\)/,
  'Cơ chế tự chuyển quyền chủ ca đã gỡ, không được dựng lại.',
)
assert.match(
  autoOpenSource,
  /if \(sessions\.some\(\(item\) => item\.status === 'open'\)\) return skip\('shift-already-open'\)/,
  'Ca đang mở thì bộ dò ca phải dừng, không đụng vào quyền chủ ca.',
)
assert.match(
  handoverSource,
  /canOpenNextScheduledOperationalShift\(registration, todaySessions, registrations, workShifts\)/,
)
assert.doesNotMatch(
  handoverSource,
  /mustDeferToScheduledPrimary/,
  'Luật "nhường ca" tạm thời đã thừa sau khi xếp ca theo đăng ký — không để lại code chết.',
)

console.log('OK — phiên ca xếp theo thứ tự vào ca của ca trưởng trong ngày.')
