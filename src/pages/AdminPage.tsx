import { useEffect, useMemo, useState } from 'react'
import {
  buildAttendanceReport,
  buildAttendanceDetailRows,
  createEmployeeAccount,
  deleteEmployeeAccount,
  fetchAttendanceRecords,
  fetchEmployees,
  fetchShiftRegistrations,
  fetchWorkShifts,
  permittedBranchIds,
  resetEmployeePassword,
  updateEmployeeDetails,
  updateEmployeeRole,
} from '../lib/attendance'
import { roleLabel } from '../lib/access'
import { useLang } from '../lib/i18n'
import { BRANCHES, PRODUCTS } from '../lib/constants'
import { calculateStock, fetchInventoryReports, fetchMovements, fetchReportSnapshots } from '../lib/store'
import { supabase } from '../lib/supabase'
import { fetchBagAllocations } from '../lib/shiftLedger'
import { COMMISSION_MIN_BAGS, summarizeEmployeeBagSales } from '../lib/commission'
import { buildDailyRevenueRows } from '../lib/revenue'
import { emailToUsername, validateUsername } from '../lib/authIdentity'
import { fetchSupplyRequests, acknowledgeSupplyRequest, updateSupplyRequestStatus, type SupplyRequest } from '../lib/supplyRequests'
import type {
  AppUser,
  AttendanceRecord,
  BagAllocation,
  EmployeeProfile,
  EmploymentType,
  InventoryReport,
  ReportSnapshot,
  Role,
  ShiftRegistration,
  StockMovement,
  WorkShift,
} from '../types'

export type AdminSection = 'overview' | 'attendance' | 'commission' | 'payroll' | 'inventory' | 'requests' | 'accounts' | 'revenue'

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
  { id: 'chain', section: 'overview', icon: '▣', label: 'Chuỗi nhà hàng', description: 'Tổng quan chi nhánh, ca làm, cảnh báo vận hành', tone: 'blue' },
  { id: 'business', section: 'revenue', icon: '▤', label: 'Tình hình kinh doanh', description: 'Doanh thu toàn chuỗi theo ngày và chi nhánh', tone: 'gold' },
  { id: 'cashflow', section: 'payroll', icon: '◇', label: 'Tình hình thu chi', description: 'Lương, hoa hồng, thưởng phạt và chi phí nhân sự', tone: 'pink' },
  { id: 'revenue', section: 'revenue', icon: '◔', label: 'Doanh thu', description: 'Báo cáo doanh thu chi tiết trong kỳ', tone: 'green' },
  { id: 'best_sellers', section: 'commission', icon: '▥', label: 'Mặt hàng bán chạy', description: 'Sản phẩm và nhân viên bán tốt theo sổ túi', tone: 'purple' },
  { id: 'customers', section: 'revenue', icon: '◎', label: 'Số lượng khách', description: 'Ước tính theo hóa đơn và lượt bán trong ngày', tone: 'cyan' },
  { id: 'kitchen_orders', section: 'requests', icon: '↑', label: 'Đặt bếp', description: 'Duyệt yêu cầu đặt bếp/nhập hàng từ ca trưởng', tone: 'violet' },
  { id: 'employee_revenue', section: 'commission', icon: '○', label: 'Doanh thu theo nhân viên', description: 'KPI, túi bán và hoa hồng từng nhân viên', tone: 'orange' },
  { id: 'cancelled', section: 'requests', icon: '▱', label: 'SL hủy order/hủy món', description: 'Yêu cầu đặt hàng bị hủy hoặc chưa hoàn tất', tone: 'red' },
  { id: 'branch_compare', section: 'revenue', icon: '▧', label: 'So sánh doanh thu chi nhánh', description: 'Xếp hạng và đối chiếu doanh thu từng điểm bán', tone: 'purple' },
  { id: 'returns', section: 'inventory', icon: '↺', label: 'Số lượng chế biến trả lại', description: 'Hao hụt, hoàn trả và tồn kho sau chế biến', tone: 'dark' },
  { id: 'attendance', section: 'attendance', icon: '◉', label: 'Chấm công nhân viên', description: 'Ca làm, giờ công, đi trễ và quên check-out', tone: 'blue' },
  { id: 'accounts', section: 'accounts', icon: '⊕', label: 'Nhân sự & tài khoản', description: 'Tạo tài khoản, phân quyền và hồ sơ nhân viên', tone: 'green' },
]

const ADMIN_TEXT = {
  vi: {
    navLabel: 'CHỨC NĂNG',
    sections: {
      revenue: 'Doanh thu',
      overview: 'Tổng quan',
      attendance: 'Chấm công',
      commission: 'KPI & Hoa hồng',
      payroll: 'Bảng lương',
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
      commission: 'KPI & Hoa hồng',
      payroll: 'Bảng lương',
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

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'kitchen', label: 'Bếp' },
  { value: 'staff', label: 'Nhân viên' },
  { value: 'shift_leader', label: 'Ca trưởng' },
  { value: 'manager', label: 'Admin' },
]

interface PayrollDraft {
  hourlyRate: string
  fixedSalary: string
  bonus: string
  deduction: string
  note: string
}

const PAYROLL_DRAFT_KEY = 'gustino_payroll_drafts_v1'

const emptyPayrollDraft: PayrollDraft = {
  hourlyRate: '',
  fixedSalary: '',
  bonus: '',
  deduction: '',
  note: '',
}

function loadPayrollDrafts(): Record<string, PayrollDraft> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PAYROLL_DRAFT_KEY) || '{}') as Record<string, PayrollDraft>
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, { ...emptyPayrollDraft, ...value }]))
  } catch {
    return {}
  }
}

