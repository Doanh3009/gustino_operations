import type { BagShiftSession } from '../types'
import type { SalesReceipt } from './salesReceipts'

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

  const rows = new Map<string, ShiftLeaderRevenueRow>()
  scopedSessions.forEach((session, sessionIndex) => {
    const nextSession = scopedSessions.slice(sessionIndex + 1).find((candidate) =>
      candidate.branchId === session.branchId
      && candidate.businessDate === session.businessDate
      && candidate.startedAt > session.startedAt,
    )
    const startedAt = Date.parse(session.startedAt)
    const endedAt = session.endedAt
      ? Date.parse(session.endedAt) + 1
      : nextSession ? Date.parse(nextSession.startedAt) : Number.POSITIVE_INFINITY
    const shiftReceipts = (receiptsByDay.get(`${session.branchId}|${session.businessDate}`) || [])
      .filter((receipt) => {
        const createdAt = Date.parse(receipt.createdAt)
        return Number.isFinite(createdAt) && createdAt >= startedAt && createdAt < endedAt
      })
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

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}
