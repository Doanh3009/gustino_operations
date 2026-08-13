/**
 * TỔNG QUAN — Control Center của hôm nay (§12–§20).
 *
 * Trang này trả lời đúng MỘT câu hỏi: "Hôm nay hệ thống đang vận hành như thế
 * nào và có gì cần chú ý?". Vì vậy nó KHÔNG phải nơi xem chi tiết bill, không
 * phải nơi đổ mọi dữ liệu hệ thống ra màn hình.
 *
 * Những gì bản cũ có mà bản này không hiển thị trực tiếp — 30 bill gần đây,
 * danh sách hao hụt đầy đủ, danh sách người đang online — KHÔNG bị xoá: bill rút
 * còn 5 dòng kèm lối "Xem tất cả giao dịch", hao hụt trở thành dòng "Cần xử lý"
 * dẫn sang màn Kho, online thành chip nhỏ ở header mở popover (§19, §20, §86).
 */
import { useMemo, useState } from 'react'
import {
  AttentionList,
  DataList,
  DataRow,
  EmptyState,
  Metric,
  MetricRow,
  PageHeader,
  RankBar,
  SectionHeader,
  StatusBadge,
  Surface,
  type AttentionItem,
} from '../../components/ui'
import { roleLabel } from '../../lib/access'
import { branchTeamPeriodRevenueTarget, employeeCompetitionPeriodRevenueTarget } from '../../lib/commission'
import { formatQuantity, formatStockAmount } from '../../lib/inventoryEntry'
import type { SalesReceipt } from '../../lib/salesReceipts'
import type { ActiveUserSession, EmployeeProfile, Product } from '../../types'

export interface OverviewStockLine {
  branchId: string
  product: Product
  expected: number
}

export interface OverviewOpenShift {
  sessionId: string
  branchId: string
  businessDate: string
  sequence: number
}

export interface OverviewAttendanceIssue {
  key: string
  employeeName: string
  branchId: string
  workDate: string
}

export interface OverviewWasteRow {
  branchId: string
  productId: string
  productName: string
  count: number
  quantity: number
  unit: string
}

interface Props {
  from: string
  to: string
  /** Hôm nay theo giờ máy — để phân biệt "hôm nay" với "một ngày trong quá khứ". */
  todayKey: string
  branches: Array<{ id: string; name: string }>
  /** Doanh thu đã tổng hợp theo ngày × chi nhánh (nguồn duy nhất, không tự cộng lại). */
  revenueRows: Array<{ branchId: string; reportDate: string; revenue: number; totalSold: number }>
  receipts: SalesReceipt[]
  employees: EmployeeProfile[]
  stockLines: OverviewStockLine[]
  openShifts: OverviewOpenShift[]
  attendanceIssues: OverviewAttendanceIssue[]
  pendingRequestCount: number
  wasteRows: OverviewWasteRow[]
  activeUsers: ActiveUserSession[]
  showActiveUsers: boolean
  branchName: (branchId: string) => string
  onOpenSection: (section: 'revenue' | 'inventory' | 'attendance' | 'requests' | 'commission') => void
}

