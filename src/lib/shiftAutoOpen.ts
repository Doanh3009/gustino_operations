import { fetchAttendanceRecords, fetchShiftRegistrations, fetchWorkShifts } from './attendance'
import { getFinishedBulkProducts, getSaleProducts } from './constants'
import { localDateKey } from './dates'
import {
  canOpenNextScheduledOperationalShift,
  isDeputyShiftLeader,
  nextOperationalSequence,
  primaryLeadersScheduledFor,
  scheduledOperationalSequences,
} from './operationalShiftAssignment'
import {
  fetchBagShiftSessions,
  ownsBagShiftSession,
  startBagShift,
  transferBagShiftLeadership,
} from './shiftLedger'
import { calculateStock, ensureOperationDay, fetchMovements, getOperationDay } from './store'
import { supabase } from './supabase'
import type { AppUser, BagShiftSession, ShiftRegistration, WorkShift } from '../types'

/**
 * Vì sao cần "bộ dò ca":
 * Trước đây ca vận hành chỉ được mở ở 2 chỗ — lúc check-in (Chấm công) và một
 * effect trong màn Bàn giao. Ca trưởng check-in bằng điện thoại ngoài quầy, mạng
 * chập chờn làm `startBagShift()` ném lỗi, và vì đã check-in rồi nên không thể
 * check-in lại để thử lần nữa. Nếu ca trưởng không mở đúng màn Bàn giao thì ca
 * không bao giờ mở → cả ngày không bán, không bàn giao, không chốt được
 * (đúng tình huống Lotte Vũng Tàu 23/07: ngày vận hành đã mở lúc 07:14 nhưng
 * không có phiên ca nào).
 *
 * Hàm này chạy được từ bất kỳ đâu trong app và **idempotent**: mọi điều kiện đều
 * đọc lại từ máy chủ, nên gọi lặp lại vẫn an toàn.
 */
export type ShiftAutoOpenResult =
  | { status: 'opened'; sequence: number }
  | { status: 'reassigned'; sequence: number }
  | { status: 'skipped'; reason: ShiftAutoOpenSkip }

export type ShiftAutoOpenSkip =
  | 'not-leader'
  | 'shift-already-open'
  | 'day-complete'
  | 'day-closed'
  | 'not-checked-in'
  | 'not-scheduled'
  /** Ca phó: ca trưởng được xếp ca này mới là chủ ca. */
  | 'deputy-not-owner'

function skip(reason: ShiftAutoOpenSkip): ShiftAutoOpenResult {
  return { status: 'skipped', reason }
}

/**
 * Tồn đầu ca phải lấy từ kho THẬT, không thể tin danh sách movement mà trang gọi
 * đang giữ: trang Bán hàng không tải movement nên sẽ ghi tồn đầu ca = 0.
 */
async function buildOpeningBalances(user: AppUser) {
  const movements = await fetchMovements(user.branchId, user)
  const finishedProducts = getFinishedBulkProducts()
  const products = finishedProducts.length ? finishedProducts : getSaleProducts()
  const stock = calculateStock(movements.filter((item) => item.branchId === user.branchId))
  return Object.fromEntries(products.map((product) => [
    product.id,
    Math.max(0, stock.find((line) => line.product.id === product.id)?.expected || 0),
  ]))
}

/**
 * Mở ca vận hành kế tiếp nếu ca trưởng đang đăng nhập đủ điều kiện.
 * Giữ nguyên quy tắc BUG-100/BUG-101: phải có đăng ký đã duyệt khớp đúng
 * sequence kế tiếp VÀ đang check-in cho chính đăng ký đó.
 */
export async function reconcileOperationalShift(user: AppUser): Promise<ShiftAutoOpenResult> {
  if (user.role !== 'shift_leader') return skip('not-leader')
  const today = localDateKey()

  // Các phép kiểm tra rẻ tiền trước, để vòng lặp định kỳ hầu như không tốn gì.
  const sessions = await fetchBagShiftSessions(user, { branchId: user.branchId, date: today })
  const openSession = sessions.find((item) => item.status === 'open')
  if (openSession) return reclaimShiftForPrimaryLeader(user, openSession, today)
  if (sessions.length >= 2) return skip('day-complete')

  const day = await getOperationDay(user.branchId, today, user).catch(() => null)
  if (day?.status === 'closed') return skip('day-closed')

  const [registrations, attendance, workShifts] = await Promise.all([
    fetchShiftRegistrations(user, { branchId: user.branchId, from: today, to: today }),
    fetchAttendanceRecords(user, { branchId: user.branchId, userId: user.id, from: today, to: today }),
    fetchWorkShifts(user),
  ])
  const openAttendances = attendance.filter((record) => !record.checkOutTime)
  if (!openAttendances.length) return skip('not-checked-in')

  const registration = registrations.find((item) =>
    item.userId === user.id
    && item.workDate === today
    && item.status === 'approved'
    && openAttendances.some((record) => record.shiftRegistrationId === item.id)
    && canOpenNextScheduledOperationalShift(item, sessions, workShifts),
  )
  if (!registration) return skip('not-scheduled')

  // Ca phó không bao giờ TỰ ĐỘNG thành chủ ca khi đã có ca trưởng được xếp
  // phiên ca này — kể cả khi check-in trước. Muốn mở thay (ca trưởng vắng) thì
  // phải bấm tay ở màn Bàn giao, có xác nhận và ghi rõ vào ghi chú ca.
  const sequence = nextOperationalSequence(sessions)
  if (blockedAsDeputy(user, sequence, today, registrations, workShifts)) return skip('deputy-not-owner')

  await ensureOperationDay(user, today)
  const session = await startBagShift(user, today, await buildOpeningBalances(user))
  return { status: 'opened', sequence: session.sequence }
}

