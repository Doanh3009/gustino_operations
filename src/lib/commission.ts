import { isMissingTable, userHeaders } from './core'
import { configuredProductPrice } from './constants'
import { promotionalPriceFor } from './promotions'
import { shouldUseLanApi, supabase } from './supabase'
import type { AppUser, BagAllocation, CommissionRule, EmploymentType, Role } from '../types'

export const DEFAULT_REVENUE_TARGET = 2000000
export const DEFAULT_COMMISSION_RATE = 2

export type KpiPositionKey = 'pg_part_time' | 'pg_full_time' | 'shift_deputy' | 'shift_leader'

export interface PositionKpiFormula {
  branchId: string
  position: KpiPositionKey
  weekdayTarget: number
  weekendTarget: number
  monthlyTarget: number
}

const STANDARD_MONTH_WEEKDAYS = 20
const STANDARD_MONTH_WEEKENDS = 6
export const VUNG_TAU_NEW_KPI_FROM = '2026-07-01'
export const VUNG_TAU_NEW_KPI_TO = '2026-07-15'

export const POSITION_KPI_FORMULAS: PositionKpiFormula[] = [
  { branchId: 'gold-coast', position: 'pg_part_time', weekdayTarget: 500000, weekendTarget: 650000, monthlyTarget: 13900000 },
  { branchId: 'gold-coast', position: 'pg_full_time', weekdayTarget: 1000000, weekendTarget: 1300000, monthlyTarget: 27800000 },
  { branchId: 'gold-coast', position: 'shift_deputy', weekdayTarget: 300000, weekendTarget: 390000, monthlyTarget: 8340000 },
  { branchId: 'gold-coast', position: 'shift_leader', weekdayTarget: 300000, weekendTarget: 390000, monthlyTarget: 8340000 },
  // Khung gốc Vũng Tàu: áp dụng trước 01/07 và từ 16/07/2026 trở đi.
  { branchId: 'lotte-vt', position: 'pg_part_time', weekdayTarget: 600000, weekendTarget: 780000, monthlyTarget: 16680000 },
  { branchId: 'lotte-vt', position: 'pg_full_time', weekdayTarget: 1200000, weekendTarget: 1560000, monthlyTarget: 33360000 },
  { branchId: 'lotte-vt', position: 'shift_deputy', weekdayTarget: 360000, weekendTarget: 468000, monthlyTarget: 10008000 },
  { branchId: 'lotte-vt', position: 'shift_leader', weekdayTarget: 360000, weekendTarget: 468000, monthlyTarget: 10008000 },
  { branchId: 'lotte-2310', position: 'pg_part_time', weekdayTarget: 400000, weekendTarget: 550000, monthlyTarget: 11300000 },
  { branchId: 'lotte-2310', position: 'pg_full_time', weekdayTarget: 800000, weekendTarget: 1100000, monthlyTarget: 22600000 },
  { branchId: 'lotte-2310', position: 'shift_deputy', weekdayTarget: 240000, weekendTarget: 330000, monthlyTarget: 6780000 },
  { branchId: 'lotte-2310', position: 'shift_leader', weekdayTarget: 240000, weekendTarget: 330000, monthlyTarget: 6780000 },
]

export const VUNG_TAU_NEW_POSITION_KPI_FORMULAS: PositionKpiFormula[] = [
  { branchId: 'lotte-vt', position: 'pg_part_time', weekdayTarget: 550000, weekendTarget: 650000, monthlyTarget: 14900000 },
  { branchId: 'lotte-vt', position: 'pg_full_time', weekdayTarget: 1050000, weekendTarget: 1300000, monthlyTarget: 28800000 },
  { branchId: 'lotte-vt', position: 'shift_deputy', weekdayTarget: 500000, weekendTarget: 500000, monthlyTarget: 13000000 },
  { branchId: 'lotte-vt', position: 'shift_leader', weekdayTarget: 0, weekendTarget: 0, monthlyTarget: 0 },
]

export const BRANCH_MONTHLY_KPI_TOTALS: Record<string, number> = {
  'gold-coast': 127880000,
  'lotte-vt': 153456000,
  'lotte-2310': 58760000,
}

