import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { buildOperationalReportPatch, mergeBagSalesIntoReportState } from '../lib/reportSync'
import { DEFAULT_REVENUE_TARGET, dailyKpiBonus, employeeKpiKey, employeePeriodRevenueTarget, employeeRevenueTarget, fetchEmployeeKpiTargets, kpiRank, productSaleValues, summarizeEmployeeBagSales } from '../lib/commission'
import { PRODUCTS, productById as catalogProductById } from '../lib/constants'
import { branchName as configuredBranchName } from '../lib/branches'
import { calculateStock, ensureOperationDay, fetchReportSnapshots, finalizeDailyReport, getOperationDay, saveShiftReportSnapshot } from '../lib/store'
import { fetchAttendanceRecords, fetchShiftRegistrations, findAttendanceRecordForRegistration } from '../lib/attendance'
import { fetchBagAllocations, fetchBagShiftSessions } from '../lib/shiftLedger'
import { fetchSalesReceipts, type SalesReceipt } from '../lib/salesReceipts'
import { supabase, uniqueChannelName } from '../lib/supabase'
import { localDateKey } from '../lib/dates'
import { canvasToBlob, shareOrDownloadBlob } from '../lib/browser'
import { createZaloReportIntent } from '../lib/reportDeliveryIntent'
import { queueN8nReportImages, type N8nQueueResult, type N8nReportKind } from '../lib/n8nReports'
import type { InventoryTab, Page } from '../components/AppShell'
import type { AppUser, AttendanceRecord, BagAllocation, BagShiftSession, ReportSnapshot, ShiftRegistration, StockMovement } from '../types'

interface Props {
  user: AppUser
  movements: StockMovement[]
  onNavigate: (page: Page) => void
  onOpenInventory: (tab: InventoryTab) => void
  onRefresh: () => Promise<void>
}

type ReportScope = 'day' | 'shift-1' | 'shift-2'

interface ProductQuantityRow {
  productId: string
  name: string
  unit: string
  quantity: number
  documents: number
  notes: string[]
}

interface BatchReportRow {
  id: string
  phase: string
  inputLabel: string
  outputLabel: string
  raw: number
  cooked: number
  loss: number
  lossRate: number
  packedLabel: string
  note: string
  createdAt: string
}

interface ProductReportRow {
  productId: string
  name: string
  unit: string
  issued: number
  sold: number
  returned: number
  damaged: number
  remaining: number
  outstanding: number
  revenue: number
  weightKg: number
}

interface EmployeeProductRow {
  productId: string
  name: string
  issued: number
  sold: number
  returned: number
  damaged: number
}

interface EmployeeReportRow {
  key: string
  name: string
  issued: number
  sold: number
  returned: number
  damaged: number
  outstanding: number
  revenue: number
  commission: number
  achievedCommission: boolean
  kpi: number
  rank: string
  targetRevenue: number
  workHours: number
  checkedIn: boolean
  checkedOut: boolean
  products: EmployeeProductRow[]
}

interface ShiftReportRow {
  id: string
  sequence: number
  leaderName: string
  status: BagShiftSession['status']
  startedAt: string
  endedAt?: string
  employeeCount: number
  issued: number
  sold: number
  returned: number
  damaged: number
  revenue: number
  discrepancyNote: string
  openingPhotoUrl: string
  closingPhotoUrl: string
}

interface WasteReportRow {
  id: string
  productName: string
  unit: string
  quantity: number
  note: string
  sourceName: string
}

interface StockReportRow {
  productId: string
  name: string
  sku: string
  unit: string
  category: string
  expected: number
  actual?: number
  variance?: number
}

interface ProofImage {
  key: string
  label: string
  url: string
}

interface DailyReportModel {
  branchName: string
  businessDate: string
  dateLabel: string
  leaderNames: string[]
  morningLeaderName: string
  eveningLeaderName: string
  closedShiftCount: number
  openShiftCount: number
  outstandingCount: number
  blockingIssues: string[]
  warnings: string[]
  grade: string
  legacyState: Record<string, unknown>
  summary: {
    revenue: number
    totalIn: number
    totalSold: number
    salesRate: number
    kpi: number
    kitchenLoss: number
    grade: string
    shiftTime: string
    leader: string
  }
  totals: {
    inboundDocuments: number
    processingBatches: number
    packingDocuments: number
    issued: number
    sold: number
    returned: number
    damaged: number
    revenue: number
    commission: number
    salesRate: number
    teamKpi: number
    averageEmployeeKpi: number
    processingRawKg: number
    processingCookedKg: number
    processingLossKg: number
    processingLossRate: number
  }
  shifts: ShiftReportRow[]
  inboundRows: ProductQuantityRow[]
  batchRows: BatchReportRow[]
  packingRows: ProductQuantityRow[]
  productRows: ProductReportRow[]
  employeeRows: EmployeeReportRow[]
  wasteRows: WasteReportRow[]
  stockRows: StockReportRow[]
  bagShiftSummary: ReturnType<typeof buildBagShiftSummary>
  proofImages: ProofImage[]
}

interface ReportLedgerData {
  sessions: BagShiftSession[]
  allocations: BagAllocation[]
  registrations: ShiftRegistration[]
  records: AttendanceRecord[]
  receipts: SalesReceipt[]
  snapshots: ReportSnapshot[]
}

