import { employeeCompetitionPeriodRevenueTarget, kpiRank, positionKpiKey, type KpiPositionKey } from './commission'
import { employeePositionLabel } from './access'
import { hasLeftCompany } from './employmentStatus'
import type { KpiRevenueAdjustment } from './kpiRevenueAdjustments'
import type { SalesReceipt } from './salesReceipts'
import type { EmployeeProfile } from '../types'

/**
 * Bảng thi đua rút gọn dành cho NHÂN VIÊN xem.
 *
 * Cố ý chỉ có: tên, vị trí, doanh thu, % KPI và hạng. KHÔNG có giờ công, số ca,
 * tiền thưởng hay bất cứ dữ liệu chấm công nào của người khác — nhân viên chỉ
 * cần biết mình đang đứng đâu để phấn đấu, không cần xem lịch làm của đồng nghiệp.
 *
 * Công thức chỉ tiêu dùng CHUNG với trang Quản trị (`commission.ts`), nên Admin
 * đổi mức KPI trong giao diện là bảng này đổi theo, không lệch hai nguồn số.
 */

export interface CompetitionBoardRow {
  employeeKey: string
  employeeId?: string
  employeeName: string
  branchId: string
  positionLabel: string
  /** Nhóm KPI, để so sánh người cùng vị trí với nhau cho công bằng. */
  positionGroup: KpiPositionKey
  revenue: number
  target: number
  progress: number
  rank: string
  /** Số ngày trong kỳ mà người này đạt chỉ tiêu NGÀY. Không phải số ca, không phải giờ công. */
  achievedDays: number
  /** Số ngày trong kỳ có phát sinh doanh thu — dùng làm mẫu số của "tỉ lệ ngày đạt". */
  activeDays: number
  isMe: boolean
}

/** Tổng quan cả điểm bán, để ca trưởng và nhân viên biết chi nhánh đang đứng đâu. */
export interface CompetitionBoardTeam {
  branchId: string
  revenue: number
  target: number
  progress: number
  achievedCount: number
  memberCount: number
}

/**
 * Vai trò có mặt trên bảng thi đua NHÂN VIÊN.
 * Ca trưởng được xếp riêng theo doanh thu ca vận hành trong trang Quản trị;
 * đưa họ vào đây vừa trùng người vừa dùng sai nguồn doanh thu cá nhân.
 */
const BOARD_ROLES = new Set(['staff', 'shift_deputy', 'cashier'])

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function receiptSellerKey(receipt: SalesReceipt) {
  return receipt.sellerId || receipt.sellerKey || normalizeName(receipt.sellerName || '')
}

export function buildCompetitionBoardRows(input: {
  receipts: SalesReceipt[]
  adjustments?: KpiRevenueAdjustment[]
  employees: EmployeeProfile[]
  branchId?: string
  from: string
  to: string
  meId: string
}): CompetitionBoardRow[] {
  const { receipts, adjustments = [], employees, branchId, from, to, meId } = input
  const scopedEmployees = employees.filter((employee) =>
    // Đã nghỉ việc thì không còn trên bảng thi đua — bảng này để người ĐANG làm
    // phấn đấu. Dữ liệu cũ của họ vẫn nguyên trong báo cáo theo kỳ.
    !hasLeftCompany(employee)
    && BOARD_ROLES.has(employee.role)
    && (!branchId || employee.branchId === branchId),
  )

  const revenueByKey = new Map<string, number>()
  // Doanh thu tách theo NGÀY để đếm được số ngày đạt chỉ tiêu — mỗi ngày có mức
  // riêng (ngày thường / cuối tuần) nên không thể suy ra từ tổng kỳ.
  const revenueByKeyDate = new Map<string, Map<string, number>>()
  const addRevenue = (key: string, date: string, amount: number) => {
    if (!key) return
    revenueByKey.set(key, (revenueByKey.get(key) || 0) + amount)
    const byDate = revenueByKeyDate.get(key) || new Map<string, number>()
    byDate.set(date, (byDate.get(date) || 0) + amount)
    revenueByKeyDate.set(key, byDate)
  }
  receipts
    .filter((receipt) => !branchId || receipt.branchId === branchId)
    .forEach((receipt) => addRevenue(receiptSellerKey(receipt), receipt.businessDate, receipt.totalAmount))
  // Doanh thu lịch sử trước khi chi nhánh dùng web cũng tính vào KPI (CODEMAP §56).
  adjustments
    .filter((adjustment) => !branchId || adjustment.branchId === branchId)
    .forEach((adjustment) => addRevenue(adjustment.employeeId, adjustment.businessDate, adjustment.amount))

  const rows: CompetitionBoardRow[] = scopedEmployees.map((employee) => {
    const revenue = revenueByKey.get(employee.id)
      ?? revenueByKey.get(normalizeName(employee.name))
      ?? 0
    const byDate = revenueByKeyDate.get(employee.id)
      || revenueByKeyDate.get(normalizeName(employee.name))
      || new Map<string, number>()
    const employeeBranchId = employee.branchId || branchId || ''
    const target = employeeCompetitionPeriodRevenueTarget(
      employeeBranchId,
      employee.role,
      employee.employmentType,
      employee.positionTitle || '',
      from,
      to,
    )
    const progress = target > 0 ? (revenue / target) * 100 : 0
    let achievedDays = 0
    byDate.forEach((dayRevenue, date) => {
      const dayTarget = employeeCompetitionPeriodRevenueTarget(
        employeeBranchId,
        employee.role,
        employee.employmentType,
        employee.positionTitle || '',
        date,
        date,
      )
      if (dayTarget > 0 && dayRevenue >= dayTarget) achievedDays += 1
    })
    return {
      employeeKey: employee.id,
      employeeId: employee.id,
      employeeName: employee.name,
      branchId: employeeBranchId,
      positionLabel: employeePositionLabel(employee),
      positionGroup: positionKpiKey(employee.role, employee.employmentType, employee.positionTitle || ''),
      revenue,
      target,
      progress,
      rank: kpiRank(progress),
      achievedDays,
      activeDays: byDate.size,
      isMe: employee.id === meId,
    }
  })

  return rows.sort((a, b) => b.revenue - a.revenue || a.employeeName.localeCompare(b.employeeName, 'vi'))
}

/**
 * Tổng của cả điểm bán trong kỳ. Cộng từ chính các dòng trên nên con số luôn khớp
 * với bảng đang hiển thị, không sinh ra một nguồn số thứ hai.
 */
export function summarizeCompetitionTeam(rows: CompetitionBoardRow[], branchId: string): CompetitionBoardTeam {
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0)
  const target = rows.reduce((sum, row) => sum + row.target, 0)
  return {
    branchId,
    revenue,
    target,
    progress: target > 0 ? (revenue / target) * 100 : 0,
    // Chính sách tiền KPI là daily-only: một người "có đạt KPI" khi có ít nhất
    // một ngày đạt chỉ tiêu, không bắt buộc tổng doanh thu tháng đạt 100% target.
    achievedCount: rows.filter((row) => row.achievedDays > 0).length,
    memberCount: rows.length,
  }
}

/** Nhóm thi đua của một hồ sơ — dùng để lọc "cùng vị trí với tôi". */
export function boardPositionGroup(employee: Pick<EmployeeProfile, 'role' | 'employmentType' | 'positionTitle'>) {
  return positionKpiKey(employee.role, employee.employmentType, employee.positionTitle || '')
}