const BRANCH_KPI_STAFFING: Record<string, Partial<Record<KpiPositionKey, number>>> = {
  'gold-coast': { pg_full_time: 4, shift_leader: 2 },
  // Vũng Tàu: 4 Full-time + 1 Ca phó; Ca trưởng dùng KPI team và không có KPI cá nhân.
  'lotte-vt': { pg_full_time: 4, shift_deputy: 1, shift_leader: 1 },
  'lotte-2310': { pg_part_time: 4, shift_leader: 2 },
}

/* ------------------------------------------------------------------ *
 * Mức KPI do Admin chỉnh trong giao diện (bảng `branch_kpi_formulas`)
 * ------------------------------------------------------------------ *
 * Lớp ghi đè các hằng số ở trên. Trước đây đổi một con số KPI là phải sửa
 * `POSITION_KPI_FORMULAS` rồi build + deploy; nay Admin tự sửa trong trang
 * Quản trị → Thi đua nhân viên → "Mức KPI theo chi nhánh".
 *
 * Nạp một lần khi trang tải (`applyBranchKpiOverrides` trong
 * `lib/branchKpiFormulas.ts`) rồi mọi hàm tính KPI đọc chung ở đây, nên
 * KHÔNG cần đổi chữ ký của hàng chục lời gọi rải khắp AdminPage/ReportPage/
 * ManagerDashboardPage.
 */
export interface BranchKpiOverride extends PositionKpiFormula {
  headcount: number
  effectiveFrom?: string
  /**
   * Tiền thưởng ngày (đ/ca) do Admin đặt: mức khi đạt 100–109% và mức khi đạt từ
   * 110%. Bỏ trống ⇒ chạy đúng mức mặc định trong `DEFAULT_DAILY_KPI_BONUS`, nên
   * dòng override cũ (lưu trước khi có hai cột này) không bị tụt thưởng về 0.
   */
  dailyBonus100?: number
  dailyBonus110?: number
}

let branchKpiOverrides = new Map<string, BranchKpiOverride>()

export function setBranchKpiOverrides(rows: BranchKpiOverride[]) {
  branchKpiOverrides = new Map(rows.map((row) => [`${row.branchId}|${row.position}`, row]))
}

export function listBranchKpiOverrides(): BranchKpiOverride[] {
  return Array.from(branchKpiOverrides.values())
}

export function branchKpiOverrideFor(branchId: string, position: KpiPositionKey) {
  return branchKpiOverrides.get(`${branchId}|${position}`)
}