/** Có ca trưởng khác được xếp phiên ca này, còn người đang đăng nhập là ca phó. */
function blockedAsDeputy(
  user: AppUser,
  sequence: number,
  workDate: string,
  registrations: ShiftRegistration[],
  workShifts: WorkShift[],
) {
  if (!isDeputyShiftLeader(user)) return false
  return primaryLeadersScheduledFor(sequence, workDate, registrations, workShifts)
    .some((item) => item.userId !== user.id)
}

/**
 * Ca đang mở nhưng người giữ ca KHÔNG phải chủ ca của chính phiên ca đó: trả quyền
 * về ca trưởng được xếp đúng phiên ca và đang trong ca. Chạy được từ vòng dò ca lẫn
 * từ check-in, nên ca trưởng check-in muộn vài giây vẫn nhận lại đúng ca của mình.
 *
 * 07/08/2026 — mở rộng khỏi "chỉ giành lại từ ca phó". Gold Coast 07/08: Ca 2 bị mở
 * dưới tên Trần Minh Lý (ca trưởng CA 1, lịch chỉ có sequence 1) lúc 15:19. Trương
 * Thị Phương mới là ca trưởng được xếp Ca 2, nhưng vì người giữ ca cũng là "ca
 * trưởng" nên bản cũ bỏ qua ⇒ chị Phương KHÔNG bao giờ nhận được ca: màn Bàn giao
 * báo "Chưa nhận ca" và không hiện nút chốt, ca treo tới nửa đêm.
 *
 * Luật mới: chỉ bỏ qua khi người giữ ca thực sự được xếp ĐÚNG phiên ca này. Ca 1
 * chưa bàn giao vẫn tuyệt đối không bị chiếm — người giữ có lịch sequence 1 nên
 * đúng chủ ca. Người giữ không có lịch hôm nay cũng là giữ nhầm.
 */
async function reclaimShiftForPrimaryLeader(
  user: AppUser,
  session: BagShiftSession,
  workDate: string,
): Promise<ShiftAutoOpenResult> {
  if (ownsBagShiftSession(session, user)) return skip('shift-already-open')
  if (isDeputyShiftLeader(user)) return skip('deputy-not-owner')

  const [registrations, attendance, workShifts] = await Promise.all([
    fetchShiftRegistrations(user, { branchId: user.branchId, from: workDate, to: workDate }),
    fetchAttendanceRecords(user, { branchId: user.branchId, userId: user.id, from: workDate, to: workDate }),
    fetchWorkShifts(user),
  ])
  // Chỉ bỏ qua khi người đang giữ ca ĐÚNG là chủ ca của phiên ca này: ca trưởng
  // (không phải ca phó) và có lịch đúng sequence đó. Mọi trường hợp còn lại —
  // ca phó mở hộ, ca trưởng ca khác giữ nhầm, người không có lịch hôm nay — đều
  // là giữ nhầm và phải trả về đúng người.
  const holder = registrations.find((item) => item.userId === session.leaderId && item.workDate === workDate)
  const holderOwnsThisSequence = Boolean(holder)
    && !isDeputyShiftLeader(holder)
    && scheduledOperationalSequences(holder!, workShifts).includes(session.sequence)
  if (holderOwnsThisSequence) return skip('shift-already-open')

  const openAttendances = attendance.filter((record) => !record.checkOutTime)
  const registration = registrations.find((item) =>
    item.userId === user.id
    && item.workDate === workDate
    && item.status === 'approved'
    && openAttendances.some((record) => record.shiftRegistrationId === item.id)
    && scheduledOperationalSequences(item, workShifts).includes(session.sequence),
  )
  if (!registration) return skip('shift-already-open')

  const stamp = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  const holderRole = holder && isDeputyShiftLeader(holder) ? 'ca phó' : 'không có lịch ca này'
  await transferBagShiftLeadership(
    user,
    session,
    `${session.leaderName} (${holderRole}) mở ca; ${user.name} (ca trưởng được xếp Ca ${session.sequence}) nhận quyền chủ ca lúc ${stamp}.`,
  )
  return { status: 'reassigned', sequence: session.sequence }
}

