import { productSaleValues, soldBagQuantity } from './commission'
import type { SalesReceipt } from './salesReceipts'
import type { BagAllocation, ReportSnapshot, StockMovement } from '../types'

export interface DailyRevenueRow {
  id: string
  branchId: string
  reportDate: string
  revenue: number
  totalSold: number
  salesRate?: number
  kpi?: number
  grade?: string
  leader?: string
  source: 'report' | 'live'
  createdAt: string
  hasRevenueSummary?: boolean
}

export function buildDailyRevenueRows(
  snapshots: ReportSnapshot[],
  allocations: BagAllocation[],
  movements: StockMovement[],
  options: {
    branchId?: string
    from?: string
    to?: string
    receipts?: SalesReceipt[]
  } = {},
) {
  const snapshotRows = latestSnapshotRows(snapshots, options)
  // A partial/legacy snapshot can exist before its summary is populated. It must
  // not hide authoritative POS receipts for the same branch/day.
  const snapshotKeys = new Set(snapshotRows
    .filter((row) => row.hasRevenueSummary)
    .map((row) => `${row.branchId}|${row.reportDate}`))
  const receiptRows = liveReceiptRows(options.receipts || [], options)
    .filter((row) => !snapshotKeys.has(`${row.branchId}|${row.reportDate}`))
  // A report is a point-in-time statement. POS receipts written after that
  // statement are authoritative live revenue until the day is re-finalized.
  // Keeping the snapshot baseline and adding only the later receipts avoids
  // double counting receipts that the saved report already includes.
  const postSnapshotReceiptRows = liveReceiptRowsAfterSnapshots(
    options.receipts || [],
    snapshotRows.filter((row) => row.hasRevenueSummary),
    options,
  )
  const postSnapshotReceiptsByKey = new Map(
    postSnapshotReceiptRows.map((row) => [`${row.branchId}|${row.reportDate}`, row]),
  )
  const reconciledSnapshotRows = snapshotRows.map((row) => {
    const liveDelta = postSnapshotReceiptsByKey.get(`${row.branchId}|${row.reportDate}`)
    if (!liveDelta) return row
    return {
      ...row,
      revenue: row.revenue + liveDelta.revenue,
      totalSold: row.totalSold + liveDelta.totalSold,
      createdAt: liveDelta.createdAt > row.createdAt ? liveDelta.createdAt : row.createdAt,
    }
  })
  const receiptRowKeys = new Set(receiptRows.map((row) => `${row.branchId}|${row.reportDate}`))
  const displayedSnapshotRows = reconciledSnapshotRows.filter((row) =>
    row.hasRevenueSummary || !receiptRowKeys.has(`${row.branchId}|${row.reportDate}`),
  )
  const receiptKeys = new Set([...snapshotKeys, ...receiptRows.map((row) => `${row.branchId}|${row.reportDate}`)])
  const liveRows = liveAllocationRows(allocations, options)
    .filter((row) => !receiptKeys.has(`${row.branchId}|${row.reportDate}`))
  const liveKeys = new Set([...receiptKeys, ...liveRows.map((row) => `${row.branchId}|${row.reportDate}`)])
  const movementRows = liveMovementRows(movements, options)
    .filter((row) => !liveKeys.has(`${row.branchId}|${row.reportDate}`))

  return [...displayedSnapshotRows, ...receiptRows, ...liveRows, ...movementRows]
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.createdAt.localeCompare(a.createdAt))
}

function latestSnapshotRows(
  snapshots: ReportSnapshot[],
  options: { branchId?: string; from?: string; to?: string },
): DailyRevenueRow[] {
  const sorted = snapshots
    .filter((snap) => inScope(snap.branchId, snap.reportDate, options))
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.createdAt.localeCompare(a.createdAt))
  const latestByDay = new Map<string, ReportSnapshot>()
  sorted.forEach((snap) => {
    const key = `${snap.branchId}|${snap.reportDate}`
    if (!latestByDay.has(key)) latestByDay.set(key, snap)
  })
  return Array.from(latestByDay.values()).map((snap) => ({
    id: snap.id,
    branchId: snap.branchId,
    reportDate: snap.reportDate,
    revenue: snap.payload.summary?.revenue || 0,
    totalSold: snap.payload.summary?.totalSold || 0,
    salesRate: snap.payload.summary?.salesRate,
    kpi: snap.payload.summary?.kpi,
    grade: snap.payload.summary?.grade,
    leader: snap.payload.summary?.leader,
    source: 'report' as const,
    createdAt: snap.createdAt,
    hasRevenueSummary: typeof snap.payload.summary?.revenue === 'number',
  }))
}