export function DashboardPage(props: Props) {
  const {
    from, to, todayKey, branches, revenueRows, receipts, employees, stockLines,
    openShifts, attendanceIssues, pendingRequestCount, wasteRows,
    activeUsers, showActiveUsers, branchName, onOpenSection,
  } = props
  const [onlineOpen, setOnlineOpen] = useState(false)

  const singleDay = from === to
  const isToday = singleDay && to === todayKey

  /* ── Quick metrics (§14) ───────────────────────────────────────────────── */

  const revenue = revenueRows.reduce((sum, row) => sum + row.revenue, 0)
  const rangeReceipts = useMemo(
    () => receipts.filter((receipt) => receipt.businessDate >= from && receipt.businessDate <= to),
    [receipts, from, to],
  )

  /**
   * So sánh với kỳ liền trước CÙNG ĐỘ DÀI. Dữ liệu hóa đơn chỉ được nạp từ đầu
   * tháng của `from`, nên kỳ trước có thể nằm ngoài vùng đã tải — khi đó KHÔNG
   * hiển thị phần trăm nào thay vì bịa ra một con số (§4.2 dự án, §90).
   */
  const previous = useMemo(() => {
    const spanDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
    const prevTo = shiftDateKey(from, -1)
    const prevFrom = shiftDateKey(prevTo, -(spanDays - 1))
    const loadedFrom = receipts.reduce<string>((min, receipt) => receipt.businessDate < min ? receipt.businessDate : min, from)
    if (!receipts.length || prevFrom < loadedFrom) return null
    const rows = receipts.filter((receipt) => receipt.businessDate >= prevFrom && receipt.businessDate <= prevTo)
    return {
      label: singleDay ? 'so với hôm qua' : 'so với kỳ trước',
      revenue: rows.reduce((sum, receipt) => sum + receipt.totalAmount, 0),
      orders: rows.length,
    }
  }, [receipts, from, to, singleDay])

  const currentPosRevenue = rangeReceipts.reduce((sum, receipt) => sum + receipt.totalAmount, 0)
  const revenueDelta = previous ? { rate: pctChange(currentPosRevenue, previous.revenue), label: previous.label } : null
  const orderDelta = previous ? { rate: pctChange(rangeReceipts.length, previous.orders), label: previous.label } : null

  /* ── Tình hình chi nhánh (§15) ─────────────────────────────────────────── */

  const branchRows = useMemo(() => branches.map((branch) => {
    const rows = revenueRows.filter((row) => row.branchId === branch.id)
    const branchRevenue = rows.reduce((sum, row) => sum + row.revenue, 0)
    const target = branchTeamPeriodRevenueTarget(branch.id, from, to)
    const outOfStock = stockLines.filter((line) => line.branchId === branch.id && line.expected <= 0.0001).length
    const negative = stockLines.filter((line) => line.branchId === branch.id && line.expected < -0.0001).length
    const unclosed = openShifts.filter((shift) => shift.branchId === branch.id).length
    return {
      id: branch.id,
      name: branch.name,
      revenue: branchRevenue,
      target,
      progress: target > 0 ? branchRevenue / target * 100 : 0,
      alerts: outOfStock + unclosed + negative,
    }
  }).sort((a, b) => b.revenue - a.revenue), [branches, revenueRows, stockLines, openShifts, from, to])

  const targetTotal = branchRows.reduce((sum, row) => sum + row.target, 0)
  const kpiProgress = targetTotal > 0 ? revenue / targetTotal * 100 : 0
  const activeBranchCount = branchRows.filter((row) => row.revenue > 0).length
  const branchesNeedingAttention = branchRows.filter((row) => row.alerts > 0).length

  /* ── Cần xử lý (§17): actionable item, không phải dữ liệu thô ──────────── */

  const attention = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = []
    stockLines
      .filter((line) => line.expected < -0.0001)
      .slice(0, 6)
      .forEach((line) => items.push({
        id: `neg-${line.branchId}-${line.product.id}`,
        severity: 'bad',
        kind: `Âm kho ${formatStockAmount(Math.abs(line.expected), line.product.unit)}`,
        where: `${line.product.name} · ${branchName(line.branchId)}`,
        actionLabel: 'Kiểm tra',
        onAction: () => onOpenSection('inventory'),
      }))
    stockLines
      .filter((line) => line.expected >= -0.0001 && line.expected <= 0.0001)
      .slice(0, 6)
      .forEach((line) => items.push({
        id: `out-${line.branchId}-${line.product.id}`,
        severity: 'bad',
        kind: 'Hết hàng',
        where: `${line.product.name} · ${branchName(line.branchId)}`,
        actionLabel: 'Xem',
        onAction: () => onOpenSection('inventory'),
      }))
    openShifts.slice(0, 4).forEach((shift) => items.push({
      id: `shift-${shift.sessionId}`,
      severity: 'warn',
      kind: `Ca ${shift.sequence} chưa bàn giao`,
      where: `${branchName(shift.branchId)} · ${formatDate(shift.businessDate)}`,
      actionLabel: 'Xử lý',
      onAction: () => onOpenSection('inventory'),
    }))
    attendanceIssues.slice(0, 4).forEach((issue) => items.push({
      id: `att-${issue.key}`,
      severity: 'warn',
      kind: 'Chấm công tự đóng · cần rà soát',
      where: `${issue.employeeName} · ${branchName(issue.branchId)} · ${formatDate(issue.workDate)}`,
      actionLabel: 'Xử lý',
      onAction: () => onOpenSection('attendance'),
    }))
    wasteRows
      .slice()
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 3)
      .forEach((row) => items.push({
        id: `waste-${row.branchId}-${row.productId}`,
        severity: 'warn',
        kind: `Hao hụt ${formatQuantity(row.quantity)} ${row.unit}`,
        where: `${row.productName} · ${branchName(row.branchId)} · ${row.count} lượt ghi nhận`,
        actionLabel: 'Xem',
        onAction: () => onOpenSection('inventory'),
      }))
    if (pendingRequestCount > 0) items.push({
      id: 'requests-pending',
      severity: 'info',
      kind: `${pendingRequestCount} đơn đặt hàng chờ xác nhận`,
      where: 'Yêu cầu nhập hàng từ các chi nhánh',
      actionLabel: 'Xem',
      onAction: () => onOpenSection('requests'),
    })
    return items
  }, [stockLines, openShifts, attendanceIssues, wasteRows, pendingRequestCount, branchName, onOpenSection])

  /* ── Thi đua (§18): top 5 thật, không phải banner rỗng ─────────────────── */

  const topSellers = useMemo(() => {
    const rows = new Map<string, { name: string; branchId: string; revenue: number; employee?: EmployeeProfile }>()
    rangeReceipts.forEach((receipt) => {
      const key = `${receipt.branchId}|${receipt.sellerId || normalizeName(receipt.sellerName || '')}`
      if (!receipt.sellerName) return
      const current = rows.get(key) || {
        name: receipt.sellerName,
        branchId: receipt.branchId,
        revenue: 0,
        employee: employees.find((item) =>
          item.branchId === receipt.branchId
          && (item.id === receipt.sellerId || normalizeName(item.name) === normalizeName(receipt.sellerName)),
        ),
      }
      current.revenue += receipt.totalAmount
      rows.set(key, current)
    })
    return Array.from(rows.values())
      .map((row) => {
        const target = row.employee
          ? employeeCompetitionPeriodRevenueTarget(row.branchId, row.employee.role, row.employee.employmentType, row.employee.positionTitle, from, to)
          : 0
        return { ...row, target, progress: target > 0 ? row.revenue / target * 100 : null }
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
  }, [rangeReceipts, employees, from, to])

  const recentBills = useMemo(
    () => rangeReceipts.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    [rangeReceipts],
  )
  const maxBranchRevenue = Math.max(1, ...branchRows.map((row) => row.revenue))

  return (
    <div className="gt-page">
      <PageHeader
        title="TỔNG QUAN"
        subtitle={isToday
          ? `Tình hình vận hành hôm nay · ${formatDate(to)}`
          : singleDay
            ? `Tình hình vận hành ngày ${formatDate(to)}`
            : `Tình hình vận hành ${formatDate(from)} → ${formatDate(to)}`}
        actions={showActiveUsers ? (
          <div className="gt-overflow">
            <button
              type="button"
              className="gt-btn gt-btn--secondary"
              aria-expanded={onlineOpen}
              onClick={() => setOnlineOpen((current) => !current)}
            >● {activeUsers.length} online</button>
            {onlineOpen && (
              <div className="gt-overflow__panel" style={{ minWidth: 280, padding: 0 }}>
                {activeUsers.length ? activeUsers.map((session) => (
                  <div className="gt-attention__row" key={session.userId} style={{ gridTemplateColumns: '1fr auto' }}>
                    <span className="gt-attention__body">
                      <strong>{session.userName}</strong>
                      <small>{roleLabel(session.role)} · {branchName(session.branchId)}</small>
                    </span>
                    <time className="gt-section-count">
                      {new Date(session.lastSeenAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </div>
                )) : <EmptyState title="Chưa có ai truy cập" description="Không có phiên nào trong 2 phút gần đây." />}
              </div>
            )}
          </div>
        ) : undefined}
      />

      <MetricRow>
        <Metric
          label={isToday ? 'Doanh thu hôm nay' : 'Doanh thu'}
          value={formatCompactMoney(revenue)}
          delta={revenueDelta}
          hint={revenueDelta ? undefined : 'Chưa đủ dữ liệu kỳ trước để so sánh'}
        />
        <Metric
          label="Đơn hàng"
          value={rangeReceipts.length.toLocaleString('vi-VN')}
          delta={orderDelta}
          hint={orderDelta ? undefined : 'Hóa đơn POS trong kỳ'}
        />
        <Metric
          label="Tiến độ KPI"
          value={targetTotal > 0 ? `${kpiProgress.toFixed(0)}%` : '—'}
          hint={targetTotal > 0 ? `${formatCompactMoney(revenue)} / ${formatCompactMoney(targetTotal)}` : 'Chưa cấu hình chỉ tiêu chi nhánh'}
        />
        <Metric
          label="Chi nhánh"
          value={`${activeBranchCount}/${branches.length} hoạt động`}
          hint={branchesNeedingAttention ? `${branchesNeedingAttention} nơi cần chú ý` : 'Không có cảnh báo'}
        />
      </MetricRow>

      <Surface>
        <SectionHeader
          title="Cần xử lý"
          description="Việc phải làm ngay, kèm nơi phát sinh và mức độ."
          count={attention.length ? `${attention.length} việc` : undefined}
        />
        <AttentionList items={attention} />
      </Surface>

      <Surface>
        <SectionHeader title="Tình hình chi nhánh" count={`${branchRows.length} điểm bán`} />
        <DataList columns="minmax(0, 2fr) minmax(0, 1.6fr) minmax(0, 1fr) auto">
          {branchRows.map((row) => (
            <DataRow key={row.id}>
              <span data-gt-primary>
                <strong>{row.name}</strong>
                <small>{row.target > 0 ? `Chỉ tiêu ${formatCompactMoney(row.target)}` : 'Chưa có chỉ tiêu'}</small>
              </span>
              <span data-gt-span>
                <span className="gt-rank__track">
                  <span
                    className={`gt-rank__fill${row.progress >= 100 ? '' : row.progress >= 80 ? ' is-info' : ' is-warn'}`}
                    style={{ width: `${Math.max(2, Math.min(100, row.revenue / maxBranchRevenue * 100)).toFixed(1)}%` }}
                  />
                </span>
              </span>
              <span className="gt-cell--num" data-gt-label="Doanh thu">
                <b>{formatCompactMoney(row.revenue)}</b>
                {row.target > 0 && <small>{row.progress.toFixed(0)}% KPI</small>}
              </span>
              <span data-gt-trailing>
                {row.alerts
                  ? <StatusBadge tone="warn">{row.alerts} cảnh báo</StatusBadge>
                  : <StatusBadge tone="good">Bình thường</StatusBadge>}
              </span>
            </DataRow>
          ))}
          {!branchRows.length && <EmptyState title="Chưa có chi nhánh" description="Không có chi nhánh nào trong phạm vi quản lý." />}
        </DataList>
      </Surface>

      <div className="gt-overview-split">
        <Surface>
          <SectionHeader
            title="Thi đua hôm nay"
            aside={<button type="button" className="gt-btn gt-btn--ghost gt-btn--sm" onClick={() => onOpenSection('commission')}>Xem bảng thi đua →</button>}
          />
          <div className="gt-pad" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gt-4)' }}>
            {topSellers.map((row, index) => (
              <RankBar
                key={`${row.branchId}-${row.name}`}
                name={`${index + 1}. ${row.name}`}
                value={formatMoney(row.revenue)}
                meta={`${branchName(row.branchId)}${row.progress !== null ? ` · KPI ${row.progress.toFixed(0)}%` : ''}`}
                share={row.revenue / Math.max(1, topSellers[0]?.revenue || 1)}
                tone={row.progress !== null && row.progress >= 100 ? 'brand' : 'info'}
              />
            ))}
            {!topSellers.length && <EmptyState title="Chưa có doanh số" description="Chưa có hóa đơn nào trong khoảng đang chọn." />}
          </div>
        </Surface>

        <Surface>
          <SectionHeader
            title="Hoạt động gần đây"
            aside={<button type="button" className="gt-btn gt-btn--ghost gt-btn--sm" onClick={() => onOpenSection('revenue')}>Xem tất cả giao dịch →</button>}
          />
          <DataList columns="52px minmax(0, 1fr) auto">
            {recentBills.map((receipt) => (
              <DataRow key={receipt.id}>
                <time className="gt-section-count">{formatTime(receipt.createdAt)}</time>
                <span data-gt-primary>
                  <strong>{receipt.code || 'Bill POS'}</strong>
                  <small>{branchName(receipt.branchId)}{receipt.sellerName ? ` · ${receipt.sellerName}` : ''}</small>
                </span>
                <span className="gt-cell--num" data-gt-trailing><b>{formatMoney(receipt.totalAmount)}</b></span>
              </DataRow>
            ))}
            {!recentBills.length && <EmptyState title="Không có giao dịch" description="Chưa phát sinh hóa đơn trong khoảng thời gian này." />}
          </DataList>
        </Surface>
      </div>
    </div>
  )
}

function pctChange(current: number, base: number) {
  if (base > 0) return (current - base) / base * 100
  return current > 0 ? 100 : 0
}

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-')
  return day && month && year ? `${day}/${month}/${year}` : value
}

function formatTime(createdAt: string) {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

/** 127.600.000 → "127,6tr". Số lớn trên dashboard đọc nhanh hơn ở dạng rút gọn. */
function formatCompactMoney(value: number) {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}tr`
  return formatMoney(value)
}