/**
 * Đường mở ca ngay sau khi check-in. Dùng chung phần tính tồn đầu ca với bộ dò
 * ca, nhưng bám đúng đăng ký vừa được check-in thay vì đi tìm lại.
 */
export async function openShiftAfterLeaderCheckIn(
  user: AppUser,
  registration: ShiftRegistration,
): Promise<string> {
  const sessions = await fetchBagShiftSessions(user, { branchId: user.branchId, date: registration.workDate })
  const openSession = sessions.find((item) => item.status === 'open')
  if (openSession) {
    // Ca phó check-in sớm hơn ca trưởng vài giây là chuyện thường ngày. Ca
    // trưởng vừa check-in thì nhận lại quyền chủ ca ngay, không phải chờ vòng dò.
    const result = await reclaimShiftForPrimaryLeader(user, openSession, registration.workDate)
      .catch(() => skip('shift-already-open'))
    return result.status === 'reassigned'
      ? ` Ca ${result.sequence} đang do ca phó mở; bạn là ca trưởng của ca này nên đã nhận lại quyền chủ ca.`
      : ' Ca vận hành đang mở.'
  }
  if (sessions.length >= 2) return ' Hôm nay đã đủ 2 ca vận hành.'
  const workShifts = await fetchWorkShifts(user)
  if (!canOpenNextScheduledOperationalShift(registration, sessions, workShifts)) {
    const nextSequence = nextOperationalSequence(sessions)
    return nextSequence === 2
      ? ' Đã check-in Ca 1, nhưng chỉ ca trưởng có lịch Ca 2 mới được tự nhận Ca 2.'
      : ' Đã check-in, đang chờ ca trưởng được xếp Ca 1 tự mở ca vận hành.'
  }
  if (isDeputyShiftLeader(user)) {
    const registrations = await fetchShiftRegistrations(user, {
      branchId: user.branchId,
      from: registration.workDate,
      to: registration.workDate,
    })
    const sequence = nextOperationalSequence(sessions)
    const primaryLeaders = primaryLeadersScheduledFor(sequence, registration.workDate, registrations, workShifts)
      .filter((item) => item.userId !== user.id)
    if (primaryLeaders.length) {
      const names = primaryLeaders.map((item) => item.userName).join(', ')
      return ` Bạn là ca phó nên không đứng tên chủ ca; ${names} (ca trưởng) sẽ mở Ca ${sequence}.`
        + ' Bạn vẫn nhập kho, chế biến và bán hàng bình thường.'
        + ' Nếu ca trưởng vắng, vào mục Bàn giao để mở ca thay.'
    }
  }
  await ensureOperationDay(user, registration.workDate)
  try {
    const session = await startBagShift(user, registration.workDate, await buildOpeningBalances(user))
    return ` Ca ${session.sequence} đã tự mở; hãy chụp ảnh quầy đầu ca ở trang Hôm nay.`
  } catch (error) {
    const latest = await fetchBagShiftSessions(user, { branchId: user.branchId, date: registration.workDate })
    if (latest.some((item) => item.status === 'open')) return ' Ca vận hành đã tự mở.'
    throw error
  }
}

/** Ca vận hành do CHÍNH ca trưởng này đang giữ và chưa bàn giao. */
export async function findOwnOpenShift(user: AppUser): Promise<BagShiftSession | undefined> {
  const today = localDateKey()
  const sessions = await fetchBagShiftSessions(user, { branchId: user.branchId, date: today })
  return sessions.find((item) => item.status === 'open' && ownsBagShiftSession(item, user))
}

/**
 * Ca trưởng cố tình check-out khi ca chưa bàn giao (sự cố thật). Chỉ ghi CHÚ
 * THÍCH lên phiên ca để quản lý rà soát — không đổi trạng thái, không ghi tồn
 * cuối ca. Ca vẫn mở để người kế tiếp hoặc quản lý chốt bằng số đếm thật.
 */
export async function markShiftLeftWithoutHandover(user: AppUser): Promise<boolean> {
  const session = await findOwnOpenShift(user)
  if (!session || !supabase) return false
  const stamp = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  const marker = `[CHƯA KIỂM ĐẾM] ${user.name} check-out lúc ${stamp} khi Ca ${session.sequence} chưa bàn giao.`
  const existing = String(session.discrepancyNote || '').trim()
  if (existing.includes('[CHƯA KIỂM ĐẾM]')) return true
  const { error } = await supabase
    .from('bag_shift_sessions')
    .update({ discrepancy_note: existing ? `${existing}\n${marker}` : marker })
    .eq('id', session.id)
    .eq('status', 'open')
  return !error
}
