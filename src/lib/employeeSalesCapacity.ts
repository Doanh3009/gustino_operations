/**
 * Khả năng bán trung bình của một nhân viên.
 *
 * Bảng thi đua xếp theo TỔNG doanh thu nên người làm nhiều hơn luôn đứng trên,
 * kể cả khi mỗi ngày họ bán ít hơn người khác. Module này chia tổng cho mẫu số
 * công sức để trả lời đúng câu chủ quán hỏi: *một NGÀY người này bán được bao
 * nhiêu, và cả THÁNG thì trung bình bao nhiêu*.
 *
 * Mẫu số là NGÀY CÔNG và THÁNG CÓ ĐI LÀM, không phải số ca: một người trực hai
 * ca trong cùng một ngày vẫn chỉ bán trong một ngày. Muốn tách ngày thường với
 * cuối tuần thì dùng bộ lọc "Loại ngày" của bảng thi đua — cùng một tập dữ liệu.
 *
 * Hàm thuần, không React, không gọi mạng — mọi số liệu vào từ bảng thi đua đã
 * lọc sẵn (vai trò, loại ngày, khoảng số ca) nên khối này luôn cùng phạm vi với
 * bảng xếp hạng đang xem.
 */

export type SalesCapacityMetric = 'revenuePerDay' | 'quantityPerDay' | 'revenuePerMonth'

export interface SalesCapacityInput {
  employeeKey: string
  employeeName: string
  branchId: string
  avatarUrl?: string
  revenue: number
  soldQuantity: number
  shiftCount: number
  totalHours: number
  /** Số ngày công khác nhau trong kỳ (2 ca cùng ngày vẫn là 1). */
  dayCount: number
  /** Số tháng khác nhau có đi làm trong kỳ. */
  monthCount: number
}

export interface SalesCapacityRow extends SalesCapacityInput {
  revenuePerDay: number
  quantityPerDay: number
  revenuePerMonth: number
  /** Giá trị của chỉ số đang xem. */
  value: number
  /** Có mẫu số hợp lệ (ngày công hoặc tháng có làm) để tính trung bình hay không. */
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
  totalDays: number
  totalMonths: number
  /** Có ngày công để tính trung bình không (bảng ca trưởng theo tháng thì không). */
  hasDays: boolean
}

export const SALES_CAPACITY_METRICS: Array<{
  id: SalesCapacityMetric
  label: string
  hint: string
  perMonth: boolean
}> = [
  { id: 'revenuePerDay', label: 'Doanh thu / ngày', hint: 'Trung bình một ngày đi làm người đó bán ra bao nhiêu tiền.', perMonth: false },
  { id: 'quantityPerDay', label: 'Sản phẩm / ngày', hint: 'Trung bình một ngày đi làm người đó bán được bao nhiêu sản phẩm.', perMonth: false },
  { id: 'revenuePerMonth', label: 'Doanh thu / tháng', hint: 'Trung bình mỗi tháng có đi làm người đó mang về bao nhiêu tiền.', perMonth: true },
]

export function salesCapacityMetricLabel(metric: SalesCapacityMetric) {
  return SALES_CAPACITY_METRICS.find((item) => item.id === metric)?.label || ''
}

export function buildEmployeeSalesCapacity(
  inputs: SalesCapacityInput[],
  metric: SalesCapacityMetric,
): SalesCapacitySummary {
  const usesMonths = metric === 'revenuePerMonth'
  const hasDays = inputs.some((input) => input.dayCount > 0)

  const base = inputs.map((input) => {
    const days = Math.max(0, input.dayCount)
    const months = Math.max(0, input.monthCount)
    const revenuePerDay = days > 0 ? input.revenue / days : 0
    const quantityPerDay = days > 0 ? input.soldQuantity / days : 0
    const revenuePerMonth = months > 0 ? input.revenue / months : 0
    const measured = usesMonths ? months > 0 : days > 0
    const value = metric === 'revenuePerDay' ? revenuePerDay
      : metric === 'quantityPerDay' ? quantityPerDay
        : revenuePerMonth
    return {
      ...input,
      revenuePerDay,
      quantityPerDay,
      revenuePerMonth,
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
    (sum, row) => sum + (metric === 'quantityPerDay' ? row.soldQuantity : row.revenue),
    0,
  )
  const denominator = measuredRows.reduce((sum, row) => sum + (usesMonths ? row.monthCount : row.dayCount), 0)
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
    totalDays: base.reduce((sum, row) => sum + Math.max(0, row.dayCount), 0),
    totalMonths: base.reduce((sum, row) => sum + Math.max(0, row.monthCount), 0),
    hasDays,
  }
}
