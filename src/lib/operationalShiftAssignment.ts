import type { BagShiftSession, ShiftRegistration, WorkShift } from '../types'

/**
 * "Ca phó" KHÔNG phải một role riêng: ca trưởng và ca phó cùng đăng nhập bằng
 * `shift_leader`, chỉ khác `position_title`. Quy tắc vận hành: **chủ ca luôn là
 * ca trưởng** — ca phó vẫn chấm công, nhập kho, chế biến, bán hàng trong ca
 * nhưng không đứng tên phiên ca.
 *
 * Trước đây ai check-in trước thì người đó thành chủ ca, nên 28/07 tại Gold
 * Coast ca phó check-in sớm hơn ca trưởng 67 giây và cả Ca 1 mang tên ca phó
 * (kéo theo chỉ tiêu/KPI của ca cũng tính theo chức danh ca phó).
 *
 * Chức danh RỖNG phải hiểu là ca trưởng: hồ sơ cũ chưa khai vị trí, nếu coi
 * mặc định là ca phó thì cả chi nhánh sẽ không ai mở được ca.
 */
export function isDeputyShiftLeader(person?: { positionTitle?: string } | null) {
  const title = String(person?.positionTitle || '')
    .toLocaleLowerCase('vi')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
  return /(^|[^a-z])pho([^a-z]|$)/.test(title)
}

/**
 * Đăng ký này có phải của MỘT CA TRƯỞNG đứng tên phiên ca hay không.
 *
 * `employmentType` rỗng (bản ghi cũ/đường LAN) phải hiểu là "có thể là ca trưởng" —
 * cùng lý do với BUG-100, không được loại nhầm người đúng lịch. Nhưng rỗng KHÔNG được
 * hiểu thoáng tới mức nhận cả part-time: khi rỗng thì phải có thêm bằng chứng là ca
 * đã đăng ký nằm trong nhóm ca dành cho ca trưởng.
 */
function isLeaderRegistration(registration: ShiftRegistration, workShifts: WorkShift[]) {
  if (isDeputyShiftLeader(registration)) return false
  if (registration.employmentType === 'leader') return true
  if (registration.employmentType) return false
  return workShifts.some((shift) =>
    shift.branchId === registration.branchId
    && shift.active !== false
    && shift.employmentTypes?.includes('leader')
    && (registration.shiftId ? shift.id === registration.shiftId : registrationCoversShift(registration, shift)))
}

/**
 * Xếp CA TRƯỞNG của một ngày theo giờ vào ca: sớm hơn đứng Ca 1, người còn lại Ca 2.
 *
 * ĐÂY LÀ NGUỒN SỰ THẬT cho việc ai đứng tên phiên ca nào (chủ quán xác nhận 08/08/2026):
 * mỗi chi nhánh chỉ có 2 ca trưởng; một ngày hoặc hai người đăng ký — người đăng ký ca
 * sáng nhận Ca 1, người kia nhận Ca 2 — hoặc chỉ một ca trưởng làm cả hai ca.
 *
 * Bản cũ suy ra phiên ca từ VỊ TRÍ của bản ghi trong bảng cấu hình `shifts`, nên chỉ cần
 * ai đó tạo thừa một ca trưởng là cả chi nhánh lệch: Lotte Vũng Tàu có ca thừa
 * "07:15-22:15" (0 đăng ký) trùng giờ mở với Ca 1 nên chen vào vị trí 2, đẩy "Ca 2" thật
 * xuống vị trí 3 — mà code chỉ nhận vị trí 1–2 ⇒ ca trưởng đăng ký đúng Ca 2 ra danh
 * sách RỖNG, vĩnh viễn "Chưa nhận ca" và không chốt được ca. Xếp theo đăng ký thật thì
 * cấu hình ca có rác cũng không ảnh hưởng.
 */
export function leaderRegistrationsInOrder(
  workDate: string,
  branchId: string,
  registrations: ShiftRegistration[],
  workShifts: WorkShift[],
) {
  return registrations
    .filter((registration) =>
      registration.workDate === workDate
      && registration.branchId === branchId
      && registration.status === 'approved'
      && isLeaderRegistration(registration, workShifts))
    .sort((left, right) =>
      String(left.startTime || '').localeCompare(String(right.startTime || ''))
      || String(left.endTime || '').localeCompare(String(right.endTime || ''))
      || String(left.id).localeCompare(String(right.id)))
}

/** Khung giờ của một đăng ký — thứ quyết định phiên ca, xem `leaderShiftWindowsInOrder`. */
function registrationWindowKey(registration: Pick<ShiftRegistration, 'startTime' | 'endTime'>) {
  return `${String(registration.startTime || '').slice(0, 5)}-${String(registration.endTime || '').slice(0, 5)}`
}