function normalizedEffectiveFrom(value?: string) {
  const date = String(value || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined
}

function activeBranchKpiOverrideFor(branchId: string, position: KpiPositionKey, date?: string) {
  const override = branchKpiOverrideFor(branchId, position)
  const effectiveFrom = normalizedEffectiveFrom(override?.effectiveFrom)
  if (!override || (effectiveFrom && date && date < effectiveFrom)) return undefined
  return override
}

/** Mức mặc định trong code — dùng làm giá trị khởi tạo và nút "Khôi phục mặc định". */
export function defaultPositionKpiFormula(branchId: string, position: KpiPositionKey) {
  return POSITION_KPI_FORMULAS.find((item) => item.branchId === branchId && item.position === position)
}

export function defaultBranchKpiHeadcount(branchId: string, position: KpiPositionKey) {
  return Number(BRANCH_KPI_STAFFING[branchId]?.[position] || 0)
}

/**
 * Cửa sổ Vũng Tàu 01–15/07/2026 đã được audit và chốt số với chủ hệ thống
 * (CODEMAP §55/§56). Override của Admin KHÔNG được sửa lại kỳ đó, nếu không
 * mọi con số đối soát tháng 7 đã ký sẽ đổi theo mà không ai biết.
 */
function isFrozenVungTauWindow(branchId: string, date?: string) {
  return branchId === 'lotte-vt' && !!date && usesVungTauNewKpi(date)
}

/** Nguồn sự thật duy nhất cho một (chi nhánh, vị trí, ngày): kỳ đã chốt → override → mặc định. */
function resolvedPositionFormula(branchId: string, position: KpiPositionKey, date?: string) {
  if (isFrozenVungTauWindow(branchId, date)) {
    return VUNG_TAU_NEW_POSITION_KPI_FORMULAS.find((item) => item.branchId === branchId && item.position === position)
      || defaultPositionKpiFormula(branchId, position)
  }
  return activeBranchKpiOverrideFor(branchId, position, date) || defaultPositionKpiFormula(branchId, position)
}

function resolvedHeadcount(branchId: string, position: KpiPositionKey, date?: string) {
  const override = activeBranchKpiOverrideFor(branchId, position, date)
  if (override) return Math.max(0, Number(override.headcount || 0))
  return defaultBranchKpiHeadcount(branchId, position)
}

/** Cơ cấu nhân sự chuẩn dùng cho KPI team, đã áp override của Admin. */
function branchStaffing(branchId: string, date?: string): Array<[KpiPositionKey, number]> {
  const positions = new Set<KpiPositionKey>([
    ...Object.keys(BRANCH_KPI_STAFFING[branchId] || {}) as KpiPositionKey[],
    ...listBranchKpiOverrides().filter((row) => row.branchId === branchId).map((row) => row.position),
  ])
  return Array.from(positions)
    .map((position) => [position, resolvedHeadcount(branchId, position, date)] as [KpiPositionKey, number])
    .filter(([, headcount]) => headcount > 0)
}

function samePositionFormula(a?: PositionKpiFormula, b?: PositionKpiFormula) {
  return Number(a?.weekdayTarget || 0) === Number(b?.weekdayTarget || 0)
    && Number(a?.weekendTarget || 0) === Number(b?.weekendTarget || 0)
    && Number(a?.monthlyTarget || 0) === Number(b?.monthlyTarget || 0)
}

function positionFormulaChangesWithin(branchId: string, position: KpiPositionKey, dates: string[]) {
  const first = resolvedPositionFormula(branchId, position, dates[0])
  return dates.some((date) => !samePositionFormula(first, resolvedPositionFormula(branchId, position, date)))
}

export function positionKpiKey(role?: Role, employmentType?: EmploymentType, positionTitle = ''): KpiPositionKey {
  const title = positionTitle.toLocaleLowerCase('vi')
  const normalizedTitle = title.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  if (role === 'shift_deputy' || normalizedTitle.includes('ca pho') || normalizedTitle.includes('pho quan ly ca')) return 'shift_deputy'
  if (role === 'shift_leader' || employmentType === 'leader' || normalizedTitle.includes('ca truong')) {
    return 'shift_leader'
  }
  if (employmentType === 'full_time' || title.includes('full')) return 'pg_full_time'
  return 'pg_part_time'
}

export function positionKpiFormula(
  branchId: string,
  role?: Role,
  employmentType?: EmploymentType,
  positionTitle = '',
  date?: string,
) {
  const position = positionKpiKey(role, employmentType, positionTitle)
  return resolvedPositionFormula(branchId, position, date)
    || activeBranchKpiOverrideFor('gold-coast', position, date)
    || defaultPositionKpiFormula('gold-coast', position)
}

export function employeePeriodRevenueTarget(
  branchId: string,
  role?: Role,
  employmentType?: EmploymentType,
  positionTitle = '',
  from?: string,
  to?: string,
) {
  const formula = positionKpiFormula(branchId, role, employmentType, positionTitle, to)
  if (!formula) return DEFAULT_REVENUE_TARGET
  if (!from || !to) return formula.monthlyTarget
  const dates = dateRange(from, to)
  const mixedVungTauWindow = branchId === 'lotte-vt' && dates.some(usesVungTauNewKpi)
  const position = positionKpiKey(role, employmentType, positionTitle)
  if (isFullCalendarMonth(from, to) && !mixedVungTauWindow && !positionFormulaChangesWithin(branchId, position, dates)) {
    return formula.monthlyTarget
  }
  let total = 0
  for (const date of dates) {
    const dateFormula = positionKpiFormula(branchId, role, employmentType, positionTitle, date)
    if (dateFormula) total += isWeekend(date) ? dateFormula.weekendTarget : dateFormula.weekdayTarget
  }
  if (
    branchId === 'lotte-vt'
    && position === 'shift_leader'
    && dates.some(usesVungTauNewKpi)
  ) return total
  return total || formula.monthlyTarget
}

export function branchTeamPeriodRevenueTarget(branchId: string, from?: string, to?: string) {
  const staffing = branchStaffing(branchId, to)
  if (!staffing.length) return BRANCH_MONTHLY_KPI_TOTALS[branchId] || DEFAULT_REVENUE_TARGET
  const monthlyTotal = (date?: string) => branchStaffing(branchId, date).reduce((sum, [position, headcount]) => {
    const formula = resolvedPositionFormula(branchId, position, date)
    return sum + (formula?.monthlyTarget || 0) * headcount
  }, 0)
  if (!from || !to) return monthlyTotal()
  const dates = dateRange(from, to)
  const mixedVungTauWindow = branchId === 'lotte-vt' && dates.some(usesVungTauNewKpi)
  const firstMonthlyTotal = monthlyTotal(dates[0])
  const monthlyTotalChanges = dates.some((date) => monthlyTotal(date) !== firstMonthlyTotal)
  if (isFullCalendarMonth(from, to) && !mixedVungTauWindow && !monthlyTotalChanges) return monthlyTotal(to)
  return dates.reduce((sum, date) => sum + branchStaffing(branchId, date).reduce((daySum, [position, headcount]) => {
    const formula = resolvedPositionFormula(branchId, position, date)
    const target = formula ? (isWeekend(date) ? formula.weekendTarget : formula.weekdayTarget) : 0
    return daySum + target * headcount
  }, 0), 0)
}

export function employeeCompetitionPeriodRevenueTarget(
  branchId: string,
  role?: Role,
  employmentType?: EmploymentType,
  positionTitle = '',
  from?: string,
  to?: string,
) {
  const isVungTauLeader = branchId === 'lotte-vt'
    && positionKpiKey(role, employmentType, positionTitle) === 'shift_leader'
  if (!isVungTauLeader || !from || !to) {
    return employeePeriodRevenueTarget(branchId, role, employmentType, positionTitle, from, to)
  }
  return dateRange(from, to).reduce((sum, date) => sum + (
    usesVungTauNewKpi(date)
      ? branchTeamPeriodRevenueTarget(branchId, date, date)
      : employeePeriodRevenueTarget(branchId, role, employmentType, positionTitle, date, date)
  ), 0)
}

export function usesVungTauNewKpi(date: string) {
  return date >= VUNG_TAU_NEW_KPI_FROM && date <= VUNG_TAU_NEW_KPI_TO
}

/**
 * **Từ 01/08/2026: doanh thu ca trưởng ghi nhận theo CA LÀM** — tổng doanh thu các
 * ca mình đứng tên ca trưởng, cộng hóa đơn tự bấm ở ca người khác
 * (`buildShiftLeaderRecordedRevenue`).
 *
 * Kèm theo: **ca trưởng chưa bị chấm KPI.** Chủ quán chưa quyết chỉ tiêu mới
 * (11/08/2026) — mà giữ chỉ tiêu cũ thì vô nghĩa: doanh thu theo ca lớn gấp ba lần
 * chỉ tiêu cá nhân nên ai cũng vượt 200%. Vì vậy chỉ GHI NHẬN con số: không chỉ
 * tiêu, không %, không xếp hạng, không thưởng KPI. Khi có chỉ tiêu thì bỏ cờ này.
 *
 * Trước mốc: giữ nguyên số đã chốt (gồm cả luật KPI đội Vũng Tàu 01–15/07).
 */
export const LEADER_SHIFT_REVENUE_FROM = '2026-08-01'

export function usesLeaderShiftRevenue(periodFrom: string) {
  return String(periodFrom || '') >= LEADER_SHIFT_REVENUE_FROM
}

/**
 * Chủ hệ thống đã TỰ ĐẶT chỉ tiêu cho ca trưởng ở chi nhánh này chưa?
 * (Quản trị → Thi đua nhân viên → "Mức KPI theo chi nhánh", bảng `branch_kpi_formulas`.)
 *
 * Chưa đặt ⇒ ca trưởng chỉ GHI NHẬN doanh thu theo ca, không %, không hạng, không
 * thưởng. Đặt rồi ⇒ chấm KPI bình thường ngay, không phải build lại app.
 *
 * KHÔNG lấy `POSITION_KPI_FORMULAS` làm căn cứ: đó là mức mặc định trong mã nguồn
 * cho thời "doanh thu ca trưởng = hóa đơn tự bấm", nhỏ hơn doanh thu theo ca khoảng
 * ba lần nên dùng lại là ai cũng vượt 200%.
 */
export function hasLeaderKpiTarget(branchId: string) {
  const override = branchKpiOverrideFor(branchId, 'shift_leader')
  if (!override) return false
  return Number(override.monthlyTarget || 0) > 0
    || Number(override.weekdayTarget || 0) > 0
    || Number(override.weekendTarget || 0) > 0
}

export function kpiRank(progress: number) {
  if (progress >= 120) return 'S+'
  if (progress >= 100) return 'A'
  if (progress >= 85) return 'B'
  if (progress >= 70) return 'C'
  return 'D'
}

/**
 * Mức thưởng ngày mặc định trong mã nguồn (đ/ca) — đúng chính sách đang chạy:
 * PG đạt 100–109% → 20.000, từ 110% → 40.000; Ca trưởng/Ca phó đạt KPI → 30.000.
 *
 * Đây chỉ còn là GIÁ TRỊ KHỞI TẠO: từ 14/08/2026 Admin đặt số tiền ngay trong
 * bảng "Mức KPI theo chi nhánh" (cột Thưởng đạt 100% / Thưởng từ 110%), nên đổi
 * mức thưởng không phải sửa file này rồi build lại nữa.
 *
 * Ca trưởng/Ca phó cố ý có at100 = at110: chính sách chỉ có MỘT mốc "đạt KPI".
 * Muốn thưởng thêm khi họ vượt 110% thì nâng riêng ô 110% của vị trí đó.
 */
export const DEFAULT_DAILY_KPI_BONUS: Record<KpiPositionKey, { at100: number; at110: number }> = {
  pg_part_time: { at100: 20000, at110: 40000 },
  pg_full_time: { at100: 20000, at110: 40000 },
  shift_deputy: { at100: 30000, at110: 30000 },
  shift_leader: { at100: 30000, at110: 30000 },
}

export function defaultDailyKpiBonus(position: KpiPositionKey) {
  return DEFAULT_DAILY_KPI_BONUS[position] || { at100: 0, at110: 0 }
}

/**
 * Nguồn sự thật cho tiền thưởng một (chi nhánh, vị trí, ngày).
 *
 * Không truyền `branchId` ⇒ mức mặc định, y hệt hành vi trước khi thưởng chỉnh
 * được — để một lời gọi quên truyền cũng không âm thầm trả về 0 đồng.
 */
function resolvedDailyKpiBonus(position: KpiPositionKey, branchId?: string, date?: string) {
  const fallback = defaultDailyKpiBonus(position)
  // Kỳ Vũng Tàu 01–15/07/2026 đã chốt số đối soát: đóng băng cả tiền thưởng,
  // không chỉ chỉ tiêu — nếu không thì bảng lương đã ký sẽ đổi theo mà không ai biết.
  if (!branchId || isFrozenVungTauWindow(branchId, date)) return fallback
  const override = activeBranchKpiOverrideFor(branchId, position, date)
  if (!override) return fallback
  const amount = (value?: number, backup = 0) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : backup
  return {
    at100: amount(override.dailyBonus100, fallback.at100),
    at110: amount(override.dailyBonus110, fallback.at110),
  }
}

export function dailyKpiBonus(
  progress: number,
  role?: Role,
  employmentType?: EmploymentType,
  positionTitle = '',
  branchId?: string,
  date?: string,
) {
  const position = positionKpiKey(role, employmentType, positionTitle)
  const bonus = resolvedDailyKpiBonus(position, branchId, date)
  if (progress >= 110) return bonus.at110
  if (progress >= 100) return bonus.at100
  return 0
}

export function monthlyKpiBonus(
  progress: number,
  role?: Role,
  employmentType?: EmploymentType,
  positionTitle = '',
) {
  const position = positionKpiKey(role, employmentType, positionTitle)
  const isLeader = position === 'shift_leader'
  const fullTimeOrDeputy = position === 'pg_full_time' || position === 'shift_deputy' || isLeader
  if (!fullTimeOrDeputy || progress < 80) return 0
  const leaderTiers = [
    [120, 5000000],
    [110, 4000000],
    [100, 3000000],
    [90, 2000000],
    [80, 1000000],
  ] as const
  const staffTiers = [
    [120, 2500000],
    [110, 2000000],
    [100, 1500000],
    [90, 1000000],
    [80, 500000],
  ] as const
  const tiers = isLeader ? leaderTiers : staffTiers
  return tiers.find(([threshold]) => progress >= threshold)?.[1] || 0
}

export function monthlySpecialBonus(input: {
  position: KpiPositionKey
  revenue: number
  previousRevenue?: number
  achievedDays: number
  totalShifts: number
  lateCount: number
  absentCount: number
  isTopRevenueInGroup: boolean
  disciplineConfirmed: boolean
}) {
  const confirmedLabels: string[] = []
  const pendingLabels: string[] = []
  let confirmedBonus = 0
  let pendingBonus = 0
  const previousRevenue = Math.max(0, input.previousRevenue || 0)
  if (previousRevenue > 0 && input.revenue * 100 >= previousRevenue * 115 && input.achievedDays >= 10) {
    confirmedBonus += 400000
    confirmedLabels.push('Most Improved')
  }
  if (input.achievedDays >= 26 && input.totalShifts >= 26 && input.lateCount === 0 && input.absentCount === 0) {
    confirmedBonus += 500000
    confirmedLabels.push('Perfect Month')
  }
  if (
    (input.position === 'pg_part_time' || input.position === 'pg_full_time')
    && input.isTopRevenueInGroup
    && input.achievedDays >= 26
  ) {
    const pgBonus = input.position === 'pg_part_time' ? 500000 : 1000000
    if (input.disciplineConfirmed) {
      confirmedBonus += pgBonus
      confirmedLabels.push('PG of the Month')
    } else {
      pendingBonus += pgBonus
      pendingLabels.push('PG of the Month — chờ Admin xác nhận kỷ luật')
    }
  }
  return { confirmedBonus, pendingBonus, confirmedLabels, pendingLabels }
}

export function weeklyKpiBonus(achievedDays: number, perfectWeekDays: number) {
  if (perfectWeekDays >= 6) return 200000
  if (achievedDays >= 5) return 100000
  return 0
}

export function isFullCalendarMonth(from: string, to: string) {
  if (from.slice(0, 7) !== to.slice(0, 7) || !from.endsWith('-01')) return false
  const end = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0))
  return to === end.toISOString().slice(0, 10)
}

