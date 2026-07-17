import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildAttendanceReport,
  buildAttendanceDetailRows,
  createEmployeeAccount,
  deleteAttendanceRecordByAdmin,
  deleteEmployeeAccount,
  fetchAttendanceRecords,
  fetchEmployees,
  fetchShiftRegistrations,
  fetchWorkShifts,
  hardDeleteEmployeeAccount,
  permittedBranchIds,
  resetEmployeePassword,
  updateAttendanceRecordByAdmin,
  updateEmployeeDetails,
  updateEmployeeRole,
} from '../lib/attendance'
import { formatDecimalHoursAsDuration, formatWorkDurationBetween } from '../lib/workDuration'
import { employeePositionLabel, roleLabel } from '../lib/access'
import { useLang } from '../lib/i18n'
import { PRODUCTS, getPackingOptionsByOutput, getProducts, productById } from '../lib/constants'
import { branchName as configuredBranchName, useConfiguredBranches } from '../lib/branches'
import { downloadBlob, shareOrDownloadBlob } from '../lib/browser'
import { calculateStock, fetchInventoryReports, fetchMovements, fetchReportSnapshots } from '../lib/store'
import { supabase, uniqueChannelName } from '../lib/supabase'
import { fetchBagAllocations, fetchBagShiftSessions } from '../lib/shiftLedger'
import { buildShiftLeaderRevenueRows } from '../lib/shiftCompetition'
import { DEFAULT_COMMISSION_RATE, DEFAULT_REVENUE_TARGET, dailyKpiBonus, employeeKpiKey, employeePeriodRevenueTarget, kpiRank, loadEmployeeRevenueTargets, fetchCommissionRules, fetchEmployeeKpiTargets, productSaleValues, saveCommissionRule, saveEmployeeRevenueTarget, soldBagQuantity, summarizeEmployeeBagSales, weeklyKpiBonus } from '../lib/commission'
import { buildDailyRevenueRows } from '../lib/revenue'
import { fetchPayrollEntries, fetchRoleSalaryDefaults, upsertPayrollEntry, upsertRoleSalaryDefault, type PayrollEntry, type RoleSalaryDefault } from '../lib/payroll'
import { fetchSalesReceiptsRange, type SalesReceipt } from '../lib/salesReceipts'
import { emailToUsername, validateUsername } from '../lib/authIdentity'
import { fetchSupplyRequests, acknowledgeSupplyRequest, updateSupplyRequestStatus, type SupplyRequest } from '../lib/supplyRequests'
import { fetchActiveUsers } from '../lib/activeUsers'
import { AttendanceAdjustmentArchive } from '../components/AttendanceAdjustmentArchive'
import type {
  ActiveUserSession,
  AppUser,
  AttendanceRecord,
  BagAllocation,
  BagShiftSession,
  EmployeeProfile,
  EmploymentType,
  InventoryReport,
  Product,
  ReportSnapshot,
  Role,
  ShiftRegistration,
  StockMovement,
  WorkShift,
} from '../types'

export type AdminSection = 'overview' | 'attendance' | 'commission' | 'payroll' | 'inventory' | 'requests' | 'accounts' | 'revenue'

const INVENTORY_EXCEL_QUANTITY_FORMAT = '0.####'
const INVENTORY_EXCEL_INTEGER_FORMAT = '0'

const ADMIN_SECTIONS: Array<{ id: AdminSection; icon: string }> = [
  { id: 'revenue', icon: '₫' },
  { id: 'overview', icon: '▤' },
  { id: 'attendance', icon: '◉' },
  { id: 'commission', icon: '★' },
  { id: 'payroll', icon: '₫' },
  { id: 'inventory', icon: '▦' },
  { id: 'requests', icon: '↑' },
  { id: 'accounts', icon: '⊕' },
]

const MANAGEMENT_FUNCTIONS: Array<{
  id: string
  section: AdminSection
  icon: string
  label: string
  description: string
  tone: string
}> = [
  { id: 'business', section: 'revenue', icon: '▤', label: 'Tình hình kinh doanh', description: 'Doanh thu, hóa đơn và so sánh chi nhánh theo kỳ', tone: 'gold' },
  { id: 'branch_compare', section: 'revenue', icon: '▧', label: 'So sánh chi nhánh', description: 'Xếp hạng doanh thu từng điểm bán', tone: 'purple' },
  { id: 'best_sellers', section: 'commission', icon: '▥', label: 'Mặt hàng bán chạy', description: 'Sản phẩm và nhân viên bán tốt theo POS', tone: 'purple' },
  { id: 'employee_revenue', section: 'commission', icon: '○', label: 'Doanh thu nhân viên', description: 'KPI và sản phẩm bán từng nhân viên', tone: 'orange' },
  { id: 'inventory_overview', section: 'inventory', icon: '▦', label: 'Tồn kho chi nhánh', description: 'Tồn đầu, nhập xuất, hao hụt và tồn cuối kỳ', tone: 'dark' },
  { id: 'attendance', section: 'attendance', icon: '◉', label: 'Bảng công nhân viên', description: 'Ca làm, giờ công, đi trễ và quên check-out', tone: 'blue' },
  { id: 'payroll', section: 'payroll', icon: '◇', label: 'KPI nhân viên', description: 'Doanh thu từng ca, tỷ lệ đạt KPI và thưởng ngày', tone: 'pink' },
  { id: 'kitchen_orders', section: 'requests', icon: '↑', label: 'Đặt hàng', description: 'Tổng hợp yêu cầu đặt bếp/nhập hàng theo ngày', tone: 'violet' },
]

const ADMIN_TEXT = {
  vi: {
    navLabel: 'CHỨC NĂNG',
    sections: {
      revenue: 'Doanh thu',
      overview: 'Tổng quan',
      attendance: 'Chấm công',
      commission: 'KPI',
      payroll: 'KPI nhân viên',
      inventory: 'Báo cáo kho',
      requests: 'Đặt hàng',
      accounts: 'Nhân sự',
    },
    branch: 'Chi nhánh',
    employee: 'Nhân viên',
    from: 'Từ ngày',
    to: 'Đến ngày',
    allBranches: 'Tất cả chi nhánh',
    allEmployees: 'Tất cả nhân viên',
    today: 'Hôm nay',
    thisMonth: 'Tháng này',
    previousMonth: 'Tháng trước',
    shiftsDone: 'Ca đã làm',
    hours: 'Giờ công',
    lowStock: 'Cảnh báo tồn kho',
    orderRequests: 'Yêu cầu đặt hàng',
    shiftsHint: 'Tổng số ca có chấm công trong kỳ',
    hoursHint: 'nhân viên có dữ liệu',
    activeHint: 'nhân viên đang làm việc',
    requestsHint: 'yêu cầu trong kỳ',
    archiveEyebrow: 'LƯU TRỮ',
    archiveTitle: 'Lịch sử báo cáo đã lưu',
    archiveCount: 'hồ sơ',
    noArchive: 'Chưa có báo cáo được lưu trong khoảng thời gian này.',
    wasteEyebrow: 'HAO HỤT',
    wasteTitle: 'Sản phẩm hao hụt',
    wasteCount: 'mặt hàng',
    noWaste: 'Không ghi nhận hao hụt trong kỳ.',
  },
  en: {
    navLabel: 'CHỨC NĂNG',
    sections: {
      revenue: 'Doanh thu',
      overview: 'Tổng quan',
      attendance: 'Chấm công',
      commission: 'KPI',
      payroll: 'KPI nhân viên',
      inventory: 'Báo cáo kho',
      requests: 'Đặt hàng',
      accounts: 'Nhân sự',
    },
    branch: 'Chi nhánh',
    employee: 'Nhân viên',
    from: 'Từ ngày',
    to: 'Đến ngày',
    allBranches: 'Tất cả chi nhánh',
    allEmployees: 'Tất cả nhân viên',
    today: 'Hôm nay',
    thisMonth: 'Tháng này',
    previousMonth: 'Tháng trước',
    shiftsDone: 'Ca đã làm',
    hours: 'Giờ công',
    lowStock: 'Cảnh báo tồn kho',
    orderRequests: 'Yêu cầu đặt hàng',
    shiftsHint: 'Tổng số ca có chấm công trong kỳ',
    hoursHint: 'nhân viên có dữ liệu',
    activeHint: 'nhân viên đang làm việc',
    requestsHint: 'yêu cầu trong kỳ',
    archiveEyebrow: 'LƯU TRỮ',
    archiveTitle: 'Lịch sử báo cáo đã lưu',
    archiveCount: 'hồ sơ',
    noArchive: 'Chưa có báo cáo được lưu trong khoảng thời gian này.',
    wasteEyebrow: 'HAO HỤT',
    wasteTitle: 'Sản phẩm hao hụt',
    wasteCount: 'mặt hàng',
    noWaste: 'Không ghi nhận hao hụt trong kỳ.',
  },
} as const

const ADMIN_TEXT_EN = {
  navLabel: 'FUNCTIONS',
  sections: {
    revenue: 'Revenue',
    overview: 'Overview',
    attendance: 'Attendance',
    commission: 'KPI',
    payroll: 'Staff KPI',
    inventory: 'Inventory Report',
    requests: 'Orders',
    accounts: 'People',
  },
  branch: 'Branch',
  employee: 'Employee',
  from: 'From',
  to: 'To',
  allBranches: 'All branches',
  allEmployees: 'All employees',
  today: 'Today',
  thisMonth: 'This month',
  previousMonth: 'Previous month',
  shiftsDone: 'Completed shifts',
  hours: 'Work hours',
  lowStock: 'Low stock alerts',
  orderRequests: 'Order requests',
  shiftsHint: 'Total checked-in shifts in this period',
  hoursHint: 'employees with data',
  activeHint: 'active employees',
  requestsHint: 'requests in this period',
  archiveEyebrow: 'ARCHIVE',
  archiveTitle: 'Saved reports',
  archiveCount: 'records',
  noArchive: 'No saved reports in this date range.',
  wasteEyebrow: 'WASTE',
  wasteTitle: 'Product waste',
  wasteCount: 'items',
  noWaste: 'No waste recorded in this period.',
}

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'kitchen', label: 'Bếp' },
  { value: 'staff', label: 'Nhân viên' },
  { value: 'shift_leader', label: 'Ca trưởng' },
  { value: 'manager', label: 'Quản lý' },
]

interface PayrollDraft {
  hourlyRate: string
  fixedSalary: string
  bonus: string
  deduction: string
  evidenceUrl: string
  evidenceNote: string
  note: string
}

// Chỉ nhân sự vận hành bán hàng được tính KPI/lương doanh số.
// Manager/admin/kitchen là vai trò giám sát hoặc hỗ trợ, không tham gia KPI bán hàng.
const PAYROLL_ROLES: Role[] = ['shift_leader', 'staff']
const ATTENDANCE_EDIT_PAGE_SIZE = 20

const emptyPayrollDraft: PayrollDraft = {
  hourlyRate: '',
  fixedSalary: '',
  bonus: '',
  deduction: '',
  evidenceUrl: '',
  evidenceNote: '',
  note: '',
}

function roleSlotKey(branchId: string, role: Role) {
  return `${branchId}|${role}`
}

