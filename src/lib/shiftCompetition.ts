import type { BagShiftSession } from '../types'
import type { SalesReceipt } from './salesReceipts'
import { sessionScopeWindow, timestampInScopeWindow } from './shiftReportScope'

export interface ShiftLeaderRevenueRow {
  leaderKey: string
  leaderName: string
  branchId: string
  revenue: number
  soldQuantity: number
  receiptCount: number
  shiftCount: number
  achievedShiftCount: number
  targetRevenue: number
  progress: number
}

export interface ShiftLeaderReceiptSource {
  sessionId: string
  sessionSequence: number
  leaderKey: string
  leaderName: string
  branchId: string
  businessDate: string
  receipt: SalesReceipt
}

type ShiftCompetitionFilters = {
  branchIds: string[]
  from: string
  to: string
}

export function buildShiftLeaderReceiptSources(
  sessions: BagShiftSession[],
  receipts: SalesReceipt[],
  filters: ShiftCompetitionFilters,
): ShiftLeaderReceiptSource[] {
  return scopedSessionReceipts(sessions, receipts, filters).flatMap(({ session, receipts: shiftReceipts }) => {
    const leaderKey = session.leaderId || normalizeName(session.leaderName)
    return shiftReceipts.map((receipt) => ({
      sessionId: session.id,
      sessionSequence: session.sequence,
      leaderKey,
      leaderName: session.leaderName,
      branchId: session.branchId,
      businessDate: session.businessDate,
      receipt,
    }))
  })
}

export interface ShiftLeaderRecordedSource {
  receipt: SalesReceipt
  businessDate: string
  /** Phiên ca mà hóa đơn này thuộc về; rỗng khi ca trưởng bấm bill ở ca người khác. */
  sessionId: string
  sessionSequence: number
  /** Hóa đơn do CHÍNH ca trưởng bấm ở ca của người khác. */
  ownBillOutsideShift: boolean
}

export interface ShiftLeaderRecordedDay {
  date: string
  revenue: number
  soldQuantity: number
}

export interface ShiftLeaderRecordedRevenue {
  leaderKey: string
  leaderName: string
  branchId: string
  revenue: number
  soldQuantity: number
  receiptCount: number
  shiftCount: number
  /** Vỡ theo ngày — dùng để chấm KPI ngày khi chủ đã đặt chỉ tiêu cho ca trưởng. */
  days: ShiftLeaderRecordedDay[]
  /**
   * Đúng những hóa đơn đã cộng vào `revenue`. Bảng đối chiếu Excel PHẢI đọc từ đây,
   * không tự dò lại theo `seller_id` — dò lại là ra 0 nguồn và báo "Lệch" oan, vì
   * ca trưởng hiếm khi đứng tên hóa đơn nào.
   */
  sources: ShiftLeaderRecordedSource[]
}

/**
 * **Doanh thu GHI NHẬN cho ca trưởng = tổng các CA mình làm ca trưởng** (chủ quán
 * chốt 11/08/2026), cộng thêm hóa đơn chính mình bấm ở ca của người khác.
 *
 * Trước đó ca trưởng chỉ được ghi nhận hóa đơn tự tay bấm, mà ca trưởng thì đứng
 * quầy điều phối chứ hiếm khi bấm bill — tháng 7/2026 hai ca trưởng Vũng Tàu có
 * ĐÚNG 0 hóa đơn đứng tên. Vá tạm bằng luật "KPI đội" chỉ áp cho nửa đầu tháng 7,
 * nên nửa sau tháng doanh thu của họ về 0 và hạng khóa cứng ở D.
 *
 * Một hóa đơn KHÔNG bao giờ được cộng hai lần: hóa đơn ca trưởng tự bấm trong ca
 * của chính mình đã nằm trong tổng ca rồi. Vì vậy gom bằng tập id hóa đơn.
 *
 * Ranh giới ca lấy từ `sessionScopeWindow` (mốc đồng hồ 15:15) nên tổng các ca
 * trong ngày luôn bằng tổng ngày — không hở, không chồng.
 */