function dateRange(from: string, to: string) {
  const dates: string[] = []
  const cursor = dateOnlyUtc(from)
  const end = dateOnlyUtc(to)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function isWeekend(date: string) {
  const day = dateOnlyUtc(date).getUTCDay()
  return day === 0 || day === 6
}

function dateOnlyUtc(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

const PRODUCT_PRICES: Record<string, number> = {
  'chestnut-110': 33000,
  'snow-110': 33000,
  'grilled-110': 33000,
  'chestnut-330': 89000,
  'snow-330': 89000,
  'grilled-330': 89000,
  'chestnut-500': 169000,
  'snow-500': 169000,
  'grilled-500': 169000,
  'chestnut-1kg': 330000,
  'snow-1kg': 330000,
  'grilled-1kg': 330000,
  'potato-500': 48000,
  'potato-1kg': 80000,
  'cake-box': 36000,
}

export function commissionPerBag(price: number) {
  if (price < 50000) return 1000
  if (price < 100000) return 2000
  return 3000
}

export function revenueCommission(revenue: number, ratePercent = DEFAULT_COMMISSION_RATE) {
  return Math.round(revenue * Math.max(0, ratePercent) / 100)
}

let employeeKpiCloudReady: boolean | null = supabase ? null : false

export interface EmployeeKpiTarget {
  branchId: string
  employeeKey: string
  employeeId?: string
  employeeName: string
  targetRevenue: number
  updatedAt?: string
}

export function employeeKpiKey(branchId: string, employeeKey: string) {
  return `${branchId}|${employeeKey}`
}

export function loadEmployeeRevenueTargets() {
  return {}
}

export function employeeRevenueTarget(
  branchId: string,
  employeeKey: string,
  fallback = DEFAULT_REVENUE_TARGET,
  targets: Record<string, number> = loadEmployeeRevenueTargets(),
) {
  // Mức Vũng Tàu trong chính sách 10/08/2026 áp dụng thống nhất cho mọi nhân sự
  // và mọi kỳ được xem lại; override cá nhân cũ không được làm sống lại khung cũ.
  if (branchId === 'lotte-vt') return Math.max(0, fallback)
  // Target 0 là quy tắc nghiệp vụ có chủ đích (Ca trưởng Vũng Tàu không chạy số
  // cá nhân), nên không được để một override cũ trong DB bật KPI cá nhân lại.
  if (fallback <= 0) return 0
  return targets[employeeKpiKey(branchId, employeeKey)] || fallback
}

function kpiRowToTarget(row: any): EmployeeKpiTarget {
  return {
    branchId: row.branch_id,
    employeeKey: row.employee_key,
    employeeId: row.employee_id || undefined,
    employeeName: row.employee_name || '',
    targetRevenue: Number(row.target_revenue || DEFAULT_REVENUE_TARGET),
    updatedAt: row.updated_at,
  }
}

function localTargetsToRows(branchIds: string[]) {
  void branchIds
  return [] as EmployeeKpiTarget[]
}

export async function fetchEmployeeKpiTargets(user: AppUser, branchIds: string[]): Promise<EmployeeKpiTarget[]> {
  if (shouldUseLanApi(user)) {
    const query = new URLSearchParams({ branchIds: branchIds.join(',') })
    const response = await fetch(`/api/employee-kpi-targets?${query}`, { headers: userHeaders(user) })
    if (response.ok) return response.json()
    return localTargetsToRows(branchIds)
  }
  if (employeeKpiCloudReady !== false) {
    const { data, error } = await supabase!
      .from('employee_kpi_targets')
      .select('*')
      .in('branch_id', branchIds)
    if (!error) {
      employeeKpiCloudReady = true
      return (data || []).map(kpiRowToTarget)
    }
    if (!isMissingTable(error)) throw error
    employeeKpiCloudReady = false
  }
  return localTargetsToRows(branchIds)
}

export async function saveEmployeeRevenueTarget(user: AppUser, target: EmployeeKpiTarget): Promise<EmployeeKpiTarget> {
  const normalizedTarget = {
    ...target,
    targetRevenue: Math.round(Math.max(0, Number(target.targetRevenue) || 0)),
  }
  if (shouldUseLanApi(user)) {
    const response = await fetch('/api/employee-kpi-targets', {
      method: 'PUT',
      headers: userHeaders(user),
      body: JSON.stringify(normalizedTarget),
    })
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Không thể lưu KPI nhân viên.')
    return response.json()
  }
  if (employeeKpiCloudReady !== false) {
    if (normalizedTarget.targetRevenue <= 0) {
      const { error } = await supabase!
        .from('employee_kpi_targets')
        .delete()
        .eq('branch_id', normalizedTarget.branchId)
        .eq('employee_key', normalizedTarget.employeeKey)
      if (!error) {
        employeeKpiCloudReady = true
        return normalizedTarget
      }
    if (!isMissingTable(error)) throw error
    employeeKpiCloudReady = false
    throw new Error('Thiếu bảng employee_kpi_targets trên Supabase, không lưu KPI tạm trên trình duyệt.')
    }
    const { data, error } = await supabase!.from('employee_kpi_targets').upsert({
      branch_id: normalizedTarget.branchId,
      employee_id: normalizedTarget.employeeId || null,
      employee_key: normalizedTarget.employeeKey,
      employee_name: normalizedTarget.employeeName,
      target_revenue: normalizedTarget.targetRevenue,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'branch_id,employee_key' }).select().single()
    if (!error) {
      employeeKpiCloudReady = true
      return kpiRowToTarget(data)
    }
    if (!isMissingTable(error)) throw error
    employeeKpiCloudReady = false
  }
  throw new Error('Thiếu bảng employee_kpi_targets trên Supabase, không lưu KPI tạm trên trình duyệt.')
}

/**
 * Giá và doanh thu của một SKU.
 *
 * `options` là ĐƯỜNG DUY NHẤT để khuyến mãi tác động vào giá, và nó cố ý KHÔNG
 * có mặc định "hôm nay": hàm này cũng được dùng để tính lại doanh thu của các
 * ngày đã qua (túi phát cho nhân viên, KPI, báo cáo). Nếu tự lấy ngày hôm nay
 * thì một chương trình khuyến mãi chạy hôm nay sẽ viết lại doanh thu tháng
 * trước — đúng cái lỗi mà bảng khuyến mãi sinh ra để chấm dứt.
 *
 * Không truyền `options` ⇒ giá gốc, hành vi y như trước khi có khuyến mãi.
 * Chỉ nơi nào BIẾT CHẮC ngày nghiệp vụ mới được truyền vào.
 */
export function productSaleValues(
  productId: string,
  quantity: number,
  options?: { branchId?: string; date?: string },
) {
  const basePrice = configuredProductPrice(productId, PRODUCT_PRICES[productId] || 0)
  const price = options?.date
    ? promotionalPriceFor(productId, basePrice, { branchId: options.branchId, date: options.date }).price
    : basePrice
  return {
    price,
    basePrice,
    /** Có đang bán dưới giá niêm yết không — để POS gạch ngang giá cũ. */
    discounted: price < basePrice,
    revenue: Math.round(quantity * price),
    commissionBase: Math.round(quantity * commissionPerBag(price)),
  }
}

export function soldBagQuantity(allocation: BagAllocation) {
  if (typeof allocation.soldQuantity === 'number') return Math.max(0, allocation.soldQuantity)
  return allocation.settledAt
    ? Math.max(0, allocation.issuedQuantity - allocation.returnedQuantity - allocation.damagedQuantity)
    : 0
}

export function summarizeEmployeeBagSales(allocations: BagAllocation[]) {
  const rows = new Map<string, {
    employeeKey: string
    employeeId?: string
    employeeName: string
    branchId: string
    soldQuantity: number
    revenue: number
    commissionBase: number
  }>()
  allocations.forEach((allocation) => {
    const employeeKey = allocation.employeeId || normalizeName(allocation.employeeName)
    const key = `${allocation.branchId}|${employeeKey}`
    const current = rows.get(key) || {
      employeeKey,
      employeeId: allocation.employeeId,
      employeeName: allocation.employeeName,
      branchId: allocation.branchId,
      soldQuantity: 0,
      revenue: 0,
      commissionBase: 0,
    }
    const soldQuantity = soldBagQuantity(allocation)
    const values = productSaleValues(allocation.productId, soldQuantity)
    current.soldQuantity += soldQuantity
    current.revenue += values.revenue
    current.commissionBase += values.commissionBase
    rows.set(key, current)
  })
  return Array.from(rows.values()).map((row) => ({
    ...row,
    achieved: row.revenue >= DEFAULT_REVENUE_TARGET,
    commission: row.revenue >= DEFAULT_REVENUE_TARGET ? revenueCommission(row.revenue) : 0,
  }))
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export async function fetchCommissionRules(user: AppUser): Promise<CommissionRule[]> {
  if (shouldUseLanApi(user)) {
    const response = await fetch('/api/commission-rules', { headers: userHeaders(user) })
    if (!response.ok) throw new Error('Không thể tải chính sách hoa hồng.')
    return response.json()
  }
  const { data, error } = await supabase!.from('commission_rules').select('*')
  if (error) throw error
  return (data || []).map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    targetQuantity: Number(row.target_quantity || DEFAULT_REVENUE_TARGET),
    commissionPerUnit: Number(row.commission_per_unit || DEFAULT_COMMISSION_RATE),
    updatedAt: row.updated_at,
  }))
}

export async function saveCommissionRule(
  user: AppUser,
  input: Pick<CommissionRule, 'branchId' | 'targetQuantity' | 'commissionPerUnit'>,
) {
  if (!['admin', 'manager'].includes(user.role)) throw new Error('Chỉ Quản lý được đổi chính sách hoa hồng.')
  if (shouldUseLanApi(user)) {
    const response = await fetch('/api/commission-rules', {
      method: 'PUT',
      headers: userHeaders(user),
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Không thể lưu chính sách hoa hồng.')
    return response.json() as Promise<CommissionRule>
  }
  const { data, error } = await supabase!.from('commission_rules').upsert({
    branch_id: input.branchId,
    target_quantity: input.targetQuantity,
    commission_per_unit: input.commissionPerUnit,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'branch_id' }).select().single()
  if (error) throw error
  return {
    id: data.id,
    branchId: data.branch_id,
    targetQuantity: Number(data.target_quantity),
    commissionPerUnit: Number(data.commission_per_unit),
    updatedAt: data.updated_at,
  } satisfies CommissionRule
}