function lastDayOfMonth(period: string) {
  const [year, month] = period.split('-').map(Number)
  return `${period}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
}

type ManagementDataKey = 'employees' | 'shifts' | 'registrations' | 'records' | 'movements'
  | 'inventoryReports' | 'allocations' | 'sessions' | 'requests' | 'snapshots' | 'receipts'

const ALL_MANAGEMENT_DATA: ManagementDataKey[] = [
  'employees', 'shifts', 'registrations', 'records', 'movements',
  'inventoryReports', 'allocations', 'sessions', 'requests', 'snapshots', 'receipts',
]

function managementDataNeeds(section: AdminSection, focused: boolean) {
  if (!focused || section === 'overview') return new Set<ManagementDataKey>(ALL_MANAGEMENT_DATA)
  const bySection: Record<AdminSection, ManagementDataKey[]> = {
    overview: ALL_MANAGEMENT_DATA,
    revenue: ['employees', 'movements', 'allocations', 'snapshots', 'receipts'],
    attendance: ['employees', 'shifts', 'registrations', 'records'],
    commission: ['employees', 'shifts', 'registrations', 'records', 'allocations', 'sessions', 'receipts'],
    payroll: ['employees', 'shifts', 'registrations', 'records', 'allocations', 'sessions', 'receipts'],
    inventory: ['employees', 'movements', 'inventoryReports', 'sessions', 'receipts'],
    requests: ['employees', 'requests'],
    accounts: ['employees'],
  }
  return new Set<ManagementDataKey>(bySection[section])
}

function managementRealtimeTables(section: AdminSection, focused: boolean) {
  if (!focused || section === 'overview') return [
    'sales_receipts', 'sales_receipt_items', 'shift_registrations', 'attendance_records',
    'bag_allocations', 'bag_shift_sessions', 'stock_movements', 'operation_days',
    'inventory_reports', 'supply_requests', 'report_snapshots',
  ]
  const bySection: Record<AdminSection, string[]> = {
    overview: [],
    revenue: ['sales_receipts', 'sales_receipt_items', 'bag_allocations', 'bag_shift_sessions', 'stock_movements', 'operation_days', 'report_snapshots'],
    attendance: ['shift_registrations', 'attendance_records'],
    commission: ['sales_receipts', 'sales_receipt_items', 'shift_registrations', 'attendance_records', 'bag_allocations', 'bag_shift_sessions'],
    payroll: ['sales_receipts', 'sales_receipt_items', 'shift_registrations', 'attendance_records', 'bag_allocations', 'bag_shift_sessions'],
    inventory: ['stock_movements', 'operation_days', 'inventory_reports', 'bag_shift_sessions', 'sales_receipts', 'sales_receipt_items'],
    requests: ['supply_requests'],
    accounts: [],
  }
  return bySection[section]
}

export function ManagementPage({ user, initialSection, focused = false }: { user: AppUser; initialSection?: AdminSection; focused?: boolean }) {
  const lang = useLang()
  const text = lang === 'en' ? ADMIN_TEXT_EN : ADMIN_TEXT.vi
  const branches = useConfiguredBranches({ user })
  const initialRange = monthRange()
  const [activeSection, setActiveSection] = useState<AdminSection>(initialSection || 'revenue')
  const [activeFunctionId, setActiveFunctionId] = useState(() =>
    MANAGEMENT_FUNCTIONS.find((item) => item.section === (initialSection || 'revenue'))?.id || MANAGEMENT_FUNCTIONS[1].id,
  )
  useEffect(() => {
    if (!initialSection) return
    setActiveSection(initialSection)
    setActiveFunctionId(MANAGEMENT_FUNCTIONS.find((item) => item.section === initialSection)?.id || MANAGEMENT_FUNCTIONS[1].id)
  }, [initialSection])
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [shifts, setShifts] = useState<WorkShift[]>([])
  const [registrations, setRegistrations] = useState<ShiftRegistration[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [inventoryReports, setInventoryReports] = useState<InventoryReport[]>([])
  const [bagAllocations, setBagAllocations] = useState<BagAllocation[]>([])
  const [bagSessions, setBagSessions] = useState<BagShiftSession[]>([])
  const [supplyRequests, setSupplyRequests] = useState<SupplyRequest[]>([])
  const [reportSnapshots, setReportSnapshots] = useState<ReportSnapshot[]>([])
  const [salesReceipts, setSalesReceipts] = useState<SalesReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [exportBusy, setExportBusy] = useState('')
  const [branchId, setBranchId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)
  const rankingPeriod = from.slice(0, 7)
  const rankingMonthFrom = `${rankingPeriod}-01`
  const rankingMonthTo = lastDayOfMonth(rankingPeriod)
  const todayKey = localDateKey()
  const [attendanceListMode, setAttendanceListMode] = useState<'date' | 'employee'>('date')
  const [attendanceListDate, setAttendanceListDate] = useState(todayKey)
  const [attendanceListEmployeeId, setAttendanceListEmployeeId] = useState('')
  const [attendanceEmployeeSearch, setAttendanceEmployeeSearch] = useState('')
  const [attendanceListPage, setAttendanceListPage] = useState(1)
  const [competitionRankingMode, setCompetitionRankingMode] = useState<'daily' | 'monthly' | 'leaders'>('daily')
  const [competitionDate, setCompetitionDate] = useState(todayKey)
  const [savingRoleId, setSavingRoleId] = useState('')
  const [accountBusyId, setAccountBusyId] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState('')
  const [pendingHardDeleteId, setPendingHardDeleteId] = useState('')
  const [employeeDrafts, setEmployeeDrafts] = useState<Record<string, {
    branchId: string
    employmentType: EmploymentType
    positionTitle: string
    avatarUrl: string
  }>>({})
  const [payrollDrafts, setPayrollDrafts] = useState<Record<string, PayrollDraft>>({})
  const [roleDefaultDrafts, setRoleDefaultDrafts] = useState<Record<string, { hourlyRate: string; fixedSalary: string }>>({})
  const [commissionRuleDrafts, setCommissionRuleDrafts] = useState<Record<string, { targetRevenue: string; commissionRate: string }>>({})
  const [employeeKpiDrafts, setEmployeeKpiDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(loadEmployeeRevenueTargets()).map(([key, value]) => [key, String(value)])),
  )
  const payrollSaveTimers = useRef<Record<string, number>>({})
  const roleDefaultTimers = useRef<Record<string, number>>({})
  const commissionRuleTimers = useRef<Record<string, number>>({})
  const competitionPosterRef = useRef<HTMLDivElement>(null)
  const [savingEmployeeDetailsId, setSavingEmployeeDetailsId] = useState('')
  const [accountName, setAccountName] = useState('')
  const [accountUsername, setAccountUsername] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [accountBranchId, setAccountBranchId] = useState(user.branchId)
  const [accountRole, setAccountRole] = useState<Exclude<Role, 'admin'>>('staff')
  const [accountEmploymentType, setAccountEmploymentType] = useState<EmploymentType>('part_time')
  const [accountPositionTitle, setAccountPositionTitle] = useState('Part-time')
  const [temporaryCredential, setTemporaryCredential] = useState<{ username: string; password: string } | null>(null)
  const [showSupplyReport, setShowSupplyReport] = useState(false)
  const [inventoryDetailBranchId, setInventoryDetailBranchId] = useState('')
  const [activeUsers, setActiveUsers] = useState<ActiveUserSession[]>([])
  const [attendanceEdit, setAttendanceEdit] = useState<{
    recordId: string
    employeeName: string
    checkInTime: string
    checkOutTime: string
    reason: string
  } | null>(null)
  const [attendanceEditSaving, setAttendanceEditSaving] = useState(false)
  const [attendanceDelete, setAttendanceDelete] = useState<{
    recordId: string
    employeeName: string
    workDate: string
    reason: string
  } | null>(null)
  const [attendanceDeleteSaving, setAttendanceDeleteSaving] = useState(false)
  const managementRefreshInFlightRef = useRef<Promise<void> | null>(null)
  const managementRefreshQueuedRef = useRef(false)
  const managementRefreshContextRef = useRef({ activeSection, focused, from, to, rankingMonthFrom, rankingMonthTo })
  managementRefreshContextRef.current = { activeSection, focused, from, to, rankingMonthFrom, rankingMonthTo }

  async function refresh(showLoading = true) {
    if (managementRefreshInFlightRef.current) {
      managementRefreshQueuedRef.current = true
      return managementRefreshInFlightRef.current
    }
    if (showLoading) setLoading(true)
    const run = (async () => {
      try {
      const managedBranchIds = permittedBranchIds(user)
      const refreshContext = managementRefreshContextRef.current
      const dataNeeds = managementDataNeeds(refreshContext.activeSection, refreshContext.focused)
      const receiptFrom = refreshContext.from < refreshContext.rankingMonthFrom ? refreshContext.from : refreshContext.rankingMonthFrom
      const receiptTo = refreshContext.to > refreshContext.rankingMonthTo ? refreshContext.to : refreshContext.rankingMonthTo
      const [
        nextEmployees,
        nextShifts,
        nextRegistrations,
        nextRecords,
        nextMovements,
        nextInventoryReports,
        nextBagAllocations,
        nextBagSessions,
        nextSupplyRequests,
        nextReportSnapshots,
        nextSalesReceipts,
      ] = await Promise.all([
        dataNeeds.has('employees') ? fetchEmployees(user, { includeInactive: true }) : Promise.resolve(employees),
        dataNeeds.has('shifts') ? fetchWorkShifts(user) : Promise.resolve(shifts),
        dataNeeds.has('registrations') ? fetchShiftRegistrations(user, { from: receiptFrom, to: receiptTo }) : Promise.resolve(registrations),
        dataNeeds.has('records') ? fetchAttendanceRecords(user, { from: receiptFrom, to: receiptTo }) : Promise.resolve(records),
        dataNeeds.has('movements') ? Promise.all(managedBranchIds.map((id) => fetchMovements(id, user))).then((items) => items.flat()) : Promise.resolve(movements),
        dataNeeds.has('inventoryReports') ? Promise.all(managedBranchIds.map((id) => fetchInventoryReports(id, user))).then((items) => items.flat()) : Promise.resolve(inventoryReports),
        dataNeeds.has('allocations') ? Promise.all(managedBranchIds.map((id) => fetchBagAllocations(user, { branchId: id }))).then((items) => items.flat()) : Promise.resolve(bagAllocations),
        dataNeeds.has('sessions') ? Promise.all(managedBranchIds.map((id) => fetchBagShiftSessions(user, { branchId: id, from: receiptFrom, to: receiptTo }))).then((items) => items.flat()) : Promise.resolve(bagSessions),
        dataNeeds.has('requests') ? fetchSupplyRequests(user, managedBranchIds) : Promise.resolve(supplyRequests),
        dataNeeds.has('snapshots') ? Promise.all(managedBranchIds.map((id) => fetchReportSnapshots(id, user))).then((items) => items.flat()) : Promise.resolve(reportSnapshots),
        dataNeeds.has('receipts') ? fetchSalesReceiptsRange(user, { branchIds: managedBranchIds, from: receiptFrom, to: receiptTo }) : Promise.resolve(salesReceipts),
      ])
      setEmployees(nextEmployees)
      setShifts(nextShifts)
      setRegistrations(nextRegistrations)
      setRecords(nextRecords)
      setMovements(nextMovements)
      setInventoryReports(nextInventoryReports)
      setBagAllocations(nextBagAllocations)
      setBagSessions(nextBagSessions)
      setSupplyRequests(nextSupplyRequests)
      setReportSnapshots(nextReportSnapshots)
      setSalesReceipts(nextSalesReceipts)
      setError('')
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Không thể tải dữ liệu quản lý.')
      } finally {
        if (showLoading) setLoading(false)
      }
    })()
    managementRefreshInFlightRef.current = run
    try {
      await run
    } finally {
      managementRefreshInFlightRef.current = null
      if (managementRefreshQueuedRef.current) {
        managementRefreshQueuedRef.current = false
        void refresh(false)
      }
    }
  }

  useEffect(() => { void refresh(true) }, [user.id, from, to, activeSection, focused])

  useEffect(() => {
    const fallbackDate = todayKey >= from && todayKey <= to ? todayKey : to
    setAttendanceListDate((current) => current >= from && current <= to ? current : fallbackDate)
    setAttendanceListEmployeeId('')
    setAttendanceListPage(1)
    setAttendanceEdit(null)
    setCompetitionDate((current) => current >= from && current <= to ? current : fallbackDate)
  }, [from, to, branchId])

  useEffect(() => {
    if (user.role !== 'admin' || (focused && activeSection !== 'accounts')) return
    let active = true
    const loadActiveUsers = () => {
      void fetchActiveUsers(user).then((items) => {
        if (active) setActiveUsers(items)
      }).catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Không thể đồng bộ danh sách người dùng online.')
      })
    }
    loadActiveUsers()
    const timer = window.setInterval(loadActiveUsers, 30000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [user.id, user.role, activeSection, focused])

  useEffect(() => {
    const refreshWhenActive = () => void refresh(false)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshWhenActive()
    }
    const timer = window.setInterval(refreshWhenActive, 30000)
    window.addEventListener('focus', refreshWhenActive)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    const client = user.authToken ? null : supabase
    if (!client) {
      return () => {
        window.clearInterval(timer)
        window.removeEventListener('focus', refreshWhenActive)
        document.removeEventListener('visibilitychange', refreshWhenVisible)
      }
    }
    const channel = client.channel(uniqueChannelName(`admin-live:${user.id}`))
    managementRealtimeTables(activeSection, focused).forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => void refresh(false))
    })
    channel.subscribe()
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshWhenActive)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      void client.removeChannel(channel)
    }
  }, [user.id, user.authToken, from, to, activeSection, focused])

  useEffect(() => {
    setPayrollDrafts({})
    setRoleDefaultDrafts({})
    return
    let active = true
    void fetchCommissionRules(user).then((rules) => {
      if (!active) return
      setCommissionRuleDrafts(Object.fromEntries(rules.map((rule) => [rule.branchId, {
        targetRevenue: String(rule.targetQuantity || DEFAULT_REVENUE_TARGET),
        commissionRate: String(rule.commissionPerUnit || DEFAULT_COMMISSION_RATE),
      }])))
    }).catch(() => {
      if (!active) return
      setCommissionRuleDrafts({})
    })
    return () => { active = false }
  }, [user.id])

  useEffect(() => {
    let active = true
    const managedBranchIds = permittedBranchIds(user)
    void fetchEmployeeKpiTargets(user, managedBranchIds).then((targets) => {
      if (!active) return
      setEmployeeKpiDrafts(Object.fromEntries(targets.map((target) => [
          employeeKpiKey(target.branchId, target.employeeKey),
          String(target.targetRevenue),
        ])))
    }).catch(() => undefined)
    return () => { active = false }
  }, [user.id, user.branchId])

  // Tải lương theo tháng + lương mặc định theo vai trò từ Supabase.
  useEffect(() => {
    let active = true
    const managedBranchIds = permittedBranchIds(user)
    const period = from.slice(0, 7)
    void Promise.all([
      fetchPayrollEntries(user, period, managedBranchIds),
      fetchRoleSalaryDefaults(user, managedBranchIds),
    ]).then(([entries, defaults]) => {
      if (!active) return
      setPayrollDrafts(Object.fromEntries(entries.map((entry) => [entry.employeeId, {
        hourlyRate: entry.hourlyRate === null ? '' : String(entry.hourlyRate),
        fixedSalary: entry.fixedSalary === null ? '' : String(entry.fixedSalary),
        bonus: entry.bonus ? String(entry.bonus) : '',
        deduction: entry.deduction ? String(entry.deduction) : '',
        evidenceUrl: entry.evidenceUrl || '',
        evidenceNote: entry.evidenceNote || '',
        note: entry.note,
      }])))
      setRoleDefaultDrafts(Object.fromEntries(defaults.map((def) => [roleSlotKey(def.branchId, def.role), {
        hourlyRate: def.hourlyRate ? String(def.hourlyRate) : '',
        fixedSalary: def.fixedSalary ? String(def.fixedSalary) : '',
      }])))
      setError('')
    }).catch((reason) => {
      if (!active) return
      setError(reason instanceof Error ? reason.message : 'Không thể tải dữ liệu bảng lương đồng bộ.')
    })
    return () => { active = false }
  }, [user.id, from])

  const branchIds = permittedBranchIds(user)
  const visibleBranches = branches.filter((branch) => branchIds.includes(branch.id))
  const selectedBranches = visibleBranches.filter((branch) => !branchId || branch.id === branchId)
  const validBranchIds = new Set(visibleBranches.map((branch) => branch.id))
  const filteredEmployees = employees.filter((employee) =>
    employee.active !== false
    && (!employee.branchId || validBranchIds.has(employee.branchId) || employee.role === 'admin' || employee.role === 'manager' || employee.role === 'kitchen')
    && (!branchId || employee.branchId === branchId || employee.role === 'admin' || employee.role === 'manager' || employee.role === 'kitchen')
    && (!employeeId || employee.id === employeeId),
  )
  const payrollProfileCandidates = employees.filter((employee) =>
    PAYROLL_ROLES.includes(employee.role)
    && Boolean(employee.branchId)
    && validBranchIds.has(employee.branchId || '')
    && (!branchId || employee.branchId === branchId)
    && (!employeeId || employee.id === employeeId)
  )
  const accountEmployees = filteredEmployees.filter((employee) => employee.hasLoginAccount !== false || Boolean(employee.email))
  const rangeRegistrations = registrations.filter((item) =>
    (!branchId || item.branchId === branchId)
    && (!employeeId || item.userId === employeeId)
    && item.workDate >= from && item.workDate <= to,
  )
  const rangeRecords = records.filter((item) => {
    const date = localDateKey(new Date(item.checkInTime))
    return (!branchId || item.branchId === branchId)
      && (!employeeId || item.userId === employeeId)
      && date >= from && date <= to
  })
  const graceByShift = useMemo(
    () => new Map(shifts.map((shift) => [shift.id, shift.graceMinutes])),
    [shifts],
  )
  const allAttendanceRows = useMemo(
    () => {
      const registeredKeys = new Set(rangeRegistrations.filter((item) => item.status !== 'rejected').map((item) => `${item.userId}|${item.branchId}`))
      return buildAttendanceReport(rangeRegistrations, rangeRecords, graceByShift)
        .filter((row) => registeredKeys.has(`${row.userId}|${row.branchId}`))
    },
    [rangeRegistrations, rangeRecords, graceByShift],
  )
  const payrollEmployees = useMemo(
    () => buildPayrollEmployeeList(payrollProfileCandidates, allAttendanceRows),
    [payrollProfileCandidates, allAttendanceRows],
  )
  const payrollEmployeeIds = useMemo(
    () => new Set(payrollEmployees.map((employee) => employee.id)),
    [payrollEmployees],
  )
  const payrollEmployeeNames = useMemo(
    () => new Set(payrollEmployees.map((employee) => `${employee.branchId}|${normalizeName(employee.name)}`)),
    [payrollEmployees],
  )
  const attendanceRows = useMemo(
    () => allAttendanceRows.filter((row) =>
      payrollEmployeeIds.has(row.userId)
      || payrollEmployeeNames.has(`${row.branchId}|${normalizeName(row.employeeName)}`),
    ),
    [allAttendanceRows, payrollEmployeeIds, payrollEmployeeNames],
  )
  const allAttendanceDetailRows = useMemo(
    () => buildAttendanceDetailRows(rangeRegistrations, rangeRecords, graceByShift)
      .filter((row) => rangeRegistrations.some((registration) => registration.id === row.registrationId)),
    [rangeRegistrations, rangeRecords, graceByShift],
  )
  const attendanceDetailRows = useMemo(
    () => allAttendanceDetailRows.filter((row) =>
      payrollEmployeeIds.has(row.userId)
      || payrollEmployeeNames.has(`${row.branchId}|${normalizeName(row.employeeName)}`),
    ),
    [allAttendanceDetailRows, payrollEmployeeIds, payrollEmployeeNames],
  )
  const attendanceListRows = useMemo(
    () => buildAttendanceDetailRows(rangeRegistrations, rangeRecords, graceByShift),
    [rangeRegistrations, rangeRecords, graceByShift],
  )
  const attendanceListEmployeeOptions = useMemo(() => {
    const byEmployee = new Map<string, { id: string; name: string; branchId: string }>()
    attendanceListRows.forEach((row) => {
      if (!row.userId || byEmployee.has(row.userId)) return
      byEmployee.set(row.userId, { id: row.userId, name: row.employeeName, branchId: row.branchId })
    })
    return Array.from(byEmployee.values()).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  }, [attendanceListRows])
  const attendanceEmployeeSearchKey = normalizeName(attendanceEmployeeSearch)
  const attendanceListVisibleEmployeeOptions = useMemo(() => (
    attendanceEmployeeSearchKey
      ? attendanceListEmployeeOptions.filter((employee) =>
        normalizeName(`${employee.name} ${branchName(employee.branchId)}`).includes(attendanceEmployeeSearchKey),
      )
      : attendanceListEmployeeOptions
  ), [attendanceListEmployeeOptions, attendanceEmployeeSearchKey])
  const attendanceListFilteredRows = useMemo(() => {
    const modeRows = attendanceListMode === 'date'
      ? attendanceListRows.filter((row) => row.workDate === attendanceListDate)
      : attendanceListEmployeeId
        ? attendanceListRows.filter((row) => row.userId === attendanceListEmployeeId)
        : attendanceEmployeeSearchKey
          ? attendanceListRows
          : []
    const scopedRows = attendanceEmployeeSearchKey
      ? modeRows.filter((row) =>
        normalizeName(row.employeeName).includes(attendanceEmployeeSearchKey)
        || normalizeName(branchName(row.branchId)).includes(attendanceEmployeeSearchKey),
      )
      : modeRows
    return scopedRows.slice().sort((a, b) =>
      b.workDate.localeCompare(a.workDate)
      || a.employeeName.localeCompare(b.employeeName, 'vi')
      || a.scheduledStart.localeCompare(b.scheduledStart),
    )
  }, [attendanceListRows, attendanceListMode, attendanceListDate, attendanceListEmployeeId, attendanceEmployeeSearchKey])
  const attendanceListTotalPages = Math.max(1, Math.ceil(attendanceListFilteredRows.length / ATTENDANCE_EDIT_PAGE_SIZE))
  const attendanceListSafePage = Math.min(attendanceListPage, attendanceListTotalPages)
  const attendanceListPageStart = (attendanceListSafePage - 1) * ATTENDANCE_EDIT_PAGE_SIZE
  const attendanceListPageRows = attendanceListFilteredRows.slice(
    attendanceListPageStart,
    attendanceListPageStart + ATTENDANCE_EDIT_PAGE_SIZE,
  )
  const rangeMovements = movements.filter((item) =>
    (!branchId || item.branchId === branchId) && item.shiftDate >= from && item.shiftDate <= to,
  )
  const stockRows = useMemo(
    () => buildInventoryRows(movements, selectedBranches.map((branch) => branch.id), from, to),
    [movements, branchId, from, to],
  )
  const inventoryLedgerRows = useMemo(
    () => rangeMovements.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [rangeMovements],
  )
  const inventoryLedgerByDay = useMemo(() => {
    const map = new Map<string, StockMovement[]>()
    inventoryLedgerRows.forEach((row) => { map.set(row.shiftDate, [...(map.get(row.shiftDate) || []), row]) })
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [inventoryLedgerRows])
  const currentStockRows = useMemo(
    () => selectedBranches.flatMap((branch) =>
      calculateStock(movements.filter((item) => item.branchId === branch.id))
        .map((line) => ({ ...line, branchId: branch.id })),
    ),
    [movements, branchId],
  )
  const lowStockRows = currentStockRows.filter((line) => line.expected <= line.product.lowStock)
  const periodInventoryReports = inventoryReports.filter((report) =>
    (!branchId || report.branchId === branchId) && report.reportDate >= from && report.reportDate <= to,
  )
  const totalHours = attendanceRows.reduce((sum, row) => sum + row.totalHours, 0)
  const totalShifts = attendanceRows.reduce((sum, row) => sum + row.totalShifts, 0)
  const activeNow = records.filter((record) => !record.checkOutTime && (!branchId || record.branchId === branchId)).length
  const wasteRows = buildWasteRows(rangeMovements)
  const inventorySaleOutMovements = movements
    .filter((item) =>
      item.type === 'sale_out'
      && item.shiftDate >= from
      && item.shiftDate <= to
      && validBranchIds.has(item.branchId)
      && (!branchId || item.branchId === branchId),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const inventoryDailyOutboundRows = buildDailyOutboundRows(inventorySaleOutMovements)
  const inventoryDailyOutboundSummary = summarizeInventoryQuantities(
    inventoryDailyOutboundRows.map((row) => ({ quantity: row.quantity, unit: row.unit })),
  )
  const inventoryDailyOutboundDocumentCount = new Set(
    inventorySaleOutMovements.map((item) => item.documentId || item.id),
  ).size
  const inventoryShiftReconciliationRows = buildShiftInventoryReconciliation(
    bagSessions,
    salesReceipts,
    movements,
    from,
    to,
    validBranchIds,
    branchId,
  )
  const inventoryShiftPosSummary = summarizeInventoryQuantities(
    inventoryShiftReconciliationRows.flatMap((row) => row.posNativeQuantities),
    'Chưa có POS',
  )
  const inventoryShiftOfficialOutSummary = summarizeInventoryQuantities(
    inventoryShiftReconciliationRows.flatMap((row) =>
      row.lines
        .filter((line) => line.officialOut !== null)
        .map((line) => ({ quantity: line.officialOut || 0, unit: line.unit })),
    ),
    inventoryShiftReconciliationRows.some((row) => row.status === 'open') ? 'Chờ bàn giao' : 'Không phát sinh',
  )
  const inventoryClosedShiftCount = inventoryShiftReconciliationRows.filter((row) => row.status === 'closed').length
  const branchInventorySummaries = selectedBranches.map((branch) => {
    const stockLines = currentStockRows.filter((line) => line.branchId === branch.id)
    const lowCount = stockLines.filter((line) => line.expected <= line.product.lowStock && Math.abs(line.expected) > 0.0001).length
    const branchStockRows = stockRows.filter((row) => row.branchId === branch.id)
    const wasteMovements = rangeMovements.filter((item) => item.branchId === branch.id && item.type === 'waste')
    const lossQty = wasteMovements.reduce((sum, item) => sum + item.quantity, 0)
    const lossSource = wasteMovements.reduce((sum, item) => sum + (item.sourceQuantity || 0), 0)
    const lossRate = lossSource > 0 ? (lossQty / lossSource) * 100 : 0
    const topLoss = branchStockRows.filter((row) => row.waste > 0).sort((a, b) => b.waste - a.waste).slice(0, 3)
    const stockSummary = summarizeInventoryQuantities(
      stockLines.filter((line) => line.expected > 0.0001).map((line) => ({ quantity: line.expected, unit: line.product.unit })),
      'Không có tồn',
    )
    const inboundSummary = summarizeInventoryQuantities(
      branchStockRows.filter((row) => row.inbound > 0).map((row) => ({ quantity: row.inbound, unit: row.product.unit })),
    )
    const outboundSummary = summarizeInventoryQuantities(
      branchStockRows.filter((row) => row.outbound > 0).map((row) => ({ quantity: row.outbound, unit: row.product.unit })),
    )
    const lossSummary = summarizeInventoryQuantities(
      branchStockRows.filter((row) => row.waste > 0).map((row) => ({ quantity: row.waste, unit: row.product.unit })),
    )
    const branchShiftRows = inventoryShiftReconciliationRows.filter((row) => row.branchId === branch.id)
    const dailyPosSummary = summarizeInventoryQuantities(
      branchShiftRows
        .flatMap((row) => row.posNativeQuantities)
        .map((row) => ({ quantity: row.quantity, unit: row.unit })),
      'Chưa có POS',
    )
    return {
      branch,
      lowCount,
      lossQty,
      lossRate,
      topLoss,
      stockLines,
      stockSummary,
      inboundSummary,
      outboundSummary,
      lossSummary,
      dailyPosSummary,
    }
  })
  const inventoryDetailSummary = branchInventorySummaries.find(({ branch }) => branch.id === inventoryDetailBranchId) || null
  const inventoryOverview = {
    branches: selectedBranches.length,
    stockedSkus: currentStockRows.filter((line) => line.expected > 0.0001).length,
    lowSkus: lowStockRows.filter((line) => Math.abs(line.expected) > 0.0001).length,
    movements: rangeMovements.length,
  }
  const archiveRows = [
    ...periodInventoryReports.map((report) => ({
      id: report.id,
      date: report.reportDate,
      branchId: report.branchId,
      type: 'Phiếu kiểm kê',
      detail: `${report.reportNo} · ${report.shift} · ${report.reporter}`,
      createdAt: report.createdAt,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  const commissionRows = useMemo(
    () => buildCommissionRows(
      bagAllocations.filter((item) => {
        const date = allocationReportDate(item)
        return soldBagQuantity(item) > 0 && date >= from && date <= to && (!branchId || item.branchId === branchId)
      }),
      payrollEmployees,
      attendanceRows,
      salesReceipts.filter((receipt) => receipt.businessDate >= from && receipt.businessDate <= to && (!branchId || receipt.branchId === branchId)),
      commissionRuleDrafts,
      employeeKpiDrafts,
      from,
      to,
    ),
    [bagAllocations, payrollEmployees, attendanceRows, salesReceipts, commissionRuleDrafts, employeeKpiDrafts, branchId, from, to],
  )
  const dailyKpiRows = useMemo(
    () => buildDailyEmployeeKpiRows(
      bagAllocations.filter((item) => {
        const date = allocationReportDate(item)
        return soldBagQuantity(item) > 0 && date >= from && date <= to && (!branchId || item.branchId === branchId)
      }),
      salesReceipts.filter((receipt) => receipt.businessDate >= from && receipt.businessDate <= to && (!branchId || receipt.branchId === branchId)),
      payrollEmployees,
      attendanceDetailRows,
      from,
      to,
    ),
    [bagAllocations, salesReceipts, payrollEmployees, attendanceDetailRows, branchId, from, to],
  )
  const monthlyCompetitionRows = useMemo(() => {
    const rows = buildCommissionRows(
      bagAllocations.filter((item) => {
        const date = allocationReportDate(item)
        return soldBagQuantity(item) > 0 && date >= rankingMonthFrom && date <= rankingMonthTo && (!branchId || item.branchId === branchId)
      }),
      payrollEmployees,
      [],
      salesReceipts.filter((receipt) => receipt.businessDate >= rankingMonthFrom && receipt.businessDate <= rankingMonthTo && (!branchId || receipt.branchId === branchId)),
      commissionRuleDrafts,
      employeeKpiDrafts,
      rankingMonthFrom,
      rankingMonthTo,
    )
    return buildCompetitionRows(
      rows,
      registrations.filter((item) => item.workDate >= rankingMonthFrom && item.workDate <= rankingMonthTo && (!branchId || item.branchId === branchId)),
      payrollEmployees,
    ).slice(0, 10)
  }, [bagAllocations, payrollEmployees, salesReceipts, registrations, commissionRuleDrafts, employeeKpiDrafts, branchId, rankingMonthFrom, rankingMonthTo])
  const dailyCompetitionRows = useMemo(() => {
    const rows = buildCommissionRows(
      bagAllocations.filter((item) => allocationReportDate(item) === competitionDate && (!branchId || item.branchId === branchId)),
      payrollEmployees,
      [],
      salesReceipts.filter((receipt) => receipt.businessDate === competitionDate && (!branchId || receipt.branchId === branchId)),
      commissionRuleDrafts,
      employeeKpiDrafts,
      competitionDate,
      competitionDate,
    )
    return buildCompetitionRows(
      rows,
      registrations.filter((item) => item.workDate === competitionDate && (!branchId || item.branchId === branchId)),
      payrollEmployees,
    ).slice(0, 10)
  }, [bagAllocations, payrollEmployees, salesReceipts, registrations, commissionRuleDrafts, employeeKpiDrafts, branchId, competitionDate])
  const leaderCompetitionRows = useMemo(() => {
    return buildShiftLeaderRevenueRows(bagSessions, salesReceipts, {
      branchIds: selectedBranches.map((branch) => branch.id),
      from: rankingMonthFrom,
      to: rankingMonthTo,
      targetForSession: (session) => {
        const profile = employees.find((employee) =>
          employee.branchId === session.branchId
          && (employee.id === session.leaderId || normalizeName(employee.name) === normalizeName(session.leaderName)),
        )
        return employeePeriodRevenueTarget(
          session.branchId,
          profile?.role || 'shift_leader',
          profile?.employmentType || 'leader',
          profile?.positionTitle || 'Ca trưởng',
          session.businessDate,
          session.businessDate,
        )
      },
    })
      .filter((row) => row.revenue > 0)
      .map((row) => {
        const profile = employees.find((employee) =>
          employee.branchId === row.branchId
          && (employee.id === row.leaderKey || normalizeName(employee.name) === normalizeName(row.leaderName)),
        )
        return {
          employeeKey: profile?.id || row.leaderKey,
          employeeName: profile?.name || row.leaderName,
          branchId: row.branchId,
          avatarUrl: profile?.avatarUrl,
          soldQuantity: row.soldQuantity,
          revenue: row.revenue,
          commission: 0,
          totalHours: 0,
          progress: row.progress,
          rank: kpiRank(row.progress),
          score: Math.round(row.revenue / 10000 + row.progress),
          detail: `${row.shiftCount} ca · ${row.achievedShiftCount} ca đạt KPI`,
        }
      })
      .slice(0, 10)
  }, [bagSessions, salesReceipts, employees, branchId, rankingMonthFrom, rankingMonthTo, selectedBranches.length])
  const competitionRankingRows = competitionRankingMode === 'daily'
    ? dailyCompetitionRows
    : competitionRankingMode === 'monthly'
      ? monthlyCompetitionRows
      : leaderCompetitionRows
  const competitionRankingTitle = competitionRankingMode === 'daily'
    ? `Nhân viên theo ngày ${formatDate(competitionDate)}`
    : competitionRankingMode === 'monthly'
      ? `Nhân viên theo tháng ${rankingPeriod}`
      : `Ca trưởng theo tháng ${rankingPeriod}`
  const businessProductRows = useMemo(
    () => buildBusinessProductRows(salesReceipts, bagAllocations, {
      branchIds: selectedBranches.map((branch) => branch.id),
      from,
      to,
    }),
    [salesReceipts, bagAllocations, branchId, from, to, selectedBranches.length],
  )
  const payrollPeriod = from.slice(0, 7)
  const roleDefaults = useMemo(() => {
    const map: Record<string, RoleSalaryDefault> = {}
    Object.entries(roleDefaultDrafts).forEach(([key, value]) => {
      const [defBranchId, role] = key.split('|')
      map[key] = {
        branchId: defBranchId,
        role: role as Role,
        hourlyRate: parseMoney(value.hourlyRate),
        fixedSalary: parseMoney(value.fixedSalary),
      }
    })
    return map
  }, [roleDefaultDrafts])
  const payrollRows = useMemo(
    () => buildPayrollRows(payrollEmployees, attendanceRows, commissionRows, payrollDrafts, roleDefaults),
    [payrollEmployees, attendanceRows, commissionRows, payrollDrafts, roleDefaults],
  )
  // Các tổ hợp (chi nhánh × vai trò) cần đặt lương mặc định, suy từ nhân viên hiện có.
  const payrollRoleSlots = useMemo(() => {
    const slots = new Map<string, { branchId: string; role: Role }>()
    payrollEmployees.forEach((employee) => {
      if (!employee.branchId || !PAYROLL_ROLES.includes(employee.role)) return
      slots.set(roleSlotKey(employee.branchId, employee.role), { branchId: employee.branchId, role: employee.role })
    })
    return Array.from(slots.values()).sort((a, b) =>
      branchName(a.branchId).localeCompare(branchName(b.branchId), 'vi') || a.role.localeCompare(b.role),
    )
  }, [payrollEmployees])
  const payrollTotals = {
    basePay: payrollRows.reduce((sum, row) => sum + row.basePay, 0),
    commission: payrollRows.reduce((sum, row) => sum + row.commission, 0),
    bonus: payrollRows.reduce((sum, row) => sum + row.bonus, 0),
    deduction: payrollRows.reduce((sum, row) => sum + row.deduction, 0),
    grossPay: payrollRows.reduce((sum, row) => sum + row.grossPay, 0),
  }
  const pendingRequests = supplyRequests.filter((r) => r.status === 'pending').length

  const periodSnapshots = (() => {
    const sorted = reportSnapshots
      .filter((snap) =>
        (!branchId || snap.branchId === branchId)
        && snap.reportDate >= from
        && snap.reportDate <= to,
      )
      .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.createdAt.localeCompare(a.createdAt))
    const latestByDay = new Map<string, ReportSnapshot>()
    sorted.forEach((snap) => {
      const key = `${snap.branchId}|${snap.reportDate}`
      if (!latestByDay.has(key)) latestByDay.set(key, snap)
    })
    return Array.from(latestByDay.values())
  })()
  const periodRevenueRows = buildDailyRevenueRows(reportSnapshots, bagAllocations, movements, { branchId, from, to, receipts: salesReceipts })
  const adminRevenueTrendRows = buildAdminDailyTrendRows(periodRevenueRows, { from, to })
  const adminRevenueArea = buildAdminAreaChart(adminRevenueTrendRows, Math.max(...adminRevenueTrendRows.map((row) => row.revenue), 1))
  const visibleManagementFunctions = user.role === 'admin'
    ? MANAGEMENT_FUNCTIONS
    : MANAGEMENT_FUNCTIONS.filter((item) => !['attendance', 'payroll', 'requests', 'accounts'].includes(item.section))
  const activeFunction = visibleManagementFunctions.find((item) => item.id === activeFunctionId) || visibleManagementFunctions[0] || MANAGEMENT_FUNCTIONS[1]
  const activeFunctionStats = buildFunctionStats(activeFunction.id, {
    revenue: periodRevenueRows.reduce((sum, row) => sum + row.revenue, 0),
    sold: periodRevenueRows.reduce((sum, row) => sum + row.totalSold, 0),
    branches: selectedBranches.length,
    employees: filteredEmployees.length,
    lowStock: lowStockRows.length,
    pendingRequests,
    payroll: dailyKpiRows.reduce((sum, row) => sum + row.revenue, 0),
    commission: commissionRows.reduce((sum, row) => sum + row.commission, 0),
    waste: wasteRows.reduce((sum, row) => sum + row.quantity, 0),
  })

  function setQuickRange(kind: 'today' | 'month' | 'previousMonth') {
    const range = kind === 'today' ? { from: localDateKey(), to: localDateKey() }
      : kind === 'month' ? monthRange()
        : monthRange(-1)
    setFrom(range.from)
    setTo(range.to)
  }

  async function changeRole(employee: EmployeeProfile, role: Role) {
    setSavingRoleId(employee.id)
    try {
      await updateEmployeeRole(user, employee.id, role)
      setEmployees((items) => items.map((item) => item.id === employee.id ? { ...item, role } : item))
      setFeedback(`Đã cập nhật ${employee.name} thành ${roleLabel(role)}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể cập nhật phân quyền.')
    } finally {
      setSavingRoleId('')
    }
  }

  async function createAccount(event: React.FormEvent) {
    event.preventDefault()
    setAccountBusyId('create')
    try {
      const username = validateUsername(accountUsername)
      if (accountPassword.length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự.')
      const employee = await createEmployeeAccount(user, {
        name: accountName.trim(),
        username,
        branchId: accountRole === 'manager' || accountRole === 'kitchen' ? undefined : accountBranchId,
        role: accountRole,
        employmentType: accountEmploymentType,
        positionTitle: accountPositionTitle.trim(),
        password: accountPassword,
      })
      setEmployees((items) => [employee, ...items])
      setTemporaryCredential({ username, password: accountPassword })
      setAccountName('')
      setAccountUsername('')
      setAccountPassword('')
      setAccountRole('staff')
      setAccountEmploymentType('part_time')
      setAccountPositionTitle('Part-time')
      setFeedback(`Đã tạo tài khoản và mật khẩu cho ${employee.name}.`)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Không thể tạo tài khoản.'
      setError(message)
    } finally {
      setAccountBusyId('')
    }
  }

  async function resetPassword(employee: EmployeeProfile) {
    const newPassword = window.prompt(`Nhập mật khẩu mới cho ${employee.name} (ít nhất 6 ký tự):`)
    if (newPassword === null) return
    if (newPassword.length < 6) {
      setError('Mật khẩu cần ít nhất 6 ký tự.')
      return
    }
    setAccountBusyId(employee.id)
    try {
      await resetEmployeePassword(user, employee.id, newPassword)
      setTemporaryCredential({ username: emailToUsername(employee.email) || employee.id, password: newPassword })
      setFeedback(`Đã đặt lại mật khẩu cho ${employee.name}.`)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Không thể đặt lại mật khẩu.'
      setError(message)
    } finally {
      setAccountBusyId('')
    }
  }

  async function removeAccount(employee: EmployeeProfile) {
    if (pendingDeleteId !== employee.id) {
      setPendingDeleteId(employee.id)
      setFeedback(`Bấm “Xác nhận xóa” lần nữa để xóa vĩnh viễn tài khoản, lịch làm, chấm công và lương của ${employee.name}.`)
      return
    }
    setAccountBusyId(employee.id)
    try {
      await deleteEmployeeAccount(user, employee.id)
      setEmployees((items) => items.filter((item) => item.id !== employee.id))
      if (employeeId === employee.id) setEmployeeId('')
      setPendingDeleteId('')
      setFeedback(`Đã xóa vĩnh viễn tài khoản ${employee.name}. Tên đăng nhập cũ có thể dùng lại.`)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Không thể xóa tài khoản.'
      setError(message)
    } finally {
      setAccountBusyId('')
    }
  }

  async function hardRemoveAccount(employee: EmployeeProfile) {
    if (pendingHardDeleteId !== employee.id) {
      setPendingHardDeleteId(employee.id)
      setPendingDeleteId('')
      setFeedback(`Bấm “Xóa sạch test” lần nữa để xóa vĩnh viễn tài khoản, lịch làm, chấm công và lương của ${employee.name}.`)
      return
    }
    setAccountBusyId(employee.id)
    try {
      await hardDeleteEmployeeAccount(user, employee.id)
      setEmployees((items) => items.filter((item) => item.id !== employee.id))
      if (employeeId === employee.id) setEmployeeId('')
      setPendingHardDeleteId('')
      setFeedback(`Đã xóa sạch dữ liệu test của ${employee.name}. Bảng công/lịch làm sẽ không kéo người này lên lại.`)
      await refresh(false)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Không thể xóa sạch dữ liệu test.'
      setError(message)
    } finally {
      setAccountBusyId('')
    }
  }

  function employeeDraft(employee: EmployeeProfile) {
    return employeeDrafts[employee.id] || {
      branchId: employee.branchId || user.branchId,
      employmentType: employee.employmentType || (employee.role === 'shift_leader' ? 'leader' : 'part_time'),
      positionTitle: employee.positionTitle || roleLabel(employee.role),
      avatarUrl: employee.avatarUrl || '',
    }
  }

  function updateEmployeeDraft(employee: EmployeeProfile, patch: Partial<ReturnType<typeof employeeDraft>>) {
    setEmployeeDrafts((items) => ({
      ...items,
      [employee.id]: { ...employeeDraft(employee), ...patch },
    }))
  }

  async function saveEmployeeDetails(employee: EmployeeProfile) {
    const draft = employeeDraft(employee)
    setSavingEmployeeDetailsId(employee.id)
    try {
      const updated = await updateEmployeeDetails(user, employee.id, {
        ...draft,
        branchId: employee.role === 'manager' || employee.role === 'kitchen' ? undefined : draft.branchId,
      })
      if (updated.id === user.id) dispatchCurrentUserProfile(user, updated)
      setEmployees((items) => items.map((item) => item.id === employee.id ? { ...item, ...updated } : item))
      setEmployeeDrafts((items) => {
        const next = { ...items }
        delete next[employee.id]
        return next
      })
      setFeedback(`Đã cập nhật hồ sơ làm việc của ${employee.name}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể cập nhật hồ sơ nhân viên.')
    } finally {
      setSavingEmployeeDetailsId('')
    }
  }

  async function updateEmployeeAvatar(employee: EmployeeProfile, file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Vui lòng chọn file ảnh đại diện.')
      return
    }
    if (file.size > 8000000) {
      setError('Ảnh đại diện quá lớn. Hãy chọn ảnh dưới 8MB.')
      return
    }
    setSavingEmployeeDetailsId(employee.id)
    try {
      const avatarUrl = await fileToAvatarDataUrl(file)
      updateEmployeeDraft(employee, { avatarUrl })
      const updated = await updateEmployeeDetails(user, employee.id, { avatarUrl })
      if (updated.id === user.id) dispatchCurrentUserProfile(user, updated)
      setEmployees((items) => items.map((item) => item.id === employee.id ? { ...item, ...updated } : item))
      setEmployeeDrafts((items) => {
        const next = { ...items }
        delete next[employee.id]
        return next
      })
      setFeedback(`Đã cập nhật ảnh đại diện của ${employee.name}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể lưu ảnh đại diện.')
    } finally {
      setSavingEmployeeDetailsId('')
    }
  }

  const rangeSupplyRequests = supplyRequests.filter((req) => {
    const date = req.createdAt.slice(0, 10)
    return (!branchId || req.branchId === branchId)
      && (!employeeId || req.requestedBy === employeeId)
      && date >= from && date <= to
  })

  async function handleAcknowledge(requestId: string) {
    try {
      await acknowledgeSupplyRequest(user, requestId)
      setSupplyRequests((items) => items.map((r) => r.id === requestId ? { ...r, status: 'acknowledged' as const } : r))
      setFeedback('Đã ghi nhận yêu cầu đặt hàng.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể cập nhật yêu cầu.')
    }
  }

  async function handleCancelRequest(requestId: string) {
    try {
      await updateSupplyRequestStatus(user, requestId, 'cancelled')
      setSupplyRequests((items) => items.map((r) => r.id === requestId ? { ...r, status: 'cancelled' as const } : r))
      setFeedback('Đã hủy yêu cầu đặt hàng.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể hủy yêu cầu.')
    }
  }

  async function runExport(kind: string, emptyMessage: string, task: () => void | Promise<void>, successMessage: string) {
    if (exportBusy) return
    if (emptyMessage) {
      setFeedback(emptyMessage)
      return
    }
    setExportBusy(kind)
    setError('')
    try {
      await task()
      setFeedback(successMessage)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể xuất dữ liệu.')
    } finally {
      setExportBusy('')
    }
  }

  async function exportCompetitionImage() {
    const target = competitionPosterRef.current
    if (!target) return
    if (!monthlyCompetitionRows.length) {
      setFeedback('Chưa có dữ liệu thi đua để xuất ảnh.')
      return
    }
    setExportBusy('competition-image')
    setError('')
    try {
      const { default: html2canvas } = await import('html2canvas')
      const canvas = await html2canvas(target, {
        scale: 2,
        backgroundColor: '#f8faf4',
        useCORS: true,
        logging: false,
      })
      const link = document.createElement('a')
      link.download = `thi-dua-nhan-vien-${from}-${to}.jpg`
      link.href = canvas.toDataURL('image/jpeg', 0.95)
      link.click()
      setFeedback('Đã xuất ảnh infographic thi đua nhân viên.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể xuất ảnh thi đua.')
    } finally {
      setExportBusy('')
    }
  }

  async function exportAttendance() {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    const positionByUser = new Map<string, string>()
    const positionByName = new Map<string, string>()
    employees.forEach((employee) => {
      const label = employeePositionLabel(employee)
      if (employee.id) positionByUser.set(employee.id, label)
      positionByName.set(`${employee.branchId}|${normalizeName(employee.name)}`, label)
    })
    const resolvePosition = (userId: string, branchId: string, name: string) =>
      positionByUser.get(userId) || positionByName.get(`${branchId}|${normalizeName(name)}`) || ''
    const detailSheet = workbook.addWorksheet('Chi tiết chấm công')
    detailSheet.columns = attendanceDetailColumns()
    for (const row of attendanceDetailRows) {
      await addAttendanceDetailRow(detailSheet, row, resolvePosition(row.userId, row.branchId, row.employeeName))
    }
    styleSheet(detailSheet, `CHI TIẾT CHẤM CÔNG ${formatDate(from)} - ${formatDate(to)}`)

    const summarySheet = workbook.addWorksheet('Tổng hợp')
    summarySheet.columns = [
      { header: 'Nhân viên', key: 'employeeName', width: 26 },
      { header: 'Vị trí', key: 'position', width: 16 },
      { header: 'Chi nhánh', key: 'branch', width: 25 },
      { header: 'Tổng ca', key: 'totalShifts', width: 11 },
      { header: 'Tổng giờ (thập phân)', key: 'totalHours', width: 20 },
      { header: 'Ngày công', key: 'workDays', width: 12 },
      { header: 'Đi trễ', key: 'lateCount', width: 10 },
      { header: 'Vắng', key: 'absentCount', width: 10 },
      { header: 'Quên checkout', key: 'missingCheckoutCount', width: 16 },
    ]
    attendanceRows.forEach((row) => summarySheet.addRow({ ...row, position: resolvePosition(row.userId, row.branchId, row.employeeName), branch: branchName(row.branchId) }))
    styleSheet(summarySheet, `TỔNG HỢP CHẤM CÔNG ${formatDate(from)} - ${formatDate(to)}`)

    const commissionSheet = workbook.addWorksheet('KPI doanh thu')
    commissionSheet.columns = [
      { header: 'Nhân viên', key: 'employeeName', width: 26 },
      { header: 'Chi nhánh', key: 'branch', width: 24 },
      { header: 'Giờ công (thập phân)', key: 'totalHours', width: 21 },
      { header: 'Doanh thu', key: 'revenue', width: 16 },
      { header: 'KPI doanh thu', key: 'targetQuantity', width: 16 },
      { header: 'Tỷ lệ đạt (%)', key: 'progress', width: 14 },
      { header: 'Xếp hạng', key: 'rank', width: 12 },
      { header: 'Đạt KPI', key: 'achieved', width: 12 },
      { header: 'Thưởng ngày', key: 'dailyBonus', width: 16 },
      { header: 'Thưởng tuần', key: 'weeklyBonus', width: 16 },
      { header: 'Thưởng tháng', key: 'monthlyBonus', width: 16 },
      { header: 'Tổng thưởng KPI', key: 'commission', width: 18 },
    ]
    commissionRows.forEach((row) => commissionSheet.addRow({
      ...row,
      branch: branchName(row.branchId),
      achieved: row.achieved ? 'Đạt' : 'Chưa đạt',
    }))
    styleSheet(commissionSheet, `KPI DOANH THU ${formatDate(from)} - ${formatDate(to)}`)

    // Nhật ký doanh thu từng nhân viên theo từng ngày (để kế toán đối chiếu KPI ngày).
    const dailyRevenueSheet = workbook.addWorksheet('Doanh thu NV theo ngày')
    dailyRevenueSheet.columns = [
      { header: 'Ngày', key: 'date', width: 14 },
      { header: 'Nhân viên', key: 'employeeName', width: 26 },
      { header: 'Chi nhánh', key: 'branch', width: 24 },
      { header: 'Số hóa đơn', key: 'receipts', width: 12 },
      { header: 'SL bán', key: 'quantity', width: 12 },
      { header: 'Doanh thu', key: 'revenue', width: 16 },
    ]
    buildDailyEmployeeRevenueRows(salesReceipts, from, to, branchId).forEach((row) =>
      dailyRevenueSheet.addRow({ ...row, date: formatDate(row.date), branch: branchName(row.branchId) }),
    )
    styleSheet(dailyRevenueSheet, `DOANH THU NHÂN VIÊN THEO NGÀY ${formatDate(from)} - ${formatDate(to)}`)

    const exportBranchIds = Array.from(new Set([
      ...attendanceRows.map((row) => row.branchId),
      ...attendanceDetailRows.map((row) => row.branchId),
    ])).sort((a, b) => branchName(a).localeCompare(branchName(b), 'vi'))
    const usedSheetNames = new Set(workbook.worksheets.map((sheet) => sheet.name))
    for (const id of exportBranchIds) {
      const branchSheet = workbook.addWorksheet(uniqueSheetName(branchName(id), usedSheetNames))
      branchSheet.columns = attendanceDetailColumns()
      for (const row of attendanceDetailRows.filter((item) => item.branchId === id)) {
        await addAttendanceDetailRow(branchSheet, row, resolvePosition(row.userId, row.branchId, row.employeeName))
      }
      styleSheet(branchSheet, `CHẤM CÔNG ${branchName(id)} ${formatDate(from)} - ${formatDate(to)}`)
    }

    await saveWorkbook(workbook, `bang-cham-cong-${from}-${to}.xlsx`)
  }

  async function exportInventory() {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Gustino Operations'
    workbook.created = new Date()

    const summarySheet = workbook.addWorksheet('Tổng hợp kho')
    summarySheet.columns = [
      { header: 'Chi nhánh', key: 'branch', width: 25 },
      { header: 'Sản phẩm', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku', width: 17 },
      { header: 'ĐVT', key: 'unit', width: 10 },
      { header: 'Tồn đầu kỳ', key: 'opening', width: 14 },
      { header: 'Nhập / tăng', key: 'inbound', width: 14 },
      { header: 'Xuất / giảm', key: 'outbound', width: 14 },
      { header: 'Hao hụt', key: 'waste', width: 12 },
      { header: 'Tồn cuối kỳ', key: 'closing', width: 14 },
    ]
    stockRows.forEach((row) => summarySheet.addRow({
      branch: branchName(row.branchId),
      product: row.product.name,
      sku: row.product.sku,
      unit: row.product.unit,
      opening: row.opening,
      inbound: row.inbound,
      outbound: row.outbound,
      waste: row.waste,
      closing: row.closing,
    }))
    for (const key of ['opening', 'inbound', 'outbound', 'waste', 'closing']) {
      summarySheet.getColumn(key).numFmt = INVENTORY_EXCEL_QUANTITY_FORMAT
    }
    styleSheet(summarySheet, `TỔNG HỢP KHO ${formatDate(from)} - ${formatDate(to)}`)

    const shiftReconciliationSheet = workbook.addWorksheet('Đối chiếu ca')
    shiftReconciliationSheet.columns = [
      { header: 'Ngày', key: 'date', width: 13 },
      { header: 'Chi nhánh', key: 'branch', width: 25 },
      { header: 'Ca', key: 'shift', width: 9 },
      { header: 'Trạng thái', key: 'status', width: 18 },
      { header: 'Bắt đầu', key: 'startedAt', width: 20 },
      { header: 'Kết thúc', key: 'endedAt', width: 20 },
      { header: 'Sản phẩm nguồn', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku', width: 17 },
      { header: 'ĐVT', key: 'unit', width: 10 },
      { header: 'Tồn đầu', key: 'opening', width: 13 },
      { header: 'Nhập thêm', key: 'additions', width: 13 },
      { header: 'POS quy đổi', key: 'posEquivalent', width: 15 },
      { header: 'Hao hụt', key: 'waste', width: 12 },
      { header: 'Tồn bàn giao', key: 'closing', width: 16 },
      { header: 'Out chính thức', key: 'officialOut', width: 16 },
      { header: 'Chênh lệch', key: 'difference', width: 14 },
      { header: 'POS nguyên đơn vị', key: 'posNative', width: 25 },
      { header: 'Số hóa đơn', key: 'receipts', width: 12 },
      { header: 'Doanh thu POS', key: 'revenue', width: 17 },
      { header: 'Ghi chú', key: 'note', width: 38 },
    ]
    inventoryShiftReconciliationRows.forEach((shift) => {
      shift.lines.forEach((line) => shiftReconciliationSheet.addRow({
        date: formatDate(shift.businessDate),
        branch: branchName(shift.branchId),
        shift: `Ca ${shift.sequence}`,
        status: shift.status === 'open' ? 'Đang mở · tạm tính' : 'Đã bàn giao',
        startedAt: formatDateTime(shift.startedAt),
        endedAt: shift.endedAt ? formatDateTime(shift.endedAt) : '',
        product: line.productName,
        sku: line.sku,
        unit: line.unit,
        opening: line.opening,
        additions: line.additions,
        posEquivalent: line.posEquivalent,
        waste: line.waste,
        closing: line.closing,
        officialOut: line.officialOut,
        difference: line.difference,
        posNative: shift.posNativeSummary,
        receipts: shift.receiptCount,
        revenue: shift.posRevenue,
        note: line.trackedByHandover
          ? shift.status === 'open' ? 'Chờ tồn bàn giao cuối ca' : ''
          : 'SKU nguồn chưa nằm trong tồn bàn giao của ca',
      }))
    })
    for (const key of ['opening', 'additions', 'posEquivalent', 'waste', 'closing', 'officialOut', 'difference']) {
      shiftReconciliationSheet.getColumn(key).numFmt = INVENTORY_EXCEL_QUANTITY_FORMAT
    }
    shiftReconciliationSheet.getColumn('revenue').numFmt = INVENTORY_EXCEL_INTEGER_FORMAT
    styleSheet(shiftReconciliationSheet, `ĐỐI CHIẾU XUẤT BÁN THEO CA ${formatDate(from)} - ${formatDate(to)}`)

    const dailyOutboundSheet = workbook.addWorksheet('Xuất bán trong kỳ')
    dailyOutboundSheet.columns = [
      { header: 'Ngày', key: 'date', width: 13 },
      { header: 'Giờ ghi', key: 'time', width: 20 },
      { header: 'Chi nhánh', key: 'branch', width: 25 },
      { header: 'Số phiếu', key: 'document', width: 23 },
      { header: 'Sản phẩm', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku', width: 17 },
      { header: 'Số lượng xuất bán', key: 'quantity', width: 19 },
      { header: 'ĐVT', key: 'unit', width: 10 },
      { header: 'Người ghi', key: 'creator', width: 24 },
      { header: 'Ghi chú', key: 'note', width: 42 },
    ]
    inventorySaleOutMovements.forEach((movement) => {
      const product = productById(movement.productId)
      const creator = employees.find((employee) => employee.id === movement.createdBy)
      dailyOutboundSheet.addRow({
        date: formatDate(movement.shiftDate),
        time: formatDateTime(movement.createdAt),
        branch: branchName(movement.branchId),
        document: movement.documentId || movement.id,
        product: product?.name || movement.productId,
        sku: product?.sku || '-',
        quantity: movement.quantity,
        unit: product?.unit || 'đơn vị',
        creator: creator?.name || movement.createdBy || '-',
        note: movement.note || '-',
      })
    })
    dailyOutboundSheet.getColumn('quantity').numFmt = INVENTORY_EXCEL_QUANTITY_FORMAT
    styleSheet(dailyOutboundSheet, `XUẤT KHO ĐỂ BÁN ${formatDate(from)} - ${formatDate(to)}`)

    const ledgerSheet = workbook.addWorksheet('Nhật ký kho')
    ledgerSheet.columns = [
      { header: 'Ngày kho', key: 'date', width: 13 },
      { header: 'Thời điểm ghi', key: 'createdAt', width: 20 },
      { header: 'Chi nhánh', key: 'branch', width: 25 },
      { header: 'Loại phát sinh', key: 'type', width: 18 },
      { header: 'Số phiếu', key: 'document', width: 23 },
      { header: 'Sản phẩm', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku', width: 17 },
      { header: 'Số lượng', key: 'quantity', width: 14 },
      { header: 'ĐVT', key: 'unit', width: 10 },
      { header: 'Sản phẩm nguồn', key: 'sourceProduct', width: 28 },
      { header: 'SL nguồn', key: 'sourceQuantity', width: 14 },
      { header: 'Khối lượng đo (kg)', key: 'measuredWeightKg', width: 20 },
      { header: 'Người ghi', key: 'creator', width: 24 },
      { header: 'Ghi chú', key: 'note', width: 42 },
    ]
    inventoryLedgerRows.forEach((movement) => {
      const product = productById(movement.productId)
      const sourceProduct = movement.sourceProductId ? productById(movement.sourceProductId) : undefined
      const creator = employees.find((employee) => employee.id === movement.createdBy)
      ledgerSheet.addRow({
        date: formatDate(movement.shiftDate),
        createdAt: formatDateTime(movement.createdAt),
        branch: branchName(movement.branchId),
        type: MOVEMENT_LABELS[movement.type],
        document: movement.documentId || movement.id,
        product: product?.name || movement.productId,
        sku: product?.sku || '-',
        quantity: movement.quantity,
        unit: product?.unit || 'đơn vị',
        sourceProduct: sourceProduct?.name || movement.sourceProductId || '-',
        sourceQuantity: movement.sourceQuantity ?? null,
        measuredWeightKg: movement.measuredWeightKg ?? null,
        creator: creator?.name || movement.createdBy || '-',
        note: movement.note || '-',
      })
    })
    for (const key of ['quantity', 'sourceQuantity', 'measuredWeightKg']) {
      ledgerSheet.getColumn(key).numFmt = INVENTORY_EXCEL_QUANTITY_FORMAT
    }
    styleSheet(ledgerSheet, `NHẬT KÝ KHO ${formatDate(from)} - ${formatDate(to)}`)

    const currentStockSheet = workbook.addWorksheet('Tồn hiện tại')
    currentStockSheet.columns = [
      { header: 'Chi nhánh', key: 'branch', width: 25 },
      { header: 'Sản phẩm', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku', width: 17 },
      { header: 'Danh mục', key: 'category', width: 16 },
      { header: 'Tồn hiện tại', key: 'quantity', width: 16 },
      { header: 'ĐVT', key: 'unit', width: 10 },
      { header: 'Trạng thái', key: 'status', width: 16 },
    ]
    currentStockRows
      .slice()
      .sort((a, b) => branchName(a.branchId).localeCompare(branchName(b.branchId), 'vi') || a.product.name.localeCompare(b.product.name, 'vi'))
      .forEach((line) => currentStockSheet.addRow({
        branch: branchName(line.branchId),
        product: line.product.name,
        sku: line.product.sku,
        category: inventoryCategoryLabel(line.product.category),
        quantity: line.expected,
        unit: line.product.unit,
        status: line.expected <= 0.0001 ? 'Hết hàng' : line.expected <= line.product.lowStock ? 'Sắp hết' : 'Ổn định',
      }))
    currentStockSheet.getColumn('quantity').numFmt = INVENTORY_EXCEL_QUANTITY_FORMAT
    styleSheet(currentStockSheet, 'TỒN KHO HIỆN TẠI THEO CHI NHÁNH')

    const countSheet = workbook.addWorksheet('Phiếu kiểm kê')
    countSheet.columns = [
      { header: 'Ngày kiểm kê', key: 'date', width: 15 },
      { header: 'Chi nhánh', key: 'branch', width: 25 },
      { header: 'Số phiếu', key: 'reportNo', width: 16 },
      { header: 'Ca', key: 'shift', width: 13 },
      { header: 'Khu vực', key: 'location', width: 28 },
      { header: 'Người lập', key: 'reporter', width: 24 },
      { header: 'Sản phẩm', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku', width: 17 },
      { header: 'Kho đông', key: 'freezer', width: 13 },
      { header: 'Kho phòng', key: 'stockRoom', width: 13 },
      { header: 'Cần đặt', key: 'orderNeeded', width: 13 },
      { header: 'ĐVT', key: 'unit', width: 10 },
      { header: 'Lý do lệch', key: 'varianceReason', width: 32 },
      { header: 'Ghi chú', key: 'note', width: 36 },
    ]
    periodInventoryReports.forEach((report) => {
      report.lines.forEach((line) => {
        const product = productById(line.productId)
        countSheet.addRow({
          date: formatDate(report.reportDate),
          branch: branchName(report.branchId),
          reportNo: report.reportNo,
          shift: report.shift,
          location: report.location,
          reporter: report.reporter,
          product: product?.name || line.productId,
          sku: product?.sku || '-',
          freezer: line.freezerQty,
          stockRoom: line.stockRoomQty,
          orderNeeded: line.orderNeeded,
          unit: product?.unit || 'đơn vị',
          varianceReason: line.varianceReason || '-',
          note: line.note || '-',
        })
      })
    })
    for (const key of ['freezer', 'stockRoom', 'orderNeeded']) {
      countSheet.getColumn(key).numFmt = INVENTORY_EXCEL_QUANTITY_FORMAT
    }
    styleSheet(countSheet, `PHIẾU KIỂM KÊ ${formatDate(from)} - ${formatDate(to)}`)

    await saveWorkbook(workbook, `bao-cao-kho-${from}-${to}.xlsx`)
  }

  function exportSupplyReport() {
    const rows = rangeSupplyRequests.map((req) => [
      formatDate(req.createdAt.slice(0, 10)),
      branchName(req.branchId),
      req.requestedByName,
      req.productName,
      req.quantity,
      req.unit,
      supplyStatusLabel(req.status),
      req.note || '',
    ])
    const csv = [
      ['Ngày', 'Chi nhánh', 'Người đặt', 'Món hàng', 'Số lượng', 'ĐVT', 'Trạng thái', 'Ghi chú'],
      ...rows,
    ].map((line) => line.map(csvCell).join(',')).join('\n')
    download(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `bao-cao-dat-hang-${from}-${to}.csv`)
  }

  function updatePayrollDraft(employeeKey: string, patch: Partial<PayrollDraft>) {
    setPayrollDrafts((drafts) => {
      const nextDraft = { ...emptyPayrollDraft, ...(drafts[employeeKey] || {}), ...patch }
      const employee = employees.find((item) => item.id === employeeKey)
      const payrollRow = payrollRows.find((item) => item.employeeKey === employeeKey)
      window.clearTimeout(payrollSaveTimers.current[employeeKey])
      payrollSaveTimers.current[employeeKey] = window.setTimeout(() => {
        void upsertPayrollEntry(user, {
          employeeId: employeeKey,
          branchId: employee?.branchId || payrollRow?.branchId || '',
          period: payrollPeriod,
          hourlyRate: nextDraft.hourlyRate.trim() === '' ? null : parseMoney(nextDraft.hourlyRate),
          fixedSalary: nextDraft.fixedSalary.trim() === '' ? null : parseMoney(nextDraft.fixedSalary),
          bonus: parseMoney(nextDraft.bonus),
          deduction: parseMoney(nextDraft.deduction),
          evidenceUrl: nextDraft.evidenceUrl.trim(),
          evidenceNote: nextDraft.evidenceNote.trim(),
          note: nextDraft.note,
        }).catch((error) => {
          setError(error instanceof Error ? `Không thể tự lưu lương nhân viên: ${error.message}` : 'Không thể tự lưu lương nhân viên.')
        })
      }, 600)
      return { ...drafts, [employeeKey]: nextDraft }
    })
  }

  function updateRoleDefaultDraft(branchId: string, role: Role, patch: Partial<{ hourlyRate: string; fixedSalary: string }>) {
    const key = roleSlotKey(branchId, role)
    setRoleDefaultDrafts((drafts) => {
      const base = drafts[key] || { hourlyRate: '', fixedSalary: '' }
      const nextDraft = { ...base, ...patch }
      window.clearTimeout(roleDefaultTimers.current[key])
      roleDefaultTimers.current[key] = window.setTimeout(() => {
        void upsertRoleSalaryDefault(user, {
          branchId,
          role,
          hourlyRate: parseMoney(nextDraft.hourlyRate),
          fixedSalary: parseMoney(nextDraft.fixedSalary),
        }).catch((error) => {
          setError(error instanceof Error ? `Không thể tự lưu lương mặc định: ${error.message}` : 'Không thể tự lưu lương mặc định.')
        })
      }, 600)
      return { ...drafts, [key]: nextDraft }
    })
  }

  function updateCommissionRuleDraft(branchId: string, patch: Partial<{ targetRevenue: string; commissionRate: string }>) {
    setCommissionRuleDrafts((drafts) => {
      const base = drafts[branchId] || {
        targetRevenue: String(DEFAULT_REVENUE_TARGET),
        commissionRate: String(DEFAULT_COMMISSION_RATE),
      }
      const nextDraft = { ...base, ...patch }
      window.clearTimeout(commissionRuleTimers.current[branchId])
      commissionRuleTimers.current[branchId] = window.setTimeout(() => {
        void saveCommissionRule(user, {
          branchId,
          targetQuantity: parseMoney(nextDraft.targetRevenue) || DEFAULT_REVENUE_TARGET,
          commissionPerUnit: parsePercent(nextDraft.commissionRate) || DEFAULT_COMMISSION_RATE,
        }).then(() => {
          setFeedback(`Đã lưu KPI doanh số cho ${branchName(branchId)}.`)
        }).catch((error) => {
          setError(error instanceof Error ? error.message : 'Không thể lưu KPI doanh số.')
        })
      }, 600)
      return { ...drafts, [branchId]: nextDraft }
    })
  }

  function setPayrollMonth(month: string) {
    if (!month) return
    setFrom(`${month}-01`)
    setTo(lastDayOfMonth(month))
  }

  function exportPayroll() {
    const rows = payrollRows.map((row) => [
      row.employeeName,
      branchName(row.branchId),
      row.positionTitle,
      row.totalShifts,
      row.totalHours,
      row.workDays,
      row.hourlyRate,
      row.fixedSalary,
      row.basePay,
      row.commission,
      row.dailyBonus,
      row.weeklyBonus,
      row.monthlyBonus,
      row.bonus,
      row.deduction,
      row.grossPay,
      row.note,
    ])
    const csv = [
      ['Nhân viên', 'Chi nhánh', 'Vị trí', 'Ca', 'Giờ công (thập phân)', 'Ngày công', 'Lương giờ', 'Lương cứng', 'Lương công', 'Thưởng KPI', 'Thưởng ngày', 'Thưởng tuần', 'Thưởng tháng', 'Thưởng thêm', 'Trừ', 'Thực nhận', 'Ghi chú'],
      ...rows,
    ].map((line) => line.map(csvCell).join(',')).join('\n')
    download(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `bang-luong-${from}-${to}.csv`)
  }

  async function saveAttendanceCorrection(event: React.FormEvent) {
    event.preventDefault()
    if (!attendanceEdit || attendanceEditSaving) return
    setAttendanceEditSaving(true)
    try {
      await updateAttendanceRecordByAdmin(user, {
        recordId: attendanceEdit.recordId,
        checkInTime: attendanceEdit.checkInTime,
        checkOutTime: attendanceEdit.checkOutTime,
        reason: attendanceEdit.reason,
      })
      await refresh(false)
      setAttendanceEdit(null)
      setFeedback('Đã chỉnh công và đồng bộ lại bảng công, bảng lương.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể chỉnh công cho nhân viên.')
    } finally {
      setAttendanceEditSaving(false)
    }
  }

  async function saveAttendanceDeletion(event: React.FormEvent) {
    event.preventDefault()
    if (!attendanceDelete || attendanceDeleteSaving) return
    setAttendanceDeleteSaving(true)
    try {
      await deleteAttendanceRecordByAdmin(user, {
        recordId: attendanceDelete.recordId,
        reason: attendanceDelete.reason,
      })
      await refresh(false)
      setAttendanceDelete(null)
      setFeedback(`Đã xóa ca công của ${attendanceDelete.employeeName} ngày ${formatDate(attendanceDelete.workDate)} và đồng bộ lại bảng lương.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể xóa ca công của nhân viên.')
    } finally {
      setAttendanceDeleteSaving(false)
    }
  }

  function selectAttendanceListMode(mode: 'date' | 'employee') {
    setAttendanceListMode(mode)
    setAttendanceListPage(1)
    setAttendanceEdit(null)
    setAttendanceDelete(null)
  }

  return (
    <div className="page admin-page">
      {/* Bộ lọc quản lý — ẩn ở màn tạo/quản lý tài khoản vì không lọc theo chi nhánh/ngày */}
      {activeSection !== 'accounts' && (
      <div className="admin-filter-bar admin-date-filters">
          <label>{text.branch}
            <select value={branchId} onChange={(event) => { setBranchId(event.target.value); setEmployeeId('') }}>
              <option value="">{text.allBranches}</option>
              {visibleBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <label>{text.from}<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>{text.to}<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
          <div className="admin-quick-ranges">
            <button onClick={() => setQuickRange('today')}>{text.today}</button>
            <button onClick={() => setQuickRange('month')}>{text.thisMonth}</button>
            <button onClick={() => setQuickRange('previousMonth')}>{text.previousMonth}</button>
          </div>
      </div>
      )}

      {error && <div className="feedback-bar">{error}<button onClick={() => setError('')}>×</button></div>}
      {feedback && <div className="feedback-bar success">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}

      {/* Layout 2 cột: nav trái + nội dung phải */}
      <div className={`admin-layout${focused ? ' focused-management-layout' : ''}`}>
        {!focused && <nav className="management-function-list" aria-label={text.navLabel}>
          <div className="management-function-head">
            <span>Báo cáo</span>
            <strong>{visibleManagementFunctions.length}</strong>
          </div>
          {visibleManagementFunctions.map((item) => (
            <button
              key={item.id}
              className={`management-function-item tone-${item.tone}${activeFunctionId === item.id ? ' active' : ''}`}
              onClick={() => {
                setActiveFunctionId(item.id)
                setActiveSection(item.section)
              }}
            >
              <span className="management-function-icon">{item.icon}</span>
              <span className="management-function-copy">
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              {item.section === 'requests' && pendingRequests > 0 && (
                <span className="admin-section-badge">{pendingRequests}</span>
              )}
              <b>›</b>
            </button>
          ))}
        </nav>}

        {/* Nội dung theo section */}
        <div className="admin-section-content">
          <section className={`management-function-detail tone-${activeFunction.tone}`}>
            <span className="management-function-icon">{activeFunction.icon}</span>
            <div>
              <small>Đang xem</small>
              <h1>{activeFunction.label}</h1>
              <p>{activeFunction.description}</p>
            </div>
            <div className="management-function-metrics">
              {activeFunctionStats.map((stat) => (
                <article key={stat.label}>
                  <span>{stat.label}</span>
                  <strong>{stat.value}</strong>
                </article>
              ))}
            </div>
          </section>

          {/* ===== DOANH THU ===== */}
          {activeSection === 'revenue' && (
            <>
              {/* Overview card: CukCuk Tổng quan style */}
              {(() => {
                const grandTotal = periodRevenueRows.reduce((sum, s) => sum + s.revenue, 0)
                const maxRevenue = Math.max(...selectedBranches.map((b) =>
                  periodRevenueRows.filter((s) => s.branchId === b.id).reduce((sum, s) => sum + s.revenue, 0)
                ), 0)
                const fmtMoney = (n: number) => n >= 1000000 ? `${(n / 1000000).toFixed(1)} tr` : n.toLocaleString('vi-VN') + 'đ'
                return (
                  <div className="rev-overview-card">
                    <div className="rev-overview-head">
                      <span className="rev-overview-label">Doanh thu toàn chuỗi</span>
                      <span className="rev-overview-amount">{fmtMoney(grandTotal)}</span>
                      <span className="rev-overview-sub">{periodRevenueRows.length} ngày có doanh thu · {selectedBranches.length} chi nhánh</span>
                    </div>
                    {selectedBranches.map((branch) => {
                      const snaps = periodRevenueRows.filter((s) => s.branchId === branch.id)
                      const rev = snaps.reduce((sum, s) => sum + s.revenue, 0)
                      const sold = snaps.reduce((sum, s) => sum + s.totalSold, 0)
                      const isTop = rev === maxRevenue && maxRevenue > 0
                      return (
                        <div key={branch.id} className={`rev-branch-row${isTop ? ' top-branch' : ''}`}>
                          <span className="rbn-name">{branch.name}</span>
                          <div className="rbn-right">
                            <span className="rbn-amount">{fmtMoney(rev)}</span>
                            <span className="rbn-meta">{snaps.length} ngày · {sold} sản phẩm</span>
                          </div>
                          <span className="rbn-chevron">›</span>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
              <BusinessProductCharts rows={businessProductRows} />
              <section className="section-card admin-revenue-chart-card">
                <div className="section-title">
                  <div><span className="eyebrow dark">BIỂU ĐỒ DOANH THU</span><h2>Xu hướng theo bộ lọc</h2></div>
                  <span className="date-chip">{formatMoney(adminRevenueTrendRows.reduce((sum, row) => sum + row.revenue, 0))}</span>
                </div>
                <div className="admin-revenue-area-chart">
                  <svg viewBox="0 0 360 160" role="img" aria-label="Bieu do doanh thu theo ngay">
                    <defs>
                      <linearGradient id="adminRevenueFill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#a8d12d" stopOpacity=".44" />
                        <stop offset="100%" stopColor="#1688d8" stopOpacity=".08" />
                      </linearGradient>
                    </defs>
                    <polygon points={adminRevenueArea.fillPoints} fill="url(#adminRevenueFill)" />
                    <polyline points={adminRevenueArea.linePoints} fill="none" stroke="#1688d8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div className="admin-revenue-axis">
                    {adminRevenueTrendRows.filter((_, index) => index === 0 || index === Math.floor(adminRevenueTrendRows.length / 2) || index === adminRevenueTrendRows.length - 1).map((row) => (
                      <span key={row.date}>{formatDate(row.date)}</span>
                    ))}
                  </div>
                </div>
              </section>
              <section className="section-card" style={{ marginTop: 0 }}>
                <div className="section-title">
                  <div><span className="eyebrow dark">DOANH THU THEO NGÀY</span><h2>Tất cả chi nhánh</h2></div>
                  <span className="date-chip">{periodRevenueRows.length} ngày có doanh thu</span>
                </div>
                <div className="rev-day-list">
                  {periodRevenueRows.map((snap) => (
                    <article className="rev-day" key={snap.id}>
                      <div className="rev-day-left">
                        <time>{formatDate(snap.reportDate)}</time>
                        <span className="rev-day-branch">{branchName(snap.branchId)}</span>
                      </div>
                      <div className="rev-day-right">
                        <strong>{snap.revenue.toLocaleString('vi-VN')}đ</strong>
                        <div className="rev-day-chips">
                          <span>{snap.totalSold || 0} sản phẩm</span>
                          {snap.salesRate !== undefined && <span>NS {snap.salesRate}%</span>}
                          {snap.kpi !== undefined && <span>KPI {snap.kpi}%</span>}
                          {snap.grade && <span className="rev-grade">{snap.grade}</span>}
                          <span className={snap.source === 'report' ? 'rev-src done' : 'rev-src draft'}>{snap.source === 'report' ? 'Đã chốt' : 'Tạm tính'}</span>
                        </div>
                      </div>
                    </article>
                  ))}
                  {!periodRevenueRows.length && (
                    <p className="empty-copy">Chưa có báo cáo doanh thu trong khoảng thời gian này. Báo cáo sẽ xuất hiện sau khi ca trưởng bấm “Chốt báo cáo” cuối ngày.</p>
                  )}
                </div>
              </section>
            </>
          )}

          {/* ===== TỔNG QUAN ===== */}
          {activeSection === 'overview' && (
            <>
              {user.role === 'admin' && (
                <section className="section-card active-users-panel" style={{ marginTop: 0, marginBottom: 18 }}>
                  <div className="section-title">
                    <div><span className="eyebrow dark">ONLINE</span><h2>Nguoi dang truy cap</h2></div>
                    <span className="date-chip">{activeUsers.length} online</span>
                  </div>
                  <div className="active-user-list">
                    {activeUsers.map((session) => (
                      <article key={session.userId}>
                        <span><strong>{session.userName}</strong><small>{roleLabel(session.role)} · {branchName(session.branchId)} · {session.page || 'app'}</small></span>
                        <time>{new Date(session.lastSeenAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</time>
                      </article>
                    ))}
                    {!activeUsers.length && <p className="empty-copy">Chua co phien truy cap online trong 2 phut gan day.</p>}
                  </div>
                </section>
              )}
              <section className="admin-stats admin-business-stats">
                <article><span>{text.shiftsDone}</span><strong>{formatNumber(totalShifts)}</strong><small>{text.shiftsHint}</small></article>
                <article><span>{text.hours}</span><strong>{formatDecimalHoursAsDuration(totalHours)}</strong><small>{attendanceRows.length} {text.hoursHint}</small></article>
                <article className={lowStockRows.length ? 'danger' : 'active'}><span>{text.lowStock}</span><strong>{lowStockRows.length}</strong><small>{activeNow} {text.activeHint}</small></article>
                <article className={pendingRequests ? 'warning' : ''}><span>{text.orderRequests}</span><strong>{pendingRequests}</strong><small>{supplyRequests.length} {text.requestsHint}</small></article>
              </section>
              <div className="admin-report-grid" style={{ marginTop: 20 }}>
                <section className="section-card">
                  <div className="section-title">
                    <div><span className="eyebrow dark">{text.archiveEyebrow}</span><h2>{text.archiveTitle}</h2></div>
                    <span className="date-chip">{archiveRows.length} {text.archiveCount}</span>
                  </div>
                  <div className="admin-archive-list">
                    {archiveRows.slice(0, 30).map((row) => <article key={`${row.type}-${row.id}`}>
                      <time>{formatDate(row.date)}</time>
                      <span><strong>{row.type}</strong><small>{branchName(row.branchId)} · {row.detail}</small></span>
                      <b>ĐÃ LƯU</b>
                    </article>)}
                    {!archiveRows.length && <p className="empty-copy">{text.noArchive}</p>}
                  </div>
                </section>
                <section className="section-card admin-waste-report">
                  <div className="section-title">
                    <div><span className="eyebrow dark">{text.wasteEyebrow}</span><h2>{text.wasteTitle}</h2></div>
                    <span className="date-chip">{wasteRows.length} {text.wasteCount}</span>
                  </div>
                  <div className="admin-waste-list">
                    {wasteRows.map((row) => <article key={`${row.branchId}-${row.productId}`}>
                      <span><strong>{row.productName}</strong><small>{branchName(row.branchId)} · {row.count} lượt ghi nhận</small></span>
                      <b>{formatNumber(row.quantity)} {row.unit}</b>
                    </article>)}
                    {!wasteRows.length && <p className="empty-copy">{text.noWaste}</p>}
                  </div>
                </section>
              </div>
            </>
          )}

          {/* ===== CHẤM CÔNG ===== */}
          {activeSection === 'attendance' && (
            <>
            <section className="section-card admin-report-section" style={{ marginTop: 0 }}>
              <div className="section-title">
                <div><span className="eyebrow dark">BẢNG CHẤM CÔNG</span><h2>Chấm công theo ngày, tháng</h2></div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void runExport(
                    'attendance',
                    attendanceRows.length ? '' : 'Chưa có dữ liệu chấm công trong bộ lọc hiện tại để xuất Excel.',
                    exportAttendance,
                    'Đã xuất Excel bảng chấm công.',
                  )}
                  disabled={exportBusy === 'attendance'}
                >{exportBusy === 'attendance' ? 'Đang xuất…' : 'Xuất Excel'}</button>
              </div>
              <div className="table-scroll">
                <table className="data-table attendance-data-table">
                  <thead>
                    <tr>
                      <th>Nhân viên</th>
                      <th>Chi nhánh</th>
                      <th>Tổng ca</th>
                      <th>Tổng giờ</th>
                      <th>Ngày công</th>
                      <th>Đi trễ</th>
                      <th>Vắng</th>
                      <th>Quên checkout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceRows.map((row) => (
                      <tr key={`${row.userId}-${row.branchId}`}>
                        <td><strong>{row.employeeName}</strong></td>
                        <td>{branchName(row.branchId)}</td>
                        <td>{row.totalShifts}</td>
                        <td>{formatDecimalHoursAsDuration(row.totalHours)}</td>
                        <td>{row.workDays}</td>
                        <td className={row.lateCount ? 'warn' : ''}>{row.lateCount}</td>
                        <td className={row.absentCount ? 'warn' : ''}>{row.absentCount}</td>
                        <td className={row.missingCheckoutCount ? 'warn' : ''}>{row.missingCheckoutCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!attendanceRows.length && <p className="empty-copy">Không có dữ liệu chấm công trong khoảng đã chọn.</p>}
            </section>

            <section className="section-card attendance-detail-section">
              <div className="section-title">
                <div className="attendance-cute-heading">
                  <img className="attendance-cute-mascot" src="/mascots/capy-loading-2.png" alt="" aria-hidden="true" />
                  <div>
                    <span className="eyebrow dark">DANH SÁCH CÔNG</span>
                    <h2>Từng ca đã ghi nhận</h2>
                    <p>Tìm theo tên, chọn đúng ngày để chỉnh hoặc xóa ca tạo nhầm. Mọi thay đổi đều được lưu lịch sử và đồng bộ bảng lương.</p>
                  </div>
                </div>
                <span className="date-chip">{attendanceListFilteredRows.length} ca</span>
              </div>
              <div className="attendance-correction-filters">
                <div className="attendance-correction-mode" aria-label="Cách lọc danh sách công">
                  <button
                    type="button"
                    className={attendanceListMode === 'date' ? 'active' : ''}
                    aria-pressed={attendanceListMode === 'date'}
                    onClick={() => selectAttendanceListMode('date')}
                  >Theo ngày</button>
                  <button
                    type="button"
                    className={attendanceListMode === 'employee' ? 'active' : ''}
                    aria-pressed={attendanceListMode === 'employee'}
                    onClick={() => selectAttendanceListMode('employee')}
                  >Theo nhân viên</button>
                </div>
                <label className="attendance-employee-search">Tìm nhân viên
                  <input
                    type="search"
                    value={attendanceEmployeeSearch}
                    placeholder="Tìm tên nhân viên, có thể nhập không dấu…"
                    onChange={(event) => {
                      setAttendanceEmployeeSearch(event.target.value)
                      setAttendanceListEmployeeId('')
                      setAttendanceListPage(1)
                      setAttendanceEdit(null)
                      setAttendanceDelete(null)
                    }}
                  />
                </label>
                {attendanceListMode === 'date' ? (
                  <label>Ngày cần chỉnh
                    <input
                      type="date"
                      min={from}
                      max={to}
                      value={attendanceListDate}
                      onChange={(event) => {
                        if (!event.target.value) return
                        setAttendanceListDate(event.target.value)
                        setAttendanceListPage(1)
                        setAttendanceEdit(null)
                        setAttendanceDelete(null)
                      }}
                      required
                    />
                  </label>
                ) : (
                  <label>Nhân viên cần chỉnh
                    <select
                      value={attendanceListEmployeeId}
                      onChange={(event) => {
                        setAttendanceListEmployeeId(event.target.value)
                        setAttendanceListPage(1)
                        setAttendanceEdit(null)
                        setAttendanceDelete(null)
                      }}
                    >
                      <option value="">Chọn nhân viên</option>
                      {attendanceListVisibleEmployeeOptions.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name} · {branchName(employee.branchId)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="attendance-correction-filter-summary">
                  <strong>{attendanceListFilteredRows.length}</strong>
                  <span>ca phù hợp</span>
                  <small>{attendanceListMode === 'date' ? formatDate(attendanceListDate) : `${formatDate(from)}–${formatDate(to)}`}</small>
                </div>
              </div>
              <div className="attendance-detail-list">
                {attendanceListPageRows.map((row) => (
                  <article key={`${row.registrationId}-${row.attendanceRecordId || 'scheduled'}`}>
                    <div className="attendance-detail-date">
                      <strong>{formatDate(row.workDate)}</strong>
                      <small>{row.scheduledStart}–{row.scheduledEnd || '—'}</small>
                    </div>
                    <div className="attendance-detail-person">
                      <strong>{row.employeeName}</strong>
                      <small>{branchName(row.branchId)}</small>
                    </div>
                    <div className="attendance-detail-clock">
                      <span><small>Vào thực tế</small><b>{row.checkInTime ? formatDateTime(row.checkInTime) : 'Chưa có'}</b></span>
                      <span><small>Ra thực tế</small><b>{row.checkOutTime ? formatDateTime(row.checkOutTime) : 'Chưa có'}</b></span>
                    </div>
                    <div className="attendance-detail-result">
                      <span className={`attendance-state ${row.status}`}>{attendanceDetailStatus(row.status)}</span>
                      <strong>{formatWorkDurationBetween(row.checkInTime, row.checkOutTime)}</strong>
                    </div>
                    {row.attendanceRecordId ? (
                      <div className="attendance-record-actions">
                        <button
                          type="button"
                          className="mini-button attendance-edit-button"
                          onClick={() => {
                            setAttendanceDelete(null)
                            setAttendanceEdit({
                              recordId: row.attendanceRecordId!,
                              employeeName: row.employeeName,
                              checkInTime: toDateTimeLocalValue(row.checkInTime),
                              checkOutTime: toDateTimeLocalValue(row.checkOutTime),
                              reason: '',
                            })
                          }}
                        >Chỉnh công</button>
                        <button
                          type="button"
                          className="mini-button attendance-delete-button"
                          onClick={() => {
                            setAttendanceEdit(null)
                            setAttendanceDelete({
                              recordId: row.attendanceRecordId!,
                              employeeName: row.employeeName,
                              workDate: row.workDate,
                              reason: '',
                            })
                          }}
                        >Xóa ca công</button>
                      </div>
                    ) : <span className="attendance-no-record">Chưa có bản ghi</span>}

                    {attendanceEdit && attendanceEdit.recordId === row.attendanceRecordId && (
                      <form className="attendance-correction-form" onSubmit={saveAttendanceCorrection}>
                        <div>
                          <strong>Chỉnh công · {attendanceEdit.employeeName}</strong>
                          <small>Mọi thay đổi được lưu lịch sử và đồng bộ vào bảng lương.</small>
                        </div>
                        <label>Giờ vào
                          <input type="datetime-local" value={attendanceEdit.checkInTime} onChange={(event) => setAttendanceEdit((current) => current ? { ...current, checkInTime: event.target.value } : current)} required />
                        </label>
                        <label>Giờ ra
                          <input type="datetime-local" value={attendanceEdit.checkOutTime} onChange={(event) => setAttendanceEdit((current) => current ? { ...current, checkOutTime: event.target.value } : current)} required />
                        </label>
                        <label className="attendance-correction-reason">Lý do điều chỉnh
                          <input value={attendanceEdit.reason} minLength={3} onChange={(event) => setAttendanceEdit((current) => current ? { ...current, reason: event.target.value } : current)} placeholder="Ví dụ: thiết bị lỗi không ghi nhận đúng giờ" required />
                        </label>
                        <div className="attendance-correction-actions">
                          <button type="button" className="secondary-button" onClick={() => setAttendanceEdit(null)} disabled={attendanceEditSaving}>Hủy</button>
                          <button type="submit" className="primary-button" disabled={attendanceEditSaving}>{attendanceEditSaving ? 'Đang lưu…' : 'Lưu & đồng bộ'}</button>
                        </div>
                      </form>
                    )}

                    {attendanceDelete && attendanceDelete.recordId === row.attendanceRecordId && (
                      <form className="attendance-delete-confirm" onSubmit={saveAttendanceDeletion}>
                        <div>
                          <strong>Xóa ca công · {attendanceDelete.employeeName}</strong>
                          <small>Ngày {formatDate(attendanceDelete.workDate)} · Chỉ bản ghi này bị xóa; lịch đăng ký ca vẫn được giữ lại.</small>
                        </div>
                        <label>Lý do xóa
                          <input
                            value={attendanceDelete.reason}
                            minLength={3}
                            onChange={(event) => setAttendanceDelete((current) => current ? { ...current, reason: event.target.value } : current)}
                            placeholder="Ví dụ: tạo nhầm nhân viên hoặc nhầm ngày"
                            required
                            autoFocus
                          />
                        </label>
                        <div className="attendance-delete-actions">
                          <button type="button" className="secondary-button" onClick={() => setAttendanceDelete(null)} disabled={attendanceDeleteSaving}>Giữ lại</button>
                          <button type="submit" className="attendance-delete-confirm-button" disabled={attendanceDeleteSaving}>
                            {attendanceDeleteSaving ? 'Đang xóa…' : 'Xác nhận xóa ca'}
                          </button>
                        </div>
                      </form>
                    )}
                  </article>
                ))}
                {!attendanceListPageRows.length && (
                  <p className="empty-copy">
                    {attendanceListMode === 'employee' && !attendanceListEmployeeId && !attendanceEmployeeSearchKey
                      ? 'Tìm tên hoặc chọn một nhân viên để xem các ca trong khoảng ngày phía trên.'
                      : 'Không có ca nào phù hợp với lựa chọn hiện tại.'}
                  </p>
                )}
              </div>
              {attendanceListFilteredRows.length > ATTENDANCE_EDIT_PAGE_SIZE && (
                <div className="attendance-correction-pagination" aria-label="Phân trang danh sách công">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={attendanceListSafePage <= 1}
                    onClick={() => { setAttendanceListPage((current) => Math.max(1, current - 1)); setAttendanceEdit(null) }}
                  >← Trang trước</button>
                  <span>
                    <strong>Trang {attendanceListSafePage}/{attendanceListTotalPages}</strong>
                    <small>
                      Ca {attendanceListPageStart + 1}–{Math.min(attendanceListPageStart + ATTENDANCE_EDIT_PAGE_SIZE, attendanceListFilteredRows.length)} / {attendanceListFilteredRows.length}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={attendanceListSafePage >= attendanceListTotalPages}
                    onClick={() => { setAttendanceListPage((current) => Math.min(attendanceListTotalPages, current + 1)); setAttendanceEdit(null) }}
                  >Trang sau →</button>
                </div>
              )}
            </section>
            </>
          )}

          {activeSection === 'attendance' && <AttendanceAdjustmentArchive user={user} />}

          {/* ===== KPI DOANH THU ===== */}
          {activeSection === 'commission' && (
            <section className="section-card commission-section" style={{ marginTop: 0 }}>
              <div className="section-title">
                <div><span className="eyebrow dark">KPI DOANH THU</span><h2>Tổng kết bán hàng theo nhân viên</h2></div>
                <div className="section-actions">
                  <span className="date-chip">{commissionRows.filter((row) => row.achieved).length} người đạt KPI</span>
                  <button type="button" className="secondary-button" disabled={exportBusy === 'competition-image'} onClick={() => void exportCompetitionImage()}>
                    {exportBusy === 'competition-image' ? 'Đang xuất…' : 'Xuất ảnh thi đua'}
                  </button>
                </div>
              </div>
              <div className="commission-note">
                KPI nhân viên được tính theo từng ngày từ bảng KPI vị trí/chi nhánh. Quản lý chỉ theo dõi doanh thu, doanh số và kho; không chỉnh KPI bán hàng tại màn hình này.
              </div>
              <EmployeeCompetitionPoster
                posterRef={competitionPosterRef}
                rows={monthlyCompetitionRows}
                from={rankingMonthFrom}
                to={rankingMonthTo}
                branchLabel={branchId ? branchName(branchId) : 'Toàn hệ thống'}
              />
              <div className="competition-ranking-toolbar">
                <div>
                  <span className="eyebrow dark">BẢNG XẾP HẠNG</span>
                  <h3>Phân loại thi đua</h3>
                  <p>Dùng chung một bảng; đổi phân loại để xem theo ngày, theo tháng hoặc ca trưởng.</p>
                </div>
                <div className="competition-ranking-controls">
                  <label>Phân loại
                    <select
                      aria-label="Phân loại bảng thi đua"
                      value={competitionRankingMode}
                      onChange={(event) => setCompetitionRankingMode(event.target.value as 'daily' | 'monthly' | 'leaders')}
                    >
                      <option value="daily">Theo ngày</option>
                      <option value="monthly">Theo tháng</option>
                      <option value="leaders">Ca trưởng theo tháng</option>
                    </select>
                  </label>
                  {competitionRankingMode === 'daily' && <label>Ngày xem
                    <input
                      type="date"
                      min={from}
                      max={to}
                      value={competitionDate}
                      onChange={(event) => { if (event.target.value) setCompetitionDate(event.target.value) }}
                    />
                  </label>}
                </div>
              </div>
              <CompetitionClassificationTable
                title={competitionRankingTitle}
                rows={competitionRankingRows}
                showReward={competitionRankingMode !== 'leaders'}
              />
              <div className="adm-list">
                {commissionRows.map((row) => (
                  <article className="adm-row" key={`${row.branchId}-${row.employeeKey}`}>
                    <div className="adm-row-head">
                      <div className="adm-row-id"><strong>{row.employeeName}</strong><small>{branchName(row.branchId)}</small></div>
                      <div className="adm-row-hero"><b className="adm-hero-money">{row.commission.toLocaleString('vi-VN')}đ</b><span>thưởng KPI</span></div>
                    </div>
                    <div className="adm-metrics">
                      <span><i>Giờ công</i><b>{formatDecimalHoursAsDuration(row.totalHours)}</b></span>
                      <span><i>Doanh thu</i><b>{formatMoney(row.revenue)}</b></span>
                      <span><i>KPI doanh thu</i><b>{formatMoney(row.targetQuantity)}</b></span>
                      <span className={row.rank === 'A' || row.rank === 'S+' ? 'ok' : row.rank === 'D' ? 'warn' : 'amber'}><i>Xếp hạng</i><b>{row.rank}</b></span>
                      <span><i>Thưởng ngày</i><b>{formatMoney(row.dailyBonus)}</b></span>
                      <span><i>Thưởng tuần</i><b>{formatMoney(row.weeklyBonus)}</b></span>
                      <span className={row.achieved ? 'ok' : 'amber'}><i>Tỷ lệ</i><b>{formatNumber(row.progress)}%</b></span>
                    </div>
                  </article>
                ))}
                {!commissionRows.length && <p className="empty-copy">Chưa có lượt bán đã đối soát trong kỳ.</p>}
              </div>
              <p className="commission-note">KPI chỉ tính cho staff/ca trưởng có chi nhánh hợp lệ. Thưởng KPI ngày/tuần được cộng tự động vào bảng lương tháng.</p>
            </section>
          )}

          {/* ===== BẢNG LƯƠNG (khôi phục §27 Phase 4: đồng bộ bảng công → lương) ===== */}
          {activeSection === 'payroll' && (
            <section className="section-card payroll-section" style={{ marginTop: 0 }}>
              <div className="section-title">
                <div><span className="eyebrow dark">BẢNG LƯƠNG</span><h2>Lương tháng {formatMonthLabel(payrollPeriod)}</h2></div>
                <div className="section-actions">
                  <label className="payroll-month-pick">Kỳ lương
                    <input type="month" value={payrollPeriod} onChange={(event) => setPayrollMonth(event.target.value)} />
                  </label>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void runExport(
                      'payroll',
                      payrollRows.length ? '' : 'Chưa có dữ liệu lương trong kỳ hiện tại để tải CSV.',
                      exportPayroll,
                      'Đã tải CSV bảng lương.',
                    )}
                    disabled={exportBusy === 'payroll'}
                  >{exportBusy === 'payroll' ? 'Đang tải…' : 'Tải CSV'}</button>
                </div>
              </div>
              <div className="payroll-summary-grid">
                <article><span>Lương công</span><strong>{formatMoney(payrollTotals.basePay)}</strong></article>
                <article><span>Thưởng KPI</span><strong>{formatMoney(payrollTotals.commission)}</strong></article>
                <article><span>Thưởng / trừ</span><strong>{formatMoney(payrollTotals.bonus - payrollTotals.deduction)}</strong></article>
                <article className="total"><span>Thực nhận</span><strong>{formatMoney(payrollTotals.grossPay)}</strong></article>
              </div>

              <div className="payroll-defaults">
                <div className="payroll-defaults-head">
                  <strong>Lương mặc định theo vai trò</strong>
                  <span>áp dụng khi không nhập riêng cho từng người</span>
                </div>
                {payrollRoleSlots.length ? (
                  <div className="payroll-default-grid">
                    {payrollRoleSlots.map((slot) => {
                      const key = roleSlotKey(slot.branchId, slot.role)
                      const draft = roleDefaultDrafts[key] || { hourlyRate: '', fixedSalary: '' }
                      return (
                        <article key={key}>
                          <strong>{branchName(slot.branchId)} · {roleLabel(slot.role)}</strong>
                          <label>Lương giờ
                            <input inputMode="numeric" value={draft.hourlyRate} placeholder="0"
                              onChange={(event) => updateRoleDefaultDraft(slot.branchId, slot.role, { hourlyRate: cleanMoneyInput(event.target.value) })} />
                          </label>
                          <label>Lương cứng / tháng
                            <input inputMode="numeric" value={draft.fixedSalary} placeholder="0"
                              onChange={(event) => updateRoleDefaultDraft(slot.branchId, slot.role, { fixedSalary: cleanMoneyInput(event.target.value) })} />
                          </label>
                        </article>
                      )
                    })}
                  </div>
                ) : <p className="empty-copy">Chưa có nhân viên (ngoài admin/bếp) trong bộ lọc để đặt lương.</p>}
              </div>

              <div className="adm-list payroll-card-list">
                {payrollRows.map((row) => (
                  <article className="adm-row payroll-card" key={row.employeeKey}>
                    <div className="adm-row-head">
                      <div className="adm-row-id"><strong>{row.employeeName}</strong><small>{branchName(row.branchId)} · {row.positionTitle}</small></div>
                      <div className="adm-row-hero"><b className="adm-hero-money">{formatMoney(row.grossPay)}</b><span>thực nhận</span></div>
                    </div>
                    <div className="adm-metrics">
                      <span><i>Công</i><b>{formatDecimalHoursAsDuration(row.totalHours)}</b></span>
                      <span><i>Ngày · ca</i><b>{formatNumber(row.workDays)} · {row.totalShifts}</b></span>
                      <span><i>Lương công</i><b>{formatMoney(row.basePay)}</b></span>
                      <span className="ok"><i>Thưởng KPI</i><b>{formatMoney(row.dailyBonus + row.weeklyBonus)}</b></span>
                      <span><i>Ngày đạt KPI</i><b>{row.achievedDays} ngày · {formatNumber(row.kpiProgress)}%</b></span>
                    </div>
                    <p className="payroll-basepay-formula">
                      {row.fixedSalary > 0
                        ? <>Lương công = lương cứng <b>{formatMoney(row.fixedSalary)}</b></>
                        : <>Lương công = <b>{formatDecimalHoursAsDuration(row.totalHours)}</b> (<b>{formatNumber(row.totalHours)}</b> giờ thập phân) × <b>{formatMoney(row.hourlyRate)}</b>/giờ = <b>{formatMoney(row.basePay)}</b></>}
                    </p>
                    <div className="payroll-bonus-breakdown">
                      <span>KPI <b>{formatNumber(row.kpiProgress)}% · {row.achievedDays} ngày đạt</b></span>
                      <span>Ngày <b>{formatMoney(row.dailyBonus)}</b></span>
                      <span>Tuần <b>{formatMoney(row.weeklyBonus)}</b></span>
                    </div>
                    <div className="payroll-inputs">
                      <label>Lương giờ
                        <input className="payroll-money-input" inputMode="numeric" value={row.draft.hourlyRate}
                          placeholder={row.roleHourlyDefault ? `MĐ ${formatNumber(row.roleHourlyDefault)}` : '0'}
                          onChange={(event) => updatePayrollDraft(row.employeeKey, { hourlyRate: cleanMoneyInput(event.target.value) })} />
                      </label>
                      <label>Lương cứng
                        <input className="payroll-money-input" inputMode="numeric" value={row.draft.fixedSalary}
                          placeholder={row.roleFixedDefault ? `MĐ ${formatNumber(row.roleFixedDefault)}` : '0'}
                          onChange={(event) => updatePayrollDraft(row.employeeKey, { fixedSalary: cleanMoneyInput(event.target.value) })} />
                      </label>
                      <label>Thưởng
                        <input className="payroll-money-input" inputMode="numeric" value={row.draft.bonus} placeholder="0"
                          onChange={(event) => updatePayrollDraft(row.employeeKey, { bonus: cleanMoneyInput(event.target.value) })} />
                      </label>
                      <label>Trừ
                        <input className="payroll-money-input" inputMode="numeric" value={row.draft.deduction} placeholder="0"
                          onChange={(event) => updatePayrollDraft(row.employeeKey, { deduction: cleanMoneyInput(event.target.value) })} />
                      </label>
                      <label className="wide">Ghi chú
                        <input className="payroll-note-input" value={row.draft.note} placeholder="Ứng lương, thưởng KPI..."
                          onChange={(event) => updatePayrollDraft(row.employeeKey, { note: event.target.value })} />
                      </label>
                    </div>
                  </article>
                ))}
                {!payrollRows.length && <p className="empty-copy">Chưa có nhân viên phù hợp bộ lọc để lập bảng lương.</p>}
              </div>
              <p className="commission-note">Lương được lưu theo <b>từng tháng</b> và đồng bộ nhiều thiết bị (Supabase; tạm lưu trên máy nếu chưa chạy migration). Bảng công và thưởng KPI lấy tự động theo kỳ lương. Lương công = lương cứng nếu có, ngược lại = giờ công × lương giờ.</p>
            </section>
          )}

          {/* ===== CHI TIẾT KPI THEO NGÀY (nguồn thưởng cộng vào bảng lương ở trên) ===== */}
          {activeSection === 'payroll' && (
            <section className="section-card payroll-section">
              <div className="section-title">
                <div><span className="eyebrow dark">CHI TIẾT KPI THEO NGÀY</span><h2>KPI & thưởng theo ngày</h2></div>
                <span className="date-chip">{dailyKpiRows.length} dòng KPI</span>
              </div>
              <div className="payroll-summary-grid">
                <article><span>Doanh thu KPI</span><strong>{formatMoney(dailyKpiRows.reduce((sum, row) => sum + row.revenue, 0))}</strong></article>
                <article><span>Ngày có KPI</span><strong>{dailyKpiRows.length}</strong></article>
                <article><span>Đạt KPI</span><strong>{dailyKpiRows.filter((row) => row.progress >= 100).length}</strong></article>
                <article className="total"><span>Thưởng ngày</span><strong>{formatMoney(dailyKpiRows.reduce((sum, row) => sum + row.dailyBonus, 0))}</strong></article>
              </div>
              <div className="table-scroll">
                <table className="data-table kpi-daily-table">
                  <thead>
                    <tr>
                      <th>Ngày</th>
                      <th>Chi nhánh</th>
                      <th>Nhân viên</th>
                      <th>Vị trí</th>
                      <th>Giờ công</th>
                      <th>Sản phẩm bán</th>
                      <th>Doanh thu ngày</th>
                      <th>KPI ngày</th>
                      <th>% đạt</th>
                      <th>Hạng</th>
                      <th>Thưởng ngày</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyKpiRows.map((row) => (
                      <tr key={`${row.date}-${row.branchId}-${row.employeeKey}`}>
                        <td>{formatDate(row.date)}</td>
                        <td>{branchName(row.branchId)}</td>
                        <td><strong>{row.employeeName}</strong></td>
                        <td>{row.positionTitle}</td>
                        <td>{formatDecimalHoursAsDuration(row.totalHours)}</td>
                        <td>{formatNumber(row.soldQuantity)}</td>
                        <td>{formatMoney(row.revenue)}</td>
                        <td>{formatMoney(row.targetRevenue)}</td>
                        <td className={row.progress >= 100 ? 'ok' : row.progress >= 80 ? 'amber' : 'warn'}>{formatNumber(row.progress)}%</td>
                        <td>{row.rank}</td>
                        <td>{formatMoney(row.dailyBonus)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!dailyKpiRows.length && <p className="empty-copy">Chưa có doanh thu KPI trong khoảng đã chọn.</p>}
              <p className="commission-note">Thưởng KPI theo ngày ở bảng này được cộng tự động vào cột Thưởng KPI của bảng lương phía trên.</p>
            </section>
          )}

          {/* ===== BÁO CÁO KHO ===== */}
          {activeSection === 'inventory' && (
            <section className="section-card admin-report-section" style={{ marginTop: 0 }}>
              <div className="section-title">
                <div><span className="eyebrow dark">BÁO CÁO KHO</span><h2>Nhập, xuất, hao hụt và tồn kho trong kỳ</h2></div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void runExport(
                    'inventory',
                    stockRows.length ? '' : 'Chưa có dữ liệu kho trong bộ lọc hiện tại để xuất Excel.',
                    exportInventory,
                    'Đã xuất Excel báo cáo kho.',
                  )}
                  disabled={exportBusy === 'inventory'}
                >{exportBusy === 'inventory' ? 'Đang xuất…' : 'Xuất Excel'}</button>
              </div>
              <div className="admin-inventory-overview">
                <div className="admin-inventory-overview-copy">
                  <span>TỔNG QUAN KHO</span>
                  <strong>{branchId ? branchName(branchId) : `${inventoryOverview.branches} chi nhánh`}</strong>
                  <small>{formatDate(from)} — {formatDate(to)} · dữ liệu tự đồng bộ</small>
                </div>
                <article><span>SKU đang có tồn</span><b>{inventoryOverview.stockedSkus}</b><small>Tồn hiện tại lớn hơn 0</small></article>
                <article className={inventoryOverview.lowSkus ? 'warning' : 'good'}><span>Cần chú ý</span><b>{inventoryOverview.lowSkus}</b><small>SKU chạm ngưỡng sắp hết</small></article>
                <article><span>Phát sinh trong kỳ</span><b>{inventoryOverview.movements}</b><small>Dòng nhập, xuất, kiểm kê, hao hụt</small></article>
              </div>
              <div className="inventory-branch-section">
                <div className="inventory-branch-section-head">
                  <div>
                    <span className="eyebrow dark">KHO THEO CHI NHÁNH</span>
                    <h3>Tình trạng tồn và luân chuyển hàng hóa</h3>
                    <p>Chọn một chi nhánh để xem tồn từng SKU. Danh sách chi nhánh luôn được giữ nguyên phía trên.</p>
                  </div>
                  <span className="inventory-branch-count">{branchInventorySummaries.length} điểm bán</span>
                </div>

                <div className="inventory-branch-grid">
                  {branchInventorySummaries.map(({ branch, lowCount, lossRate, stockLines, stockSummary, inboundSummary, dailyPosSummary }) => {
                    const isSelected = inventoryDetailBranchId === branch.id
                    const stockedCount = stockLines.filter((line) => line.expected > 0.0001).length
                    return (
                      <button
                        type="button"
                        className={`inventory-branch-card${isSelected ? ' selected' : ''}`}
                        key={branch.id}
                        aria-expanded={isSelected}
                        aria-controls="inventory-branch-detail-panel"
                        onClick={() => setInventoryDetailBranchId((current) => current === branch.id ? '' : branch.id)}
                      >
                        <span className="inventory-branch-card-head">
                          <span className="inventory-branch-symbol" aria-hidden="true">▦</span>
                          <span className="inventory-branch-identity">
                            <strong>{branch.name}</strong>
                            <small>{stockedCount} SKU đang có tồn</small>
                          </span>
                          <span className="inventory-branch-action">{isSelected ? 'Thu gọn' : 'Xem chi tiết'} <i aria-hidden="true">⌄</i></span>
                        </span>
                        <span className="inventory-branch-card-metrics">
                          <span><small>Tồn hiện tại</small><b>{stockSummary}</b></span>
                          <span><small>Nhập trong kỳ</small><b>{inboundSummary}</b></span>
                          <span><small>POS bán trong kỳ</small><b>{dailyPosSummary}</b></span>
                        </span>
                        <span className="inventory-branch-card-footer">
                          <span className={`inventory-health ${lowCount ? 'warning' : 'good'}`}>{lowCount ? `${lowCount} SKU sắp hết` : 'Tồn kho ổn định'}</span>
                          <span className={`inventory-health ${lossRate > 12 ? 'danger' : lossRate > 7 ? 'warning' : 'good'}`}>Hao hụt {formatInventoryDecimal(lossRate, 1)}%</span>
                        </span>
                      </button>
                    )
                  })}
                  {!branchInventorySummaries.length && <p className="empty-copy">Chưa có chi nhánh nào để hiển thị.</p>}
                </div>

                {inventoryDetailSummary && (
                  <section className="inventory-branch-detail-shell" id="inventory-branch-detail-panel" aria-live="polite">
                    <header className="inventory-branch-detail-head">
                      <div>
                        <span className="eyebrow dark">CHI TIẾT TỒN KHO</span>
                        <h3>{inventoryDetailSummary.branch.name}</h3>
                        <p>Mỗi số lượng luôn kèm đúng đơn vị kg, g hoặc cái; không cộng lẫn các đơn vị.</p>
                      </div>
                      <button type="button" className="inventory-detail-close" onClick={() => setInventoryDetailBranchId('')} aria-label="Đóng chi tiết chi nhánh">×</button>
                    </header>

                    <div className="inventory-branch-detail-metrics">
                      <div><span>Tồn hiện tại</span><b>{inventoryDetailSummary.stockSummary}</b></div>
                      <div className={inventoryDetailSummary.lowCount ? 'warning' : ''}><span>SKU sắp hết</span><b>{inventoryDetailSummary.lowCount} SKU</b></div>
                      <div><span>Nhập trong kỳ</span><b>{inventoryDetailSummary.inboundSummary}</b></div>
                      <div><span>Xuất trong kỳ</span><b>{inventoryDetailSummary.outboundSummary}</b></div>
                      <div className={inventoryDetailSummary.lossQty ? 'danger' : ''}><span>Hao hụt</span><b>{inventoryDetailSummary.lossSummary}</b></div>
                    </div>

                    <div className="inventory-branch-detail-content">
                      <div className="inventory-stock-table" role="table" aria-label={`Tồn kho ${inventoryDetailSummary.branch.name}`}>
                        <div className="inventory-stock-head" role="row">
                          <span>Sản phẩm / SKU</span>
                          <span>Tồn hiện tại</span>
                          <span>Trạng thái</span>
                        </div>
                        {inventoryDetailSummary.stockLines.slice().sort((a, b) => a.product.name.localeCompare(b.product.name, 'vi')).map((line) => {
                          const isOut = line.expected <= 0.0001
                          const isLow = !isOut && line.expected <= line.product.lowStock
                          return (
                            <article className={`inventory-stock-row${isOut ? ' out' : isLow ? ' warning' : ''}`} role="row" key={line.product.id}>
                              <span className="inventory-stock-product" role="cell"><strong>{line.product.name}</strong><small>{line.product.sku}</small></span>
                              <span className="inventory-stock-value" role="cell"><b>{formatInventoryQuantity(line.expected, line.product.unit)}</b></span>
                              <span role="cell"><b className={`inventory-stock-status ${isOut ? 'out' : isLow ? 'warning' : 'good'}`}>{isOut ? 'Hết hàng' : isLow ? 'Sắp hết' : 'Ổn định'}</b></span>
                            </article>
                          )
                        })}
                      </div>

                      <aside className="inventory-loss-panel">
                        <span className="eyebrow dark">Hao hụt cần chú ý</span>
                        <strong>{formatInventoryDecimal(inventoryDetailSummary.lossRate, 1)}%</strong>
                        <small>Tỷ lệ hao hụt trong khoảng ngày đã chọn</small>
                        <div className="inventory-loss-progress" aria-hidden="true"><span style={{ width: `${Math.min(inventoryDetailSummary.lossRate, 100)}%` }} /></div>
                        {inventoryDetailSummary.topLoss.length > 0 ? (
                          <ul>
                            {inventoryDetailSummary.topLoss.map((row) => (
                              <li key={row.product.id}><span><b>{row.product.name}</b><small>{row.product.sku}</small></span><strong>{formatInventoryQuantity(row.waste, row.product.unit)}</strong></li>
                            ))}
                          </ul>
                        ) : <p>Chưa ghi nhận hao hụt trong kỳ.</p>}
                      </aside>
                    </div>
                  </section>
                )}
              </div>
              <section className="inventory-shift-reconciliation">
                <header className="inventory-shift-reconciliation-head">
                  <div>
                    <span className="eyebrow dark">ĐỐI CHIẾU THEO CA</span>
                    <h3>Xuất bán và tồn bàn giao</h3>
                    <p>Out chính thức = Tồn đầu + Nhập thêm − Tồn bàn giao − Hao hụt. POS chỉ dùng để đối chiếu, không trừ kho lần hai.</p>
                  </div>
                  <div className="inventory-shift-period-fields">
                    <label>Từ ngày
                      <input type="date" max={to} value={from} onChange={(event) => { if (event.target.value) setFrom(event.target.value) }} required />
                    </label>
                    <label>Đến ngày
                      <input type="date" min={from} value={to} onChange={(event) => { if (event.target.value) setTo(event.target.value) }} required />
                    </label>
                  </div>
                </header>
                <div className="inventory-shift-reconciliation-summary">
                  <span><small>Ca đã bàn giao</small><strong>{inventoryClosedShiftCount}/{inventoryShiftReconciliationRows.length} ca</strong></span>
                  <span><small>POS đã bán</small><strong>{inventoryShiftPosSummary}</strong></span>
                  <span><small>Out chính thức</small><strong>{inventoryShiftOfficialOutSummary}</strong></span>
                  <span><small>Phiếu xuất riêng</small><strong>{inventoryDailyOutboundDocumentCount} phiếu · {inventoryDailyOutboundSummary}</strong></span>
                </div>
                <div className="inventory-shift-reconciliation-table" role="table" aria-label={`Đối chiếu xuất bán theo ca từ ${formatDate(from)} đến ${formatDate(to)}`}>
                  <div className="inventory-shift-reconciliation-table-head" role="row">
                    <span>Chi nhánh / ca</span>
                    <span>Trạng thái</span>
                    <span>Tồn đầu</span>
                    <span>Nhập thêm</span>
                    <span>POS đã bán</span>
                    <span>Hao hụt</span>
                    <span>Tồn bàn giao</span>
                    <span>Out chính thức</span>
                    <span>Chênh lệch</span>
                  </div>
                  {inventoryShiftReconciliationRows.map((row) => (
                    <article className={`inventory-shift-reconciliation-row ${row.status}`} role="row" key={row.sessionId}>
                      <span data-label="Chi nhánh / ca" role="cell">
                        <strong>{branchName(row.branchId)}</strong>
                        <small>{formatDate(row.businessDate)} · Ca {row.sequence} · {formatShiftTime(row.startedAt, row.endedAt)}</small>
                      </span>
                      <span data-label="Trạng thái" role="cell">
                        <b className={`inventory-shift-status ${row.status}`}>
                          {row.status === 'open' ? 'Ca đang mở · POS tạm tính' : 'Đã bàn giao'}
                        </b>
                        <small>{row.receiptCount} hóa đơn · {formatMoney(row.posRevenue)}</small>
                      </span>
                      <span data-label="Tồn đầu" role="cell"><b>{row.openingSummary}</b></span>
                      <span data-label="Nhập thêm" role="cell"><b>{row.additionSummary}</b></span>
                      <span data-label="POS đã bán" role="cell"><b>{row.posNativeSummary}</b><small>{row.posEquivalentSummary}</small></span>
                      <span data-label="Hao hụt" role="cell"><b>{row.wasteSummary}</b></span>
                      <span data-label="Tồn bàn giao" role="cell"><b>{row.closingSummary}</b></span>
                      <span data-label="Out chính thức" role="cell"><b>{row.officialOutSummary}</b></span>
                      <span data-label="Chênh lệch" role="cell"><b className={row.differenceTone}>{row.differenceLabel}</b></span>
                      <details className="inventory-shift-reconciliation-details">
                        <summary>Chi tiết đối chiếu theo SKU</summary>
                        <div className="inventory-shift-reconciliation-lines">
                          <div className="inventory-shift-reconciliation-line head">
                            <span>Sản phẩm nguồn</span><span>Tồn đầu</span><span>Nhập thêm</span><span>POS quy đổi</span>
                            <span>Hao hụt</span><span>Tồn cuối</span><span>Out</span><span>Lệch</span>
                          </div>
                          {row.lines.map((line) => (
                            <div className="inventory-shift-reconciliation-line" key={line.productId}>
                              <span data-label="Sản phẩm nguồn"><strong>{line.productName}</strong><small>{line.sku}</small></span>
                              <span data-label="Tồn đầu">{formatInventoryQuantity(line.opening, line.unit)}</span>
                              <span data-label="Nhập thêm">{formatInventoryQuantity(line.additions, line.unit)}</span>
                              <span data-label="POS quy đổi">{formatInventoryQuantity(line.posEquivalent, line.unit)}</span>
                              <span data-label="Hao hụt">{formatInventoryQuantity(line.waste, line.unit)}</span>
                              <span data-label="Tồn cuối">{line.closing === null ? 'Chưa bàn giao' : formatInventoryQuantity(line.closing, line.unit)}</span>
                              <span data-label="Out">{line.officialOut === null ? 'Chưa chốt' : formatInventoryQuantity(line.officialOut, line.unit)}</span>
                              <span data-label="Lệch">{line.difference === null ? 'Chưa đối chiếu' : formatInventoryQuantity(line.difference, line.unit)}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    </article>
                  ))}
                  {!inventoryShiftReconciliationRows.length && <p className="empty-copy">Không có ca vận hành trong khoảng ngày và chi nhánh đã chọn.</p>}
                </div>
              </section>
              {user.role === 'admin' && <div className="admin-inventory-ledger" role="table" aria-label="Danh sách phát sinh kho">
                <div className="admin-inventory-ledger-head" role="row">
                  <span>Ngày</span>
                  <span>Chi nhánh</span>
                  <span>Loại</span>
                  <span>Thành phẩm / SKU</span>
                  <span>Số lượng</span>
                  <span>Người nhập</span>
                  <span>Ghi chú</span>
                </div>
                {inventoryLedgerByDay.map(([date, rows], index) => (
                  <details className="admin-ledger-day" key={date} open={index === 0}>
                    <summary>
                      <span><strong>{formatDate(date)}</strong><small>{rows.length} phát sinh kho</small></span>
                      <span className="admin-ledger-day-count">{new Set(rows.map((row) => row.branchId)).size} chi nhánh</span>
                    </summary>
                    {rows.map((movement) => {
                      const product = productById(movement.productId)
                      const creator = employees.find((employee) => employee.id === movement.createdBy)
                      return (
                        <article className="admin-inventory-ledger-row" role="row" key={movement.id}>
                          <span data-label="Ngày"><strong>{formatDate(movement.shiftDate)}</strong><small>{formatDateTime(movement.createdAt)}</small></span>
                          <span data-label="Chi nhánh">{branchName(movement.branchId)}</span>
                          <span data-label="Loại"><b className={`inventory-movement-chip ${movement.type}`}>{MOVEMENT_LABELS[movement.type]}</b></span>
                          <span data-label="Thành phẩm / SKU"><strong>{product?.name || movement.productId}</strong><small>{product?.sku || '-'}</small></span>
                          <span data-label="Số lượng"><b>{formatInventoryQuantity(movement.quantity, product?.unit || 'đơn vị')}</b></span>
                          <span data-label="Người nhập">{creator?.name || movement.createdBy || '-'}</span>
                          <span data-label="Ghi chú">{movement.note || '-'}</span>
                        </article>
                      )
                    })}
                  </details>
                ))}
                {!inventoryLedgerRows.length && <p className="empty-copy">Không có phát sinh kho trong khoảng đã chọn.</p>}
              </div>}
            </section>
          )}

          {/* ===== ĐẶT HÀNG ===== */}
          {activeSection === 'requests' && (
            <section className="section-card" style={{ marginTop: 0 }}>
              <div className="section-title">
                <div><span className="eyebrow dark">YÊU CẦU NHẬP HÀNG</span><h2>Báo đặt hàng từ ca trưởng</h2></div>
                <div className="section-actions">
                  <button className="secondary-button" onClick={() => setShowSupplyReport((value) => !value)}>
                    {showSupplyReport ? 'Ẩn báo cáo' : 'Xem báo cáo'}
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void runExport(
                      'supply',
                      rangeSupplyRequests.length ? '' : 'Chưa có yêu cầu đặt hàng trong bộ lọc hiện tại để tải CSV.',
                      exportSupplyReport,
                      'Đã tải CSV báo cáo đặt hàng.',
                    )}
                    disabled={exportBusy === 'supply'}
                  >{exportBusy === 'supply' ? 'Đang tải…' : 'Tải CSV'}</button>
                  <span className="date-chip">{pendingRequests} chờ duyệt</span>
                </div>
              </div>
              {showSupplyReport && (
                <div className="adm-list">
                  {rangeSupplyRequests.map((req) => (
                    <article className="adm-row" key={`report-${req.id}`}>
                      <div className="adm-row-head">
                        <div className="adm-row-id"><strong>{req.productName}</strong><small>{branchName(req.branchId)} · {req.requestedByName} · {formatDate(req.createdAt.slice(0, 10))}</small></div>
                        <div className="adm-row-hero"><b>{req.quantity}</b><span>{req.unit}</span></div>
                      </div>
                      <div className="adm-metrics">
                        <span><i>Trạng thái</i><b>{supplyStatusLabel(req.status)}</b></span>
                        <span style={{ flex: '2 1 140px' }}><i>Ghi chú</i><b>{req.note || '-'}</b></span>
                      </div>
                    </article>
                  ))}
                  {!rangeSupplyRequests.length && <p className="empty-copy">Chưa có yêu cầu đặt hàng nào trong bộ lọc này.</p>}
                </div>
              )}
              <div className="supply-request-list">
                {supplyRequests.map((req) => (
                  <div key={req.id} className={`supply-request-item${req.status === 'pending' ? ' pending' : ''}`}>
                    <span className="supply-request-icon">↑</span>
                    <span>
                      <strong>{req.productName} · {req.quantity} {req.unit}</strong>
                      <small>{branchName(req.branchId)} · {req.requestedByName} · {formatDate(req.createdAt.slice(0, 10))}{req.note ? ` · "${req.note}"` : ''}</small>
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                      <span className={`supply-status-badge ${req.status}`}>
                        {req.status === 'pending' ? 'Chờ duyệt' : req.status === 'acknowledged' ? 'Đã nhận' : req.status === 'cancelled' ? 'Đã hủy' : 'Hoàn thành'}
                      </span>
                      {req.status === 'pending' && (
                        <button className="mini-button" onClick={() => void handleAcknowledge(req.id)}>Xác nhận nhận</button>
                      )}
                      {(req.status === 'pending' || req.status === 'acknowledged') && (
                        <button className="mini-button danger-lite" onClick={() => void handleCancelRequest(req.id)}>Hủy đơn</button>
                      )}
                    </div>
                  </div>
                ))}
                {!supplyRequests.length && <p className="empty-copy">Chưa có yêu cầu đặt hàng nào.</p>}
              </div>
            </section>
          )}

          {/* ===== NHÂN SỰ ===== */}
          {activeSection === 'accounts' && (
            <section className="section-card admin-accounts" style={{ marginTop: 0 }}>
              <div className="section-title">
                <div><span className="eyebrow dark">NHÂN SỰ & TÀI KHOẢN</span><h2>Tạo và quản lý tài khoản nhân viên</h2></div>
                <span className="date-chip">{accountEmployees.length} tài khoản</span>
              </div>
              <form className="employee-account-form" onSubmit={createAccount}>
                <label>Họ tên<input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Nguyễn Văn A" required /></label>
                <label>Tên đăng nhập<input value={accountUsername} onChange={(event) => setAccountUsername(event.target.value)} placeholder="Ví dụ: ngoc, quanly" autoCapitalize="none" required /></label>
                <label>Mật khẩu<input type="password" minLength={6} value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} placeholder="Quản lý tự đặt" required /></label>
                {accountRole === 'manager' || accountRole === 'kitchen' ? (
                  <label>Phạm vi
                    <input value="Tất cả chi nhánh" disabled />
                  </label>
                ) : (
                  <label>Chi nhánh
                    <select value={accountBranchId} onChange={(event) => setAccountBranchId(event.target.value)}>
                      {visibleBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                    </select>
                  </label>
                )}
                <label>Vai trò
                  <select value={accountRole} onChange={(event) => {
                    const role = event.target.value as Exclude<Role, 'admin'>
                    setAccountRole(role)
                    if (role === 'kitchen') {
                      setAccountEmploymentType('part_time')
                      setAccountPositionTitle('Bếp')
                    }
                    if (role === 'manager') {
                      setAccountEmploymentType('leader')
                      setAccountPositionTitle('Quản lý')
                    }
                    if (role === 'shift_leader') {
                      setAccountEmploymentType('leader')
                      setAccountPositionTitle('Ca trưởng')
                    }
                  }}>
                    {ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{roleLabel(role.value, lang)}</option>)}
                  </select>
                </label>
                <label>Nhóm ca
                  <select value={accountEmploymentType} onChange={(event) => {
                    const type = event.target.value as EmploymentType
                    setAccountEmploymentType(type)
                    setAccountPositionTitle(type === 'leader' ? 'Ca trưởng' : type === 'full_time' ? 'Full-time' : 'Part-time')
                    if (accountRole !== 'manager' && accountRole !== 'kitchen') setAccountRole(type === 'leader' ? 'shift_leader' : 'staff')
                  }}>
                    <option value="leader">Ca trưởng / Ca phó</option>
                    <option value="full_time">Full-time</option>
                    <option value="part_time">Part-time</option>
                  </select>
                </label>
                <label>Vị trí<input value={accountPositionTitle} onChange={(event) => setAccountPositionTitle(event.target.value)} placeholder="Ca phó, Full-time…" required /></label>
                <button className="primary-button" disabled={accountBusyId === 'create'}>
                  {accountBusyId === 'create' ? 'Đang tạo…' : '+ Tạo tài khoản'}
                </button>
              </form>
              <p className="password-safety-note">Admin hệ thống tự đặt mật khẩu cho nhân viên. Mật khẩu được Supabase mã hóa và không thể xem lại sau khi đóng khung thông tin.</p>
              {temporaryCredential && (
                <div className="temporary-credential" role="status">
                  <span><strong>Thông tin đăng nhập</strong><small>Hãy sao chép và gửi trực tiếp cho nhân viên. Khung này sẽ mất khi tải lại trang.</small></span>
                  <code>{temporaryCredential.username}</code>
                  <code>{temporaryCredential.password}</code>
                  <button type="button" onClick={() => {
                    void navigator.clipboard.writeText(`Tên đăng nhập: ${temporaryCredential.username}\nMật khẩu: ${temporaryCredential.password}`)
                    setFeedback('Đã sao chép thông tin đăng nhập.')
                  }}>Sao chép</button>
                  <button type="button" onClick={() => setTemporaryCredential(null)}>Đóng</button>
                </div>
              )}
              {loading ? <p className="empty-copy">Đang tải danh sách nhân sự…</p> : (
                <div className="admin-account-list admin-role-editor">
                  {accountEmployees.map((employee) => {
                    const draft = employeeDraft(employee)
                    return <article className={employee.active === false ? 'inactive' : ''} key={employee.id}>
                    <span className="admin-avatar">
                      {draft.avatarUrl ? <img src={draft.avatarUrl} alt="" /> : employee.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span><strong>{employee.name}{employee.active === false ? ' · Đã xóa' : ''}</strong><small>{employee.role === 'manager' || employee.role === 'kitchen' ? 'Tất cả chi nhánh' : branchName(employee.branchId)} · {employee.positionTitle || roleLabel(employee.role)} · @{emailToUsername(employee.email) || employee.id}</small></span>
                    <div className="employee-profile-editor">
                      {employee.role === 'manager' || employee.role === 'kitchen' ? (
                        <label>Phạm vi
                          <input value="Tất cả chi nhánh" disabled />
                        </label>
                      ) : (
                        <label>Chi nhánh
                          <select
                            value={draft.branchId}
                            disabled={employee.active === false || savingEmployeeDetailsId === employee.id}
                            onChange={(event) => updateEmployeeDraft(employee, { branchId: event.target.value })}
                          >
                            {visibleBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                          </select>
                        </label>
                      )}
                      <label>Nhóm ca
                        <select
                          value={draft.employmentType}
                          disabled={employee.active === false || savingEmployeeDetailsId === employee.id}
                          onChange={(event) => {
                            const employmentType = event.target.value as EmploymentType
                            updateEmployeeDraft(employee, {
                              employmentType,
                              positionTitle: employmentType === 'leader' ? 'Ca trưởng' : employmentType === 'full_time' ? 'Full-time' : 'Part-time',
                            })
                          }}
                        >
                          <option value="leader">Ca trưởng / Ca phó</option>
                          <option value="full_time">Full-time</option>
                          <option value="part_time">Part-time</option>
                        </select>
                      </label>
                      <label>Vị trí
                        <input
                          value={draft.positionTitle}
                          disabled={employee.active === false || savingEmployeeDetailsId === employee.id}
                          onChange={(event) => updateEmployeeDraft(employee, { positionTitle: event.target.value })}
                        />
                      </label>
                      <label>Ảnh đại diện
                        <input
                          type="file"
                          accept="image/*"
                          disabled={employee.active === false || savingEmployeeDetailsId === employee.id}
                          onChange={(event) => void updateEmployeeAvatar(employee, event.target.files?.[0])}
                        />
                      </label>
                      <button
                        type="button"
                        className="mini-button"
                        disabled={employee.active === false || savingEmployeeDetailsId === employee.id}
                        onClick={() => void saveEmployeeDetails(employee)}
                      >
                        {savingEmployeeDetailsId === employee.id ? (lang === 'en' ? 'Saving...' : 'Đang lưu…') : (lang === 'en' ? 'Save profile' : 'Lưu hồ sơ')}
                      </button>
                      <button
                        type="button"
                        className={pendingHardDeleteId === employee.id ? 'danger-button compact confirming' : 'danger-button compact'}
                        disabled={accountBusyId === employee.id || employee.id === user.id || employee.active === false}
                        title="Xóa vĩnh viễn tài khoản test và toàn bộ lịch làm/chấm công/lương liên quan"
                        onClick={() => void hardRemoveAccount(employee)}
                      >
                        {accountBusyId === employee.id
                          ? (lang === 'en' ? 'Deleting...' : 'Đang xóa...')
                          : employee.id === user.id
                            ? (lang === 'en' ? 'Current account' : 'Tài khoản đang dùng')
                            : pendingHardDeleteId === employee.id
                              ? (lang === 'en' ? 'Confirm hard delete' : 'Xác nhận xóa sạch')
                              : (lang === 'en' ? 'Hard delete test' : 'Xóa sạch test')}
                      </button>
                    </div>
                    <div className="employee-account-actions">
                      <select
                        aria-label={`Vai trò của ${employee.name}`}
                        value={employee.role === 'admin' ? 'manager' : employee.role}
                        disabled={savingRoleId === employee.id || employee.active === false}
                        onChange={(event) => void changeRole(employee, event.target.value as Role)}
                      >
                        {ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{roleLabel(role.value, lang)}</option>)}
                      </select>
                      <button type="button" disabled={accountBusyId === employee.id || employee.active === false} onClick={() => void resetPassword(employee)}>{lang === 'en' ? 'Reset password' : 'Đặt lại mật khẩu'}</button>
                      <button
                        type="button"
                        className={pendingDeleteId === employee.id ? 'danger-button compact confirming' : 'danger-button compact'}
                        disabled={accountBusyId === employee.id || employee.id === user.id}
                        title={employee.id === user.id ? 'Không thể xóa tài khoản đang đăng nhập' : 'Xóa vĩnh viễn tài khoản và dữ liệu nhân sự liên quan'}
                        onClick={() => void removeAccount(employee)}
                      >
                        {accountBusyId === employee.id
                          ? (lang === 'en' ? 'Deleting...' : 'Đang xóa…')
                          : employee.id === user.id
                            ? (lang === 'en' ? 'Current account' : 'Tài khoản đang dùng')
                            : pendingDeleteId === employee.id
                              ? (lang === 'en' ? 'Confirm delete' : 'Xác nhận xóa')
                              : (lang === 'en' ? 'Delete account' : 'Xóa tài khoản')}
                      </button>
                    </div>
                  </article>})}
                  {!accountEmployees.length && <p className="empty-copy">Chưa có dữ liệu nhân sự phù hợp bộ lọc.</p>}
                </div>
              )}
            </section>
          )}

        </div>
      </div>
    </div>
  )
}

const BUSINESS_CHART_COLORS = ['#c7e9f1', '#ffd6de', '#d8efd3', '#ffe8b8', '#d9d0ff', '#cde7ff']

interface BusinessProductRow {
  productId: string
  productName: string
  quantity: number
  revenue: number
}

function BusinessProductCharts({ rows }: { rows: BusinessProductRow[] }) {
  const topRows = rows.slice(0, 6)
  const maxRevenue = Math.max(1, ...topRows.map((row) => row.revenue))
  const totalRevenue = topRows.reduce((sum, row) => sum + row.revenue, 0)
  if (!topRows.length) {
    return (
      <section className="section-card business-product-charts empty">
        <div className="section-title">
          <div><span className="eyebrow dark">MẶT HÀNG</span><h2>Món bán chạy nhất</h2></div>
        </div>
        <p className="empty-copy">Chưa có hóa đơn POS trong bộ lọc này.</p>
      </section>
    )
  }
  let cursor = 0
  const pieStops = topRows.map((row, index) => {
    const start = cursor
    const size = row.revenue / Math.max(totalRevenue, 1) * 100
    cursor += size
    return `${BUSINESS_CHART_COLORS[index % BUSINESS_CHART_COLORS.length]} ${start}% ${cursor}%`
  }).join(', ')
  return (
    <section className="section-card business-product-charts">
      <div className="business-product-bars">
        <div className="section-title">
          <div><span className="eyebrow dark">MẶT HÀNG</span><h2>Món bán chạy nhất</h2></div>
          <span className="date-chip">{formatMoney(totalRevenue)}</span>
        </div>
        {topRows.map((row, index) => (
          <article key={row.productId}>
            <span className="business-product-swatch" style={{ background: BUSINESS_CHART_COLORS[index % BUSINESS_CHART_COLORS.length] }} />
            <div>
              <div className="business-product-line">
                <strong>{row.productName}</strong>
                <b>{formatMoney(row.revenue)}</b>
              </div>
              <i><em style={{ width: `${Math.max(8, row.revenue / maxRevenue * 100)}%`, background: BUSINESS_CHART_COLORS[index % BUSINESS_CHART_COLORS.length] }} /></i>
              <small>{formatNumber(row.quantity)} đơn vị bán</small>
            </div>
          </article>
        ))}
      </div>
      <div className="business-product-pie">
        <div className="section-title">
          <div><span className="eyebrow dark">TỶ TRỌNG</span><h2>Doanh thu theo món</h2></div>
        </div>
        <div className="business-product-donut" style={{ background: `conic-gradient(${pieStops})` }}>
          <span>{topRows.length}</span>
          <small>món</small>
        </div>
        <div className="business-product-legend">
          {topRows.map((row, index) => (
            <span key={row.productId}>
              <i style={{ background: BUSINESS_CHART_COLORS[index % BUSINESS_CHART_COLORS.length] }} />
              {row.productName}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

function EmployeeRevenueChart({ rows }: { rows: ReturnType<typeof buildCompetitionRows> }) {
  const topRows = rows.filter((row) => row.revenue > 0).slice(0, 6)
  const maxRevenue = Math.max(1, ...topRows.map((row) => row.revenue))
  const totalRevenue = topRows.reduce((sum, row) => sum + row.revenue, 0)
  if (!topRows.length) return null
  return (
    <div className="employee-revenue-chart">
      <header>
        <div><span className="eyebrow dark">BIỂU ĐỒ NHÂN VIÊN</span><h3>Cơ cấu doanh thu</h3></div>
        <strong>{formatMoney(totalRevenue)}</strong>
      </header>
      <div className="employee-revenue-bars">
        {topRows.map((row, index) => (
          <article key={`${row.branchId}-${row.employeeKey}`}>
            <span className={`leaderboard-rank rank-${index + 1}`}>{index + 1}</span>
            <div>
              <div className="employee-revenue-line">
                <strong>{row.employeeName}</strong>
                <b>{formatMoney(row.revenue)}</b>
              </div>
              <i><em style={{ width: `${Math.max(6, row.revenue / maxRevenue * 100)}%` }} /></i>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function CompetitionClassificationTable({
  title,
  rows,
  showReward,
}: {
  title: string
  rows: Array<ReturnType<typeof buildCompetitionRows>[number] & { detail?: string }>
  showReward: boolean
}) {
  return <section className={`competition-classification-table${showReward ? ' with-reward' : ''}`} aria-label={title}>
    <div className="competition-classification-title">
      <div>
        <h3>{title} · Xếp hạng doanh thu</h3>
        <p>{showReward
          ? 'Top doanh thu không tự phát sinh thưởng; thưởng chỉ có khi đạt ngưỡng KPI ngày/tuần.'
          : 'Bảng này xếp doanh thu ca do ca trưởng phụ trách, không phải thưởng KPI cá nhân.'}</p>
      </div>
      <small>{rows.length} người có doanh thu</small>
    </div>
    <div className="competition-classification-head" role="row">
      <span>Hạng</span>
      <span>Nhân sự</span>
      <span>Chi nhánh</span>
      <span>Kết quả</span>
      <span>Doanh thu</span>
      <span>Xếp loại KPI</span>
      {showReward && <span>Thưởng KPI</span>}
    </div>
    {rows.map((row, index) => <div className="competition-classification-row" role="row" key={`${row.branchId}-${row.employeeKey}`}>
      <span data-label="Hạng" role="cell"><b className={`leaderboard-rank rank-${index + 1}`}>{index + 1}</b></span>
      <span data-label="Nhân sự" role="cell" className="competition-classification-person">
        <i className="employee-top-avatar">{row.avatarUrl ? <img src={row.avatarUrl} alt="" /> : row.employeeName.slice(0, 1).toUpperCase()}</i>
        <strong>{row.employeeName}</strong>
      </span>
      <span data-label="Chi nhánh" role="cell">{branchName(row.branchId)}</span>
      <span data-label="Kết quả" role="cell">{row.detail || `${formatNumber(row.soldQuantity)} sản phẩm`}</span>
      <span data-label="Doanh thu" role="cell"><b>{formatMoney(row.revenue)}</b></span>
      <span data-label="Xếp loại KPI" role="cell"><b>{row.rank}</b><small>{formatNumber(row.progress)}%</small></span>
      {showReward && <span data-label="Thưởng KPI" role="cell" className={`competition-classification-reward${row.commission > 0 ? ' earned' : ''}`}>
        <b>{formatMoney(row.commission)}</b>
        <small>{row.commission > 0 ? 'Đã đạt thưởng ngày/tuần' : 'Chưa đạt ngưỡng ngày/tuần'}</small>
      </span>}
    </div>)}
    {!rows.length && <p className="empty-copy">Chưa có doanh thu phù hợp với phân loại và ngày đã chọn.</p>}
  </section>
}

function EmployeeCompetitionPoster({
  posterRef,
  rows,
  from,
  to,
  branchLabel,
}: {
  posterRef: { current: HTMLDivElement | null }
  rows: ReturnType<typeof buildCompetitionRows>
  from: string
  to: string
  branchLabel: string
}) {
  const rankedRows = rows.filter((row) => row.revenue > 0).slice(0, 10)
  const topRows = rankedRows.slice(0, 3)
  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0)
  const totalSold = rows.reduce((sum, row) => sum + row.soldQuantity, 0)
  const achievedCount = rows.filter((row) => row.progress >= 100).length
  return (
    <div className="competition-poster-wrap" aria-hidden={!rankedRows.length}>
      <div className="competition-poster" ref={posterRef}>
        <header>
          <div>
            <span>TOP 10 NHÂN VIÊN THEO THÁNG</span>
            <h3>Thi đua nhân viên bán hàng</h3>
            <p>{branchLabel} · {formatDate(from)} - {formatDate(to)}</p>
          </div>
          <strong>{achievedCount}/{Math.max(1, rows.length)} đạt KPI</strong>
        </header>
        <section className="competition-poster-kpis">
          <div><span>Doanh thu</span><b>{formatMoney(totalRevenue)}</b></div>
          <div><span>Sản phẩm bán</span><b>{formatNumber(totalSold)}</b></div>
          <div><span>Nhân viên</span><b>{formatNumber(rows.length)}</b></div>
        </section>
        <section className="competition-podium">
          {topRows.map((row, index) => (
            <article className={`place-${index + 1}`} key={`${row.branchId}-${row.employeeKey}`}>
              <small>Hạng {index + 1}</small>
              <strong>{row.employeeName}</strong>
              <span>{branchName(row.branchId)}</span>
              <b>{formatMoney(row.revenue)}</b>
              <em>{formatNumber(row.progress)}% KPI · {row.rank}</em>
            </article>
          ))}
        </section>
        <section className="competition-poster-list">
          {rankedRows.map((row, index) => (
            <article key={`${row.branchId}-${row.employeeKey}`}>
              <span>{index + 1}</span>
              <span className="competition-list-avatar">
                {row.avatarUrl ? <img src={row.avatarUrl} alt="" /> : row.employeeName.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{row.employeeName}</strong>
                <small>{branchName(row.branchId)} · {formatNumber(row.soldQuantity)} sản phẩm</small>
              </div>
              <b>{formatMoney(row.revenue)}</b>
            </article>
          ))}
          {!rankedRows.length && <p>Chưa có dữ liệu thi đua trong bộ lọc này.</p>}
        </section>
      </div>
    </div>
  )
}

function buildBusinessProductRows(
  receipts: SalesReceipt[],
  allocations: BagAllocation[],
  filters: { branchIds: string[]; from: string; to: string },
): BusinessProductRow[] {
  const branchSet = new Set(filters.branchIds)
  const rows = new Map<string, BusinessProductRow>()
  const scopedReceipts = receipts.filter((receipt) =>
    branchSet.has(receipt.branchId)
    && receipt.businessDate >= filters.from
    && receipt.businessDate <= filters.to,
  )
  const receiptLines = scopedReceipts.flatMap((receipt) => receipt.lines)
  if (receiptLines.length) {
    for (const line of receiptLines) {
      const productId = line.productId || line.productName
      const product = PRODUCTS.find((item) => item.id === line.productId)
      const current = rows.get(productId) || {
        productId,
        productName: product?.name || line.productName || productId,
        quantity: 0,
        revenue: 0,
      }
      current.quantity += Number(line.quantity) || 0
      current.revenue += Number(line.total) || 0
      rows.set(productId, current)
    }
  } else {
    for (const allocation of allocations) {
      const date = allocationReportDate(allocation)
      if (!branchSet.has(allocation.branchId) || date < filters.from || date > filters.to) continue
      const quantity = soldBagQuantity(allocation)
      if (quantity <= 0) continue
      const product = PRODUCTS.find((item) => item.id === allocation.productId)
      const values = productSaleValues(allocation.productId, quantity)
      const current = rows.get(allocation.productId) || {
        productId: allocation.productId,
        productName: product?.name || allocation.productId,
        quantity: 0,
        revenue: 0,
      }
      current.quantity += quantity
      current.revenue += values.revenue
      rows.set(allocation.productId, current)
    }
  }
  return Array.from(rows.values())
    .filter((row) => row.quantity > 0 || row.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity || a.productName.localeCompare(b.productName, 'vi'))
}

function buildPayrollEmployeeList(
  profileCandidates: EmployeeProfile[],
  attendanceRows: ReturnType<typeof buildAttendanceReport>,
) {
  const output = new Map<string, EmployeeProfile>()
  const attendanceIds = new Set(attendanceRows.map((row) => row.userId))
  const attendanceNameKeys = new Set(attendanceRows.map((row) => `${row.branchId}|${normalizeName(row.employeeName)}`))
  const add = (employee: EmployeeProfile) => {
    if (!employee.branchId || !PAYROLL_ROLES.includes(employee.role)) return
    output.set(employee.id, employee)
  }

  profileCandidates.forEach((employee) => {
    const hasAttendance = attendanceIds.has(employee.id)
      || attendanceNameKeys.has(`${employee.branchId}|${normalizeName(employee.name)}`)
    if (employee.active !== false || hasAttendance) add(employee)
  })

  attendanceRows.forEach((row) => {
    if (output.has(row.userId)) return
    const profile = profileCandidates.find((employee) =>
      employee.id === row.userId
      || (employee.branchId === row.branchId && normalizeName(employee.name) === normalizeName(row.employeeName)),
    )
    if (profile) {
      add(profile)
      return
    }
    output.set(row.userId, {
      id: row.userId,
      name: row.employeeName,
      role: 'staff',
      branchId: row.branchId,
      active: true,
      employmentType: 'part_time',
      positionTitle: 'Nhân viên',
    })
  })

  return Array.from(output.values())
}

function buildDailyEmployeeKpiRows(
  allocations: BagAllocation[],
  receipts: SalesReceipt[],
  employees: EmployeeProfile[],
  detailRows: ReturnType<typeof buildAttendanceDetailRows>,
  from: string,
  to: string,
) {
  const rows = new Map<string, {
    date: string
    branchId: string
    employeeKey: string
    employeeName: string
    role: Role
    employmentType?: EmploymentType
    positionTitle: string
    totalHours: number
    soldQuantity: number
    revenue: number
    targetRevenue: number
    progress: number
    rank: string
    dailyBonus: number
  }>()

  const addRevenue = (
    date: string,
    branchId: string,
    employee: EmployeeProfile,
    fallbackName: string,
    soldQuantity: number,
    revenue: number,
  ) => {
    const employeeKey = employee.id
    const key = `${date}|${branchId}|${employeeKey}`
    const current = rows.get(key) || {
      date,
      branchId,
      employeeKey,
      employeeName: employee.name || fallbackName,
      role: employee.role,
      employmentType: employee.employmentType,
      positionTitle: employee.positionTitle || roleLabel(employee.role),
      totalHours: 0,
      soldQuantity: 0,
      revenue: 0,
      targetRevenue: employeePeriodRevenueTarget(
        branchId,
        employee.role,
        employee.employmentType,
        employee.positionTitle,
        date,
        date,
      ) || DEFAULT_REVENUE_TARGET,
      progress: 0,
      rank: 'D',
      dailyBonus: 0,
    }
    current.soldQuantity += soldQuantity
    current.revenue += revenue
    rows.set(key, current)
  }

  allocations.forEach((allocation) => {
    const date = allocationReportDate(allocation)
    if (date < from || date > to) return
    const employee = allocation.employeeId
      ? employees.find((item) => item.id === allocation.employeeId)
      : employees.find((item) => item.branchId === allocation.branchId && normalizeName(item.name) === normalizeName(allocation.employeeName))
    if (!employee?.branchId || employee.branchId !== allocation.branchId || !PAYROLL_ROLES.includes(employee.role)) return
    const soldQuantity = soldBagQuantity(allocation)
    const values = productSaleValues(allocation.productId, soldQuantity)
    addRevenue(date, allocation.branchId, employee, allocation.employeeName, soldQuantity, values.revenue)
  })

  receipts.forEach((receipt) => {
    const directLines = receipt.lines.filter((line) => !line.allocationId)
    if (!directLines.length) return
    const employee = receipt.sellerId
      ? employees.find((item) => item.id === receipt.sellerId)
      : employees.find((item) => item.branchId === receipt.branchId && normalizeName(item.name) === normalizeName(receipt.sellerName))
    if (!employee?.branchId || employee.branchId !== receipt.branchId || !PAYROLL_ROLES.includes(employee.role)) return
    addRevenue(
      receipt.businessDate,
      receipt.branchId,
      employee,
      receipt.sellerName,
      directLines.reduce((sum, line) => sum + line.quantity, 0),
      directLines.reduce((sum, line) => sum + line.total, 0),
    )
  })

  rows.forEach((row) => {
    const hours = detailRows
      .filter((item) =>
        item.branchId === row.branchId
        && item.workDate === row.date
        && (item.userId === row.employeeKey || normalizeName(item.employeeName) === normalizeName(row.employeeName)),
      )
      .reduce((sum, item) => sum + item.totalHours, 0)
    row.totalHours = Number(hours.toFixed(2))
    row.progress = row.targetRevenue > 0 ? Math.min(200, row.revenue / row.targetRevenue * 100) : 0
    row.rank = kpiRank(row.progress)
    row.dailyBonus = dailyKpiBonus(row.progress, row.role, row.employmentType, row.positionTitle)
  })

  return Array.from(rows.values())
    .sort((a, b) => b.date.localeCompare(a.date) || branchName(a.branchId).localeCompare(branchName(b.branchId), 'vi') || b.revenue - a.revenue)
}

function buildPayrollRows(
  employees: EmployeeProfile[],
  attendanceRows: ReturnType<typeof buildAttendanceReport>,
  commissionRows: ReturnType<typeof buildCommissionRows>,
  drafts: Record<string, PayrollDraft>,
  roleDefaults: Record<string, RoleSalaryDefault>,
) {
  return employees.filter((employee) => PAYROLL_ROLES.includes(employee.role)).map((employee) => {
    const employeeKey = employee.id
    const attendance = attendanceRows.find((row) =>
      row.userId === employee.id
      || (normalizeName(row.employeeName) === normalizeName(employee.name) && row.branchId === employee.branchId),
    )
    const commission = commissionRows.find((row) =>
      row.employeeKey === employee.id
      || (normalizeName(row.employeeName) === normalizeName(employee.name) && row.branchId === employee.branchId),
    )
    const draft = { ...emptyPayrollDraft, ...(drafts[employeeKey] || {}) }
    const def = roleDefaults[roleSlotKey(employee.branchId || '', employee.role)]
    // Lương hiệu lực: ưu tiên số nhập riêng cho người này, nếu trống dùng lương mặc định theo vai trò.
    const hourlyRate = draft.hourlyRate.trim() !== '' ? parseMoney(draft.hourlyRate) : (def?.hourlyRate || 0)
    const fixedSalary = draft.fixedSalary.trim() !== '' ? parseMoney(draft.fixedSalary) : (def?.fixedSalary || 0)
    const bonus = parseMoney(draft.bonus)
    const deduction = parseMoney(draft.deduction)
    const totalHours = attendance?.totalHours || 0
    const basePay = fixedSalary > 0 ? fixedSalary : Math.round(totalHours * hourlyRate)
    const commissionPay = commission?.commission || 0
    const dailyBonus = commission?.dailyBonus || 0
    const weeklyBonus = commission?.weeklyBonus || 0
    const monthlyBonus = commission?.monthlyBonus || 0
    return {
      employeeKey,
      employeeName: employee.name,
      branchId: employee.branchId || '',
      positionTitle: employee.positionTitle || roleLabel(employee.role),
      role: employee.role,
      totalShifts: attendance?.totalShifts || 0,
      totalHours,
      workDays: attendance?.workDays || 0,
      hourlyRate,
      fixedSalary,
      roleHourlyDefault: def?.hourlyRate || 0,
      roleFixedDefault: def?.fixedSalary || 0,
      basePay,
      commission: commissionPay,
      dailyBonus,
      weeklyBonus,
      monthlyBonus,
      kpiProgress: commission?.progress || 0,
      achievedDays: commission?.achievedDays || 0,
      bonus,
      deduction,
      grossPay: basePay + commissionPay + bonus - deduction,
      note: draft.note,
      draft,
    }
  }).sort((a, b) => branchName(a.branchId).localeCompare(branchName(b.branchId), 'vi') || a.employeeName.localeCompare(b.employeeName, 'vi'))
}

function buildCompetitionRows(
  commissionRows: ReturnType<typeof buildCommissionRows>,
  registrations: ShiftRegistration[],
  employees: EmployeeProfile[],
) {
  const rows = new Map<string, {
    employeeKey: string
    employeeName: string
    branchId: string
    avatarUrl?: string
    soldQuantity: number
    revenue: number
    commission: number
    totalHours: number
    progress: number
    rank: string
    score: number
  }>()
  const employeeFor = (branchId: string, employeeKey: string, employeeName: string) => employees.find((employee) =>
    employee.branchId === branchId
    && (employee.id === employeeKey || normalizeName(employee.name) === normalizeName(employeeName))
  )
  for (const registration of registrations.filter((item) => item.status !== 'rejected')) {
    const employee = employeeFor(registration.branchId, registration.userId, registration.userName)
    const key = `${registration.branchId}-${registration.userId}`
    const existing = rows.get(key)
    const scheduledHours = registeredShiftHours(registration)
    rows.set(key, {
      employeeKey: registration.userId,
      employeeName: employee?.name || registration.userName,
      branchId: registration.branchId,
      avatarUrl: employee?.avatarUrl,
      soldQuantity: existing?.soldQuantity || 0,
      revenue: existing?.revenue || 0,
      commission: existing?.commission || 0,
      totalHours: Number(((existing?.totalHours || 0) + scheduledHours).toFixed(2)),
      progress: existing?.progress || 0,
      rank: existing?.rank || 'D',
      score: Math.round((existing?.totalHours || 0) + scheduledHours),
    })
  }
  for (const row of commissionRows) {
    const employee = employeeFor(row.branchId, row.employeeKey, row.employeeName)
    const employeeKey = employee?.id || row.employeeKey
    const key = `${row.branchId}-${employeeKey}`
    const existing = rows.get(key)
    rows.set(key, {
      employeeKey,
      employeeName: employee?.name || row.employeeName,
      branchId: row.branchId,
      avatarUrl: employee?.avatarUrl || existing?.avatarUrl,
      soldQuantity: row.soldQuantity,
      revenue: row.revenue,
      commission: row.commission,
      totalHours: existing?.totalHours || 0,
      progress: row.progress,
      rank: row.rank,
      score: Math.round(row.revenue / 10000 + row.progress + (existing?.totalHours || 0) / 2),
    })
  }
  return Array.from(rows.values())
    .filter((row) => row.revenue > 0)
    .sort((a, b) =>
      b.revenue - a.revenue
      || b.progress - a.progress
      || b.soldQuantity - a.soldQuantity
      || b.totalHours - a.totalHours
      || a.employeeName.localeCompare(b.employeeName, 'vi'),
    )
}

function registeredShiftHours(registration: Pick<ShiftRegistration, 'workDate' | 'startTime' | 'endTime'>) {
  const start = new Date(`${registration.workDate}T${registration.startTime}:00`)
  const end = new Date(`${registration.workDate}T${registration.endTime}:00`)
  if (registration.endTime <= registration.startTime) end.setDate(end.getDate() + 1)
  return Math.max(0, (end.getTime() - start.getTime()) / 3600000)
}

function buildFunctionStats(id: string, values: {
  revenue: number
  sold: number
  branches: number
  employees: number
  lowStock: number
  pendingRequests: number
  payroll: number
  commission: number
  waste: number
}) {
  if (id === 'cashflow' || id === 'payroll') {
    return [
      { label: 'Doanh thu KPI', value: formatMoney(values.payroll) },
      { label: 'Hoa hồng', value: formatMoney(values.commission) },
      { label: 'Nhân viên', value: formatNumber(values.employees) },
    ]
  }
  if (id === 'kitchen_orders' || id === 'cancelled') {
    return [
      { label: 'Chờ xử lý', value: formatNumber(values.pendingRequests) },
      { label: 'Chi nhánh', value: formatNumber(values.branches) },
      { label: 'Doanh thu', value: formatMoney(values.revenue) },
    ]
  }
  if (id === 'returns') {
    return [
      { label: 'Hao hụt', value: formatNumber(values.waste) },
      { label: 'Cảnh báo kho', value: formatNumber(values.lowStock) },
      { label: 'Chi nhánh', value: formatNumber(values.branches) },
    ]
  }
  if (id === 'employee_revenue' || id === 'best_sellers') {
    return [
      { label: 'Nhân viên', value: formatNumber(values.employees) },
      { label: 'Sản phẩm bán', value: formatNumber(values.sold) },
      { label: 'Doanh thu', value: formatMoney(values.revenue) },
    ]
  }
  return [
    { label: 'Doanh thu', value: formatMoney(values.revenue) },
    { label: 'Sản phẩm bán', value: formatNumber(values.sold) },
    { label: 'Chi nhánh', value: formatNumber(values.branches) },
  ]
}

function formatInventoryQuantity(value: number, unit: string) {
  const normalized = Math.abs(value) < 0.00005 ? 0 : value
  if (unit === 'kg' && normalized !== 0 && Math.abs(normalized) < 1) {
    return `${formatInventoryDecimal(normalized * 1000, 2)} g`
  }
  return `${formatInventoryDecimal(normalized, unit === 'kg' ? 4 : 2)} ${unit}`.trim()
}

function formatInventoryDecimal(value: number, maximumFractionDigits: number) {
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value).replace(/\./g, ' ')
}

function summarizeInventoryQuantities(items: Array<{ quantity: number; unit: string }>, emptyLabel = 'Không phát sinh') {
  const totals = new Map<string, number>()
  items.forEach(({ quantity, unit }) => {
    if (!Number.isFinite(quantity)) return
    const normalizedUnit = unit.trim() || 'đơn vị'
    totals.set(normalizedUnit, (totals.get(normalizedUnit) || 0) + quantity)
  })
  const summaries = Array.from(totals.entries())
    .filter(([, quantity]) => Math.abs(quantity) > 0.00005)
    .sort(([unitA], [unitB]) => unitA === 'kg' ? -1 : unitB === 'kg' ? 1 : unitA.localeCompare(unitB, 'vi'))
    .map(([unit, quantity]) => formatInventoryQuantity(quantity, unit))
  return summaries.length ? summaries.join(' · ') : emptyLabel
}

function formatShiftTime(startedAt: string, endedAt?: string) {
  const time = (value: string) => new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  return `${time(startedAt)} – ${endedAt ? time(endedAt) : 'đang làm'}`
}

function buildShiftInventoryReconciliation(
  sessions: BagShiftSession[],
  receipts: SalesReceipt[],
  movements: StockMovement[],
  fromDate: string,
  toDate: string,
  validBranchIds: Set<string>,
  selectedBranchId: string,
) {
  const packingBySource = getPackingOptionsByOutput()
  const sourceBySaleProduct = new Map<string, { sourceProductId: string; sourceQuantity: number }>()
  Object.entries(packingBySource).forEach(([sourceProductId, options]) => {
    options.forEach((option) => sourceBySaleProduct.set(option.productId, {
      sourceProductId,
      sourceQuantity: option.sourceQuantity,
    }))
  })
  const additionTypes = new Set<StockMovement['type']>(['opening', 'inbound', 'processing_in', 'packing_in', 'adjustment'])

  return sessions
    .filter((session) =>
      session.businessDate >= fromDate
      && session.businessDate <= toDate
      && validBranchIds.has(session.branchId)
      && (!selectedBranchId || session.branchId === selectedBranchId),
    )
    .slice()
    .sort((a, b) => b.businessDate.localeCompare(a.businessDate) || a.branchId.localeCompare(b.branchId) || a.sequence - b.sequence)
    .map((session) => {
      const startMs = Date.parse(session.startedAt)
      const endMs = session.endedAt ? Date.parse(session.endedAt) : Number.POSITIVE_INFINITY
      const sessionReceipts = receipts.filter((receipt) => {
        if (receipt.branchId !== session.branchId || receipt.businessDate !== session.businessDate) return false
        if (receipt.createdAt < session.startedAt) return false
        if (session.endedAt && receipt.createdAt > session.endedAt) return false
        return true
      })
      const sessionMovements = movements.filter((movement) => {
        if (movement.branchId !== session.branchId || movement.shiftDate !== session.businessDate) return false
        const movementMs = Date.parse(movement.createdAt)
        return Number.isFinite(movementMs) && movementMs >= startMs && movementMs <= endMs
      })
      const openingBalances = session.openingBalances || {}
      const closingBalances = session.closingBalances || {}
      const trackedProductIds = new Set([...Object.keys(openingBalances), ...Object.keys(closingBalances)])
      const posBySource = new Map<string, number>()
      const posNativeQuantities: Array<{ quantity: number; unit: string }> = []
      const untrackedPosProducts = new Set<string>()

      sessionReceipts.forEach((receipt) => {
        receipt.lines.forEach((line) => {
          const saleProduct = productById(line.productId)
          posNativeQuantities.push({ quantity: line.quantity, unit: saleProduct?.unit || 'sản phẩm' })
          const conversion = sourceBySaleProduct.get(line.productId)
          const sourceProductId = conversion?.sourceProductId || (trackedProductIds.has(line.productId) ? line.productId : '')
          if (!sourceProductId) {
            untrackedPosProducts.add(line.productId)
            return
          }
          const sourceQuantity = conversion?.sourceQuantity || 1
          posBySource.set(sourceProductId, (posBySource.get(sourceProductId) || 0) + line.quantity * sourceQuantity)
        })
      })

      const productIds = new Set([...trackedProductIds, ...posBySource.keys()])
      const isOfficial = session.status === 'closed' && Boolean(session.closingBalances)
      const lines = Array.from(productIds)
        .map((productId) => {
          const product = productById(productId)
          const trackedByHandover = trackedProductIds.has(productId)
          const opening = Number(openingBalances[productId] || 0)
          const additions = sessionMovements
            .filter((movement) => movement.productId === productId && additionTypes.has(movement.type))
            .reduce((sum, movement) => sum + movement.quantity, 0)
          const waste = sessionMovements
            .filter((movement) => movement.productId === productId && movement.type === 'waste' && !movement.sourceProductId)
            .reduce((sum, movement) => sum + movement.quantity, 0)
          const closing = isOfficial && trackedByHandover ? Number(closingBalances[productId] || 0) : null
          const posEquivalent = posBySource.get(productId) || 0
          const officialOut = closing === null ? null : opening + additions - closing - waste
          const difference = officialOut === null ? null : officialOut - posEquivalent
          return {
            productId,
            productName: product?.name || productId,
            sku: product?.sku || '-',
            unit: product?.unit || 'đơn vị',
            trackedByHandover,
            opening,
            additions,
            posEquivalent,
            waste,
            closing,
            officialOut,
            difference,
          }
        })
        .sort((a, b) => a.productName.localeCompare(b.productName, 'vi'))

      const comparableLines = lines.filter((line) => line.difference !== null)
      const differenceRows = comparableLines
        .filter((line) => Math.abs(line.difference || 0) > 0.00005)
        .map((line) => ({ quantity: line.difference || 0, unit: line.unit }))
      const untrackedCount = lines.filter((line) => !line.trackedByHandover && line.posEquivalent > 0).length + untrackedPosProducts.size
      let differenceLabel = session.status === 'open'
        ? 'Chưa đối chiếu'
        : comparableLines.length
          ? summarizeInventoryQuantities(differenceRows, 'Khớp POS')
          : 'Chưa đủ dữ liệu'
      if (session.status === 'closed' && untrackedCount > 0) {
        differenceLabel += ` · ${untrackedCount} SKU chưa bàn giao`
      }
      const hasDifference = differenceRows.length > 0 || untrackedCount > 0

      return {
        sessionId: session.id,
        branchId: session.branchId,
        businessDate: session.businessDate,
        sequence: session.sequence,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        receiptCount: sessionReceipts.length,
        posRevenue: sessionReceipts.reduce((sum, receipt) => sum + receipt.totalAmount, 0),
        posNativeQuantities,
        posNativeSummary: summarizeInventoryQuantities(posNativeQuantities, 'Chưa có POS'),
        posEquivalentSummary: `Quy đổi: ${summarizeInventoryQuantities(
          lines.filter((line) => line.posEquivalent > 0).map((line) => ({ quantity: line.posEquivalent, unit: line.unit })),
          'chưa có SKU quy đổi',
        )}`,
        openingSummary: summarizeInventoryQuantities(
          lines.filter((line) => line.trackedByHandover).map((line) => ({ quantity: line.opening, unit: line.unit })),
          '0',
        ),
        additionSummary: summarizeInventoryQuantities(
          lines.filter((line) => line.trackedByHandover).map((line) => ({ quantity: line.additions, unit: line.unit })),
        ),
        wasteSummary: summarizeInventoryQuantities(
          lines.filter((line) => line.trackedByHandover).map((line) => ({ quantity: line.waste, unit: line.unit })),
        ),
        closingSummary: isOfficial
          ? summarizeInventoryQuantities(
              lines.filter((line) => line.closing !== null).map((line) => ({ quantity: line.closing || 0, unit: line.unit })),
              '0',
            )
          : 'Chưa bàn giao',
        officialOutSummary: isOfficial
          ? summarizeInventoryQuantities(
              lines.filter((line) => line.officialOut !== null).map((line) => ({ quantity: line.officialOut || 0, unit: line.unit })),
              '0',
            )
          : 'Chưa chốt ca',
        differenceLabel,
        differenceTone: session.status === 'open' ? 'pending' : hasDifference ? 'danger' : 'good',
        lines,
      }
    })
}

function buildDailyOutboundRows(movements: StockMovement[]) {
  const grouped = new Map<string, {
    branchId: string
    productId: string
    productName: string
    sku: string
    unit: string
    quantity: number
    documentIds: Set<string>
    createdByIds: Set<string>
    notes: Set<string>
    lastCreatedAt: string
  }>()
  movements.forEach((movement) => {
    const product = productById(movement.productId)
    const key = `${movement.branchId}|${movement.productId}`
    const current = grouped.get(key) || {
      branchId: movement.branchId,
      productId: movement.productId,
      productName: product?.name || movement.productId,
      sku: product?.sku || '-',
      unit: product?.unit || 'đơn vị',
      quantity: 0,
      documentIds: new Set<string>(),
      createdByIds: new Set<string>(),
      notes: new Set<string>(),
      lastCreatedAt: movement.createdAt,
    }
    current.quantity += movement.quantity
    current.documentIds.add(movement.documentId || movement.id)
    if (movement.createdBy) current.createdByIds.add(movement.createdBy)
    if (movement.note) current.notes.add(movement.note)
    if (movement.createdAt > current.lastCreatedAt) current.lastCreatedAt = movement.createdAt
    grouped.set(key, current)
  })
  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      documentIds: Array.from(row.documentIds),
      createdByIds: Array.from(row.createdByIds),
      notes: Array.from(row.notes),
    }))
    .sort((a, b) => a.branchId.localeCompare(b.branchId) || a.productName.localeCompare(b.productName, 'vi'))
}

function inventoryCategoryLabel(category: Product['category']) {
  if (category === 'raw') return 'Nguyên liệu'
  if (category === 'finished') return 'Thành phẩm'
  return 'Bao bì'
}

function buildInventoryRows(movements: StockMovement[], branchIds: string[], from: string, to: string) {
  return branchIds.flatMap((branchId) => {
    const branchMovements = movements.filter((item) => item.branchId === branchId)
    const openingStock = new Map(calculateStock(branchMovements.filter((item) => item.shiftDate < from)).map((line) => [line.product.id, line.expected]))
    const closingStock = new Map(calculateStock(branchMovements.filter((item) => item.shiftDate <= to)).map((line) => [line.product.id, line.expected]))
    const period = branchMovements.filter((item) => item.shiftDate >= from && item.shiftDate <= to)
    return getProducts().map((product) => {
      const rows = period.filter((item) => item.productId === product.id)
      const inbound = rows.filter((item) => ['opening', 'inbound', 'processing_in', 'packing_in'].includes(item.type))
        .reduce((sum, item) => sum + item.quantity, 0)
        + rows.filter((item) => item.type === 'adjustment' && item.quantity > 0).reduce((sum, item) => sum + item.quantity, 0)
      const outbound = rows.filter((item) => ['processing_out', 'packing_out', 'sale_out'].includes(item.type))
        .reduce((sum, item) => sum + item.quantity, 0)
      const waste = rows.filter((item) => item.type === 'waste').reduce((sum, item) => sum + item.quantity, 0)
      return {
        branchId,
        product,
        opening: openingStock.get(product.id) || 0,
        inbound,
        outbound,
        waste,
        closing: closingStock.get(product.id) || 0,
      }
    }).filter((row) => row.opening || row.inbound || row.outbound || row.waste || row.closing)
  })
}

function buildWasteRows(movements: StockMovement[]) {
  const rows = new Map<string, {
    branchId: string
    productId: string
    productName: string
    unit: string
    quantity: number
    count: number
  }>()
  for (const movement of movements.filter((item) => item.type === 'waste')) {
    const product = productById(movement.productId)
    if (!product) continue
    const key = `${movement.branchId}|${movement.productId}`
    const current = rows.get(key) || {
      branchId: movement.branchId,
      productId: movement.productId,
      productName: product.name,
      unit: product.unit,
      quantity: 0,
      count: 0,
    }
    current.quantity += movement.quantity
    current.count += 1
    rows.set(key, current)
  }
  return Array.from(rows.values()).sort((a, b) => b.quantity - a.quantity)
}

function buildAdminDailyTrendRows(rows: Array<{ reportDate: string; revenue: number }>, range: { from: string; to: string }) {
  const byDate = new Map<string, number>()
  rows.forEach((row) => byDate.set(row.reportDate, (byDate.get(row.reportDate) || 0) + row.revenue))
  const output: Array<{ date: string; revenue: number }> = []
  const cursor = new Date(`${range.from}T00:00:00`)
  const end = new Date(`${range.to}T00:00:00`)
  while (cursor <= end && output.length < 31) {
    const date = localDateKey(cursor)
    output.push({ date, revenue: byDate.get(date) || 0 })
    cursor.setDate(cursor.getDate() + 1)
  }
  return output
}

function buildAdminAreaChart(rows: Array<{ date: string; revenue: number }>, maxRevenue: number) {
  const width = 360
  const padX = 12
  const baseY = 142
  const plotHeight = 124
  const points = rows.map((row, index) => {
    const x = rows.length <= 1 ? width / 2 : padX + index * ((width - padX * 2) / (rows.length - 1))
    const y = baseY - (row.revenue / Math.max(maxRevenue, 1)) * plotHeight
    return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`
  })
  const linePoints = points.join(' ')
  const fillPoints = points.length ? `${padX},${baseY} ${linePoints} ${width - padX},${baseY}` : `${padX},${baseY} ${width - padX},${baseY}`
  return { linePoints, fillPoints }
}

// Gom doanh thu POS theo (ngày × nhân viên × chi nhánh) trong khoảng đã lọc.
function buildDailyEmployeeRevenueRows(receipts: SalesReceipt[], from: string, to: string, branchId: string) {
  const map = new Map<string, { date: string; branchId: string; employeeName: string; receipts: number; quantity: number; revenue: number }>()
  receipts
    .filter((receipt) => receipt.businessDate >= from && receipt.businessDate <= to && (!branchId || receipt.branchId === branchId))
    .forEach((receipt) => {
      const sellerKey = receipt.sellerId || receipt.sellerKey || normalizeName(receipt.sellerName)
      const key = `${receipt.businessDate}|${receipt.branchId}|${sellerKey}`
      const row = map.get(key) || { date: receipt.businessDate, branchId: receipt.branchId, employeeName: receipt.sellerName, receipts: 0, quantity: 0, revenue: 0 }
      row.receipts += 1
      row.quantity += receipt.totalQuantity
      row.revenue += receipt.totalAmount
      map.set(key, row)
    })
  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date) || b.revenue - a.revenue)
}

function buildCommissionRows(
  allocations: BagAllocation[],
  employees: EmployeeProfile[],
  attendanceRows: ReturnType<typeof buildAttendanceReport>,
  receipts: SalesReceipt[],
  ruleDrafts: Record<string, { targetRevenue: string; commissionRate: string }>,
  employeeKpiDrafts: Record<string, string>,
  from: string,
  to: string,
) {
  const allocationsByDate = new Map<string, BagAllocation[]>()
  allocations.forEach((allocation) => {
    const date = allocationReportDate(allocation)
    allocationsByDate.set(date, [...(allocationsByDate.get(date) || []), allocation])
  })
  const rows = new Map<string, ReturnType<typeof summarizeEmployeeBagSales>[number] & {
    achievedDays: number
    maxDailySold: number
    dailyBonus: number
    weeklyBonus: number
    monthlyBonus: number
    rank: string
  }>()
  const dailyPerformance = new Map<string, {
    date: string
    branchId: string
    employee: EmployeeProfile
    soldQuantity: number
    revenue: number
  }>()
  const addDailyPerformance = (
    date: string,
    branchId: string,
    employee: EmployeeProfile,
    soldQuantity: number,
    revenue: number,
  ) => {
    const key = `${date}|${branchId}|${employee.id}`
    const current = dailyPerformance.get(key) || { date, branchId, employee, soldQuantity: 0, revenue: 0 }
    current.soldQuantity += soldQuantity
    current.revenue += revenue
    dailyPerformance.set(key, current)
  }

  allocationsByDate.forEach((dayAllocations) => {
    summarizeEmployeeBagSales(dayAllocations).forEach((dayRow) => {
      const employee = dayRow.employeeId
        ? employees.find((item) => item.id === dayRow.employeeId)
        : employees.find((item) => item.branchId === dayRow.branchId && normalizeName(item.name) === normalizeName(dayRow.employeeName))
      if (!employee?.branchId || employee.branchId !== dayRow.branchId || !PAYROLL_ROLES.includes(employee.role)) return
      const date = dayAllocations[0] ? allocationReportDate(dayAllocations[0]) : from
      const key = `${dayRow.branchId}|${employee.id}`
      const current = rows.get(key) || {
        ...dayRow,
        employeeKey: employee.id,
        employeeId: employee.id,
        employeeName: employee.name || dayRow.employeeName,
        soldQuantity: 0,
        revenue: 0,
        commissionBase: 0,
        commission: 0,
        achieved: false,
        achievedDays: 0,
        maxDailySold: 0,
        dailyBonus: 0,
        weeklyBonus: 0,
        monthlyBonus: 0,
        rank: 'D',
      }
      current.soldQuantity += dayRow.soldQuantity
      current.revenue += dayRow.revenue
      current.commissionBase += dayRow.commissionBase
      rows.set(key, current)
      addDailyPerformance(date, dayRow.branchId, employee, dayRow.soldQuantity, dayRow.revenue)
    })
  })

  receipts.forEach((receipt) => {
    const directLines = receipt.lines.filter((line) => !line.allocationId)
    if (!directLines.length) return
    const employee = receipt.sellerId
      ? employees.find((item) => item.id === receipt.sellerId)
      : employees.find((item) => item.branchId === receipt.branchId && normalizeName(item.name) === normalizeName(receipt.sellerName))
    if (!employee?.branchId || employee.branchId !== receipt.branchId || !PAYROLL_ROLES.includes(employee.role)) return
    const date = receipt.businessDate
    const soldQuantity = directLines.reduce((sum, line) => sum + line.quantity, 0)
    const revenue = directLines.reduce((sum, line) => sum + line.total, 0)
    const key = `${receipt.branchId}|${employee.id}`
    const current = rows.get(key) || {
      employeeKey: employee.id,
      employeeId: employee.id,
      employeeName: employee.name || receipt.sellerName,
      branchId: receipt.branchId,
      soldQuantity: 0,
      revenue: 0,
      commissionBase: 0,
      commission: 0,
      achieved: false,
      achievedDays: 0,
      maxDailySold: 0,
      dailyBonus: 0,
      weeklyBonus: 0,
      monthlyBonus: 0,
      rank: 'D',
    }
    current.soldQuantity += soldQuantity
    current.revenue += revenue
    current.commissionBase += revenue
    rows.set(key, current)
    addDailyPerformance(date, receipt.branchId, employee, soldQuantity, revenue)
  })

  const weekWins = new Map<string, { rowKey: string; achievedDays: number; perfectDays: number }>()
  dailyPerformance.forEach((day) => {
    const rowKey = `${day.branchId}|${day.employee.id}`
    const row = rows.get(rowKey)
    if (!row) return
    const dayTarget = employeePeriodRevenueTarget(
      day.branchId,
      day.employee.role,
      day.employee.employmentType,
      day.employee.positionTitle,
      day.date,
      day.date,
    )
    const dayProgress = day.revenue / Math.max(1, dayTarget) * 100
    row.dailyBonus += dailyKpiBonus(dayProgress, day.employee.role, day.employee.employmentType, day.employee.positionTitle)
    row.achieved = row.achieved || dayProgress >= 100
    row.achievedDays += dayProgress >= 100 ? 1 : 0
    row.maxDailySold = Math.max(row.maxDailySold, day.soldQuantity)
    const weekKey = `${rowKey}|${weekStart(day.date)}`
    const week = weekWins.get(weekKey) || { rowKey, achievedDays: 0, perfectDays: 0 }
    if (dayProgress >= 100) week.achievedDays += 1
    if (dayProgress >= 100) week.perfectDays += 1
    weekWins.set(weekKey, week)
  })
  weekWins.forEach((week) => {
    const row = rows.get(week.rowKey)
    if (!row) return
    row.weeklyBonus += weeklyKpiBonus(week.achievedDays, week.perfectDays)
  })
  type CommissionOutputRow = ReturnType<typeof summarizeEmployeeBagSales>[number] & {
    achievedDays: number
    maxDailySold: number
    dailyBonus: number
    weeklyBonus: number
    monthlyBonus: number
    rank: string
    employeeKey: string
    employeeName: string
    totalHours: number
    targetQuantity: number
    progress: number
  }
  return Array.from(rows.values()).map((row): CommissionOutputRow | null => {
    const employee = row.employeeId
      ? employees.find((item) => item.id === row.employeeId)
      : employees.find((item) => normalizeName(item.name) === normalizeName(row.employeeName))
    if (!employee?.branchId || employee.branchId !== row.branchId || !PAYROLL_ROLES.includes(employee.role)) return null
    const employeeKey = employee?.id || row.employeeKey
    const attendance = attendanceRows.find((item) =>
      item.branchId === row.branchId
      && (item.userId === employeeKey || normalizeName(item.employeeName) === normalizeName(row.employeeName)),
    )
    const formulaTarget = employeePeriodRevenueTarget(
      row.branchId,
      employee?.role,
      employee?.employmentType,
      employee?.positionTitle,
      from,
      to,
    )
    const targetRevenue = formulaTarget || DEFAULT_REVENUE_TARGET
    const achieved = row.achievedDays > 0
    const progress = Math.min(200, row.revenue / targetRevenue * 100)
    const monthlyBonus = 0
    const kpiBonus = row.dailyBonus + row.weeklyBonus
    return {
      ...row,
      employeeKey,
      employeeName: employee?.name || row.employeeName,
      totalHours: attendance?.totalHours || 0,
      targetQuantity: targetRevenue,
      achieved,
      dailyBonus: row.dailyBonus,
      weeklyBonus: row.weeklyBonus,
      monthlyBonus,
      commission: kpiBonus,
      progress,
      rank: kpiRank(progress),
    }
  }).filter((row): row is CommissionOutputRow => Boolean(row))
    .sort((a, b) => b.revenue - a.revenue || b.commission - a.commission)
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function allocationReportDate(allocation: BagAllocation) {
  return allocation.businessDate || allocation.settledAt?.slice(0, 10) || allocation.issuedAt.slice(0, 10)
}

function weekStart(value: string) {
  const date = new Date(`${value}T00:00:00`)
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

function styleSheet(sheet: import('exceljs').Worksheet, title: string) {
  sheet.spliceRows(1, 0, [title])
  sheet.mergeCells(1, 1, 1, sheet.columnCount)
  sheet.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } }
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102238' } }
  sheet.getCell('A1').alignment = { horizontal: 'center' }
  sheet.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF789D12' } }
  sheet.views = [{ state: 'frozen', ySplit: 2 }]
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: sheet.columnCount } }
}

function attendanceDetailColumns() {
  return [
    { header: 'Ngày làm', key: 'workDate', width: 13 },
    { header: 'Nhân viên', key: 'employeeName', width: 26 },
    { header: 'Vị trí', key: 'position', width: 16 },
    { header: 'Chi nhánh', key: 'branch', width: 24 },
    { header: 'Ca dự kiến', key: 'scheduled', width: 17 },
    { header: 'Giờ vào', key: 'checkIn', width: 20 },
    { header: 'Giờ ra', key: 'checkOut', width: 20 },
    { header: 'Giờ thực tế (thập phân)', key: 'totalHours', width: 22 },
    { header: 'Ngày công', key: 'workDayCredit', width: 12 },
    { header: 'Đi trễ (phút)', key: 'lateMinutes', width: 14 },
    { header: 'Trạng thái', key: 'status', width: 16 },
    { header: 'Địa chỉ check-in', key: 'address', width: 50 },
    { header: 'Địa chỉ check-out', key: 'checkOutAddress', width: 50 },
    { header: 'Ảnh check-in', key: 'checkInSelfieUrl', width: 18 },
    { header: 'Ảnh check-out', key: 'checkOutSelfieUrl', width: 18 },
    { header: 'Ghi chú', key: 'note', width: 30 },
  ]
}

async function addAttendanceDetailRow(sheet: import('exceljs').Worksheet, row: ReturnType<typeof buildAttendanceDetailRows>[number], position = '') {
  const [evidenceUrl, checkOutEvidenceUrl] = await Promise.all([
    selfieEvidenceUrl(row.selfieUrl),
    selfieEvidenceUrl(row.checkOutSelfieUrl),
  ])
  sheet.addRow({
    workDate: formatDate(row.workDate),
    employeeName: row.employeeName,
    position,
    branch: branchName(row.branchId),
    scheduled: `${row.scheduledStart}-${row.scheduledEnd}`,
    checkIn: row.checkInTime ? formatDateTime(row.checkInTime) : '',
    checkOut: row.checkOutTime ? formatDateTime(row.checkOutTime) : '',
    totalHours: row.totalHours,
    workDayCredit: row.workDayCredit,
    lateMinutes: row.lateMinutes,
    status: attendanceDetailStatus(row.status),
    address: row.checkInAddress || '',
    checkOutAddress: row.checkOutAddress || '',
    checkInSelfieUrl: evidenceUrl ? { text: 'Check-in', hyperlink: evidenceUrl } : '',
    checkOutSelfieUrl: checkOutEvidenceUrl ? { text: 'Check-out', hyperlink: checkOutEvidenceUrl } : '',
    note: row.note,
  })
}

const adminAttendanceEvidenceUrlCache = new Map<string, Promise<string>>()

async function selfieEvidenceUrl(value?: string) {
  if (!value) return ''
  const cached = adminAttendanceEvidenceUrlCache.get(value)
  if (cached) return cached
  const pending = resolveSelfieEvidenceUrl(value).catch(() => {
    adminAttendanceEvidenceUrlCache.delete(value)
    return ''
  })
  adminAttendanceEvidenceUrlCache.set(value, pending)
  return pending
}

async function resolveSelfieEvidenceUrl(value: string) {
  const path = normalizeAttendanceSelfiePath(value)
  if (/^https?:\/\//i.test(value) && !path) return value
  if (value.startsWith('/')) return `${window.location.origin}${value}`
  if (!supabase) return value
  const storagePath = path || value.replace(/^attendance-selfies\//, '')
  if (isDemoAttendanceSelfiePath(storagePath)) return ''
  try {
    const signed = await supabase.storage.from('attendance-selfies').createSignedUrl(storagePath, 60 * 60 * 24 * 30)
    if (signed.data?.signedUrl) return signed.data.signedUrl
    if (signed.error) return ''
    return supabase.storage.from('attendance-selfies').getPublicUrl(storagePath).data.publicUrl || value
  } catch {
    return ''
  }
}

function isDemoAttendanceSelfiePath(value: string) {
  return /^(demo|sample|mock)[/_-]/i.test(value)
    || /\/(demo|sample|mock)[/_-]/i.test(value)
    || /^demo\//i.test(value)
}

function safeSheetName(value: string) {
  return value.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Chi nhánh'
}

function uniqueSheetName(value: string, used: Set<string>) {
  const base = safeSheetName(value)
  let name = base
  let index = 2
  while (used.has(name)) {
    const suffix = ` ${index}`
    name = `${base.slice(0, Math.max(1, 31 - suffix.length)).trim()}${suffix}`
    index += 1
  }
  used.add(name)
  return name
}
function normalizeAttendanceSelfiePath(value: string) {
  try {
    const rawPath = /^https?:\/\//i.test(value) ? decodeURIComponent(new URL(value).pathname) : value
    const marker = '/attendance-selfies/'
    const index = rawPath.indexOf(marker)
    if (index >= 0) return rawPath.slice(index + marker.length)
    if (rawPath.startsWith('attendance-selfies/')) return rawPath.slice('attendance-selfies/'.length)
  } catch {
    // Keep original value when it is not a parseable URL.
  }
  return ''
}

async function saveWorkbook(workbook: import('exceljs').Workbook, name: string) {
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && typeof navigator.share === 'function') {
    await shareOrDownloadBlob(blob, name, { title: name.replace(/\.xlsx$/i, '') })
  } else {
    download(blob, name)
  }
}

function download(blob: Blob, name: string) {
  downloadBlob(blob, name)
}

function dispatchCurrentUserProfile(user: AppUser, updated: EmployeeProfile) {
  window.dispatchEvent(new CustomEvent('gustino:user-profile-updated', {
    detail: {
      id: updated.id,
      name: updated.name,
      email: updated.email || user.email,
      role: updated.role,
      branchId: updated.branchId || user.branchId,
      employmentType: updated.employmentType,
      positionTitle: updated.positionTitle,
      avatarUrl: updated.avatarUrl,
    },
  }))
}

async function fileToAvatarDataUrl(file: File) {
  try {
    const bitmap = await createImageBitmap(file)
    const size = 256
    const scale = Math.min(size / bitmap.width, size / bitmap.height)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Không thể xử lý ảnh đại diện.')
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch {
    return fileToDataUrl(file)
  }
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`
}

function cleanMoneyInput(value: string) {
  return value.replace(/[^\d]/g, '')
}

function parseMoney(value: string) {
  return Number(cleanMoneyInput(value)) || 0
}

function parsePercent(value: string) {
  return Number(value.replace(/[^\d.,]/g, '').replace(',', '.')) || 0
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

function supplyStatusLabel(status: SupplyRequest['status']) {
  return status === 'pending' ? 'Chờ duyệt'
    : status === 'acknowledged' ? 'Đã nhận'
      : status === 'cancelled' ? 'Đã hủy'
        : 'Hoàn thành'
}

function branchName(id?: string) {
  if (!id) return 'Chưa gán chi nhánh'
  return configuredBranchName(id) || id
}

function formatNumber(value: number) {
  return Number(value.toFixed(2)).toLocaleString('vi-VN')
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN')
}
function formatMonthLabel(period: string) {
  const [year, month] = period.split('-')
  return `${month}/${year}`
}
function formatDateTime(date: string) {
  return new Date(date).toLocaleString('vi-VN', { hour12: false })
}
function toDateTimeLocalValue(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
function attendanceDetailStatus(status: 'completed' | 'working' | 'absent' | 'scheduled') {
  return ({ completed: 'Đã hoàn thành', working: 'Đang làm', absent: 'Vắng', scheduled: 'Chưa tới ca' })[status]
}

function monthRange(offset = 0) {
  const today = new Date()
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  const last = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0)
  return { from: localDateKey(first), to: localDateKey(last) }
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const MOVEMENT_LABELS: Record<StockMovement['type'], string> = {
  opening: 'Tồn đầu',
  inbound: 'Nhập kho',
  processing_out: 'Xuất sơ chế',
  processing_in: 'Nhập sơ chế',
  packing_out: 'Xuất đóng gói',
  packing_in: 'Nhập thành phẩm',
  sale_out: 'Bán hàng',
  waste: 'Hao hụt',
  adjustment: 'Điều chỉnh',
  count: 'Kiểm kê',
}