/**
 * Các KHUNG GIỜ ca trưởng của một ngày, xếp theo giờ vào ca. Ca 1 là khung sớm nhất,
 * Ca 2 là khung muộn nhất.
 *
 * Phiên ca phải bám KHUNG GIỜ, không bám vị trí của từng đăng ký: một khung giờ có thể
 * có nhiều hơn một ca trưởng (người kèm người mới, người trực bù, hai người cùng nhận
 * ca sáng). Bản cũ đếm theo vị trí bản ghi nên chỉ cần ngày đó có 3 đăng ký ca trưởng
 * là lệch hết — Lotte 23/10 ngày 08/08/2026: Võ Thảo Quyên và Nguyễn Thị Yến cùng đăng
 * ký 07:15–15:15, chị Yến chiếm vị trí 2 nên được gán "Ca 2", còn Nguyễn Bình Thảo
 * Nguyên (người đăng ký ĐÚNG ca tối 14:15–22:15) rơi xuống vị trí 3 ⇒ danh sách phiên
 * ca RỖNG ⇒ ca tối không bao giờ tự mở, mà màn Bàn giao cũng không hiện nút nào vì hệ
 * thống tưởng "đã có ca trưởng khác được xếp Ca 2".
 */
export function leaderShiftWindowsInOrder(
  workDate: string,
  branchId: string,
  registrations: ShiftRegistration[],
  workShifts: WorkShift[],
) {
  const windows: string[] = []
  for (const registration of leaderRegistrationsInOrder(workDate, branchId, registrations, workShifts)) {
    const key = registrationWindowKey(registration)
    if (!windows.includes(key)) windows.push(key)
  }
  return windows
}

/**
 * Phiên ca mà đăng ký này được đứng tên: `[1]`, `[2]`, hoặc `[1, 2]` khi cả ngày chỉ có
 * MỘT khung giờ ca trưởng (một người — hoặc một nhóm cùng khung — trực cả hai ca).
 * Khung giờ nằm giữa (ngày có từ 3 khung trở lên) không đứng tên ca nào: chi nhánh chỉ
 * có 2 phiên ca một ngày, và người kẹt vẫn còn nút "Nhận ca ngay" để tự nhận.
 */
export function operationalSequencesFor(
  registration: ShiftRegistration,
  registrations: ShiftRegistration[],
  workShifts: WorkShift[],
) {
  if (registration.status !== 'approved') return []
  if (!isLeaderRegistration(registration, workShifts)) return []
  const windows = leaderShiftWindowsInOrder(
    registration.workDate,
    registration.branchId,
    registrations,
    workShifts,
  )
  const index = windows.indexOf(registrationWindowKey(registration))
  if (index < 0) return []
  // Cả ngày chỉ một khung giờ ca trưởng ⇒ khung đó trực cả hai phiên ca.
  if (windows.length === 1) return [1, 2]
  if (index === 0) return [1]
  return index === windows.length - 1 ? [2] : []
}

/** Ca trưởng (không phải ca phó) được xếp đúng phiên ca này trong ngày. */
export function primaryLeadersScheduledFor(
  sequence: number,
  workDate: string,
  registrations: ShiftRegistration[],
  workShifts: WorkShift[],
) {
  return registrations.filter((registration) =>
    registration.workDate === workDate
    && operationalSequencesFor(registration, registrations, workShifts).includes(sequence))
}

/** Số thứ tự phiên ca kế tiếp của chi nhánh trong ngày (1 hoặc 2). */
export function nextOperationalSequence(sessions: BagShiftSession[]) {
  return sessions.length ? Math.max(...sessions.map((session) => session.sequence)) + 1 : 1
}

/** Phiên ca duy nhất của đăng ký này, hoặc `undefined` nếu người đó trực cả hai ca. */
export function scheduledOperationalSequence(
  registration: ShiftRegistration,
  registrations: ShiftRegistration[],
  workShifts: WorkShift[],
) {
  const sequences = operationalSequencesFor(registration, registrations, workShifts)
  return sequences.length === 1 ? sequences[0] : undefined
}

export function canOpenNextScheduledOperationalShift(
  registration: ShiftRegistration,
  sessions: BagShiftSession[],
  registrations: ShiftRegistration[],
  workShifts: WorkShift[],
) {
  if (registration.status !== 'approved') return false
  const assignedSequences = operationalSequencesFor(registration, registrations, workShifts)
  if (!assignedSequences.length) return false
  const existingSequences = sessions
    .filter((session) => session.branchId === registration.branchId && session.businessDate === registration.workDate)
    .map((session) => session.sequence)
  const nextSequence = existingSequences.length ? Math.max(...existingSequences) + 1 : 1
  return nextSequence <= 2 && assignedSequences.includes(nextSequence)
}

function registrationCoversShift(
  registration: Pick<ShiftRegistration, 'startTime' | 'endTime'>,
  shift: Pick<WorkShift, 'startTime' | 'endTime'>,
) {
  const registrationStart = minutesOfDay(registration.startTime)
  let registrationEnd = minutesOfDay(registration.endTime)
  let shiftStart = minutesOfDay(shift.startTime)
  let shiftEnd = minutesOfDay(shift.endTime)
  if (registrationEnd <= registrationStart) registrationEnd += 24 * 60
  if (shiftEnd <= shiftStart) shiftEnd += 24 * 60
  if (shiftStart < registrationStart && shiftEnd <= registrationEnd) {
    shiftStart += 24 * 60
    shiftEnd += 24 * 60
  }
  return registrationStart <= shiftStart && registrationEnd >= shiftEnd
}

function minutesOfDay(value: string) {
  const [hours = '0', minutes = '0'] = String(value || '').slice(0, 5).split(':')
  return Number(hours) * 60 + Number(minutes)
}
