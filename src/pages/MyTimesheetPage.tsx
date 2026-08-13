import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppUser, WorkShift } from '../types'
import { localDateKey } from '../lib/dates'
import {
  buildAttendanceDetailRows,
  fetchAttendanceRecords,
  fetchShiftRegistrations,
  fetchWorkShifts,
  withAttendanceReadDeadline,
  type AttendanceDetailRow,
} from '../lib/attendance'
import { fetchSalesReceiptsRange, type SalesReceipt } from '../lib/salesReceipts'
import { fetchKpiRevenueAdjustments, type KpiRevenueAdjustment } from '../lib/kpiRevenueAdjustments'
import { loadBranchKpiOverrides } from '../lib/branchKpiFormulas'
import { dailyKpiBonus, employeeCompetitionPeriodRevenueTarget, kpiRank } from '../lib/commission'
import { EARLY_CHECK_IN_MINUTES, usesEarlyCheckInRule } from '../lib/attendanceLateness'

// Trang Xem công (#my-timesheet): nhân viên xem tháng này mình làm những ngày nào,
// mỗi ngày mấy giờ — dạng lịch tháng bấm từng ngày, ưu tiên màn hình điện thoại.
// Chỉ đọc dữ liệu của CHÍNH MÌNH; không có thông tin lương.

interface Props {
  user: AppUser
}

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

