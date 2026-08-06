/**
 * Khả năng bán trung bình của một nhân viên.
 *
 * Bảng thi đua xếp theo TỔNG doanh thu nên người làm nhiều ca luôn đứng trên,
 * kể cả khi mỗi ca họ bán ít hơn người khác. Module này chia tổng cho mẫu số
 * công sức (số ca có check-in / giờ công thực tế) để so sánh đúng "khả năng bán
 * được của một người trong một ca".
 *
 * Hàm thuần, không React, không gọi mạng — mọi số liệu vào từ bảng thi đua đã
 * lọc sẵn (vai trò, loại ngày, khoảng số ca) nên danh sách này luôn cùng phạm vi
 * với bảng xếp hạng đang xem.
 */

export type SalesCapacityMetric = 'revenuePerShift' | 'quantityPerShift' | 'revenuePerHour'

export interface SalesCapacityInput {
  employeeKey: string
  employeeName: string
  branchId: string
  avatarUrl?: string
  revenue: number
  soldQuantity: number
  shiftCount: number
  totalHours: number
}

export interface SalesCapacityRow extends SalesCapacityInput {
  revenuePerShift: number
  quantityPerShift: number
  revenuePerHour: number
  /** Giá trị của chỉ số đang xem. */
  value: number
  /** Có mẫu số hợp lệ (ca hoặc giờ công) để tính trung bình hay không. */
  measured: boolean
  /** Chênh lệch tuyệt đối so với trung bình đội. */
  diffFromTeam: number
  /** % so với trung bình đội — 100 là ngang bằng, 0 khi đội chưa có số liệu. */
  teamRatio: number
}

export interface SalesCapacitySummary {
  metric: SalesCapacityMetric
  /** Người đo được xếp trước (giảm dần theo chỉ số), người thiếu mẫu số xếp cuối. */
  rows: SalesCapacityRow[]
  measuredRows: SalesCapacityRow[]
  teamAverage: number
  bestValue: number
  bestRow?: SalesCapacityRow
  totalRevenue: number
  totalSoldQuantity: number
  totalShifts: number
  totalHours: number
  /** Có giờ công để tính doanh thu/giờ không (bảng ca trưởng không có giờ công). */
  hasHours: boolean
}

export const SALES_CAPACITY_METRICS: Array<{
  id: SalesCapacityMetric
  label: string
  hint: string
  needsHours: boolean
}> = [
  { id: 'revenuePerShift', label: 'Doanh thu / ca', hint: 'Trung bình một ca người đó bán ra bao nhiêu tiền.', needsHours: false },
  { id: 'quantityPerShift', label: 'Sản phẩm / ca', hint: 'Trung bình một ca người đó bán được bao nhiêu sản phẩm.', needsHours: false },
  { id: 'revenuePerHour', label: 'Doanh thu / giờ công', hint: 'Trung bình mỗi giờ đứng quầy mang về bao nhiêu tiền.', needsHours: true },
]

export function salesCapacityMetricLabel(metric: SalesCapacityMetric) {
  return SALES_CAPACITY_METRICS.find((item) => item.id === metric)?.label || ''
}

export function buildEmployeeSalesCapacity(
  inputs: SalesCapacityInput[],
  metric: SalesCapacityMetric,
): SalesCapacitySummary {
  const usesHours = metric === 'revenuePerHour'
  const hasHours = inputs.some((input) => input.totalHours > 0)

  const base = inputs.map((input) => {
    const shifts = Math.max(0, input.shiftCount)
    const hours = Math.max(0, input.totalHours)
    const revenuePerShift = shifts > 0 ? input.revenue / shifts : 0
    const quantityPerShift = shifts > 0 ? input.soldQuantity / shifts : 0
    const revenuePerHour = hours > 0 ? input.revenue / hours : 0
    const measured = usesHours ? hours > 0 : shifts > 0
    const value = metric === 'revenuePerShift' ? revenuePerShift
      : metric === 'quantityPerShift' ? quantityPerShift
        : revenuePerHour
    return {
      ...input,
      revenuePerShift,
      quantityPerShift,
      revenuePerHour,
      value: measured ? value : 0,
      measured,
      diffFromTeam: 0,
      teamRatio: 0,
    }
  })

  const measuredRows = base.filter((row) => row.measured)
  // Trung bình đội tính theo TỔNG chia TỔNG (bình quân gia quyền), không phải
  // trung bình của các số trung bình: một người chỉ làm 1 ca may mắn sẽ không
  // kéo lệch mốc so sánh của cả đội.
  const numerator = measuredRows.reduce(
    (sum, row) => sum + (metric === 'quantityPerShift' ? row.soldQuantity : row.revenue),
    0,
  )
  const denominator = measuredRows.reduce((sum, row) => sum + (usesHours ? row.totalHours : row.shiftCount), 0)
  const teamAverage = denominator > 0 ? numerator / denominator : 0

  const rows = base
    .map((row) => ({
      ...row,
      diffFromTeam: row.measured ? row.value - teamAverage : 0,
      teamRatio: row.measured && teamAverage > 0 ? row.value / teamAverage * 100 : 0,
    }))
    .sort((a, b) =>
      Number(b.measured) - Number(a.measured)
      || b.value - a.value
      || b.revenue - a.revenue
      || a.employeeName.localeCompare(b.employeeName, 'vi'),
    )

  const ranked = rows.filter((row) => row.measured)
  return {
    metric,
    rows,
    measuredRows: ranked,
    teamAverage,
    bestValue: ranked.length ? ranked[0].value : 0,
    bestRow: ranked[0],
    totalRevenue: base.reduce((sum, row) => sum + row.revenue, 0),
    totalSoldQuantity: base.reduce((sum, row) => sum + row.soldQuantity, 0),
    totalShifts: base.reduce((sum, row) => sum + Math.max(0, row.shiftCount), 0),
    totalHours: base.reduce((sum, row) => sum + Math.max(0, row.totalHours), 0),
    hasHours,
  }
}