export function ReportPage({ user, movements, onNavigate, onRefresh }: Props) {
  const infographicRef = useRef<HTMLDivElement>(null)
  const n8nDayPosterRef = useRef<HTMLDivElement>(null)
  const n8nShiftOnePosterRef = useRef<HTMLDivElement>(null)
  const n8nShiftTwoPosterRef = useRef<HTMLDivElement>(null)
  const n8nPosterRefs: Record<ReportScope, RefObject<HTMLDivElement | null>> = {
    day: n8nDayPosterRef,
    'shift-1': n8nShiftOnePosterRef,
    'shift-2': n8nShiftTwoPosterRef,
  }
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [finalized, setFinalized] = useState(false)
  const [bagSessions, setBagSessions] = useState<BagShiftSession[]>([])
  const [bagAllocations, setBagAllocations] = useState<BagAllocation[]>([])
  const [shiftRegistrations, setShiftRegistrations] = useState<ShiftRegistration[]>([])
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([])
  const [salesReceipts, setSalesReceipts] = useState<SalesReceipt[]>([])
  const [employeeKpiTargets, setEmployeeKpiTargets] = useState<Record<string, number>>({})
  const [reportScope, setReportScope] = useState<ReportScope>('day')
  const [reportSnapshot, setReportSnapshot] = useState<ReportSnapshot | null>(null)
  const handoverIntentRef = useRef(readHandoverReportIntent())
  const autoFinalizeAttemptRef = useRef('')
  const [handoverComplete, setHandoverComplete] = useState(false)
  const businessDate = localDateKey()

  async function loadReportLedger(): Promise<ReportLedgerData> {
    const [sessions, allocations, registrations, records, receipts, snapshots] = await Promise.all([
      fetchBagShiftSessions(user, { branchId: user.branchId, date: businessDate }),
      fetchBagAllocations(user, { branchId: user.branchId, date: businessDate }),
      fetchShiftRegistrations(user, { branchId: user.branchId, from: businessDate, to: businessDate }),
      fetchAttendanceRecords(user, { branchId: user.branchId, from: businessDate, to: businessDate }),
      fetchSalesReceipts(user, { branchId: user.branchId, date: businessDate }),
      fetchReportSnapshots(user.branchId, user),
    ])
    return { sessions, allocations, registrations, records, receipts, snapshots }
  }

  function applyReportLedger(ledger: ReportLedgerData) {
    setBagSessions(ledger.sessions)
    setBagAllocations(ledger.allocations)
    setShiftRegistrations(ledger.registrations)
    setAttendanceRecords(ledger.records)
    setSalesReceipts(ledger.receipts)
    setReportSnapshot(ledger.snapshots.find((item) => item.reportDate === businessDate) || null)
  }

  async function refreshLedger() {
    const ledger = await loadReportLedger()
    applyReportLedger(ledger)
    return ledger
  }

  async function refreshFinalizationState() {
    const day = await getOperationDay(user.branchId, businessDate, user)
    setFinalized(day?.status === 'closed')
  }

  useEffect(() => {
    void refreshLedger().catch((error) => {
      setMessage(error instanceof Error ? error.message : 'Không thể tải dữ liệu báo cáo hôm nay.')
    })
  }, [businessDate, user.id, user.branchId])

  useEffect(() => {
    let active = true
    void fetchEmployeeKpiTargets(user, [user.branchId]).then((targets) => {
      if (!active) return
      setEmployeeKpiTargets(Object.fromEntries(targets.map((target) => [
        employeeKpiKey(target.branchId, target.employeeKey),
        target.targetRevenue,
      ])))
    }).catch(() => undefined)
    return () => { active = false }
  }, [user.id, user.branchId])

  useEffect(() => {
    let ignore = false
    void getOperationDay(user.branchId, businessDate, user).then((day) => {
      if (!ignore) setFinalized(day?.status === 'closed')
    }).catch(() => {})
    return () => {
      ignore = true
    }
  }, [businessDate, user.branchId])

  useEffect(() => {
    const client = user.authToken ? null : supabase
    if (!client) {
      const timer = window.setInterval(() => {
        void Promise.all([
          refreshLedger(),
          refreshFinalizationState(),
        ]).catch(() => null)
      }, 5000)
      return () => window.clearInterval(timer)
    }
    const channel = client.channel(uniqueChannelName(`report-ledger:${user.branchId}:${businessDate}`))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bag_shift_sessions',
        filter: `branch_id=eq.${user.branchId}`,
      }, () => void refreshLedger().catch(() => null))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bag_allocations',
        filter: `branch_id=eq.${user.branchId}`,
      }, () => void refreshLedger().catch(() => null))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'sales_receipts',
        filter: `branch_id=eq.${user.branchId}`,
      }, () => void refreshLedger().catch(() => null))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'attendance_records',
        filter: `branch_id=eq.${user.branchId}`,
      }, () => void refreshLedger().catch(() => null))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'report_snapshots',
        filter: `branch_id=eq.${user.branchId}`,
      }, () => void refreshLedger().catch(() => null))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'operation_days',
        filter: `branch_id=eq.${user.branchId}`,
      }, () => void refreshFinalizationState().catch(() => null))
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [businessDate, user.branchId, user.id])

  const dailyReport = useMemo(
    () => buildDailyReport(user, movements, bagSessions, bagAllocations, shiftRegistrations, attendanceRecords, salesReceipts, businessDate, employeeKpiTargets),
    [user, movements, bagSessions, bagAllocations, shiftRegistrations, attendanceRecords, salesReceipts, businessDate, employeeKpiTargets],
  )
  const leaderShiftSession = useMemo(() => {
    const own = bagSessions.filter((item) => item.leaderId === user.id || normalizeName(item.leaderName) === normalizeName(user.name))
    return [...own].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'closed' ? -1 : 1
      return b.sequence - a.sequence || b.startedAt.localeCompare(a.startedAt)
    })[0]
  }, [bagSessions, user.id, user.name])

  useEffect(() => {
    if (!leaderShiftSession) return
    setReportScope(defaultReportScopeForLeader(leaderShiftSession))
  }, [leaderShiftSession?.id, leaderShiftSession?.sequence])

  const selectedShift = reportScope === 'day'
    ? undefined
    : bagSessions.find((item) => item.sequence === (reportScope === 'shift-1' ? 1 : 2))
  const hasShiftOne = bagSessions.some((item) => item.sequence === 1)
  const hasShiftTwo = bagSessions.some((item) => item.sequence === 2)
  const report = useMemo(() => {
    if (reportScope === 'day' || !selectedShift) return dailyReport
    const scopedMovements = movements.filter((item) => isTimestampInShift(item.createdAt, selectedShift))
    const scopedAllocations = bagAllocations.filter((item) => item.shiftId === selectedShift.id)
    const scopedReceipts = salesReceipts.filter((item) => isTimestampInShift(item.createdAt, selectedShift))
    return buildDailyReport(
      user,
      scopedMovements,
      [selectedShift],
      scopedAllocations,
      shiftRegistrations,
      attendanceRecords,
      scopedReceipts,
      businessDate,
      employeeKpiTargets,
    )
  }, [reportScope, selectedShift, dailyReport, user, movements, bagAllocations, shiftRegistrations, attendanceRecords, salesReceipts, businessDate, employeeKpiTargets])
  function reportModelForScope(scope: ReportScope) {
    if (scope === 'day') return dailyReport
    const session = bagSessions.find((item) => item.sequence === (scope === 'shift-1' ? 1 : 2))
    if (!session) return dailyReport
    return buildDailyReport(
      user,
      movements.filter((item) => isTimestampInShift(item.createdAt, session)),
      [session],
      bagAllocations.filter((item) => item.shiftId === session.id),
      shiftRegistrations,
      attendanceRecords,
      salesReceipts.filter((item) => isTimestampInShift(item.createdAt, session)),
      businessDate,
      employeeKpiTargets,
    )
  }
  const reportScopeLabel = reportScope === 'day' ? 'Tổng ngày' : reportScope === 'shift-1' ? 'Ca 1' : 'Ca 2'
  const shiftReportEntry = leaderShiftSession ? reportSnapshot?.payload.shiftReports?.[leaderShiftSession.id] : undefined
  const isSecondShiftFinalization = leaderShiftSession?.sequence === 2
  const canResumeSecondShiftFinalization = Boolean(isSecondShiftFinalization && shiftReportEntry && !finalized)
  const finalizeBlockedReason = finalized
    ? 'Ca 2 và Tổng ngày đã được chốt.'
    : !leaderShiftSession
      ? 'Không tìm thấy ca do bạn phụ trách trong ngày hôm nay.'
      : leaderShiftSession.status !== 'closed'
        ? `Ca ${leaderShiftSession.sequence} chưa bàn giao xong. Hãy chụp ảnh cuối ca và chốt Bàn giao trước.`
        : shiftReportEntry && !canResumeSecondShiftFinalization
          ? `Báo cáo Ca ${leaderShiftSession.sequence} đã được chốt trước đó.`
          : isSecondShiftFinalization && dailyReport.openShiftCount > 0
            ? 'Ca 2 chỉ được chốt khi không còn ca nào đang mở, vì nút này đồng thời chốt Tổng ngày.'
            : ''
  const canFinalize = !finalizeBlockedReason
  const finalizeActionLabel = leaderShiftSession?.sequence === 1
    ? 'Chốt báo cáo Ca 1 & bàn giao Ca 2'
    : leaderShiftSession?.sequence === 2
      ? 'Chốt báo cáo Ca 2 & kết thúc ngày'
      : 'Chốt báo cáo'
  const automaticPosterScopes: ReportScope[] = leaderShiftSession?.sequence === 1
    ? ['shift-1']
    : leaderShiftSession?.sequence === 2
      ? ['shift-2', 'day']
      : []
  const visibleMessage = friendlyReportMessage(message)
  const messageTone = reportMessageTone(message)

  async function queueCurrentReportImages(session: BagShiftSession, sendNow = false): Promise<N8nQueueResult> {
    const reportKinds: N8nReportKind[] = session.sequence === 1 ? ['shift-1'] : ['shift-2', 'day']
    const reports = []
    for (const kind of reportKinds) {
      const target = n8nPosterRefs[kind].current
      if (!target) throw new Error(`Infographic ${reportKindLabel(kind)} chưa render xong.`)
      const blob = await captureReportPosterBlob(target, { scale: 1.35, quality: .88, maxBytes: 2_200_000 })
      reports.push({
        kind,
        label: reportKindLabel(kind),
        fileName: `GUSTINO-bao-cao-${kind}-${businessDate}.jpg`,
        mimeType: 'image/jpeg' as const,
        imageBase64: await blobToBase64(blob),
      })
    }
    return queueN8nReportImages(user, {
      branchId: user.branchId,
      branchName: dailyReport.branchName,
      businessDate,
      shiftId: session.id,
      shiftSequence: session.sequence as 1 | 2,
      sendNow,
      reports,
    })
  }

  async function sendReportToZalo() {
    if (!leaderShiftSession || !shiftReportEntry) return
    const confirmed = window.confirm('Gửi ngay ảnh báo cáo lên Zalo? Thao tác này có thể gửi trùng nếu báo cáo đã được gửi trước đó.')
    if (!confirmed) return
    setBusy(true)
    try {
      const result = await queueCurrentReportImages(leaderShiftSession, true)
      await saveShiftReportSnapshot(user, businessDate, {
        shiftId: shiftReportEntry.shiftId,
        sequence: shiftReportEntry.sequence,
        scope: shiftReportEntry.scope,
        leaderId: shiftReportEntry.leaderId,
        leaderName: shiftReportEntry.leaderName,
        report: shiftReportEntry.report,
        zaloDelivery: shiftReportEntry.zaloDelivery,
        n8nDelivery: { ...result, updatedAt: new Date().toISOString() },
      })
      await refreshLedger()
      setMessage(result.message)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa gửi được báo cáo lên Zalo.')
    } finally {
      setBusy(false)
    }
  }

  async function saveCloud(fromHandover = false) {
    if (finalized && !fromHandover) {
      setMessage('Ngày đã kết thúc. Chúc cả đội ngủ ngon.')
      return
    }
    setBusy(true)
    try {
      const freshLedger = await loadReportLedger()
      applyReportLedger(freshLedger)
      const freshSnapshot = freshLedger.snapshots.find((item) => item.reportDate === businessDate) || null
      const freshLeaderShiftSession = [...freshLedger.sessions]
        .filter((item) => item.leaderId === user.id || normalizeName(item.leaderName) === normalizeName(user.name))
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === 'closed' ? -1 : 1
          return b.sequence - a.sequence || b.startedAt.localeCompare(a.startedAt)
        })[0]
      if (!freshLeaderShiftSession) {
        throw new Error('Không tìm thấy ca do bạn phụ trách trong ngày hôm nay.')
      }
      if (freshLeaderShiftSession.status !== 'closed') {
        throw new Error(`Ca ${freshLeaderShiftSession.sequence} chưa bàn giao xong. Hãy chụp ảnh cuối ca và chốt Bàn giao trước.`)
      }

      const freshDailyReport = buildDailyReport(
        user,
        movements,
        freshLedger.sessions,
        freshLedger.allocations,
        freshLedger.registrations,
        freshLedger.records,
        freshLedger.receipts,
        businessDate,
        employeeKpiTargets,
      )
      const freshShiftReportEntry = freshSnapshot?.payload.shiftReports?.[freshLeaderShiftSession.id]
      const freshIsSecondShiftFinalization = freshLeaderShiftSession.sequence === 2
      const freshCanResumeSecondShiftFinalization = Boolean(
        freshIsSecondShiftFinalization && freshShiftReportEntry && !finalized,
      )
      if (fromHandover && freshShiftReportEntry && (freshIsSecondShiftFinalization ? finalized : true)) {
        await waitForReportPosters()
        const delivery = await queueCurrentReportImages(freshLeaderShiftSession, true)
        await saveShiftReportSnapshot(user, businessDate, {
          ...freshShiftReportEntry,
          n8nDelivery: { ...delivery, updatedAt: new Date().toISOString() },
        })
        await refreshLedger()
        window.sessionStorage.removeItem('gustino:handover-report')
        setHandoverComplete(true)
        setMessage(freshIsSecondShiftFinalization
          ? 'Đã chốt Ca 2 và Tổng ngày. Hai hình báo cáo đã được gửi tự động vào nhóm Zalo.'
          : 'Đã chốt Ca 1. Hình báo cáo ca đã được gửi tự động vào nhóm Zalo.')
        return
      }
      if (freshShiftReportEntry && !freshCanResumeSecondShiftFinalization) {
        throw new Error(`Báo cáo Ca ${freshLeaderShiftSession.sequence} đã được chốt trước đó.`)
      }
      if (freshIsSecondShiftFinalization && freshDailyReport.openShiftCount > 0) {
        throw new Error('Ca 2 chỉ được chốt khi không còn ca nào đang mở, vì nút này đồng thời chốt Tổng ngày.')
      }

      const shiftScope: ReportScope = freshLeaderShiftSession.sequence === 1 ? 'shift-1' : 'shift-2'
      const shiftReport = buildDailyReport(
        user,
        movements.filter((item) => isTimestampInShift(item.createdAt, freshLeaderShiftSession)),
        [freshLeaderShiftSession],
        freshLedger.allocations.filter((item) => item.shiftId === freshLeaderShiftSession.id),
        freshLedger.registrations,
        freshLedger.records,
        freshLedger.receipts.filter((item) => isTimestampInShift(item.createdAt, freshLeaderShiftSession)),
        businessDate,
        employeeKpiTargets,
      )
      const zaloIntent = createZaloReportIntent({
        branchId: user.branchId,
        businessDate,
        shiftId: freshLeaderShiftSession.id,
        shiftSequence: freshLeaderShiftSession.sequence as 1 | 2,
        requestedBy: user.id,
        requestedByName: user.name,
      })
      const shiftEntry = {
        shiftId: freshLeaderShiftSession.id,
        sequence: freshLeaderShiftSession.sequence,
        scope: shiftScope,
        leaderId: user.id,
        leaderName: user.name,
        report: shiftReport as unknown as Record<string, unknown>,
        zaloIntent: zaloIntent as unknown as Record<string, unknown>,
      }
      if (freshIsSecondShiftFinalization) {
        const previousShiftReports = freshSnapshot?.payload.shiftReports || {}
        const nextShiftReports = {
          ...previousShiftReports,
          [freshLeaderShiftSession.id]: {
            ...previousShiftReports[freshLeaderShiftSession.id],
            ...shiftEntry,
            finalizedAt: new Date().toISOString(),
          },
        }
        await finalizeDailyReport(user, businessDate, {
          reportDate: businessDate,
          state: freshDailyReport.legacyState,
          openingImage: freshDailyReport.proofImages.find((item) => item.label.includes('Đầu'))?.url || '',
          closingImage: [...freshDailyReport.proofImages].reverse().find((item) => item.label.includes('Cuối'))?.url || '',
          bagShiftSummary: freshDailyReport.bagShiftSummary,
          dailyReport: freshDailyReport,
          summary: freshDailyReport.summary,
          shiftReports: nextShiftReports,
        })
        setFinalized(true)
      } else {
        await saveShiftReportSnapshot(user, businessDate, shiftEntry)
      }
      await refreshLedger()
      if (fromHandover) {
        await waitForReportPosters()
        const delivery = await queueCurrentReportImages(freshLeaderShiftSession, true)
        await saveShiftReportSnapshot(user, businessDate, {
          ...shiftEntry,
          n8nDelivery: { ...delivery, updatedAt: new Date().toISOString() },
        })
        await refreshLedger()
        window.sessionStorage.removeItem('gustino:handover-report')
        setHandoverComplete(true)
        setMessage(freshIsSecondShiftFinalization
          ? 'Đã chốt Ca 2 và Tổng ngày. Hai hình báo cáo đã được gửi tự động vào nhóm Zalo.'
          : 'Đã chốt Ca 1. Hình báo cáo ca đã được gửi tự động vào nhóm Zalo.')
      } else {
        setMessage(freshIsSecondShiftFinalization
          ? 'Đã chốt Ca 2 và kết thúc ngày.'
          : 'Đã đóng Ca 1, chốt báo cáo và bàn giao cho Ca 2.')
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      setMessage(detail ? `Không thể lưu báo cáo: ${detail}` : 'Không thể lưu báo cáo.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const intent = handoverIntentRef.current
    if (!intent || intent.businessDate !== businessDate || !leaderShiftSession) return
    if (intent.shiftId !== leaderShiftSession.id || leaderShiftSession.status !== 'closed') return
    if (autoFinalizeAttemptRef.current === intent.shiftId) return
    autoFinalizeAttemptRef.current = intent.shiftId
    setMessage('Đang tạo và gửi hình báo cáo tự động…')
    void saveCloud(true)
  }, [businessDate, leaderShiftSession?.id, leaderShiftSession?.status])

  async function reopenDay() {
    if (!window.confirm('Mở lại ngày vận hành để bổ sung/sửa số liệu? Sau khi xong nhớ bấm Chốt báo cáo lại.')) return
    setBusy(true)
    try {
      await ensureOperationDay(user, businessDate, { allowAutoOpen: true, reopenClosed: true })
      setFinalized(false)
      setMessage('Đã mở lại ngày vận hành. Bổ sung số liệu xong hãy chốt báo cáo lại.')
      await Promise.all([onRefresh(), refreshLedger()])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể mở lại ngày vận hành.')
    } finally {
      setBusy(false)
    }
  }

  async function exportInfographicImage() {
    const target = infographicRef.current
    if (!target) {
      setMessage('Infographic chưa sẵn sàng để tải. Hãy thử lại sau khi báo cáo render xong.')
      return
    }
    setBusy(true)
    try {
      const fileName = `GUSTINO-bao-cao-${reportScope}-${businessDate}.jpg`
      const blob = await captureReportPosterBlob(target, { scale: 2, quality: .95 })
      const result = await shareOrDownloadBlob(blob, fileName, {
        title: `Báo cáo GUSTINO ${businessDate}`,
        text: 'Chọn “Lưu hình ảnh” để ảnh vào Photos hoặc “Lưu vào Tệp” trên iPhone.',
      })
      setMessage(result === 'shared'
        ? 'Đã mở chia sẻ ảnh.'
        : 'Đã tải ảnh JPG.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải infographic.')
    } finally {
      setBusy(false)
    }
  }

  async function shareInfographicToZalo() {
    const target = infographicRef.current
    if (!target) {
      setMessage('Infographic chưa sẵn sàng để chia sẻ. Hãy thử lại sau khi báo cáo render xong.')
      return
    }
    setBusy(true)
    try {
      const fileName = `GUSTINO-bao-cao-${reportScope}-${businessDate}.jpg`
      const blob = await captureReportPosterBlob(target, { scale: 1.7, quality: .92 })
      const result = await shareOrDownloadBlob(blob, fileName, {
        title: `Báo cáo GUSTINO ${reportScopeLabel} ${businessDate}`,
        text: `Báo cáo ${reportScopeLabel} · ${dailyReport.branchName} · ${businessDate}`,
      })
      setMessage(result === 'shared'
        ? 'Đã mở bảng chia sẻ. Hãy chọn Zalo và nhóm cần gửi.'
        : 'Thiết bị chưa hỗ trợ chia sẻ file trực tiếp; ảnh đã được tải xuống để bạn gửi qua Zalo.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể chia sẻ infographic qua Zalo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="report-page">
      <div className="report-toolbar">
        <div className="report-toolbar-summary">
          <strong>{handoverComplete ? 'Bàn giao hoàn tất' : finalized ? 'Đã chốt Ca 2 và Tổng ngày' : `Báo cáo ${reportScopeLabel.toLowerCase()}`}</strong>
        </div>
        <div className="report-toolbar-controls">
          <label className="report-scope-select">
            <span>Xem dữ liệu</span>
            <select
              value={reportScope}
              onChange={(event) => setReportScope(event.target.value as ReportScope)}
              disabled={busy}
              aria-label="Chọn phạm vi báo cáo"
            >
              <option value="shift-1" disabled={!hasShiftOne}>Ca 1</option>
              <option value="shift-2" disabled={!hasShiftTwo}>Ca 2</option>
              <option value="day">Tổng cả ngày</option>
            </select>
          </label>

          <div className="report-essential-actions">
            <button className="secondary-button" onClick={() => void exportInfographicImage()} disabled={busy}>Tải ảnh</button>
            {handoverComplete
              ? <button className="primary-button" onClick={() => onNavigate('today')}>Về màn hình chính</button>
              : finalized
              ? <button className="secondary-button report-reopen-button" onClick={() => void reopenDay()} disabled={busy}>Mở lại ngày</button>
              : shiftReportEntry && !canResumeSecondShiftFinalization
                ? <span className="report-finalized-status">✓ Đã chốt Ca {leaderShiftSession?.sequence}</span>
                : <button
                    className="primary-button"
                    onClick={() => void saveCloud()}
                    disabled={busy}
                    title={canFinalize ? undefined : finalizeBlockedReason}
                  >
                    {busy ? 'Đang chốt…' : finalizeActionLabel}
                  </button>}
          </div>

          {visibleMessage && (
            <p className={`report-feedback ${messageTone}`} title={visibleMessage === message ? undefined : message}>
              {visibleMessage}
            </p>
          )}
        </div>
      </div>

      <div className="rp-stage">
        <ReportPoster report={report} scopeLabel={reportScopeLabel} posterRef={infographicRef} />
      </div>
      <div className="rp-n8n-poster-stage" aria-hidden="true">
        {automaticPosterScopes.map((scope) => (
          <ReportPoster
            key={`n8n-${scope}`}
            report={reportModelForScope(scope)}
            scopeLabel={reportPosterScopeLabel(scope)}
            posterRef={n8nPosterRefs[scope]}
          />
        ))}
      </div>
    </div>
  )
}

interface HandoverReportIntent {
  shiftId: string
  sequence: number
  businessDate: string
}

function readHandoverReportIntent(): HandoverReportIntent | null {
  try {
    const value = window.sessionStorage.getItem('gustino:handover-report')
    if (!value) return null
    const parsed = JSON.parse(value) as Partial<HandoverReportIntent>
    if (!parsed.shiftId || !parsed.businessDate || !Number.isFinite(parsed.sequence)) return null
    return parsed as HandoverReportIntent
  } catch {
    return null
  }
}

async function waitForReportPosters() {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())))
}