function liveReceiptRows(
  receipts: SalesReceipt[],
  options: { branchId?: string; from?: string; to?: string },
): DailyRevenueRow[] {
  const rows = new Map<string, DailyRevenueRow>()
  receipts.forEach((receipt) => {
    if (!inScope(receipt.branchId, receipt.businessDate, options)) return
    const key = `${receipt.branchId}|${receipt.businessDate}`
    const current = rows.get(key) || {
      id: `receipt-${key}`,
      branchId: receipt.branchId,
      reportDate: receipt.businessDate,
      revenue: 0,
      totalSold: 0,
      source: 'live' as const,
      createdAt: receipt.createdAt,
    }
    current.revenue += receipt.totalAmount
    current.totalSold += receipt.totalQuantity
    if (receipt.createdAt > current.createdAt) current.createdAt = receipt.createdAt
    rows.set(key, current)
  })
  return Array.from(rows.values())
}

function liveReceiptRowsAfterSnapshots(
  receipts: SalesReceipt[],
  snapshots: DailyRevenueRow[],
  options: { branchId?: string; from?: string; to?: string },
) {
  const snapshotCreatedAt = new Map(
    snapshots.map((row) => [`${row.branchId}|${row.reportDate}`, row.createdAt]),
  )
  return liveReceiptRows(receipts.filter((receipt) => {
    const createdAt = snapshotCreatedAt.get(`${receipt.branchId}|${receipt.businessDate}`)
    return Boolean(createdAt && receipt.createdAt > createdAt)
  }), options)
}

function liveAllocationRows(
  allocations: BagAllocation[],
  options: { branchId?: string; from?: string; to?: string },
): DailyRevenueRow[] {
  const rows = new Map<string, DailyRevenueRow & { issued: number }>()
  allocations.forEach((allocation) => {
    const reportDate = allocation.businessDate || allocation.settledAt?.slice(0, 10) || allocation.issuedAt.slice(0, 10)
    if (!inScope(allocation.branchId, reportDate, options)) return
    const sold = soldBagQuantity(allocation)
    if (sold <= 0) return
    const key = `${allocation.branchId}|${reportDate}`
    const current = rows.get(key) || {
      id: `live-${key}`,
      branchId: allocation.branchId,
      reportDate,
      revenue: 0,
      totalSold: 0,
      source: 'live' as const,
      createdAt: allocation.settledAt || allocation.issuedAt,
      issued: 0,
    }
    const values = productSaleValues(allocation.productId, sold)
    current.revenue += values.revenue
    current.totalSold += sold
    current.issued += allocation.issuedQuantity
    current.salesRate = current.issued ? Math.round(current.totalSold / current.issued * 100) : 0
    if ((allocation.settledAt || allocation.issuedAt) > current.createdAt) current.createdAt = allocation.settledAt || allocation.issuedAt
    rows.set(key, current)
  })
  return Array.from(rows.values()).map(({ issued: _issued, ...row }) => row)
}

function liveMovementRows(
  movements: StockMovement[],
  options: { branchId?: string; from?: string; to?: string },
): DailyRevenueRow[] {
  const rows = new Map<string, DailyRevenueRow>()
  movements.filter((item) => item.type === 'sale_out').forEach((movement) => {
    if (!inScope(movement.branchId, movement.shiftDate, options)) return
    const key = `${movement.branchId}|${movement.shiftDate}`
    const current = rows.get(key) || {
      id: `movement-${key}`,
      branchId: movement.branchId,
      reportDate: movement.shiftDate,
      revenue: 0,
      totalSold: 0,
      source: 'live' as const,
      createdAt: movement.createdAt,
    }
    const values = productSaleValues(movement.productId, movement.quantity)
    current.revenue += values.revenue
    current.totalSold += movement.quantity
    if (movement.createdAt > current.createdAt) current.createdAt = movement.createdAt
    rows.set(key, current)
  })
  return Array.from(rows.values())
}

function inScope(
  branchId: string,
  reportDate: string,
  options: { branchId?: string; from?: string; to?: string },
) {
  return (!options.branchId || branchId === options.branchId)
    && (!options.from || reportDate >= options.from)
    && (!options.to || reportDate <= options.to)
}