export function ManagementPage({ user, initialSection }: { user: AppUser; initialSection?: AdminSection }) {
  const lang = useLang()
  const text = ADMIN_TEXT[lang]
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
  const [supplyRequests, setSupplyRequests] = useState<SupplyRequest[]>([])
  const [reportSnapshots, setReportSnapshots] = useState<ReportSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [branchId, setBranchId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)
  const [savingRoleId, setSavingRoleId] = useState('')
  const [accountBusyId, setAccountBusyId] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState('')
  const [employeeDrafts, setEmployeeDrafts] = useState<Record<string, {
    branchId: string
    employmentType: EmploymentType
    positionTitle: string
  }>>({})
  const [payrollDrafts, setPayrollDrafts] = useState<Record<string, PayrollDraft>>(loadPayrollDrafts)
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

  async function refresh() {
    setLoading(true)
    try {
      const managedBranchIds = permittedBranchIds(user)
      const [
        nextEmployees,
        nextShifts,
        nextRegistrations,
        nextRecords,
        nextMovements,
        nextInventoryReports,
        nextBagAllocations,
        nextSupplyRequests,
        nextReportSnapshots,
      ] = await Promise.all([
        fetchEmployees(user),
        fetchWorkShifts(user),
        fetchShiftRegistrations(user),
        fetchAttendanceRecords(user),
        Promise.all(managedBranchIds.map(fetchMovements)).then((items) => items.flat()),
        Promise.all(managedBranchIds.map(fetchInventoryReports)).then((items) => items.flat()),
        Promise.all(managedBranchIds.map((id) => fetchBagAllocations(user, { branchId: id }))).then((items) => items.flat()),
        fetchSupplyRequests(user, managedBranchIds).catch(() => [] as SupplyRequest[]),
        Promise.all(managedBranchIds.map(fetchReportSnapshots)).then((items) => items.flat()).catch(() => [] as ReportSnapshot[]),
      ])
      setEmployees(nextEmployees)
      setShifts(nextShifts)
      setRegistrations(nextRegistrations)
      setRecords(nextRecords)
      setMovements(nextMovements)
      setInventoryReports(nextInventoryReports)
      setBagAllocations(nextBagAllocations)
      setSupplyRequests(nextSupplyRequests)
      setReportSnapshots(nextReportSnapshots)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể tải dữ liệu quản lý.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [user.id])

  const branchIds = permittedBranchIds(user)
  const visibleBranches = BRANCHES.filter((branch) => branchIds.includes(branch.id))
  const selectedBranches = visibleBranches.filter((branch) => !branchId || branch.id === branchId)
  const filteredEmployees = employees.filter((employee) =>
    employee.active !== false
    && (!branchId || employee.branchId === branchId)
    && (!employeeId || employee.id === employeeId),
  )
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
  const attendanceRows = useMemo(
    () => buildAttendanceReport(rangeRegistrations, rangeRecords, graceByShift),
    [rangeRegistrations, rangeRecords, graceByShift],
  )
  const attendanceDetailRows = useMemo(
    () => buildAttendanceDetailRows(rangeRegistrations, rangeRecords, graceByShift),
    [rangeRegistrations, rangeRecords, graceByShift],
  )
  const rangeMovements = movements.filter((item) =>
    (!branchId || item.branchId === branchId) && item.shiftDate >= from && item.shiftDate <= to,
  )
  const stockRows = useMemo(
    () => buildInventoryRows(movements, selectedBranches.map((branch) => branch.id), from, to),
    [movements, branchId, from, to],
  )
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
        const date = (item.settledAt || item.issuedAt).slice(0, 10)
        return item.settledAt && date >= from && date <= to && (!branchId || item.branchId === branchId)
      }),
      employees,
      attendanceRows,
    ),
    [bagAllocations, employees, attendanceRows, branchId, from, to],
  )
  const payrollRows = useMemo(
    () => buildPayrollRows(filteredEmployees, attendanceRows, commissionRows, payrollDrafts),
    [filteredEmployees, attendanceRows, commissionRows, payrollDrafts],
  )
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
  const periodRevenueRows = buildDailyRevenueRows(reportSnapshots, bagAllocations, movements, { branchId, from, to })
  const activeFunction = MANAGEMENT_FUNCTIONS.find((item) => item.id === activeFunctionId) || MANAGEMENT_FUNCTIONS[1]
  const activeFunctionStats = buildFunctionStats(activeFunction.id, {
    revenue: periodRevenueRows.reduce((sum, row) => sum + row.revenue, 0),
    sold: periodRevenueRows.reduce((sum, row) => sum + row.totalSold, 0),
    branches: selectedBranches.length,
    employees: filteredEmployees.length,
    lowStock: lowStockRows.length,
    pendingRequests,
    payroll: payrollTotals.grossPay,
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
        branchId: accountBranchId,
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
      setFeedback(`Bấm “Xác nhận xóa” lần nữa để xóa tài khoản ${employee.name}.`)
      return
    }
    setAccountBusyId(employee.id)
    try {
      await deleteEmployeeAccount(user, employee.id)
      setEmployees((items) => items.filter((item) => item.id !== employee.id))
      if (employeeId === employee.id) setEmployeeId('')
      setPendingDeleteId('')
      setFeedback(`Đã xóa tài khoản ${employee.name}. Tên đăng nhập cũ có thể dùng lại.`)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Không thể xóa tài khoản.'
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
      const updated = await updateEmployeeDetails(user, employee.id, draft)
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

  async function exportAttendance() {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    const detailSheet = workbook.addWorksheet('Chi tiết chấm công')
    detailSheet.columns = attendanceDetailColumns()
    for (const row of attendanceDetailRows) {
      await addAttendanceDetailRow(detailSheet, row)
    }
    styleSheet(detailSheet, `CHI TIẾT CHẤM CÔNG ${formatDate(from)} - ${formatDate(to)}`)

    const summarySheet = workbook.addWorksheet('Tổng hợp')
    summarySheet.columns = [
      { header: 'Nhân viên', key: 'employeeName', width: 26 },
      { header: 'Chi nhánh', key: 'branch', width: 25 },
      { header: 'Tổng ca', key: 'totalShifts', width: 11 },
      { header: 'Tổng giờ', key: 'totalHours', width: 12 },
      { header: 'Ngày công', key: 'workDays', width: 12 },
      { header: 'Đi trễ', key: 'lateCount', width: 10 },
      { header: 'Vắng', key: 'absentCount', width: 10 },
      { header: 'Quên checkout', key: 'missingCheckoutCount', width: 16 },
    ]
    attendanceRows.forEach((row) => summarySheet.addRow({ ...row, branch: branchName(row.branchId) }))
    styleSheet(summarySheet, `TỔNG HỢP CHẤM CÔNG ${formatDate(from)} - ${formatDate(to)}`)

    const commissionSheet = workbook.addWorksheet('KPI & Hoa hồng')
    commissionSheet.columns = [
      { header: 'Nhân viên', key: 'employeeName', width: 26 },
      { header: 'Chi nhánh', key: 'branch', width: 24 },
      { header: 'Giờ công', key: 'totalHours', width: 12 },
      { header: 'Số túi bán', key: 'soldQuantity', width: 13 },
      { header: 'KPI', key: 'targetQuantity', width: 11 },
      { header: 'Tỷ lệ đạt (%)', key: 'progress', width: 14 },
      { header: 'Đạt KPI', key: 'achieved', width: 12 },
      { header: 'Hoa hồng', key: 'commission', width: 16 },
    ]
    commissionRows.forEach((row) => commissionSheet.addRow({
      ...row,
      branch: branchName(row.branchId),
      achieved: row.achieved ? 'Đạt' : 'Chưa đạt',
    }))
    styleSheet(commissionSheet, `KPI & HOA HỒNG ${formatDate(from)} - ${formatDate(to)}`)

    const exportBranchIds = Array.from(new Set([
      ...attendanceRows.map((row) => row.branchId),
      ...attendanceDetailRows.map((row) => row.branchId),
    ])).sort((a, b) => branchName(a).localeCompare(branchName(b), 'vi'))
    for (const id of exportBranchIds) {
      const branchSheet = workbook.addWorksheet(safeSheetName(branchName(id)))
      branchSheet.columns = attendanceDetailColumns()
      for (const row of attendanceDetailRows.filter((item) => item.branchId === id)) {
        await addAttendanceDetailRow(branchSheet, row)
      }
      styleSheet(branchSheet, `CHẤM CÔNG ${branchName(id)} ${formatDate(from)} - ${formatDate(to)}`)
    }

    await saveWorkbook(workbook, `bang-cham-cong-${from}-${to}.xlsx`)
  }

  async function exportInventory() {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Báo cáo kho')
    sheet.columns = [
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
    stockRows.forEach((row) => sheet.addRow({
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
    styleSheet(sheet, `BÁO CÁO KHO ${formatDate(from)} - ${formatDate(to)}`)
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
      const next = {
        ...drafts,
        [employeeKey]: { ...emptyPayrollDraft, ...(drafts[employeeKey] || {}), ...patch },
      }
      localStorage.setItem(PAYROLL_DRAFT_KEY, JSON.stringify(next))
      return next
    })
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
      row.bonus,
      row.deduction,
      row.grossPay,
      row.note,
    ])
    const csv = [
      ['Nhân viên', 'Chi nhánh', 'Vị trí', 'Ca', 'Giờ công', 'Ngày công', 'Lương giờ', 'Lương cứng', 'Lương công', 'Hoa hồng', 'Thưởng', 'Trừ', 'Thực nhận', 'Ghi chú'],
      ...rows,
    ].map((line) => line.map(csvCell).join(',')).join('\n')
    download(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `bang-luong-${from}-${to}.csv`)
  }

  return (
    <div className="page admin-page">
      {/* Bộ lọc quản lý */}
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

      {error && <div className="feedback-bar">{error}<button onClick={() => setError('')}>×</button></div>}
      {feedback && <div className="feedback-bar success">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}

      {/* Layout 2 cột: nav trái + nội dung phải */}
      <div className="admin-layout">
        <nav className="management-function-list" aria-label={text.navLabel}>
          <div className="management-function-head">
            <span>Báo cáo</span>
            <strong>{MANAGEMENT_FUNCTIONS.length}</strong>
          </div>
          {MANAGEMENT_FUNCTIONS.map((item) => (
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
        </nav>

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
                            <span className="rbn-meta">{snaps.length} ngày · {sold} túi</span>
                          </div>
                          <span className="rbn-chevron">›</span>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
              <section className="section-card" style={{ marginTop: 0 }}>
                <div className="section-title">
                  <div><span className="eyebrow dark">DOANH THU THEO NGÀY</span><h2>Báo cáo tất cả chi nhánh</h2></div>
                  <span className="date-chip">{periodRevenueRows.length} ngày có doanh thu</span>
                </div>
                <div className="table-scroll">
                  <table className="data-table admin-compact-table">
                    <thead>
                      <tr><th>Ngày</th><th>Chi nhánh</th><th>Doanh thu</th><th>Túi bán</th><th>Năng suất</th><th>KPI</th><th>Xếp loại</th><th>Nguồn</th></tr>
                    </thead>
                    <tbody>
                      {periodRevenueRows.map((snap) => (
                        <tr key={snap.id}>
                          <td><strong>{formatDate(snap.reportDate)}</strong></td>
                          <td>{branchName(snap.branchId)}</td>
                          <td><strong>{snap.revenue.toLocaleString('vi-VN')}đ</strong></td>
                          <td>{snap.totalSold || '-'}</td>
                          <td>{snap.salesRate !== undefined ? `${snap.salesRate}%` : '-'}</td>
                          <td>{snap.kpi !== undefined ? `${snap.kpi}%` : '-'}</td>
                          <td>
                            {snap.grade
                              ? <span className={`grade-chip grade-${snap.grade.toLowerCase()}`}>{snap.grade}</span>
                              : '-'}
                          </td>
                          <td>{snap.source === 'report' ? 'Đã chốt' : 'Tạm tính'}</td>
                        </tr>
                      ))}
                      {!periodRevenueRows.length && (
                        <tr><td colSpan={8} className="empty-state">Chưa có báo cáo doanh thu trong khoảng thời gian này.<br /><small>Báo cáo sẽ xuất hiện sau khi ca trưởng bấm "Chốt báo cáo" cuối ngày.</small></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {/* ===== TỔNG QUAN ===== */}
          {activeSection === 'overview' && (
            <>
              <section className="admin-stats admin-business-stats">
                <article><span>{text.shiftsDone}</span><strong>{formatNumber(totalShifts)}</strong><small>{text.shiftsHint}</small></article>
                <article><span>{text.hours}</span><strong>{formatNumber(totalHours)}</strong><small>{attendanceRows.length} {text.hoursHint}</small></article>
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
            <section className="section-card admin-report-section" style={{ marginTop: 0 }}>
              <div className="section-title">
                <div><span className="eyebrow dark">BẢNG CHẤM CÔNG</span><h2>Chấm công theo ngày, tháng</h2></div>
                <button className="primary-button" onClick={exportAttendance} disabled={!attendanceRows.length}>Xuất Excel</button>
              </div>
              <div className="table-scroll">
                <table className="data-table attendance-report-table">
                  <thead><tr><th>Nhân viên</th><th>Chi nhánh</th><th>Tổng ca</th><th>Tổng giờ</th><th>Ngày công</th><th>Đi trễ</th><th>Vắng</th><th>Quên checkout</th></tr></thead>
                  <tbody>
                    {attendanceRows.map((row) => <tr key={`${row.userId}-${row.branchId}`}>
                      <td><strong>{row.employeeName}</strong></td><td>{branchName(row.branchId)}</td>
                      <td>{row.totalShifts}</td><td>{row.totalHours}</td><td><strong>{row.workDays}</strong></td>
                      <td>{row.lateCount}</td><td>{row.absentCount}</td><td>{row.missingCheckoutCount}</td>
                    </tr>)}
                    {!attendanceRows.length && <tr><td colSpan={8} className="empty-state">Không có dữ liệu chấm công trong khoảng đã chọn.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ===== KPI & HOA HỒNG ===== */}
          {activeSection === 'commission' && (
            <section className="section-card commission-section" style={{ marginTop: 0 }}>
              <div className="section-title">
                <div><span className="eyebrow dark">KPI & HOA HỒNG</span><h2>Tổng kết bán hàng theo nhân viên</h2></div>
                <span className="date-chip">{commissionRows.filter((row) => row.achieved).length} người đạt KPI</span>
              </div>
              <div className="commission-rule-grid">
                {selectedBranches.map((branch) => <article key={branch.id}>
                  <strong>{branch.name}</strong>
                  <label>Mốc nhận hoa hồng<input value={`${COMMISSION_MIN_BAGS} túi`} readOnly /></label>
                  <label>Cách tính<input value="1.000đ / 2.000đ / 3.000đ theo giá túi" readOnly /></label>
                </article>)}
              </div>
              <div className="table-scroll">
                <table className="data-table commission-table">
                  <thead><tr><th>Nhân viên</th><th>Chi nhánh</th><th>Giờ công</th><th>Số túi bán</th><th>KPI</th><th>Tỷ lệ</th><th>Hoa hồng</th></tr></thead>
                  <tbody>
                    {commissionRows.map((row) => <tr key={`${row.branchId}-${row.employeeKey}`}>
                      <td><strong>{row.employeeName}</strong></td>
                      <td>{branchName(row.branchId)}</td>
                      <td>{formatNumber(row.totalHours)}</td>
                      <td><strong>{formatNumber(row.soldQuantity)}</strong></td>
                      <td>{formatNumber(row.targetQuantity)}</td>
                      <td><span className={row.achieved ? 'kpi-achieved' : 'kpi-pending'}>{formatNumber(row.progress)}%</span></td>
                      <td><strong>{row.commission.toLocaleString('vi-VN')}đ</strong></td>
                    </tr>)}
                    {!commissionRows.length && <tr><td colSpan={7} className="empty-state">Chưa có lượt bán đã đối soát trong kỳ.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="commission-note">Tự động đối soát từ sổ túi. Từ {COMMISSION_MIN_BAGS} túi: sản phẩm dưới 50.000đ nhận 1.000đ/túi, dưới 100.000đ nhận 2.000đ/túi, còn lại nhận 3.000đ/túi.</p>
            </section>
          )}

          {/* ===== BẢNG LƯƠNG ===== */}
          {activeSection === 'payroll' && (
            <section className="section-card payroll-section" style={{ marginTop: 0 }}>
              <div className="section-title">
                <div><span className="eyebrow dark">BẢNG LƯƠNG</span><h2>Tính lương theo công, hoa hồng và điều chỉnh</h2></div>
                <button className="primary-button" onClick={exportPayroll} disabled={!payrollRows.length}>Tải CSV</button>
              </div>
              <div className="payroll-summary-grid">
                <article><span>Lương công</span><strong>{formatMoney(payrollTotals.basePay)}</strong></article>
                <article><span>Hoa hồng</span><strong>{formatMoney(payrollTotals.commission)}</strong></article>
                <article><span>Thưởng / trừ</span><strong>{formatMoney(payrollTotals.bonus - payrollTotals.deduction)}</strong></article>
                <article className="total"><span>Thực nhận</span><strong>{formatMoney(payrollTotals.grossPay)}</strong></article>
              </div>
              <div className="table-scroll">
                <table className="data-table payroll-table">
                  <thead>
                    <tr>
                      <th>Nhân viên</th><th>Công</th><th>Lương giờ</th><th>Lương cứng</th><th>Lương công</th>
                      <th>Hoa hồng</th><th>Thưởng</th><th>Trừ</th><th>Thực nhận</th><th>Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollRows.map((row) => (
                      <tr key={row.employeeKey}>
                        <td>
                          <strong>{row.employeeName}</strong>
                          <small>{branchName(row.branchId)} · {row.positionTitle}</small>
                        </td>
                        <td>
                          <strong>{formatNumber(row.totalHours)} giờ</strong>
                          <small>{formatNumber(row.workDays)} ngày · {row.totalShifts} ca</small>
                        </td>
                        <td>
                          <input
                            className="payroll-money-input"
                            inputMode="numeric"
                            value={row.draft.hourlyRate}
                            onChange={(event) => updatePayrollDraft(row.employeeKey, { hourlyRate: cleanMoneyInput(event.target.value) })}
                            placeholder="0"
                          />
                        </td>
                        <td>
                          <input
                            className="payroll-money-input"
                            inputMode="numeric"
                            value={row.draft.fixedSalary}
                            onChange={(event) => updatePayrollDraft(row.employeeKey, { fixedSalary: cleanMoneyInput(event.target.value) })}
                            placeholder="0"
                          />
                        </td>
                        <td><strong>{formatMoney(row.basePay)}</strong></td>
                        <td>{formatMoney(row.commission)}</td>
                        <td>
                          <input
                            className="payroll-money-input"
                            inputMode="numeric"
                            value={row.draft.bonus}
                            onChange={(event) => updatePayrollDraft(row.employeeKey, { bonus: cleanMoneyInput(event.target.value) })}
                            placeholder="0"
                          />
                        </td>
                        <td>
                          <input
                            className="payroll-money-input"
                            inputMode="numeric"
                            value={row.draft.deduction}
                            onChange={(event) => updatePayrollDraft(row.employeeKey, { deduction: cleanMoneyInput(event.target.value) })}
                            placeholder="0"
                          />
                        </td>
                        <td><strong>{formatMoney(row.grossPay)}</strong></td>
                        <td>
                          <input
                            className="payroll-note-input"
                            value={row.draft.note}
                            onChange={(event) => updatePayrollDraft(row.employeeKey, { note: event.target.value })}
                            placeholder="Ứng lương, thưởng KPI..."
                          />
                        </td>
                      </tr>
                    ))}
                    {!payrollRows.length && <tr><td colSpan={10} className="empty-state">Chưa có nhân viên phù hợp bộ lọc để lập bảng lương.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="commission-note">Lương giờ/lương cứng/thưởng/phạt đang lưu trên trình duyệt quản lý. Bảng công và hoa hồng lấy tự động theo bộ lọc ngày, chi nhánh, nhân viên phía trên.</p>
            </section>
          )}

          {/* ===== BÁO CÁO KHO ===== */}
          {activeSection === 'inventory' && (
            <section className="section-card admin-report-section" style={{ marginTop: 0 }}>
              <div className="section-title">
                <div><span className="eyebrow dark">BÁO CÁO KHO</span><h2>Nhập, xuất, hao hụt và tồn kho trong kỳ</h2></div>
                <button className="primary-button" onClick={exportInventory} disabled={!stockRows.length}>Xuất Excel</button>
              </div>
              <div className="table-scroll">
                <table className="data-table admin-compact-table admin-inventory-period-table">
                  <thead><tr><th>Sản phẩm</th><th>Chi nhánh</th><th>Tồn đầu</th><th>Nhập / tăng</th><th>Xuất / giảm</th><th>Hao hụt</th><th>Tồn cuối</th></tr></thead>
                  <tbody>
                    {stockRows.map((row) => <tr key={`${row.branchId}-${row.product.id}`}>
                      <td><strong>{row.product.name}</strong><small>{row.product.sku} · {row.product.unit}</small></td>
                      <td>{branchName(row.branchId)}</td>
                      <td>{formatNumber(row.opening)}</td><td>{formatNumber(row.inbound)}</td>
                      <td>{formatNumber(row.outbound)}</td><td className={row.waste ? 'text-warning' : ''}>{formatNumber(row.waste)}</td>
                      <td><strong>{formatNumber(row.closing)}</strong></td>
                    </tr>)}
                    {!stockRows.length && <tr><td colSpan={7} className="empty-state">Không có phát sinh kho trong khoảng đã chọn.</td></tr>}
                  </tbody>
                </table>
              </div>
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
                  <button className="primary-button" onClick={exportSupplyReport} disabled={!rangeSupplyRequests.length}>Tải CSV</button>
                  <span className="date-chip">{pendingRequests} chờ duyệt</span>
                </div>
              </div>
              {showSupplyReport && (
                <div className="table-scroll supply-report-table">
                  <table className="data-table admin-compact-table">
                    <thead><tr><th>Ngày</th><th>Chi nhánh</th><th>Người đặt</th><th>Món hàng</th><th>Số lượng</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead>
                    <tbody>
                      {rangeSupplyRequests.map((req) => (
                        <tr key={`report-${req.id}`}>
                          <td>{formatDate(req.createdAt.slice(0, 10))}</td>
                          <td>{branchName(req.branchId)}</td>
                          <td>{req.requestedByName}</td>
                          <td><strong>{req.productName}</strong></td>
                          <td>{req.quantity} {req.unit}</td>
                          <td>{supplyStatusLabel(req.status)}</td>
                          <td>{req.note || '-'}</td>
                        </tr>
                      ))}
                      {!rangeSupplyRequests.length && <tr><td colSpan={7} className="empty-state">Chưa có yêu cầu đặt hàng nào trong bộ lọc này.</td></tr>}
                    </tbody>
                  </table>
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
                <span className="date-chip">{filteredEmployees.length} tài khoản</span>
              </div>
              <form className="employee-account-form" onSubmit={createAccount}>
                <label>Họ tên<input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Nguyễn Văn A" required /></label>
                <label>Tên đăng nhập<input value={accountUsername} onChange={(event) => setAccountUsername(event.target.value)} placeholder="Ví dụ: ngoc, quanly" autoCapitalize="none" required /></label>
                <label>Mật khẩu<input type="password" minLength={6} value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} placeholder="Quản lý tự đặt" required /></label>
                <label>Chi nhánh
                  <select value={accountBranchId} onChange={(event) => setAccountBranchId(event.target.value)}>
                    {visibleBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </label>
                <label>Vai trò
                  <select value={accountRole} onChange={(event) => {
                    const role = event.target.value as Exclude<Role, 'admin'>
                    setAccountRole(role)
                    if (role === 'kitchen') {
                      setAccountEmploymentType('part_time')
                      setAccountPositionTitle('Bếp')
                    }
                    if (role === 'shift_leader') {
                      setAccountEmploymentType('leader')
                      setAccountPositionTitle('Ca trưởng')
                    }
                  }}>
                    {ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                </label>
                <label>Nhóm ca
                  <select value={accountEmploymentType} onChange={(event) => {
                    const type = event.target.value as EmploymentType
                    setAccountEmploymentType(type)
                    setAccountPositionTitle(type === 'leader' ? 'Ca trưởng' : type === 'full_time' ? 'Full-time' : 'Part-time')
                    if (accountRole !== 'kitchen') setAccountRole(type === 'leader' ? 'shift_leader' : 'staff')
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
              <p className="password-safety-note">Quản lý tự đặt mật khẩu cho nhân viên. Mật khẩu được Supabase mã hóa và không thể xem lại sau khi đóng khung thông tin.</p>
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
                  {filteredEmployees.map((employee) => {
                    const draft = employeeDraft(employee)
                    return <article className={employee.active === false ? 'inactive' : ''} key={employee.id}>
                    <span className="admin-avatar">{employee.name.slice(0, 1).toUpperCase()}</span>
                    <span><strong>{employee.name}{employee.active === false ? ' · Đã xóa' : ''}</strong><small>{branchName(employee.branchId)} · {employee.positionTitle || roleLabel(employee.role)} · @{emailToUsername(employee.email) || employee.id}</small></span>
                    <div className="employee-profile-editor">
                      <label>Chi nhánh
                        <select
                          value={draft.branchId}
                          disabled={employee.active === false || savingEmployeeDetailsId === employee.id}
                          onChange={(event) => updateEmployeeDraft(employee, { branchId: event.target.value })}
                        >
                          {visibleBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                        </select>
                      </label>
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
                      <button
                        type="button"
                        className="mini-button"
                        disabled={employee.active === false || savingEmployeeDetailsId === employee.id}
                        onClick={() => void saveEmployeeDetails(employee)}
                      >
                        {savingEmployeeDetailsId === employee.id ? 'Đang lưu…' : 'Lưu hồ sơ'}
                      </button>
                    </div>
                    <div className="employee-account-actions">
                      <select
                        aria-label={`Vai trò của ${employee.name}`}
                        value={employee.role === 'admin' ? 'manager' : employee.role}
                        disabled={savingRoleId === employee.id || employee.active === false}
                        onChange={(event) => void changeRole(employee, event.target.value as Role)}
                      >
                        {ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                      </select>
                      <button type="button" disabled={accountBusyId === employee.id || employee.active === false} onClick={() => void resetPassword(employee)}>Đặt lại mật khẩu</button>
                      <button
                        type="button"
                        className={pendingDeleteId === employee.id ? 'danger-button compact confirming' : 'danger-button compact'}
                        disabled={accountBusyId === employee.id || employee.id === user.id || employee.active === false}
                        title={employee.id === user.id ? 'Không thể xóa tài khoản đang đăng nhập' : 'Xóa quyền đăng nhập, vẫn giữ lịch sử chấm công'}
                        onClick={() => void removeAccount(employee)}
                      >
                        {accountBusyId === employee.id
                          ? 'Đang xóa…'
                          : employee.id === user.id
                            ? 'Tài khoản đang dùng'
                            : pendingDeleteId === employee.id
                              ? 'Xác nhận xóa'
                              : 'Xóa tài khoản'}
                      </button>
                    </div>
                  </article>})}
                  {!filteredEmployees.length && <p className="empty-copy">Chưa có dữ liệu nhân sự phù hợp bộ lọc.</p>}
                </div>
              )}
            </section>
          )}

        </div>
      </div>
    </div>
  )
}

function buildPayrollRows(
  employees: EmployeeProfile[],
  attendanceRows: ReturnType<typeof buildAttendanceReport>,
  commissionRows: ReturnType<typeof buildCommissionRows>,
  drafts: Record<string, PayrollDraft>,
) {
  return employees.map((employee) => {
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
    const hourlyRate = parseMoney(draft.hourlyRate)
    const fixedSalary = parseMoney(draft.fixedSalary)
    const bonus = parseMoney(draft.bonus)
    const deduction = parseMoney(draft.deduction)
    const totalHours = attendance?.totalHours || 0
    const basePay = fixedSalary > 0 ? fixedSalary : Math.round(totalHours * hourlyRate)
    const commissionPay = commission?.commission || 0
    return {
      employeeKey,
      employeeName: employee.name,
      branchId: employee.branchId || '',
      positionTitle: employee.positionTitle || roleLabel(employee.role),
      totalShifts: attendance?.totalShifts || 0,
      totalHours,
      workDays: attendance?.workDays || 0,
      hourlyRate,
      fixedSalary,
      basePay,
      commission: commissionPay,
      bonus,
      deduction,
      grossPay: basePay + commissionPay + bonus - deduction,
      note: draft.note,
      draft,
    }
  }).sort((a, b) => branchName(a.branchId).localeCompare(branchName(b.branchId), 'vi') || a.employeeName.localeCompare(b.employeeName, 'vi'))
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
      { label: 'Tổng lương', value: formatMoney(values.payroll) },
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
      { label: 'Túi bán', value: formatNumber(values.sold) },
      { label: 'Doanh thu', value: formatMoney(values.revenue) },
    ]
  }
  return [
    { label: 'Doanh thu', value: formatMoney(values.revenue) },
    { label: 'Túi bán', value: formatNumber(values.sold) },
    { label: 'Chi nhánh', value: formatNumber(values.branches) },
  ]
}

function buildInventoryRows(movements: StockMovement[], branchIds: string[], from: string, to: string) {
  return branchIds.flatMap((branchId) => {
    const branchMovements = movements.filter((item) => item.branchId === branchId)
    const openingStock = new Map(calculateStock(branchMovements.filter((item) => item.shiftDate < from)).map((line) => [line.product.id, line.expected]))
    const closingStock = new Map(calculateStock(branchMovements.filter((item) => item.shiftDate <= to)).map((line) => [line.product.id, line.expected]))
    const period = branchMovements.filter((item) => item.shiftDate >= from && item.shiftDate <= to)
    return PRODUCTS.map((product) => {
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
    const product = PRODUCTS.find((item) => item.id === movement.productId)
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

function buildCommissionRows(
  allocations: BagAllocation[],
  employees: EmployeeProfile[],
  attendanceRows: ReturnType<typeof buildAttendanceReport>,
) {
  const allocationsByDate = new Map<string, BagAllocation[]>()
  allocations.forEach((allocation) => {
    const date = (allocation.settledAt || allocation.issuedAt).slice(0, 10)
    allocationsByDate.set(date, [...(allocationsByDate.get(date) || []), allocation])
  })
  const rows = new Map<string, ReturnType<typeof summarizeEmployeeBagSales>[number] & {
    achievedDays: number
    maxDailySold: number
  }>()
  allocationsByDate.forEach((dayAllocations) => {
    summarizeEmployeeBagSales(dayAllocations).forEach((dayRow) => {
      const key = `${dayRow.branchId}|${dayRow.employeeKey}`
      const current = rows.get(key) || {
        ...dayRow,
        soldQuantity: 0,
        revenue: 0,
        commissionBase: 0,
        commission: 0,
        achieved: false,
        achievedDays: 0,
        maxDailySold: 0,
      }
      current.soldQuantity += dayRow.soldQuantity
      current.revenue += dayRow.revenue
      current.commissionBase += dayRow.commissionBase
      current.commission += dayRow.commission
      current.achieved = current.achieved || dayRow.achieved
      current.achievedDays += dayRow.achieved ? 1 : 0
      current.maxDailySold = Math.max(current.maxDailySold, dayRow.soldQuantity)
      rows.set(key, current)
    })
  })
  return Array.from(rows.values()).map((row) => {
    const employee = row.employeeId
      ? employees.find((item) => item.id === row.employeeId)
      : employees.find((item) => normalizeName(item.name) === normalizeName(row.employeeName))
    const employeeKey = employee?.id || row.employeeKey
    const attendance = attendanceRows.find((item) =>
      item.branchId === row.branchId
      && (item.userId === employeeKey || normalizeName(item.employeeName) === normalizeName(row.employeeName)),
    )
    return {
      ...row,
      employeeKey,
      employeeName: employee?.name || row.employeeName,
      totalHours: attendance?.totalHours || 0,
      targetQuantity: COMMISSION_MIN_BAGS,
      progress: Math.min(100, row.maxDailySold / COMMISSION_MIN_BAGS * 100),
    }
  }).sort((a, b) => b.commission - a.commission || b.soldQuantity - a.soldQuantity)
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
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
    { header: 'Chi nhánh', key: 'branch', width: 24 },
    { header: 'Ca dự kiến', key: 'scheduled', width: 17 },
    { header: 'Giờ vào', key: 'checkIn', width: 20 },
    { header: 'Giờ ra', key: 'checkOut', width: 20 },
    { header: 'Giờ thực tế', key: 'totalHours', width: 13 },
    { header: 'Ngày công', key: 'workDayCredit', width: 12 },
    { header: 'Đi trễ (phút)', key: 'lateMinutes', width: 14 },
    { header: 'Trạng thái', key: 'status', width: 16 },
    { header: 'Địa chỉ check-in', key: 'address', width: 50 },
    { header: 'Tọa độ', key: 'coordinates', width: 24 },
    { header: 'Minh chứng selfie', key: 'selfieUrl', width: 18 },
    { header: 'Ghi chú', key: 'note', width: 30 },
  ]
}

async function addAttendanceDetailRow(sheet: import('exceljs').Worksheet, row: ReturnType<typeof buildAttendanceDetailRows>[number]) {
  const evidenceUrl = await selfieEvidenceUrl(row.selfieUrl)
  sheet.addRow({
    workDate: formatDate(row.workDate),
    employeeName: row.employeeName,
    branch: branchName(row.branchId),
    scheduled: `${row.scheduledStart}-${row.scheduledEnd}`,
    checkIn: row.checkInTime ? formatDateTime(row.checkInTime) : '',
    checkOut: row.checkOutTime ? formatDateTime(row.checkOutTime) : '',
    totalHours: row.totalHours,
    workDayCredit: row.workDayCredit,
    lateMinutes: row.lateMinutes,
    status: attendanceDetailStatus(row.status),
    address: row.checkInAddress || '',
    coordinates: row.checkInLatitude === undefined ? '' : `${row.checkInLatitude}, ${row.checkInLongitude}`,
    selfieUrl: evidenceUrl ? { text: 'Xem ảnh', hyperlink: evidenceUrl } : '',
    note: row.note,
  })
}

async function selfieEvidenceUrl(value?: string) {
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  if (value.startsWith('/')) return `${window.location.origin}${value}`
  if (!supabase) return value
  const signed = await supabase.storage.from('attendance-selfies').createSignedUrl(value, 60 * 60 * 24 * 30)
  return signed.data?.signedUrl || supabase.storage.from('attendance-selfies').getPublicUrl(value).data.publicUrl || value
}

function safeSheetName(value: string) {
  return value.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Chi nhánh'
}

async function saveWorkbook(workbook: import('exceljs').Workbook, name: string) {
  const buffer = await workbook.xlsx.writeBuffer()
  download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name)
}

function download(blob: Blob, name: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
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
  return BRANCHES.find((branch) => branch.id === id)?.name || id
}

function formatNumber(value: number) {
  return Number(value.toFixed(2)).toLocaleString('vi-VN')
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN')
}
function formatDateTime(date: string) {
  return new Date(date).toLocaleString('vi-VN', { hour12: false })
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