export function buildShiftLeaderRecordedRevenue(
  sessions: BagShiftSession[],
  receipts: SalesReceipt[],
  filters: ShiftCompetitionFilters,
): Map<string, ShiftLeaderRecordedRevenue> {
  const rows = new Map<string, ShiftLeaderRecordedRevenue>()
  const countedReceiptIds = new Map<string, Set<string>>()
  const leaderKeysByBranch = new Map<string, Map<string, string>>()

  const dayTotals = new Map<string, Map<string, ShiftLeaderRecordedDay>>()

  const rowFor = (branchId: string, leaderKey: string, leaderName: string) => {
    const key = `${branchId}|${leaderKey}`
    const current = rows.get(key) || {
      leaderKey,
      leaderName,
      branchId,
      revenue: 0,
      soldQuantity: 0,
      receiptCount: 0,
      shiftCount: 0,
      days: [],
      sources: [],
    }
    if (leaderName) current.leaderName = leaderName
    rows.set(key, current)
    if (!countedReceiptIds.has(key)) countedReceiptIds.set(key, new Set())
    if (!dayTotals.has(key)) dayTotals.set(key, new Map())
    return { key, current }
  }

  const addReceipt = (
    key: string,
    receipt: SalesReceipt,
    source: Omit<ShiftLeaderRecordedSource, 'receipt' | 'businessDate'>,
  ) => {
    const counted = countedReceiptIds.get(key)!
    if (counted.has(receipt.id)) return
    counted.add(receipt.id)
    const current = rows.get(key)!
    current.revenue += receipt.totalAmount
    current.soldQuantity += receipt.totalQuantity
    current.receiptCount += 1
    current.sources.push({ ...source, receipt, businessDate: receipt.businessDate })
    const days = dayTotals.get(key)!
    const day = days.get(receipt.businessDate) || { date: receipt.businessDate, revenue: 0, soldQuantity: 0 }
    day.revenue += receipt.totalAmount
    day.soldQuantity += receipt.totalQuantity
    days.set(receipt.businessDate, day)
  }

  scopedSessionReceipts(sessions, receipts, filters).forEach(({ session, receipts: shiftReceipts }) => {
    const leaderKey = session.leaderId || normalizeName(session.leaderName)
    if (!leaderKey) return
    const { key, current } = rowFor(session.branchId, leaderKey, session.leaderName)
    const branchLeaders = leaderKeysByBranch.get(session.branchId) || new Map<string, string>()
    branchLeaders.set(leaderKey, key)
    leaderKeysByBranch.set(session.branchId, branchLeaders)
    current.shiftCount += 1
    shiftReceipts.forEach((receipt) => addReceipt(key, receipt, {
      sessionId: session.id,
      sessionSequence: session.sequence,
      ownBillOutsideShift: false,
    }))
  })

  // Hóa đơn ca trưởng tự bấm ở ca của người khác vẫn là bán hàng của họ.
  const allowedBranches = new Set(filters.branchIds)
  receipts.forEach((receipt) => {
    if (!receipt.sellerId || !allowedBranches.has(receipt.branchId)) return
    if (receipt.businessDate < filters.from || receipt.businessDate > filters.to) return
    const key = leaderKeysByBranch.get(receipt.branchId)?.get(receipt.sellerId)
    if (!key) return
    addReceipt(key, receipt, { sessionId: '', sessionSequence: 0, ownBillOutsideShift: true })
  })

  rows.forEach((row, key) => {
    row.days = Array.from(dayTotals.get(key)?.values() || []).sort((a, b) => a.date.localeCompare(b.date))
    row.sources.sort((a, b) => b.receipt.createdAt.localeCompare(a.receipt.createdAt)
      || b.receipt.id.localeCompare(a.receipt.id))
  })
  return rows
}

export function buildShiftLeaderRevenueRows(
  sessions: BagShiftSession[],
  receipts: SalesReceipt[],
  filters: {
    branchIds: string[]
    from: string
    to: string
    targetForSession?: (session: BagShiftSession) => number
  },
): ShiftLeaderRevenueRow[] {
  const rows = new Map<string, ShiftLeaderRevenueRow>()
  scopedSessionReceipts(sessions, receipts, filters).forEach(({ session, receipts: shiftReceipts }) => {
    const leaderKey = session.leaderId || normalizeName(session.leaderName)
    const key = `${session.branchId}|${leaderKey}`
    const target = Math.max(0, filters.targetForSession?.(session) || 0)
    const shiftRevenue = shiftReceipts.reduce((sum, receipt) => sum + receipt.totalAmount, 0)
    const current = rows.get(key) || {
      leaderKey,
      leaderName: session.leaderName,
      branchId: session.branchId,
      revenue: 0,
      soldQuantity: 0,
      receiptCount: 0,
      shiftCount: 0,
      achievedShiftCount: 0,
      targetRevenue: 0,
      progress: 0,
    }
    current.leaderName = session.leaderName || current.leaderName
    current.revenue += shiftRevenue
    current.soldQuantity += shiftReceipts.reduce((sum, receipt) => sum + receipt.totalQuantity, 0)
    current.receiptCount += shiftReceipts.length
    current.shiftCount += 1
    current.targetRevenue += target
    current.achievedShiftCount += target > 0 && shiftRevenue >= target ? 1 : 0
    rows.set(key, current)
  })

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      progress: row.targetRevenue > 0 ? Math.min(200, row.revenue / row.targetRevenue * 100) : 0,
    }))
    .sort((a, b) =>
      b.revenue - a.revenue
      || b.achievedShiftCount - a.achievedShiftCount
      || b.soldQuantity - a.soldQuantity
      || a.leaderName.localeCompare(b.leaderName, 'vi'),
    )
}

function scopedSessionReceipts(
  sessions: BagShiftSession[],
  receipts: SalesReceipt[],
  filters: ShiftCompetitionFilters,
) {
  const allowedBranches = new Set(filters.branchIds)
  const scopedSessions = sessions
    .filter((session) =>
      allowedBranches.has(session.branchId)
      && session.businessDate >= filters.from
      && session.businessDate <= filters.to,
    )
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const receiptsByDay = new Map<string, SalesReceipt[]>()
  receipts.forEach((receipt) => {
    if (!allowedBranches.has(receipt.branchId)) return
    if (receipt.businessDate < filters.from || receipt.businessDate > filters.to) return
    const key = `${receipt.branchId}|${receipt.businessDate}`
    receiptsByDay.set(key, [...(receiptsByDay.get(key) || []), receipt])
  })

  return scopedSessions.map((session) => {
    // Vùng doanh thu không hở/không chồng (BUG-117): hóa đơn trước giờ mở ca đầu,
    // trong khoảng trống giữa hai ca hay sau giờ đóng ca cuối vẫn thuộc về một ca.
    const scopeWindow = sessionScopeWindow(session, scopedSessions)
    const shiftReceipts = (receiptsByDay.get(`${session.branchId}|${session.businessDate}`) || [])
      .filter((receipt) => timestampInScopeWindow(receipt.createdAt, scopeWindow))
    return { session, receipts: shiftReceipts }
  })
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}