function ReportPoster({
  report,
  scopeLabel,
  posterRef,
}: {
  report: DailyReportModel
  scopeLabel: string
  posterRef: RefObject<HTMLDivElement | null>
}) {
  const racers = [...report.employeeRows].sort((a, b) => b.revenue - a.revenue || b.sold - a.sold)
  const maxRevenue = Math.max(1, ...racers.map((item) => item.revenue))
  const products = [...report.productRows].sort((a, b) => b.sold - a.sold || b.issued - a.issued)
  const maxIssued = Math.max(1, ...products.map((item) => item.issued))
  const tone = gradeTone(report.grade)
  const remainingTotal = report.productRows.reduce((sum, item) => sum + item.remaining, 0)
  // Nhiều nhân viên → xổ bảng thi đua thành nhiều cột để poster giãn ngang thay vì dài dằng dặc.
  const density = racers.length > 10 ? 'rp-dense rp-dense-3' : racers.length > 5 ? 'rp-dense' : ''

  return (
    <div className={`rp-poster${density ? ` ${density}` : ''}`} ref={posterRef}>
      <header className={`rp-head rp-tone-${tone}`}>
        <div className="rp-brand">
          <span>🌰 HẠT DẺ ÔNG LÝ</span>
          <h1>{report.branchName}</h1>
          <p>Báo cáo {scopeLabel} · Ngày {report.dateLabel}</p>
          <div className="rp-leaders">
            <em>Ca sáng: <b>{report.morningLeaderName || '—'}</b></em>
            <em>Ca tối: <b>{report.eveningLeaderName || '—'}</b></em>
          </div>
        </div>
        <div className="rp-grade">
          <small>Xếp loại</small>
          <strong>{report.grade}</strong>
          <span>Hiệu suất doanh thu {report.totals.teamKpi}%</span>
        </div>
      </header>

      <section className="rp-revenue">
        <span>TỔNG DOANH THU</span>
        <strong>{formatMoney(report.totals.revenue)}</strong>
        <div className="rp-revenue-sub">
          <div><b>{formatNumber(report.totals.sold)}</b><i>sản phẩm đã bán</i></div>
          <div><b>{report.totals.salesRate}%</b><i>hiệu suất</i></div>
          <div><b>{formatMoney(report.totals.commission)}</b><i>thưởng KPI</i></div>
        </div>
      </section>

      <section className="rp-stats">
        <StatChip tone="sky" label="POS ghi nhận" value={`${formatNumber(report.totals.issued)}`} unit="sản phẩm" />
        <StatChip tone="green" label="Đã bán" value={`${formatNumber(report.totals.sold)}`} unit="sản phẩm" />
        <StatChip tone="amber" label="Còn tồn quầy" value={`${formatNumber(remainingTotal)}`} unit="sản phẩm" />
        <StatChip tone="rose" label="Hao hụt chế biến" value={`${report.totals.processingLossRate}`} unit="%" />
        <StatChip tone="grape" label="Hủy / hỏng" value={`${formatNumber(report.totals.damaged)}`} unit="sản phẩm" />
        <StatChip tone="navy" label="KPI nhân viên TB" value={`${report.totals.averageEmployeeKpi}`} unit="%" />
      </section>

      <section className="rp-card rp-board">
        <div className="rp-card-head">
          <strong>🏆 BẢNG THI ĐUA NHÂN VIÊN</strong>
          <span>xếp theo doanh thu</span>
        </div>
        {racers.length ? (
          <div className="rp-racers">
            {racers.map((row, index) => (
              <article className={`rp-racer rp-place-${index < 3 ? index + 1 : 'x'}`} key={row.key}>
                <div className="rp-medal">{medal(index)}</div>
                <div className="rp-racer-body">
                  <div className="rp-racer-top">
                    <strong>{row.name}</strong>
                    {row.achievedCommission
                      ? <em className="rp-badge-on">✓ Đạt thưởng KPI</em>
                      : <em className="rp-badge-off">Cần thêm {formatMoney(Math.max(0, row.targetRevenue - row.revenue))}</em>}
                  </div>
                  <div className="rp-bar"><i style={{ width: `${Math.max(4, row.revenue / maxRevenue * 100)}%` }} /></div>
                  <div className="rp-racer-meta">
                    <span>{formatNumber(row.sold)}/{formatNumber(row.issued)} sản phẩm</span>
                    <span>Hạng {row.rank} · {row.kpi}% KPI</span>
                    <b>{formatMoney(row.revenue)}</b>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : <p className="rp-empty">Chưa có dữ liệu nhân viên trong ngày.</p>}
      </section>

      <section className="rp-card rp-products">
        <div className="rp-card-head">
          <strong>📦 BÁN HÀNG THEO SẢN PHẨM</strong>
          <span>nhận · bán · doanh thu</span>
        </div>
        {products.length ? (
          <div className="rp-product-list">
            {products.map((item) => (
              <div className="rp-product" key={item.productId}>
                <div className="rp-product-name">
                  <strong>{item.name}</strong>
                  <small>{formatNumber(item.sold)}/{formatNumber(item.issued)} sản phẩm · {formatMoney(item.revenue)}</small>
                </div>
                <div className="rp-bar sm">
                  <i style={{ width: `${Math.max(5, item.issued / maxIssued * 100)}%` }}>
                    <b style={{ width: `${Math.min(100, item.sold / Math.max(1, item.issued) * 100)}%` }} />
                  </i>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="rp-empty">Chưa có dữ liệu bán hàng.</p>}
      </section>

      <section className="rp-two">
        <div className="rp-card rp-loss">
          <div className="rp-card-head"><strong>♻️ HAO HỤT & HỦY HÀNG</strong></div>
          <div className="rp-loss-row">
            <span>Sống → chín (bếp)</span>
            <b>{formatKg(report.totals.processingLossKg)} kg · {report.totals.processingLossRate}%</b>
          </div>
          {report.wasteRows.length ? report.wasteRows.slice(0, 5).map((item) => (
            <div className="rp-loss-row" key={item.id}>
              <span>{item.productName}{item.note ? ` · ${item.note}` : ''}</span>
              <b>{formatNumber(item.quantity)} {item.unit}</b>
            </div>
          )) : <div className="rp-loss-row muted"><span>Không có ghi chú hủy hàng.</span></div>}
        </div>
        <div className="rp-card rp-proofs">
          <div className="rp-card-head"><strong>📸 HÌNH ẢNH QUẦY</strong></div>
          <div className="rp-proof-grid">
            {report.proofImages.map((image) => (
              <figure key={image.key}>
                {image.url ? <img src={image.url} alt={image.label} /> : <span>Chưa có ảnh</span>}
                <figcaption>{image.label}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <footer className="rp-foot">
        <span>GUSTINO · Hệ thống vận hành nội bộ</span>
        <span>Xuất {new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · {report.dateLabel}</span>
      </footer>
    </div>
  )
}

function StatChip({ tone, label, value, unit }: { tone: string; label: string; value: string; unit: string }) {
  return (
    <div className={`rp-chip rp-chip-${tone}`}>
      <span>{label}</span>
      <strong>{value}<i>{unit}</i></strong>
    </div>
  )
}

function gradeTone(grade: string) {
  if (grade.includes('Xuất sắc')) return 'great'
  if (grade.includes('Ổn định')) return 'good'
  if (grade.includes('cải thiện')) return 'warn'
  if (grade.includes('cố gắng')) return 'warn'
  return 'muted'
}

function medal(index: number) {
  return index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`
}

function buildDailyReport(
  user: AppUser,
  movements: StockMovement[],
  sessions: BagShiftSession[],
  allocations: BagAllocation[],
  registrations: ShiftRegistration[],
  attendanceRecords: AttendanceRecord[],
  receipts: SalesReceipt[],
  businessDate: string,
  employeeKpiTargets: Record<string, number>,
): DailyReportModel {
  const branchName = configuredBranchName(user.branchId) || user.branchId
  const todayMovements = movements.filter((item) => item.branchId === user.branchId && item.shiftDate === businessDate)
  const todaySessions = sessions
    .filter((item) => item.branchId === user.branchId && item.businessDate === businessDate)
    .sort((a, b) => a.sequence - b.sequence || a.startedAt.localeCompare(b.startedAt))
  const todayAllocations = allocations
    .filter((item) => item.branchId === user.branchId)
    .filter((item) => allocationBusinessDate(item, todaySessions) === businessDate)
  const todayRegistrations = registrations.filter((item) =>
    item.branchId === user.branchId
    && item.workDate === businessDate
    && item.status !== 'rejected',
  )
  const todayAttendanceRecords = attendanceRecords.filter((item) =>
    item.branchId === user.branchId
    && item.checkInTime.slice(0, 10) === businessDate,
  )
  const todayReceipts = receipts.filter((item) => item.branchId === user.branchId && item.businessDate === businessDate)
  const productRows = mergeReceiptProductRows(buildProductReportRows(todayAllocations), todayReceipts)
  const employeeRows = buildEmployeeRows(todayAllocations, todayRegistrations, todayAttendanceRecords, todayReceipts, employeeKpiTargets, businessDate)
  const batchRows = buildBatchRows(todayMovements)
  const inboundRows = groupProductQuantities(todayMovements.filter((item) => item.type === 'inbound'))
  const packingRows = groupProductQuantities(todayMovements.filter((item) => item.type === 'packing_in'))
  const wasteRows = buildWasteRows(todayMovements)
  const stockRows = buildStockRows(movements, user.branchId, businessDate)
  const totalIssued = productRows.reduce((sum, item) => sum + item.issued, 0)
  const totalSold = productRows.reduce((sum, item) => sum + item.sold, 0)
  const totalReturned = productRows.reduce((sum, item) => sum + item.returned, 0)
  const totalDamaged = productRows.reduce((sum, item) => sum + item.damaged, 0)
  const totalRevenue = productRows.reduce((sum, item) => sum + item.revenue, 0)
  const commission = employeeRows.reduce((sum, item) => sum + item.commission, 0)
  const processingRawKg = batchRows.reduce((sum, item) => sum + item.raw, 0)
  const processingCookedKg = batchRows.reduce((sum, item) => sum + item.cooked, 0)
  const processingLossKg = batchRows.reduce((sum, item) => sum + item.loss, 0)
  const processingLossRate = processingRawKg ? roundPercent(processingLossKg / processingRawKg * 100) : 0
  const salesRate = totalIssued ? Math.round(totalSold / totalIssued * 100) : 0
  const averageEmployeeKpi = employeeRows.length
    ? Math.round(employeeRows.reduce((sum, row) => sum + row.kpi, 0) / employeeRows.length)
    : 0
  const teamTarget = Math.max(
    DEFAULT_REVENUE_TARGET,
    employeeRows.reduce((sum, row) => sum + row.targetRevenue, 0) || Math.max(1, employeeRows.length) * DEFAULT_REVENUE_TARGET,
  )
  const teamKpi = Math.min(100, Math.round(totalRevenue / teamTarget * 100))
  // Xếp loại LUÔN theo KPI (không hiện "thiếu dữ liệu"): ưu tiên KPI nhân viên trung bình, fallback KPI đội theo doanh thu.
  const kpiScore = employeeRows.length ? Math.max(teamKpi, averageEmployeeKpi) : teamKpi
  const grade = kpiScore >= 90 ? 'Xuất sắc' : kpiScore >= 70 ? 'Ổn định' : kpiScore >= 40 ? 'Cần cải thiện' : 'Cần cố gắng'
  const closedShiftCount = todaySessions.filter((item) => item.status === 'closed').length
  const openShiftCount = todaySessions.filter((item) => item.status === 'open').length
  const outstandingCount = todayAllocations.filter((item) => !item.settledAt).length
  const leaderNames = unique(todaySessions.map((item) => item.leaderName).filter(Boolean))
  const morningLeaderName = todaySessions.find((item) => item.sequence === 1)?.leaderName || ''
  const eveningLeaderName = todaySessions.find((item) => item.sequence === 2)?.leaderName || ''
  const blockingIssues = [
    openShiftCount > 0 ? `Còn ${openShiftCount} ca bàn giao quầy đang mở.` : '',
  ].filter(Boolean)
  const warnings = [
    !todayMovements.length && !todayAllocations.length && !todayReceipts.length ? 'Chưa thấy phát sinh kho hoặc POS trong ngày này.' : '',
    !batchRows.length ? 'Chưa có mẻ chế biến, hãy kiểm tra lại nếu hôm nay có làm hàng.' : '',
    !inboundRows.length ? 'Chưa có phiếu nhập đầu ngày.' : '',
    closedShiftCount < 2 ? `Hôm nay mới có ${closedShiftCount}/2 ca quầy đã bàn giao. Báo cáo vẫn hiển thị doanh thu nhân viên theo POS.` : '',
    outstandingCount > 0 ? `Còn ${outstandingCount} dòng bàn giao cũ chưa tất toán; doanh thu đã bán vẫn được tính theo POS.` : '',
    todayRegistrations.some((registration) => {
      const record = findAttendanceRecordForRegistration(todayAttendanceRecords, registration)
      return record && !record.checkOutTime
    }) ? 'Có nhân viên đã check-in nhưng chưa check-out. Giờ công sẽ cập nhật tiếp khi nhân viên kết ca.' : '',
  ].filter(Boolean)
  const legacyPatch = buildOperationalReportPatch(user, movements, businessDate)
  const legacyState = mergeBagSalesIntoReportState({
    ...legacyPatch,
    shiftLeader: leaderNames.join(', ') || user.name,
  }, todayAllocations)
  const dateLabel = formatDateLabel(businessDate)
  const summary = {
    revenue: totalRevenue,
    totalIn: processingCookedKg,
    totalSold,
    salesRate,
    kpi: teamKpi,
    kitchenLoss: processingLossRate,
    grade,
    shiftTime: dateLabel,
    leader: leaderNames.join(', ') || user.name,
  }

  return {
    branchName,
    businessDate,
    dateLabel,
    leaderNames,
    morningLeaderName,
    eveningLeaderName,
    closedShiftCount,
    openShiftCount,
    outstandingCount,
    blockingIssues,
    warnings,
    grade,
    legacyState,
    summary,
    totals: {
      inboundDocuments: countDocuments(todayMovements.filter((item) => item.type === 'inbound')),
      processingBatches: batchRows.length,
      packingDocuments: countDocuments(todayMovements.filter((item) => item.type === 'packing_in')),
      issued: totalIssued,
      sold: totalSold,
      returned: totalReturned,
      damaged: totalDamaged,
      revenue: totalRevenue,
      commission,
      salesRate,
      teamKpi,
      averageEmployeeKpi,
      processingRawKg,
      processingCookedKg,
      processingLossKg,
      processingLossRate,
    },
    shifts: buildShiftRows(todaySessions, todayAllocations),
    inboundRows,
    batchRows,
    packingRows,
    productRows,
    employeeRows,
    wasteRows,
    stockRows,
    bagShiftSummary: buildBagShiftSummary(todaySessions, todayAllocations),
    proofImages: buildProofImages(todaySessions, user.branchId, businessDate),
  }
}

function allocationBusinessDate(allocation: BagAllocation, sessions: BagShiftSession[]) {
  if (allocation.businessDate) return allocation.businessDate
  const session = sessions.find((item) => item.id === allocation.shiftId || item.id === allocation.settlementShiftId)
  return session?.businessDate || allocation.issuedAt.slice(0, 10)
}

function buildShiftRows(sessions: BagShiftSession[], allocations: BagAllocation[]): ShiftReportRow[] {
  return sessions.map((session) => {
    const rows = allocations.filter((item) => item.shiftId === session.id || item.settlementShiftId === session.id)
    const employees = new Set(rows.map((item) => item.employeeId || normalizeName(item.employeeName)))
    const sold = rows.reduce((sum, item) => sum + soldQuantity(item), 0)
    const revenue = rows.reduce((sum, item) => sum + productSaleValues(item.productId, soldQuantity(item)).revenue, 0)
    return {
      id: session.id,
      sequence: session.sequence,
      leaderName: session.leaderName,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      employeeCount: employees.size,
      issued: rows.reduce((sum, item) => sum + item.issuedQuantity, 0),
      sold,
      returned: rows.reduce((sum, item) => sum + item.returnedQuantity, 0),
      damaged: rows.reduce((sum, item) => sum + item.damagedQuantity, 0),
      revenue,
      discrepancyNote: session.discrepancyNote || '',
      openingPhotoUrl: session.openingPhotoUrl || '',
      closingPhotoUrl: session.closingPhotoUrl || '',
    }
  })
}

function buildBatchRows(movements: StockMovement[]): BatchReportRow[] {
  const groups = groupByDocument(movements.filter((item) =>
    item.type === 'processing_out' || item.type === 'processing_in' || item.type === 'waste' || item.type === 'packing_in',
  ))
  return Array.from(groups.entries())
    .filter(([, rows]) => rows.some((item) => item.type === 'processing_out'))
    .map(([documentId, rows], index) => {
      const inputs = rows.filter((item) => item.type === 'processing_out')
      const outputs = rows.filter((item) => item.type === 'processing_in')
      const waste = rows.filter((item) => item.type === 'waste' && item.sourceProductId)
      const packing = rows.filter((item) => item.type === 'packing_in')
      const raw = round(inputs.reduce((sum, item) => sum + item.quantity, 0))
      const cooked = round(outputs.reduce((sum, item) => sum + item.quantity, 0))
      const loss = round(waste.length ? waste.reduce((sum, item) => sum + item.quantity, 0) : Math.max(0, raw - cooked))
      const note = unique(inputs.map((item) => cleanPhaseNote(item.note)).filter(Boolean)).join(' · ')
      const phase = extractPhase(inputs[0]?.note) || `Mẻ ${index + 1}`
      return {
        id: documentId,
        phase,
        inputLabel: summarizeMovementProducts(inputs),
        outputLabel: summarizeMovementProducts(outputs),
        raw,
        cooked,
        loss,
        lossRate: raw ? roundPercent(loss / raw * 100) : 0,
        packedLabel: packing.map((item) => {
          const product = productById(item.productId)
          return `${formatNumber(item.quantity)} ${product?.unit || ''} ${product?.name || item.productId}`
        }).join(' · '),
        note,
        createdAt: rows.map((item) => item.createdAt).sort()[0] || '',
      }
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function buildProductReportRows(allocations: BagAllocation[]): ProductReportRow[] {
  const rows = new Map<string, ProductReportRow>()
  allocations.forEach((allocation) => {
    const product = productById(allocation.productId)
    const current = rows.get(allocation.productId) || {
      productId: allocation.productId,
      name: product?.name || allocation.productId,
      unit: product?.unit || 'túi',
      issued: 0,
      sold: 0,
      returned: 0,
      damaged: 0,
      remaining: 0,
      outstanding: 0,
      revenue: 0,
      weightKg: product?.weightKg || 0,
    }
    const sold = soldQuantity(allocation)
    current.issued += allocation.issuedQuantity
    current.sold += sold
    current.returned += allocation.returnedQuantity
    current.damaged += allocation.damagedQuantity
    current.outstanding += allocation.settledAt ? 0 : allocation.issuedQuantity
    current.remaining += Math.max(0, allocation.issuedQuantity - sold - allocation.damagedQuantity)
    current.revenue += productSaleValues(allocation.productId, sold).revenue
    rows.set(allocation.productId, current)
  })
  return Array.from(rows.values()).sort((a, b) => b.issued - a.issued || a.name.localeCompare(b.name, 'vi'))
}

function mergeReceiptProductRows(rows: ProductReportRow[], receipts: SalesReceipt[]): ProductReportRow[] {
  if (!receipts.length) return rows
  const merged = new Map(rows.map((row) => [row.productId, { ...row }]))
  const receiptRows = new Map<string, { name: string; quantity: number; total: number }>()
  receipts.forEach((receipt) => {
    const directLines = receipt.lines.filter((line) => !line.allocationId)
    directLines.forEach((line) => {
      const current = receiptRows.get(line.productId) || { name: line.productName, quantity: 0, total: 0 }
      current.quantity += line.quantity
      current.total += line.total
      receiptRows.set(line.productId, current)
    })
  })
  receiptRows.forEach((receiptRow, productId) => {
    const existing = merged.get(productId)
    const product = productById(productId)
    const current = existing || {
      productId,
      name: product?.name || receiptRow.name || productId,
      unit: product?.unit || 'túi',
      issued: 0,
      sold: 0,
      returned: 0,
      damaged: 0,
      remaining: 0,
      outstanding: 0,
      revenue: 0,
      weightKg: product?.weightKg || 0,
    }
    current.issued = Math.max(current.issued, current.sold + receiptRow.quantity)
    current.sold += receiptRow.quantity
    current.revenue += receiptRow.total
    current.remaining = Math.max(0, current.issued - current.sold - current.damaged)
    merged.set(productId, current)
  })
  return Array.from(merged.values()).sort((a, b) => b.issued - a.issued || a.name.localeCompare(b.name, 'vi'))
}

function buildEmployeeRows(
  allocations: BagAllocation[],
  registrations: ShiftRegistration[],
  attendanceRecords: AttendanceRecord[],
  receipts: SalesReceipt[],
  employeeKpiTargets: Record<string, number>,
  businessDate: string,
): EmployeeReportRow[] {
  const rows = new Map<string, EmployeeReportRow & { productMap: Map<string, EmployeeProductRow> }>()
  const registrationByEmployee = new Map(registrations.map((item) => [item.userId, item]))
  const registrationByName = new Map(registrations.map((item) => [normalizeName(item.userName), item]))
  const registeredRowKeys = new Set(registrations.flatMap((item) => [
    `${item.branchId}|${item.userId}`,
    `${item.branchId}|${normalizeName(item.userName)}`,
  ]))
  const ensureRow = (
    branchId: string,
    employeeKey: string,
    employeeName: string,
    registration?: ShiftRegistration,
  ) => {
    const key = `${branchId}|${employeeKey}`
    const current = rows.get(key)
    if (current) return current
    const attendance = employeeAttendanceSummary(employeeKey, registrations, attendanceRecords)
    const row = {
      key,
      name: employeeName,
      issued: 0,
      sold: 0,
      returned: 0,
      damaged: 0,
      outstanding: 0,
      revenue: 0,
      commission: 0,
      achievedCommission: false,
      kpi: 0,
      rank: 'D',
      targetRevenue: employeeRevenueTarget(
        branchId,
        employeeKey,
        employeePeriodRevenueTarget(
          branchId,
          registration?.employmentType === 'leader' ? 'shift_leader' : 'staff',
          registration?.employmentType,
          registration?.positionTitle,
          registration?.workDate || businessDate,
          registration?.workDate || businessDate,
        ),
        employeeKpiTargets,
      ),
      workHours: attendance.workHours,
      checkedIn: attendance.checkedIn,
      checkedOut: attendance.checkedOut,
      products: [],
      productMap: new Map<string, EmployeeProductRow>(),
    }
    rows.set(key, row)
    return row
  }

  registrations.forEach((registration) => {
    ensureRow(registration.branchId, registration.userId, registration.userName, registration)
  })

  allocations.forEach((allocation) => {
    const employeeKey = allocation.employeeId || normalizeName(allocation.employeeName)
    const key = `${allocation.branchId}|${employeeKey}`
    const registration = registrationByEmployee.get(employeeKey) || registrationByName.get(normalizeName(allocation.employeeName))
    const current = ensureRow(allocation.branchId, employeeKey, allocation.employeeName, registration)
    const sold = soldQuantity(allocation)
    current.issued += allocation.issuedQuantity
    current.sold += sold
    current.returned += allocation.returnedQuantity
    current.damaged += allocation.damagedQuantity
    current.outstanding += allocation.settledAt ? 0 : allocation.issuedQuantity
    current.revenue += productSaleValues(allocation.productId, sold).revenue
    current.targetRevenue = employeeRevenueTarget(
      allocation.branchId,
      employeeKey,
      employeePeriodRevenueTarget(
        allocation.branchId,
        registration?.employmentType === 'leader' ? 'shift_leader' : 'staff',
        registration?.employmentType,
        registration?.positionTitle,
        registration?.workDate || businessDate,
        registration?.workDate || businessDate,
      ),
      employeeKpiTargets,
    )
    current.commission = dailyKpiBonus(
      current.revenue / Math.max(1, current.targetRevenue) * 100,
      registration?.employmentType === 'leader' ? 'shift_leader' : 'staff',
      registration?.employmentType,
      registration?.positionTitle,
    )
    current.achievedCommission = current.revenue >= current.targetRevenue
    const product = productById(allocation.productId)
    const productRow = current.productMap.get(allocation.productId) || {
      productId: allocation.productId,
      name: product?.name || allocation.productId,
      issued: 0,
      sold: 0,
      returned: 0,
      damaged: 0,
    }
    productRow.issued += allocation.issuedQuantity
    productRow.sold += sold
    productRow.returned += allocation.returnedQuantity
    productRow.damaged += allocation.damagedQuantity
    current.productMap.set(allocation.productId, productRow)
    rows.set(key, current)
  })

  receipts.forEach((receipt) => {
    const employeeKey = receipt.sellerId || receipt.sellerKey || normalizeName(receipt.sellerName)
    const registration = registrationByEmployee.get(employeeKey) || registrationByName.get(normalizeName(receipt.sellerName))
    const current = ensureRow(receipt.branchId, employeeKey, receipt.sellerName, registration)
    const directLines = receipt.lines.filter((line) => !line.allocationId)
    if (!directLines.length && (current.revenue > 0 || current.sold > 0)) return
    const soldQuantity = directLines.length
      ? directLines.reduce((sum, line) => sum + line.quantity, 0)
      : receipt.totalQuantity
    const revenue = directLines.length
      ? directLines.reduce((sum, line) => sum + line.total, 0)
      : receipt.totalAmount
    current.sold += soldQuantity
    current.revenue += revenue
    // POS fallback: đã bán không bao giờ được hiển thị với số nhận bằng 0
    // khi allocation liên kết chưa kịp đồng bộ vào phạm vi báo cáo.
    current.issued = Math.max(current.issued, current.sold)
    current.targetRevenue = employeeRevenueTarget(
      receipt.branchId,
      employeeKey,
      employeePeriodRevenueTarget(
        receipt.branchId,
        registration?.employmentType === 'leader' ? 'shift_leader' : 'staff',
        registration?.employmentType,
        registration?.positionTitle,
        receipt.businessDate,
        receipt.businessDate,
      ),
      employeeKpiTargets,
    )
    current.achievedCommission = current.revenue >= current.targetRevenue
    current.commission = dailyKpiBonus(
      current.revenue / Math.max(1, current.targetRevenue) * 100,
      registration?.employmentType === 'leader' ? 'shift_leader' : 'staff',
      registration?.employmentType,
      registration?.positionTitle,
    )
    directLines.forEach((line) => {
      const product = productById(line.productId)
      const productRow = current.productMap.get(line.productId) || {
        productId: line.productId,
        name: product?.name || line.productName || line.productId,
        issued: 0,
        sold: 0,
        returned: 0,
        damaged: 0,
      }
      productRow.issued += line.quantity
      productRow.sold += line.quantity
      current.productMap.set(line.productId, productRow)
    })
  })

  return Array.from(rows.values())
    .filter((row) => {
      const branchId = row.key.split('|')[0]
      return registeredRowKeys.has(row.key) || registeredRowKeys.has(`${branchId}|${normalizeName(row.name)}`)
    })
    .map(({ productMap, ...row }) => ({
      ...row,
      kpi: Math.min(200, Math.round(row.revenue / Math.max(1, row.targetRevenue) * 100)),
      rank: kpiRank(row.revenue / Math.max(1, row.targetRevenue) * 100),
      products: Array.from(productMap.values()).sort((a, b) => b.issued - a.issued),
    }))
    .filter(hasSalesActivity)
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, 'vi'))
}

function hasSalesActivity(row: EmployeeReportRow) {
  return row.sold > 0 || row.revenue > 0
}

function employeeAttendanceSummary(employeeKey: string, registrations: ShiftRegistration[], records: AttendanceRecord[]) {
  const employeeRegistrations = registrations.filter((item) => item.userId === employeeKey)
  let workHours = 0
  let checkedIn = false
  let checkedOut = false
  employeeRegistrations.forEach((registration) => {
    const record = findAttendanceRecordForRegistration(records, registration)
    if (!record) return
    checkedIn = true
    if (record.checkOutTime) checkedOut = true
    const end = record.checkOutTime ? new Date(record.checkOutTime).getTime() : Date.now()
    workHours += Math.max(0, (end - new Date(record.checkInTime).getTime()) / 36e5)
  })
  return { workHours: Math.round(workHours * 10) / 10, checkedIn, checkedOut }
}

function buildWasteRows(movements: StockMovement[]): WasteReportRow[] {
  return movements
    .filter((item) => item.type === 'waste')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((item) => {
      const product = productById(item.productId)
      const source = item.sourceProductId ? productById(item.sourceProductId) : undefined
      return {
        id: item.id,
        productName: product?.name || item.productId,
        unit: product?.unit || '',
        quantity: item.quantity,
        note: item.note,
        sourceName: source?.name || '',
      }
    })
}

function buildStockRows(movements: StockMovement[], branchId: string, businessDate: string): StockReportRow[] {
  return calculateStock(movements.filter((item) => item.branchId === branchId && item.shiftDate <= businessDate))
    .filter((line) =>
      Math.abs(line.expected) > 0.0001
      || line.actual !== undefined
      || Boolean(line.variance),
    )
    .map((line) => ({
      productId: line.product.id,
      name: line.product.name,
      sku: line.product.sku,
      unit: line.product.unit,
      category: line.product.category,
      expected: line.expected,
      actual: line.actual,
      variance: line.variance,
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'vi'))
}

function groupProductQuantities(rows: StockMovement[]): ProductQuantityRow[] {
  const grouped = new Map<string, ProductQuantityRow & { documentIds: Set<string> }>()
  rows.forEach((row) => {
    const product = productById(row.productId)
    const current = grouped.get(row.productId) || {
      productId: row.productId,
      name: product?.name || row.productId,
      unit: product?.unit || '',
      quantity: 0,
      documents: 0,
      notes: [],
      documentIds: new Set<string>(),
    }
    current.quantity += row.quantity
    current.documentIds.add(row.documentId || row.id)
    if (row.note && !current.notes.includes(row.note)) current.notes.push(row.note)
    grouped.set(row.productId, current)
  })
  return Array.from(grouped.values())
    .map(({ documentIds, notes, ...row }) => ({
      ...row,
      documents: documentIds.size,
      notes: notes.slice(0, 2),
    }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'vi'))
}

function buildBagShiftSummary(sessions: BagShiftSession[], allocations: BagAllocation[]) {
  const salesByEmployee = new Map(summarizeEmployeeBagSales(allocations).map((item) => [
    `${item.branchId}|${item.employeeId || normalizeName(item.employeeName)}`,
    item,
  ]))
  const employees = new Map<string, {
    employeeName: string
    employeeId?: string
    branchId: string
    issued: number
    sold: number
    returned: number
    damaged: number
    outstanding: number
  }>()
  allocations.forEach((item) => {
    const key = `${item.branchId}|${item.employeeId || normalizeName(item.employeeName)}`
    const row = employees.get(key) || {
      employeeName: item.employeeName,
      employeeId: item.employeeId,
      branchId: item.branchId,
      issued: 0,
      sold: 0,
      returned: 0,
      damaged: 0,
      outstanding: 0,
    }
    row.issued += item.issuedQuantity
    row.sold += soldQuantity(item)
    row.returned += item.returnedQuantity
    row.damaged += item.damagedQuantity
    row.outstanding += item.settledAt ? 0 : item.issuedQuantity
    employees.set(key, row)
  })
  return {
    shifts: sessions.map((item) => ({
      sequence: item.sequence,
      leaderName: item.leaderName,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      openingBalances: item.openingBalances,
      closingBalances: item.closingBalances || {},
      discrepancyNote: item.discrepancyNote,
    })),
    employees: Array.from(employees.entries()).map(([key, item]) => ({
      ...item,
      revenue: salesByEmployee.get(key)?.revenue || 0,
      achievedCommission: salesByEmployee.get(key)?.achieved || false,
      commission: salesByEmployee.get(key)?.commission || 0,
    })),
    outstandingCount: allocations.filter((item) => !item.settledAt).length,
  }
}

function groupByDocument(rows: StockMovement[]) {
  const groups = new Map<string, StockMovement[]>()
  rows.forEach((item) => {
    const key = item.documentId || item.id
    groups.set(key, [...(groups.get(key) || []), item])
  })
  return groups
}

function summarizeMovementProducts(rows: StockMovement[]) {
  if (!rows.length) return 'Chưa ghi nhận'
  return rows.map((item) => {
    const product = productById(item.productId)
    return `${formatNumber(item.quantity)} ${product?.unit || ''} ${product?.name || item.productId}`
  }).join(' · ')
}

function countDocuments(rows: StockMovement[]) {
  return new Set(rows.map((item) => item.documentId || item.id)).size
}

function soldQuantity(item: BagAllocation) {
  if (typeof item.soldQuantity === 'number') return Math.max(0, item.soldQuantity)
  return item.settledAt
    ? Math.max(0, item.issuedQuantity - item.returnedQuantity - item.damagedQuantity)
    : 0
}

function productById(productId: string) {
  return catalogProductById(productId) || PRODUCTS.find((item) => item.id === productId)
}

function shiftLabel(sequence: number) {
  if (sequence === 1) return 'Ca sáng'
  if (sequence === 2) return 'Ca tối'
  return `Ca ${sequence}`
}

function isTimestampInShift(timestamp: string, session: BagShiftSession) {
  if (!timestamp || timestamp < session.startedAt) return false
  return !session.endedAt || timestamp <= session.endedAt
}

function defaultReportScopeForLeader(session: Pick<BagShiftSession, 'sequence'>): ReportScope {
  return session.sequence === 1 ? 'shift-1' : 'shift-2'
}

function friendlyReportMessage(value: string) {
  if (!value) return ''
  const normalized = value.toLocaleLowerCase('vi')
  const operationalError = 'Chưa gửi được Zalo. Vui lòng thử lại; nếu vẫn lỗi, báo quản trị.'
  if ([
    'response rỗng',
    'response không phải json',
    'mới chỉ xác nhận bắt đầu',
    'chưa xác nhận đã ghi sheet cho đúng job_key',
  ].some((item) => normalized.includes(item))) return operationalError
  if (
    (normalized.includes('n8n') || normalized.includes('webhook'))
    && ['lỗi', 'không', 'chưa', 'từ chối', 'quá thời gian'].some((item) => normalized.includes(item))
  ) {
    return operationalError
  }
  return value
}

function reportMessageTone(value: string) {
  const normalized = value.toLocaleLowerCase('vi')
  return ['không', 'chưa', 'lỗi', 'từ chối', 'quá thời gian'].some((item) => normalized.includes(item))
    ? 'error'
    : 'success'
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)))
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function extractPhase(note = '') {
  return note.match(/\[([^\]]+)\]/)?.[1] || ''
}

function cleanPhaseNote(note = '') {
  return note.replace(/\[[^\]]+\]/g, '').trim()
}

function shiftPhotoKey(branchId: string, date: string, kind: 'opening' | 'closing') {
  return `gustino_shift_${branchId}_${date}_${kind}_photo`
}

function buildProofImages(sessions: BagShiftSession[], branchId: string, businessDate: string): ProofImage[] {
  const sorted = [...sessions]
    .filter((item) => item.businessDate === businessDate)
    .sort((a, b) => a.sequence - b.sequence)
  const images = sorted.flatMap((session) => [
    {
      key: `${session.id}-opening`,
      label: `${shiftLabel(session.sequence)} · Đầu ca`,
      url: session.openingPhotoUrl || '',
    },
    {
      key: `${session.id}-closing`,
      label: `${shiftLabel(session.sequence)} · Cuối ca`,
      url: session.closingPhotoUrl || '',
    },
  ])
  if (images.length) return images
  return [
    { key: 'cloud-opening', label: 'Đầu ca', url: '' },
    { key: 'cloud-closing', label: 'Cuối ca', url: '' },
  ]
}

function reportPosterScopeLabel(kind: N8nReportKind) {
  return kind === 'day' ? 'Tổng ngày' : kind === 'shift-1' ? 'Ca 1' : 'Ca 2'
}

function reportKindLabel(kind: N8nReportKind) {
  return kind === 'day' ? 'Tổng ngày' : `Báo cáo ${reportPosterScopeLabel(kind)}`
}

async function captureReportPosterBlob(
  target: HTMLDivElement,
  options: { scale: number; quality: number; maxBytes?: number },
) {
  let exportFrame: HTMLDivElement | null = null
  try {
    await waitForPaint()
    const { default: html2canvas } = await import('html2canvas')
    const exportTarget = target.cloneNode(true) as HTMLDivElement
    exportTarget.classList.add('rp-poster-export')
    exportFrame = document.createElement('div')
    exportFrame.className = 'rp-export-frame'
    exportFrame.appendChild(exportTarget)
    document.body.appendChild(exportFrame)
    await waitForPaint()
    exportFrame.style.height = `${exportTarget.scrollHeight}px`
    const canvas = await html2canvas(exportTarget, {
      scale: options.scale,
      backgroundColor: '#fff8ec',
      useCORS: true,
      width: exportTarget.scrollWidth,
      height: exportTarget.scrollHeight,
      windowWidth: exportTarget.scrollWidth,
    })
    let blob = await canvasToBlob(canvas, 'image/jpeg', options.quality)
    if (!options.maxBytes || blob.size <= options.maxBytes) return blob

    for (const quality of [.8, .72, .64]) {
      blob = await canvasToBlob(canvas, 'image/jpeg', quality)
      if (blob.size <= options.maxBytes) return blob
    }

    const ratio = Math.max(.5, Math.min(.9, Math.sqrt(options.maxBytes / blob.size) * .9))
    const resized = document.createElement('canvas')
    resized.width = Math.max(1, Math.round(canvas.width * ratio))
    resized.height = Math.max(1, Math.round(canvas.height * ratio))
    const context = resized.getContext('2d')
    if (!context) throw new Error('Không thể thu gọn infographic để gửi n8n.')
    context.drawImage(canvas, 0, 0, resized.width, resized.height)
    blob = await canvasToBlob(resized, 'image/jpeg', .76)
    if (blob.size > options.maxBytes) throw new Error('Infographic quá lớn để gửi n8n. Hãy bấm gửi lại sau khi tải lại trang.')
    return blob
  } finally {
    exportFrame?.remove()
  }
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      if (comma < 0) reject(new Error('Không đọc được dữ liệu infographic.'))
      else resolve(result.slice(comma + 1))
    }
    reader.onerror = () => reject(reader.error || new Error('Không đọc được dữ liệu infographic.'))
    reader.readAsDataURL(blob)
  })
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
  })
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10
}

function formatNumber(value: number) {
  return Number(value.toFixed(2)).toLocaleString('vi-VN')
}

function formatKg(value: number) {
  return (Math.round(value * 10) / 10).toLocaleString('vi-VN', {
    maximumFractionDigits: 1,
    minimumFractionDigits: Number.isInteger(value) ? 1 : 0,
  })
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}
