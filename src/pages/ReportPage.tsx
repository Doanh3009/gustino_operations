import { useEffect, useMemo, useRef, useState } from 'react'
import { buildOperationalReportPatch, mergeBagSalesIntoReportState } from '../lib/reportSync'
import { COMMISSION_MIN_BAGS, productSaleValues, summarizeEmployeeBagSales } from '../lib/commission'
import { BRANCHES, PRODUCTS } from '../lib/constants'
import { calculateStock, closeOperationDay, ensureOperationDay, getOperationDay, saveReportSnapshot } from '../lib/store'
import { fetchBagAllocations, fetchBagShiftSessions } from '../lib/shiftLedger'
import { supabase } from '../lib/supabase'
import { localDateKey } from '../lib/dates'
import type { InventoryTab, Page } from '../components/AppShell'
import type { AppUser, BagAllocation, BagShiftSession, StockMovement } from '../types'

interface Props {
  user: AppUser
  movements: StockMovement[]
  onNavigate: (page: Page) => void
  onOpenInventory: (tab: InventoryTab) => void
  onRefresh: () => Promise<void>
}

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
}

export function ReportPage({ user, movements, onNavigate, onOpenInventory, onRefresh }: Props) {
  const infographicRef = useRef<HTMLDivElement>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [finalized, setFinalized] = useState(false)
  const [bagSessions, setBagSessions] = useState<BagShiftSession[]>([])
  const [bagAllocations, setBagAllocations] = useState<BagAllocation[]>([])
  const businessDate = localDateKey()

  async function refreshLedger() {
    const [sessions, allocations] = await Promise.all([
      fetchBagShiftSessions(user, { branchId: user.branchId, date: businessDate }),
      fetchBagAllocations(user, { branchId: user.branchId }),
    ])
    setBagSessions(sessions)
    setBagAllocations(allocations)
  }

  useEffect(() => {
    void refreshLedger().catch((error) => {
      setMessage(error instanceof Error ? error.message : 'Không thể tải sổ túi hôm nay.')
    })
  }, [businessDate, user.id, user.branchId])

  useEffect(() => {
    let ignore = false
    void getOperationDay(user.branchId, businessDate).then((day) => {
      if (!ignore) setFinalized(day?.status === 'closed')
    }).catch(() => {})
    return () => {
      ignore = true
    }
  }, [businessDate, user.branchId])

  useEffect(() => {
    const client = supabase
    if (!client) {
      const timer = window.setInterval(() => void refreshLedger().catch(() => null), 5000)
      return () => window.clearInterval(timer)
    }
    const channel = client.channel(`report-ledger:${user.branchId}:${businessDate}`)
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
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [businessDate, user.branchId, user.id])

  const report = useMemo(
    () => buildDailyReport(user, movements, bagSessions, bagAllocations, businessDate),
    [user, movements, bagSessions, bagAllocations, businessDate],
  )
  const canFinalize = report.blockingIssues.length === 0 && !finalized

  async function reloadTodayData() {
    setBusy(true)
    try {
      await Promise.all([onRefresh(), refreshLedger()])
      setMessage('Đã lấy lại dữ liệu mới nhất từ kho và sổ túi.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể lấy lại dữ liệu hôm nay.')
    } finally {
      setBusy(false)
    }
  }

  async function saveCloud() {
    if (finalized) {
      setMessage('Ngày đã kết thúc. Chúc cả đội ngủ ngon.')
      return
    }
    if (!canFinalize) {
      setMessage(report.blockingIssues[0] || 'Báo cáo chưa đủ điều kiện chốt.')
      return
    }
    setBusy(true)
    try {
      const proofImages = getShiftProofImages(bagSessions, user.branchId, businessDate)
      await ensureOperationDay(user, businessDate)
      await saveReportSnapshot(user, {
        reportDate: businessDate,
        state: report.legacyState,
        openingImage: proofImages.opening,
        closingImage: proofImages.closing,
        bagShiftSummary: report.bagShiftSummary,
        dailyReport: report,
        summary: report.summary,
      })
      await closeOperationDay(user, businessDate)
      setFinalized(true)
      setMessage('Đã chốt báo cáo và kết thúc ngày. Chúc cả đội ngủ ngon.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể lưu báo cáo.')
    } finally {
      setBusy(false)
    }
  }

  async function exportInfographicImage() {
    const target = infographicRef.current
    if (!target) return
    setBusy(true)
    try {
      await waitForPaint()
      const { default: html2canvas } = await import('html2canvas')
      const canvas = await html2canvas(target, {
        scale: 2,
        backgroundColor: '#f7f8ef',
        useCORS: true,
      })
      const link = document.createElement('a')
      link.download = `GUSTINO-bao-cao-${businessDate}.jpg`
      link.href = canvas.toDataURL('image/jpeg', 0.95)
      link.click()
      setMessage('Đã tải infographic báo cáo dạng JPG.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải infographic.')
    } finally {
      setBusy(false)
    }
  }

  const proofImages = getShiftProofImages(bagSessions, user.branchId, businessDate)

  return (
    <div className="report-page">
      <div className="report-toolbar">
        <div>
          <strong>{finalized ? 'Kết thúc ngày' : 'Báo cáo cuối ngày'}</strong>
          <small>{finalized ? 'Báo cáo đã chốt, dữ liệu đã vào dashboard. Chúc cả đội ngủ ngon.' : 'Chỉ tổng hợp dữ liệu từ kho, mẻ chế biến và sổ túi theo ca. Muốn sửa số, sửa ở màn nguồn.'}</small>
        </div>
        <div className="toolbar-actions report-toolbar-actions">
          {message && <span className="toolbar-message">{message}</span>}
          <button className="secondary-button" onClick={() => void reloadTodayData()} disabled={busy}>↻ Lấy lại dữ liệu</button>
          <button className="secondary-button" onClick={() => onOpenInventory('processing_out')}>Sửa làm hàng</button>
          <button className="secondary-button" onClick={() => onNavigate('handover')}>Sửa sổ túi</button>
          <button className="secondary-button" onClick={() => void exportInfographicImage()} disabled={busy}>Tải infographic</button>
          <button className="primary-button" onClick={() => void saveCloud()} disabled={busy || !canFinalize}>{finalized ? 'Đã kết thúc ngày' : 'Chốt báo cáo'}</button>
        </div>
      </div>

      <div className="report-infographic-export" aria-hidden="true">
        <div ref={infographicRef}>
          <ReportInfographicSheet report={report} proofImages={proofImages} />
        </div>
      </div>
      <ReportInfographicSheet report={report} proofImages={proofImages} visible />
    </div>
  )
}

function ReportInfographicSheet({
  report,
  proofImages,
  visible = false,
}: {
  report: DailyReportModel
  proofImages: { opening: string; closing: string }
  visible?: boolean
}) {
  const inventoryRows = buildInfographicInventoryRows(report)
  const employees = report.employeeRows.slice(0, 6)
  const maxSold = Math.max(1, ...employees.map((item) => item.sold))
  const wasteNotes = report.wasteRows.length
    ? report.wasteRows.map((item) =>
        `${item.productName}: ${formatNumber(item.quantity)} ${item.unit}${item.note ? ` - ${item.note}` : ''}`,
      ).join('\n')
    : 'Không có ghi chú hủy hàng.'

  return (
    <article className={`report-infographic-card ${visible ? 'report-visible-card' : ''}`}>
      <header className="report-info-header">
        <div>
          <span>HẠT DẺ ÔNG LÝ</span>
          <h1>{report.branchName}</h1>
          <p>INFOGRAPHIC BÁO CÁO CHỐT CA</p>
        </div>
        <dl>
          <div><dt>Chi nhánh</dt><dd>{report.branchName}</dd></div>
          <div><dt>Ca sáng</dt><dd>{report.morningLeaderName || '---'}</dd></div>
          <div><dt>Ca tối</dt><dd>{report.eveningLeaderName || '---'}</dd></div>
          <div><dt>Ngày & ca</dt><dd>Ngày {report.dateLabel}</dd></div>
          <div><dt>Xếp loại</dt><dd>{report.grade.toLocaleUpperCase('vi')}</dd></div>
        </dl>
      </header>

      <section className="report-info-kpis">
        <InfographicKpiBlock label="Tổng doanh thu" value={formatMoney(report.totals.revenue)} note={report.grade} tone="dark" />
        <InfographicKpiBlock label="Tổng nhận" value={`${formatNumber(report.totals.issued)} SP`} note="Hàng đã phát" />
        <InfographicKpiBlock label="Đã bán" value={`${formatNumber(report.totals.sold)} SP`} note={`${report.totals.salesRate}% hiệu suất`} tone="good" />
        <InfographicKpiBlock label="KPI đội" value={`${report.totals.teamKpi}%`} note="Trung bình PG" tone="blue" />
        <InfographicKpiBlock label="Hao hụt" value={`${report.totals.processingLossRate}%`} note="Bếp sống → chín" tone="warn" />
      </section>

      <section className="report-info-grid">
        <div className="report-info-panel">
          <div className="report-info-panel-head">
            <strong>NGUYÊN LIỆU & TỒN KHO</strong>
            <span>TỒN SP: {formatNumber(report.productRows.reduce((sum, item) => sum + item.remaining, 0))}</span>
          </div>
          <InfographicInfoTable rows={inventoryRows} />
        </div>

        <div className="report-info-panel">
          <div className="report-info-panel-head">
            <strong>BÁN HÀNG THEO SẢN PHẨM</strong>
            <span>NHẬN - BÁN - TỒN</span>
          </div>
          <InfographicProductSalesTable rows={report.productRows} />
        </div>
      </section>

      <section className="report-info-panel report-info-kpi-panel">
        <div className="report-info-panel-head">
          <strong>BẢNG KPI PG</strong>
          <span>TOP THEO KPI</span>
        </div>
        <div className="report-info-employee-grid">
          {employees.length ? employees.map((employee, index) => (
            <InfographicEmployeeKpiCard key={employee.key} row={employee} index={index} maxSold={maxSold} />
          )) : <p className="report-info-empty">Chưa có dữ liệu PG.</p>}
        </div>
      </section>

      <section className="report-info-grid compact">
        <ProofPanel title="HÌNH ẢNH ĐẦU CA" src={proofImages.opening} empty="Chưa có ảnh đầu ca." />
        <ProofPanel title="HÌNH ẢNH CUỐI CA" src={proofImages.closing} empty="Chưa có ảnh cuối ca." />
      </section>

      <section className="report-info-grid compact">
        <TextPanel title="HỦY HÀNG CUỐI CA" text={wasteNotes} />
        <TextPanel title="SỰ CỐ TRONG CA" text="Không có ghi chú sự cố." />
      </section>

      <footer className="report-info-footer">
        <span>GUSTINO - HỆ THỐNG VẬN HÀNH</span>
        <span>XUẤT LÚC: {new Date().toLocaleTimeString('vi-VN')} {report.dateLabel}</span>
      </footer>
    </article>
  )
}

function InfographicKpiBlock({ label, value, note, tone = '' }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div className={`report-info-kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  )
}

function InfographicInfoTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className="report-info-table">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}><td>{label}</td><td>{value}</td></tr>
        ))}
      </tbody>
    </table>
  )
}

function InfographicProductSalesTable({ rows }: { rows: ProductReportRow[] }) {
  const maxIssued = Math.max(1, ...rows.map((item) => item.issued))
  return (
    <table className="report-product-table">
      <thead>
        <tr>
          <th>Sản phẩm</th>
          <th>Nhận</th>
          <th>Bán</th>
          <th>Hủy</th>
          <th>Tồn</th>
          <th>Tiền</th>
        </tr>
      </thead>
      <tbody>
        {rows.length ? rows.map((item) => (
          <tr key={item.productId}>
            <td>
              <strong>{item.name}</strong>
              <i><b style={{ width: `${Math.max(6, item.issued / maxIssued * 100)}%` }} /></i>
            </td>
            <td>{formatNumber(item.issued)}</td>
            <td className="good">{formatNumber(item.sold)}</td>
            <td className="warn">{formatNumber(item.damaged)}</td>
            <td className="amber">{formatNumber(item.remaining)}</td>
            <td>{formatMoney(item.revenue)}</td>
          </tr>
        )) : (
          <tr><td colSpan={6}>Chưa có dữ liệu phát túi.</td></tr>
        )}
      </tbody>
    </table>
  )
}

function InfographicEmployeeKpiCard({ row, index, maxSold }: { row: EmployeeReportRow; index: number; maxSold: number }) {
  const small = sumEmployeeProducts(row, (productId) => productId.includes('110'))
  const large = sumEmployeeProducts(row, (productId) => productId.includes('500') || productId.includes('1kg'))
  const cake = sumEmployeeProducts(row, (productId) => productId.includes('cake'))
  return (
    <article className="report-employee-kpi">
      <div>
        <strong>{index + 1}. {row.name}<span> /PT</span></strong>
        <b>{row.kpi}%</b>
      </div>
      <p>0h · {formatNumber(row.sold)}/{formatNumber(row.issued)} SP · Hoa hồng {formatMoney(row.commission)}</p>
      <div className="report-employee-bars">
        <i style={{ width: `${Math.max(5, row.kpi)}%` }} />
      </div>
      <div className="report-employee-compare">
        <span>So sánh bán</span>
        <em><i style={{ width: `${Math.max(5, row.sold / maxSold * 100)}%` }} /></em>
        <strong>{formatNumber(row.sold)} SP</strong>
      </div>
      <footer>
        <span>S: {formatNumber(small)}/10</span>
        <span>L: {formatNumber(large)}/7</span>
        <span>Cake: {formatNumber(cake)}/5</span>
      </footer>
      <small>Doanh thu: {formatMoney(row.revenue)}</small>
    </article>
  )
}

function ProofPanel({ title, src, empty }: { title: string; src: string; empty: string }) {
  return (
    <div className="report-info-panel proof">
      <div className="report-info-panel-head"><strong>{title}</strong></div>
      {src ? <img className="report-proof-image" src={src} alt={title} /> : <div className="report-info-textbox">{empty}</div>}
    </div>
  )
}

function TextPanel({ title, text }: { title: string; text: string }) {
  return (
    <div className="report-info-panel proof">
      <div className="report-info-panel-head"><strong>{title}</strong></div>
      <div className="report-info-textbox">{text}</div>
    </div>
  )
}

function buildDailyReport(
  user: AppUser,
  movements: StockMovement[],
  sessions: BagShiftSession[],
  allocations: BagAllocation[],
  businessDate: string,
): DailyReportModel {
  const branchName = BRANCHES.find((item) => item.id === user.branchId)?.name || user.branchId
  const todayMovements = movements.filter((item) => item.branchId === user.branchId && item.shiftDate === businessDate)
  const todaySessions = sessions
    .filter((item) => item.branchId === user.branchId && item.businessDate === businessDate)
    .sort((a, b) => a.sequence - b.sequence || a.startedAt.localeCompare(b.startedAt))
  const sessionIds = new Set(todaySessions.map((item) => item.id))
  const todayAllocations = allocations
    .filter((item) => item.branchId === user.branchId)
    .filter((item) => !sessionIds.size || sessionIds.has(item.shiftId) || Boolean(item.settlementShiftId && sessionIds.has(item.settlementShiftId)))
  const productRows = buildProductReportRows(todayAllocations)
  const employeeRows = buildEmployeeRows(todayAllocations)
  const batchRows = buildBatchRows(todayMovements)
  const inboundRows = groupProductQuantities(todayMovements.filter((item) => item.type === 'inbound'))
  const packingRows = groupProductQuantities(todayMovements.filter((item) => item.type === 'packing_in'))
  const wasteRows = buildWasteRows(todayMovements)
  const stockRows = buildStockRows(movements, user.branchId, businessDate)
  const salesEmployees = summarizeEmployeeBagSales(todayAllocations)
  const totalIssued = productRows.reduce((sum, item) => sum + item.issued, 0)
  const totalSold = productRows.reduce((sum, item) => sum + item.sold, 0)
  const totalReturned = productRows.reduce((sum, item) => sum + item.returned, 0)
  const totalDamaged = productRows.reduce((sum, item) => sum + item.damaged, 0)
  const totalRevenue = productRows.reduce((sum, item) => sum + item.revenue, 0)
  const commission = salesEmployees.reduce((sum, item) => sum + item.commission, 0)
  const processingRawKg = batchRows.reduce((sum, item) => sum + item.raw, 0)
  const processingCookedKg = batchRows.reduce((sum, item) => sum + item.cooked, 0)
  const processingLossKg = batchRows.reduce((sum, item) => sum + item.loss, 0)
  const processingLossRate = processingRawKg ? roundPercent(processingLossKg / processingRawKg * 100) : 0
  const salesRate = totalIssued ? Math.round(totalSold / totalIssued * 100) : 0
  const teamTarget = Math.max(COMMISSION_MIN_BAGS, Math.max(1, employeeRows.length) * COMMISSION_MIN_BAGS)
  const teamKpi = Math.min(100, Math.round(totalSold / teamTarget * 100))
  const grade = teamKpi >= 90 ? 'Xuất sắc' : teamKpi >= 70 ? 'Ổn định' : teamKpi >= 40 ? 'Cần cải thiện' : 'Thiếu dữ liệu'
  const closedShiftCount = todaySessions.filter((item) => item.status === 'closed').length
  const openShiftCount = todaySessions.filter((item) => item.status === 'open').length
  const outstandingCount = todayAllocations.filter((item) => !item.settledAt).length
  const leaderNames = unique(todaySessions.map((item) => item.leaderName).filter(Boolean))
  const morningLeaderName = todaySessions.find((item) => item.sequence === 1)?.leaderName || ''
  const eveningLeaderName = todaySessions.find((item) => item.sequence === 2)?.leaderName || ''
  const blockingIssues = [
    closedShiftCount < 2 ? `Cần đủ 2 ca (Ca sáng và Ca tối) đã bàn giao, hiện mới có ${closedShiftCount}/2.` : '',
    openShiftCount > 0 ? `Còn ${openShiftCount} ca đang mở.` : '',
    outstandingCount > 0 ? `Còn ${outstandingCount} lượt túi nhân viên chưa đối soát.` : '',
  ].filter(Boolean)
  const warnings = [
    !todayMovements.length && !todayAllocations.length ? 'Chưa thấy phát sinh kho hoặc sổ túi trong ngày này.' : '',
    !batchRows.length ? 'Chưa có mẻ chế biến, hãy kiểm tra lại nếu hôm nay có làm hàng.' : '',
    !inboundRows.length ? 'Chưa có phiếu nhập đầu ngày.' : '',
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
  }
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

function buildEmployeeRows(allocations: BagAllocation[]): EmployeeReportRow[] {
  const commissionRows = new Map(summarizeEmployeeBagSales(allocations).map((item) => [
    `${item.branchId}|${item.employeeId || normalizeName(item.employeeName)}`,
    item,
  ]))
  const rows = new Map<string, EmployeeReportRow & { productMap: Map<string, EmployeeProductRow> }>()
  allocations.forEach((allocation) => {
    const key = `${allocation.branchId}|${allocation.employeeId || normalizeName(allocation.employeeName)}`
    const commission = commissionRows.get(key)
    const current = rows.get(key) || {
      key,
      name: allocation.employeeName,
      issued: 0,
      sold: 0,
      returned: 0,
      damaged: 0,
      outstanding: 0,
      revenue: 0,
      commission: commission?.commission || 0,
      achievedCommission: commission?.achieved || false,
      kpi: 0,
      products: [],
      productMap: new Map<string, EmployeeProductRow>(),
    }
    const sold = soldQuantity(allocation)
    current.issued += allocation.issuedQuantity
    current.sold += sold
    current.returned += allocation.returnedQuantity
    current.damaged += allocation.damagedQuantity
    current.outstanding += allocation.settledAt ? 0 : allocation.issuedQuantity
    current.revenue += productSaleValues(allocation.productId, sold).revenue
    current.commission = commission?.commission || 0
    current.achievedCommission = commission?.achieved || false
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
  return Array.from(rows.values())
    .map(({ productMap, ...row }) => ({
      ...row,
      kpi: row.issued ? Math.min(100, Math.round(row.sold / row.issued * 100)) : 0,
      products: Array.from(productMap.values()).sort((a, b) => b.issued - a.issued),
    }))
    .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name, 'vi'))
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

function buildInfographicInventoryRows(report: DailyReportModel): [string, string][] {
  const chestnutCookedKg = report.batchRows
    .filter((item) => {
      const normalized = normalizeName(item.outputLabel)
      return normalized.includes('hat de') || normalized.includes('chestnut')
    })
    .reduce((sum, item) => sum + item.cooked, 0)
  const potatoCookedKg = report.batchRows
    .filter((item) => {
      const normalized = normalizeName(item.outputLabel)
      return normalized.includes('khoai') || normalized.includes('potato')
    })
    .reduce((sum, item) => sum + item.cooked, 0)
  const chestnutRemainKg = report.productRows
    .filter((item) => isChestnutBag(item.productId))
    .reduce((sum, item) => sum + item.remaining * item.weightKg, 0)
  const potatoRemainKg = report.productRows
    .filter((item) => item.productId.includes('potato'))
    .reduce((sum, item) => sum + item.remaining * item.weightKg, 0)

  return [
    ['Nguyên liệu sống', `${formatKg(report.totals.processingRawKg)} kg`],
    ['Thành phẩm chín', `${formatKg(report.totals.processingCookedKg)} kg`],
    ['Hạt dẻ chín để chia túi', `${formatKg(chestnutCookedKg)} kg chín`],
    ['Khoai lang chín để chia túi', `${formatKg(potatoCookedKg)} kg chín`],
    ['Dư hạt dẻ sau chia túi', `Dư / Remain: ${formatKg(chestnutRemainKg)} kg`],
    ['Dư khoai sau chia túi', `Dư / Remain: ${formatKg(potatoRemainKg)} kg`],
    ['Hủy hàng cuối ca', `${formatNumber(report.totals.damaged)} SP`],
  ]
}

function sumEmployeeProducts(row: EmployeeReportRow, predicate: (productId: string) => boolean) {
  return row.products
    .filter((item) => predicate(item.productId))
    .reduce((sum, item) => sum + item.sold, 0)
}

function isChestnutBag(productId: string) {
  return productId.includes('chestnut') || productId.includes('snow') || productId.includes('grilled')
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
  return PRODUCTS.find((item) => item.id === productId)
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

function getShiftProofImages(sessions: BagShiftSession[], branchId: string, businessDate: string) {
  const sorted = [...sessions]
    .filter((item) => item.businessDate === businessDate)
    .sort((a, b) => a.sequence - b.sequence)
  const opening = sorted.find((item) => item.openingPhotoUrl)?.openingPhotoUrl
    || getLocalImage(shiftPhotoKey(branchId, businessDate, 'opening'))
  const closing = [...sorted].reverse().find((item) => item.closingPhotoUrl)?.closingPhotoUrl
    || getLocalImage(shiftPhotoKey(branchId, businessDate, 'closing'))
  return { opening, closing }
}

function getLocalImage(key: string) {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
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
