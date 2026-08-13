import { fetchAttendanceRecords, fetchShiftRegistrations, fetchWorkShifts } from './attendance'
import { getFinishedBulkProducts, getSaleProducts } from './constants'
import { localDateKey } from './dates'
import {
  canOpenNextScheduledOperationalShift,
  isDeputyShiftLeader,
  nextOperationalSequence,
  primaryLeadersScheduledFor,
  operationalSequencesFor,
} from './operationalShiftAssignment'
import {
  fetchBagShiftSessions,
  ownsBagShiftSession,
  startBagShift,
  transferBagShiftLeadership,
  uploadBagShiftPhoto,
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
  /** Ca phó: ca trưởng được xếp ca này mới là chủ ca tự động. */
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
  // Ca phó vận hành ngang ca trưởng (13/08/2026) nên cũng được bộ dò ca phục vụ.
  if (user.role !== 'shift_leader' && user.role !== 'shift_deputy') return skip('not-leader')
  const today = localDateKey()

  // Các phép kiểm tra rẻ tiền trước, để vòng lặp định kỳ hầu như không tốn gì.
  const sessions = await fetchBagShiftSessions(user, { branchId: user.branchId, date: today })
  // Ca đang mở thì THÔI — không ai bị giật ca khỏi tay nữa. Ai vào ca thì người
  // đó bấm nhận ca, và ca mang đúng tên người bấm. Nếu ca đang đứng nhầm tên,
  // xử lý bằng cách chốt & bàn giao (hoặc quản lý chỉnh), không bằng cách để
  // máy tự chuyển quyền sau lưng người đang đứng quầy.
  if (sessions.some((item) => item.status === 'open')) return skip('shift-already-open')
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
    && canOpenNextScheduledOperationalShift(item, sessions, registrations, workShifts),
  )
  if (!registration) return skip('not-scheduled')

  await ensureOperationDay(user, today)
  const session = await startBagShift(user, today, await buildOpeningBalances(user))
  return { status: 'opened', sequence: session.sequence }
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
    return ownsBagShiftSession(openSession, user)
      ? ' Ca vận hành của bạn đang mở.'
      : ` Ca ${openSession.sequence} đang do ${openSession.leaderName} phụ trách.`
  }
  if (sessions.length >= 2) return ' Hôm nay đã đủ 2 ca vận hành.'
  // Phải có CẢ danh sách đăng ký của ngày: phiên ca được xếp theo thứ tự vào ca của
  // các ca trưởng trong ngày, không suy từ riêng đăng ký của một người.
  const [workShifts, registrations] = await Promise.all([
    fetchWorkShifts(user),
    fetchShiftRegistrations(user, {
      branchId: user.branchId,
      from: registration.workDate,
      to: registration.workDate,
    }),
  ])
  if (!canOpenNextScheduledOperationalShift(registration, sessions, registrations, workShifts)) {
    const nextSequence = nextOperationalSequence(sessions)
    return nextSequence === 2
      ? ' Đã check-in Ca 1, nhưng chỉ ca trưởng có lịch Ca 2 mới được tự nhận Ca 2.'
      : ' Đã check-in, đang chờ ca trưởng được xếp Ca 1 tự mở ca vận hành.'
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

export interface ShiftClaimOptions {
  /** Tồn đầu ca do màn Bàn giao đếm sẵn. Bỏ trống thì đọc lại từ kho thật. */
  openingBalances?: Record<string, number>
  /** Ảnh quầy đầu ca đã chụp trước khi bấm nhận ca (data URL). */
  openingPhoto?: string
}

export interface ShiftClaimResult {
  session: BagShiftSession
  /** Ca này có đúng lịch của người vừa nhận hay không. */
  scheduled: boolean
  /** Ca trưởng được xếp ca này theo lịch, nếu là người khác. */
  scheduledLeaderNames: string[]
  /** Người nhận là ca phó đứng thay ca trưởng. */
  standIn: boolean
}

/**
 * **Nhận ca bằng tay — lối thoát cuối cùng.**
 *
 * Bộ dò ca chỉ mở ca cho người ĐÚNG lịch, nên mỗi lần lịch bị xếp lệch là cả chi nhánh
 * đứng hình: không ai mở được ca ⇒ không chụp được ảnh quầy, không phát túi, không bán,
 * không bàn giao, không chốt ngày. Đã xảy ra nhiều lần với nhiều nguyên nhân khác nhau
 * (cấu hình ca có rác, ba đăng ký ca trưởng trong ngày, mạng rớt lúc check-in).
 *
 * Hàm này cho người ĐANG TRONG CA nhận ca kể cả khi lịch không xếp họ, nhưng không phải
 * cửa sau: vẫn bắt buộc có ca đã duyệt hôm nay + đang check-in (chưa check-out), vẫn
 * chặn khi chi nhánh còn ca chưa bàn giao / đã đủ 2 ca / ngày đã chốt, và mọi lần nhận
 * ngoài lịch đều ghi dấu vào sổ ca cho quản lý rà soát.
 *
 * 13/08/2026: ca mang tên NGƯỜI BẤM và giữ nguyên như vậy. Không còn cơ chế nào
 * tự trả quyền chủ ca cho người khác — ca trưởng và ca phó ngang quyền.
 */
export async function claimOperationalShift(
  user: AppUser,
  options: ShiftClaimOptions = {},
): Promise<ShiftClaimResult> {
  if (!['shift_leader', 'shift_deputy'].includes(user.role)) {
    throw new Error('Chỉ ca trưởng hoặc ca phó mới nhận được ca vận hành.')
  }
  const today = localDateKey()
  const sessions = await fetchBagShiftSessions(user, { branchId: user.branchId, date: today })
  const openSession = sessions.find((item) => item.status === 'open')
  if (openSession) {
    if (ownsBagShiftSession(openSession, user)) {
      return { session: openSession, scheduled: true, scheduledLeaderNames: [], standIn: false }
    }
    throw new Error(
      `Ca ${openSession.sequence} đang do ${openSession.leaderName} phụ trách.`
      + ' Ca đó phải chốt & bàn giao xong thì mới nhận được ca tiếp theo.',
    )
  }
  if (sessions.length >= 2) throw new Error('Hôm nay đã đủ 2 ca vận hành. Không thể nhận thêm ca mới.')

  const day = await getOperationDay(user.branchId, today, user).catch(() => null)
  if (day?.status === 'closed') {
    throw new Error('Ngày vận hành đã chốt. Hãy nhờ quản lý mở lại ngày trước khi nhận ca.')
  }

  const [registrations, attendance, workShifts] = await Promise.all([
    fetchShiftRegistrations(user, { branchId: user.branchId, from: today, to: today }),
    fetchAttendanceRecords(user, { branchId: user.branchId, userId: user.id, from: today, to: today }),
    fetchWorkShifts(user),
  ])
  const openAttendances = attendance.filter((record) => !record.checkOutTime)
  if (!openAttendances.length) {
    throw new Error(attendance.length
      ? 'Bạn đã check-out ca hôm nay nên không nhận được ca vận hành. Hãy check-in lại trong Chấm công.'
      : 'Bạn chưa check-in hôm nay. Hãy vào Chấm công check-in rồi bấm nhận ca lại.')
  }
  const registration = registrations.find((item) =>
    item.userId === user.id
    && item.workDate === today
    && item.status === 'approved'
    && openAttendances.some((record) => record.shiftRegistrationId === item.id),
  )
  if (!registration) {
    throw new Error('Lần check-in hiện tại chưa gắn với ca làm đã duyệt nào của hôm nay.'
      + ' Hãy kiểm tra lịch ca trong Chấm công rồi thử lại.')
  }

  const sequence = nextOperationalSequence(sessions)
  const scheduled = operationalSequencesFor(registration, registrations, workShifts).includes(sequence)
  const scheduledLeaderNames = primaryLeadersScheduledFor(sequence, today, registrations, workShifts)
    .filter((item) => item.userId !== user.id)
    .map((item) => item.userName)
  // Không còn khái niệm "ca phó đứng thay": hai vai trò ngang nhau, ai bấm thì
  // ca mang tên người đó. Giữ trường này để các màn cũ không phải đổi kiểu.
  const standIn = false

  await ensureOperationDay(user, today)
  const openingBalances = options.openingBalances || await buildOpeningBalances(user)
  let session = await startBagShift(user, today, openingBalances, {
    note: scheduled ? undefined : offScheduleClaimNote(user, sequence, scheduledLeaderNames),
  })
  if (options.openingPhoto && !session.openingPhotoUrl) {
    session = await uploadBagShiftPhoto(user, session, 'opening', options.openingPhoto).catch(() => session)
  }
  return { session, scheduled, scheduledLeaderNames, standIn }
}

/** Mọi lần nhận ca ngoài lịch đều phải đọc được trong sổ ca, không im lặng. */
function offScheduleClaimNote(user: AppUser, sequence: number, scheduledLeaderNames: string[]) {
  const stamp = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  const names = scheduledLeaderNames.join(', ')
  return `[NHẬN CA THỦ CÔNG] ${user.name} nhận Ca ${sequence} lúc ${stamp} `
    + (names ? `(lịch hôm nay xếp ${names}).` : '(lịch hôm nay không xếp ai cho ca này).')
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
