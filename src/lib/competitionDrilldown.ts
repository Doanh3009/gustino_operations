import { productSaleValues, soldBagQuantity } from './commission'
import type { SalesReceipt, SalesReceiptLine } from './salesReceipts'
import type { BagAllocation } from '../types'

export type EmployeeCompetitionRevenueSource =
  | {
      kind: 'allocation'
      id: string
      businessDate: string
      createdAt: string
      soldQuantity: number
      revenue: number
      allocation: BagAllocation
    }
  | {
      kind: 'receipt'
      id: string
      businessDate: string
      createdAt: string
      soldQuantity: number
      revenue: number
      receipt: SalesReceipt
      directLines: SalesReceiptLine[]
    }

export function buildEmployeeCompetitionRevenueSources(
  allocations: BagAllocation[],
  receipts: SalesReceipt[],
  filters: {
    branchId: string
    employeeId: string
    employeeName: string
    from: string
    to: string
  },
): EmployeeCompetitionRevenueSource[] {
  const allocationSources: EmployeeCompetitionRevenueSource[] = allocations.flatMap((allocation) => {
    const businessDate = allocationDate(allocation)
    if (
      allocation.branchId !== filters.branchId
      || businessDate < filters.from
      || businessDate > filters.to
      || !matchesEmployee(allocation.employeeId, allocation.employeeName, filters.employeeId, filters.employeeName)
    ) return []
    const soldQuantity = soldBagQuantity(allocation)
    if (soldQuantity <= 0) return []
    return [{
      kind: 'allocation' as const,
      id: allocation.id,
      businessDate,
      createdAt: allocation.settledAt || allocation.issuedAt,
      soldQuantity,
      revenue: productSaleValues(allocation.productId, soldQuantity).revenue,
      allocation,
    }]
  })

  const receiptSources: EmployeeCompetitionRevenueSource[] = receipts.flatMap((receipt) => {
    if (
      receipt.branchId !== filters.branchId
      || receipt.businessDate < filters.from
      || receipt.businessDate > filters.to
      || !matchesEmployee(receipt.sellerId, receipt.sellerName, filters.employeeId, filters.employeeName)
    ) return []
    // Các dòng đã có allocationId đã được tính từ phiếu giao túi; chỉ lấy dòng bán trực tiếp
    // để drill-down đối chiếu đúng với buildCommissionRows và không cộng doanh thu hai lần.
    const directLines = receipt.lines.filter((line) => !line.allocationId)
    if (!directLines.length) return []
    return [{
      kind: 'receipt' as const,
      id: receipt.id,
      businessDate: receipt.businessDate,
      createdAt: receipt.createdAt,
      soldQuantity: directLines.reduce((sum, line) => sum + line.quantity, 0),
      revenue: directLines.reduce((sum, line) => sum + line.total, 0),
      receipt,
      directLines,
    }]
  })

  return [...allocationSources, ...receiptSources]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

function matchesEmployee(
  sourceEmployeeId: string | undefined,
  sourceEmployeeName: string,
  employeeId: string,
  employeeName: string,
) {
  if (sourceEmployeeId) return sourceEmployeeId === employeeId
  return normalizeName(sourceEmployeeName) === normalizeName(employeeName)
}

function allocationDate(allocation: BagAllocation) {
  return allocation.businessDate || allocation.settledAt?.slice(0, 10) || allocation.issuedAt.slice(0, 10)
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}