const DAY_STATUS_LABELS: Record<AttendanceDetailRow['status'], string> = {
  completed: 'Đã hoàn thành',
  working: 'Đang làm',
  absent: 'Vắng',
  scheduled: 'Chưa tới ca',
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}`, lastDay }
}

function shiftMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + amount, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}

/** 7.5 → "7g30". Giờ lẻ làm tròn theo phút để nhân viên đọc là hiểu ngay. */
function formatHours(value: number) {
  const totalMinutes = Math.round(value * 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (!hours && !minutes) return '0g'
  if (!minutes) return `${hours}g`
  return `${hours}g${String(minutes).padStart(2, '0')}`
}

/**
 * Giờ nghiệp vụ luôn neo Asia/Ho_Chi_Minh (quy tắc §45). Máy đặt sai múi giờ mà
 * hiển thị theo giờ thiết bị thì bảng công lệch giờ so với ảnh đóng dấu.
 */
function formatClock(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatMoney(value: number) {
  return `${Math.round(value || 0).toLocaleString('vi-VN')}đ`
}

function formatPercent(value: number) {
  return `${(Math.round(value * 10) / 10).toLocaleString('vi-VN')}%`
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/** Hóa đơn/khoản bổ sung có phải của chính người đang xem không. */
function isOwnReceipt(receipt: SalesReceipt, user: AppUser) {
  return receipt.sellerId === user.id
    || receipt.sellerKey === user.id
    || receipt.createdBy === user.id
    || normalizeName(receipt.sellerName || '') === normalizeName(user.name)
}

/** Trang độc lập (#my-timesheet). Giữ lại để link cũ không gãy; điều hướng
 *  chính nay nằm trong tab "Xem công" của trang Chấm công. */
export function MyTimesheetPage({ user }: Props) {
  return (
    <div className="page tsheet-page">
      <MyTimesheetContent user={user} />
    </div>
  )
}

export function MyTimesheetContent({ user }: Props) {
  const todayKey = localDateKey()
  const [month, setMonth] = useState(() => todayKey.slice(0, 7))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState<AttendanceDetailRow[]>([])
  const [selectedDate, setSelectedDate] = useState(todayKey)
  // KPI của CHÍNH mình, hiển thị cùng bảng công để không phải mở thêm màn khác.
  const [myReceipts, setMyReceipts] = useState<SalesReceipt[]>([])
  const [myAdjustments, setMyAdjustments] = useState<KpiRevenueAdjustment[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { from, to } = monthBounds(month)
      // Mọi lệnh đọc phải có hạn chót cứng: supabase-js không tự timeout, một
      // request treo sẽ giữ màn hình ở "Đang tải…" vĩnh viễn (BUG-106/§36).
      const [workShifts, registrations, records] = await Promise.all([
        withAttendanceReadDeadline(() => fetchWorkShifts(user), 'khung ca').catch(() => [] as WorkShift[]),
        withAttendanceReadDeadline(() => fetchShiftRegistrations(user, { userId: user.id, from, to }), 'ca đã đăng ký'),
        withAttendanceReadDeadline(() => fetchAttendanceRecords(user, { userId: user.id, from, to }), 'công đã chấm'),
      ])
      const grace = new Map(workShifts.map((shift) => [shift.id, shift.graceMinutes]))
      setRows(buildAttendanceDetailRows(registrations, records, grace)
        .filter((row) => row.userId === user.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể tải dữ liệu công.')
    } finally {
      setLoading(false)
    }
  }, [user, month])

  /**
   * KPI tải riêng khỏi bảng công: thiếu doanh thu thì màn hình vẫn phải hiện đủ
   * giờ công, không được vì một lệnh đọc hỏng mà mất luôn cả trang.
   */
  const loadKpi = useCallback(async () => {
    if (!user.branchId) return
    const { from, to } = monthBounds(month)
    await loadBranchKpiOverrides(user).catch(() => null)
    const [receipts, adjustments] = await Promise.all([
      fetchSalesReceiptsRange(user, { branchIds: [user.branchId], from, to }).catch(() => [] as SalesReceipt[]),
      fetchKpiRevenueAdjustments(user, { branchIds: [user.branchId], from, to }).catch(() => [] as KpiRevenueAdjustment[]),
    ])
    setMyReceipts(receipts.filter((receipt) => isOwnReceipt(receipt, user)))
    setMyAdjustments(adjustments.filter((adjustment) => adjustment.employeeId === user.id))
  }, [user, month])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadKpi() }, [loadKpi])

  // Mở lại app / quay về tab là tải lại — cùng quy tắc với các màn nghiệp vụ khác.
  useEffect(() => {
    const reload = () => { void load(); void loadKpi() }
    const reloadWhenVisible = () => { if (document.visibilityState === 'visible') reload() }
    window.addEventListener('focus', reload)
    window.addEventListener('online', reload)
    document.addEventListener('visibilitychange', reloadWhenVisible)
    return () => {
      window.removeEventListener('focus', reload)
      window.removeEventListener('online', reload)
      document.removeEventListener('visibilitychange', reloadWhenVisible)
    }
  }, [load, loadKpi])

  const rowsByDate = useMemo(() => {
    const map = new Map<string, AttendanceDetailRow[]>()
    rows.forEach((row) => {
      map.set(row.workDate, [...(map.get(row.workDate) || []), row])
    })
    map.forEach((dayRows) => dayRows.sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart)))
    return map
  }, [rows])

  const summary = useMemo(() => {
    let totalHours = 0
    let workDays = 0
    let shifts = 0
    let late = 0
    rows.forEach((row) => {
      totalHours += row.totalHours
      workDays += row.workDayCredit
      if (row.attendanceRecordId) shifts += 1
      if (row.attendanceRecordId && row.lateMinutes > 0) late += 1
    })
    return {
      totalHours,
      workDays: Number(workDays.toFixed(2)),
      shifts,
      late,
      daysWorked: Array.from(rowsByDate.entries())
        .filter(([, dayRows]) => dayRows.some((row) => row.attendanceRecordId)).length,
      // Quy tắc công: ĐÃ ĐĂNG KÝ ca mà hết giờ vẫn không có bản ghi chấm công thì
      // ngày đó là VẮNG. Ngày không đăng ký ca thì để trống, không tính vắng.
      absent: Array.from(rowsByDate.entries())
        .filter(([, dayRows]) =>
          !dayRows.some((row) => row.attendanceRecordId)
          && dayRows.some((row) => row.status === 'absent'))
        .length,
    }
  }, [rows, rowsByDate])

  /** Doanh thu của tôi theo từng ngày nghiệp vụ (POS + khoản bổ sung lịch sử). */
  const revenueByDate = useMemo(() => {
    const map = new Map<string, number>()
    const add = (date: string, amount: number) => map.set(date, (map.get(date) || 0) + amount)
    myReceipts.forEach((receipt) => add(receipt.businessDate, receipt.totalAmount))
    myAdjustments.forEach((adjustment) => add(adjustment.businessDate, adjustment.amount))
    return map
  }, [myReceipts, myAdjustments])

  /** KPI cả tháng — dùng đúng công thức của trang Quản trị nên số không lệch. */
  const monthKpi = useMemo(() => {
    if (!user.branchId) return null
    const { from, to } = monthBounds(month)
    const revenue = Array.from(revenueByDate.values()).reduce((sum, value) => sum + value, 0)
    const target = employeeCompetitionPeriodRevenueTarget(
      user.branchId,
      user.role,
      user.employmentType,
      user.positionTitle || '',
      from,
      to,
    )
    const progress = target > 0 ? (revenue / target) * 100 : 0
    return { revenue, target, progress, rank: kpiRank(progress) }
  }, [user.branchId, user.role, user.employmentType, user.positionTitle, month, revenueByDate])

  /** KPI của đúng ngày đang chọn, kèm thưởng ngày theo chính sách daily-only. */
  const selectedKpi = useMemo(() => {
    if (!user.branchId || !selectedDate.startsWith(month)) return null
    const revenue = revenueByDate.get(selectedDate) || 0
    const target = employeeCompetitionPeriodRevenueTarget(
      user.branchId,
      user.role,
      user.employmentType,
      user.positionTitle || '',
      selectedDate,
      selectedDate,
    )
    const progress = target > 0 ? (revenue / target) * 100 : 0
    return {
      revenue,
      target,
      progress,
      rank: kpiRank(progress),
      bonus: dailyKpiBonus(progress, user.role, user.employmentType, user.positionTitle || ''),
    }
  }, [user.branchId, user.role, user.employmentType, user.positionTitle, selectedDate, month, revenueByDate])

  const { lastDay } = monthBounds(month)
  const [yearNumber, monthNumber] = month.split('-').map(Number)
  // Lịch bắt đầu Thứ Hai: getUTCDay() trả 0=CN nên dồn CN về cuối hàng.
  const leadingBlanks = (new Date(Date.UTC(yearNumber, monthNumber - 1, 1)).getUTCDay() + 6) % 7
  const dayCells = Array.from({ length: lastDay }, (_, index) => {
    const dateKey = `${month}-${String(index + 1).padStart(2, '0')}`
    const dayRows = rowsByDate.get(dateKey) || []
    const hours = dayRows.reduce((sum, row) => sum + row.totalHours, 0)
    const hasRecord = dayRows.some((row) => row.attendanceRecordId)
    const working = dayRows.some((row) => row.status === 'working')
    // Quy tắc công (chốt 10/08/2026):
    //  - có đăng ký + có chấm công  → đã làm / đang làm
    //  - có đăng ký + hết giờ vẫn không chấm công → VẮNG
    //  - có đăng ký + chưa tới giờ  → có lịch
    //  - KHÔNG đăng ký              → ô trống, không phải vắng
    const absent = !hasRecord && dayRows.some((row) => row.status === 'absent')
    const scheduled = !hasRecord && !absent && dayRows.length > 0
    const tone = working ? 'working' : hasRecord ? 'worked' : absent ? 'absent' : scheduled ? 'scheduled' : 'empty'
    return { dateKey, day: index + 1, dayRows, hours, tone }
  })

  const selectedRows = rowsByDate.get(selectedDate) || []
  const selectedInMonth = selectedDate.startsWith(month)

  function changeMonth(amount: number) {
    const nextMonth = amount === 0 ? todayKey.slice(0, 7) : shiftMonth(month, amount)
    setMonth(nextMonth)
    setSelectedDate(nextMonth === todayKey.slice(0, 7) ? todayKey : `${nextMonth}-01`)
  }

  return (
    <div className="tsheet-body">
      <header className="tsheet-head">
        <div>
          <span className="eyebrow dark">XEM CÔNG</span>
          <h2>Công của tôi · tháng {monthNumber}/{yearNumber}</h2>
        </div>
        <div className="tsheet-month-nav" aria-label="Chọn tháng">
          <button type="button" onClick={() => changeMonth(-1)} aria-label="Tháng trước">‹</button>
          <button type="button" className={month === todayKey.slice(0, 7) ? 'active' : ''} onClick={() => changeMonth(0)}>Tháng này</button>
          <button type="button" disabled={month >= todayKey.slice(0, 7)} onClick={() => changeMonth(1)} aria-label="Tháng sau">›</button>
        </div>
      </header>

      {error && <div className="feedback-bar error">{error}<button onClick={() => { setError(''); void load() }}>Thử lại</button></div>}

      <div className="tsheet-summary">
        <article><small>Tổng giờ</small><strong>{formatHours(summary.totalHours)}</strong></article>
        <article><small>Ngày có làm</small><strong>{summary.daysWorked}</strong></article>
        <article><small>Ngày công</small><strong>{summary.workDays}</strong></article>
        <article><small>Số ca</small><strong>{summary.shifts}</strong></article>
        <article className={summary.late ? 'warn' : ''}><small>Đi trễ</small><strong>{summary.late}</strong></article>
        <article className={summary.absent ? 'warn' : ''}><small>Vắng</small><strong>{summary.absent}</strong></article>
      </div>

      {monthKpi && monthKpi.target > 0 && (
        <section className="tsheet-kpi" aria-label={`KPI tháng ${monthNumber}/${yearNumber} của tôi`}>
          <div className="tsheet-kpi-head">
            <span className="eyebrow dark">KPI CỦA TÔI</span>
            <strong>{formatPercent(monthKpi.progress)} · Xếp loại {monthKpi.rank}</strong>
          </div>
          <div className="tsheet-kpi-stats">
            <article><small>Doanh thu tháng</small><b>{formatMoney(monthKpi.revenue)}</b></article>
            <article><small>Chỉ tiêu tháng</small><b>{formatMoney(monthKpi.target)}</b></article>
            <article className={monthKpi.progress >= 100 ? 'ok' : ''}>
              <small>{monthKpi.progress >= 100 ? 'Đã vượt' : 'Còn thiếu'}</small>
              <b>{formatMoney(Math.abs(monthKpi.target - monthKpi.revenue))}</b>
            </article>
          </div>
          <div className="tsheet-kpi-bar" role="img" aria-label={`Đạt ${formatPercent(monthKpi.progress)} chỉ tiêu tháng`}>
            <span style={{ width: `${Math.min(100, Math.max(0, monthKpi.progress))}%` }} />
          </div>
        </section>
      )}

      {loading ? (
        <p className="tsheet-loading">Đang tải công tháng {monthNumber}/{yearNumber}…</p>
      ) : (
        <section className="tsheet-calendar" aria-label={`Lịch công tháng ${monthNumber}/${yearNumber}`}>
          <div className="tsheet-weekdays">
            {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
          </div>
          <div className="tsheet-grid">
            {Array.from({ length: leadingBlanks }, (_, index) => <span key={`blank-${index}`} className="tsheet-blank" />)}
            {dayCells.map((cell) => (
              <button
                type="button"
                key={cell.dateKey}
                className={[
                  'tsheet-day',
                  `tone-${cell.tone}`,
                  cell.dateKey === selectedDate ? 'selected' : '',
                  cell.dateKey === todayKey ? 'today' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setSelectedDate(cell.dateKey)}
                aria-pressed={cell.dateKey === selectedDate}
              >
                <b>{cell.day}</b>
                {cell.tone === 'worked' && <small>{formatHours(cell.hours)}</small>}
                {cell.tone === 'working' && <small>đang làm</small>}
                {cell.tone === 'scheduled' && <small>có lịch</small>}
                {cell.tone === 'absent' && <small>vắng</small>}
              </button>
            ))}
          </div>
          <div className="tsheet-legend">
            <span className="tone-worked">Đã làm (kèm số giờ)</span>
            <span className="tone-working">Đang trong ca</span>
            <span className="tone-scheduled">Có lịch</span>
            <span className="tone-absent">Vắng</span>
            <span className="tone-empty">Không đăng ký ca</span>
          </div>
          <p className="tsheet-rule" role="note">
            Đã đăng ký ca mà hết giờ không chấm công thì ngày đó tính <b>vắng</b>. Ngày không đăng ký ca để trống, không tính vắng.
          </p>
        </section>
      )}

      {!loading && (
        <section className="tsheet-detail" aria-label="Chi tiết ngày đã chọn">
          <h2>
            {selectedInMonth
              ? `Ngày ${selectedDate.slice(8)}/${selectedDate.slice(5, 7)}`
              : 'Chọn một ngày trên lịch'}
          </h2>
          {selectedInMonth && selectedKpi && selectedKpi.target > 0 && (
            <div className={`tsheet-day-kpi${selectedKpi.progress >= 100 ? ' achieved' : ''}`}>
              <span><small>Doanh thu ngày</small><b>{formatMoney(selectedKpi.revenue)}</b></span>
              <span><small>Chỉ tiêu ngày</small><b>{formatMoney(selectedKpi.target)}</b></span>
              <span><small>Đạt</small><b>{formatPercent(selectedKpi.progress)}</b></span>
              <span><small>Thưởng ngày</small><b>{selectedKpi.bonus ? formatMoney(selectedKpi.bonus) : '—'}</b></span>
            </div>
          )}
          {selectedInMonth && !selectedRows.length && (
            <p className="empty-copy">Ngày này bạn không đăng ký ca nên để trống — không bị tính vắng.</p>
          )}
          {selectedInMonth && selectedRows.map((row) => (
            <article key={`${row.registrationId}-${row.attendanceRecordId || 'scheduled'}`} className={`tsheet-shift status-${row.status}`}>
              <header>
                <strong>Ca {row.scheduledStart}–{row.scheduledEnd}</strong>
                <span className={`tsheet-status status-${row.status}`}>{DAY_STATUS_LABELS[row.status]}</span>
              </header>
              <div className="tsheet-shift-times">
                <span><small>Vào</small><b>{formatClock(row.checkInTime)}</b></span>
                <span><small>Ra</small><b>{formatClock(row.checkOutTime)}</b></span>
                <span><small>Tổng giờ</small><b>{row.totalHours > 0 ? formatHours(row.totalHours) : '—'}</b></span>
              </div>
              {row.lateMinutes > 0 && (
                <p className="tsheet-late">
                  {usesEarlyCheckInRule(row.workDate)
                    ? `Đi trễ ${row.lateMinutes} phút — ca này phải check-in trước giờ vào ${EARLY_CHECK_IN_MINUTES} phút.`
                    : `Đi trễ ${row.lateMinutes} phút so với giờ vào ca.`}
                </p>
              )}
              {row.note && <p className="tsheet-note">{row.note}</p>}
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
