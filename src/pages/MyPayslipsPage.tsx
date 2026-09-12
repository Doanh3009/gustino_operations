import { useEffect, useState } from 'react'
import { confirmOwnPayslip, fetchOwnPublishedPayslips, markOwnPayslipViewed, type PayrollEntry } from '../lib/payroll'
import type { AppUser } from '../types'
import { localDateKey } from '../lib/dates'

export function MyPayslipsPage({ user }: { user: AppUser }) {
  const [entries, setEntries] = useState<PayrollEntry[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [period, setPeriod] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [confirmationError, setConfirmationError] = useState('')
  const [viewedError, setViewedError] = useState('')

  useEffect(() => {
    let active = true
    let initial = true
    let reading = false
    const refresh = () => {
      if (reading) return
      reading = true
      void fetchOwnPublishedPayslips(user).then((rows) => {
      if (!active) return
      setEntries(rows)
      setError('')
      if (!initial) {
        setSelectedId((current) => rows.some((entry) => entry.id === current) ? current : rows[0]?.id || '')
        return
      }
      initial = false
      let requestedPeriod = ''
      try {
        requestedPeriod = sessionStorage.getItem('gustino:selected-payslip-period') || ''
        sessionStorage.removeItem('gustino:selected-payslip-period')
      } catch { /* private mode */ }
      if (requestedPeriod) setPeriod(requestedPeriod)
      const first = rows.find((entry) => entry.period === requestedPeriod) || rows[0]
      if (first?.id) {
        setSelectedId(first.id)
      }
      setLoading(false)
    }).catch((reason) => {
      if (!active) return
      setError(reason instanceof Error ? reason.message : 'Không thể tải phiếu lương.')
      setEntries([])
      setLoading(false)
    }).finally(() => { reading = false })
    }
    refresh()
    const timer = window.setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [user.id, user.role, user.authToken])

  const filteredEntries = period ? entries.filter((entry) => entry.period === period) : entries
  const [year, month] = localDateKey().slice(0, 7).split('-').map(Number)
  const recentPeriods = Array.from({ length: 24 }, (_, offset) => {
    const date = new Date(year, month - 1 - offset, 1)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  })
  const periodOptions = Array.from(new Set([...recentPeriods, ...entries.map((entry) => entry.period)])).sort().reverse()
  const selected = filteredEntries.find((entry) => entry.id === selectedId) || filteredEntries[0]

  useEffect(() => {
    setViewedError('')
    if (!selected?.id || selected.employeeViewedAt) return
    let active = true
    const entry = selected
    void markOwnPayslipViewed(user, entry.id!).then(() => {
      if (active) setEntries((current) => current.map((item) => item.id === entry.id && item.publishedAt === entry.publishedAt ? { ...item, employeeViewedAt: new Date().toISOString() } : item))
    }).catch((reason) => {
      if (active) setViewedError(reason instanceof Error ? reason.message : 'Không thể ghi nhận đã xem phiếu lương. Thông báo chưa được xóa.')
    })
    return () => { active = false }
  }, [user.id, selected?.id, selected?.publishedAt, selected?.employeeViewedAt])

  function openEntry(entry: PayrollEntry) {
    if (!entry.id) return
    setSelectedId(entry.id)
    setConfirmationError('')
  }

  async function confirmSelected() {
    if (!selected || confirming || selected.employeeConfirmedAt) return
    const entry = selected
    setConfirming(true)
    setConfirmationError('')
    try {
      const confirmedAt = await confirmOwnPayslip(user, entry)
      setEntries((current) => current.map((item) => item.id === entry.id && item.publishedAt === entry.publishedAt ? { ...item, employeeConfirmedAt: confirmedAt } : item))
    } catch (reason) {
      setConfirmationError(reason instanceof Error ? reason.message : (reason as { message?: string } | null)?.message || 'Không thể xác nhận phiếu lương.')
    } finally {
      setConfirming(false)
    }
  }

  return <section className="my-payslips-page">
    <header className="payslip-header">
      <div><span className="eyebrow dark">THÔNG TIN CÁ NHÂN</span><h1>Phiếu lương của tôi</h1></div>
      <div className="payslip-filters my-payslip-month-filter">
        <label>Tháng<select value={period} disabled={confirming} onChange={(event) => { setPeriod(event.target.value); setSelectedId(''); setConfirmationError('') }}>
          <option value="">Tất cả tháng</option>
          {periodOptions.map((value) => <option key={value} value={value}>Tháng {value.slice(5)}/{value.slice(0, 4)}</option>)}
        </select></label>
        <button type="button" className="secondary-button" disabled={!period || confirming} onClick={() => { setPeriod(''); setSelectedId(''); setConfirmationError('') }}>Tất cả tháng</button>
      </div>
    </header>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {loading ? <p className="empty-copy">Đang tải phiếu lương…</p> : !filteredEntries.length ? <div className="my-payslips-empty"><span aria-hidden="true">▤</span><h2>{period ? `Chưa có phiếu lương tháng ${period.slice(5)}/${period.slice(0, 4)}` : 'Chưa có phiếu lương'}</h2><p>Phiếu lương tháng này đang được cập nhật. Vui lòng quay lại sau.</p></div> : <div className="my-payslips-layout">
      <aside className="my-payslips-list" aria-label="Danh sách phiếu lương">
        {filteredEntries.map((entry) => <button type="button" key={entry.id || entry.period} className={selected?.id === entry.id ? 'active' : ''} onClick={() => openEntry(entry)}>
          <span><strong>Tháng {entry.period.slice(5)}/{entry.period.slice(0, 4)}</strong><small>{entry.publishedAt ? `Gửi ngày ${formatDateTime(entry.publishedAt)}` : ''}</small></span>
          {!entry.employeeViewedAt && <i>Chưa xem</i>}
        </button>)}
      </aside>
      {selected && <article className="my-payslip-sheet">
        <header><div><span>PHIẾU LƯƠNG</span><h2>Tháng {selected.period.slice(5)}/{selected.period.slice(0, 4)}</h2></div><strong>{user.name}</strong></header>
        <div className="my-payslip-values">
          <PayslipValue label="Lương cơ bản" value={selected.baseSalary} />
          <PayslipValue label="Phụ cấp trách nhiệm" value={selected.responsibilityAllowance} />
          <PayslipValue label="Phụ cấp chuyên cần" value={selected.attendanceAllowance} />
          <PayslipValue label="Phụ cấp cơm và xăng xe" value={selected.mealTransportAllowance} />
          <PayslipValue label="Lương thỏa thuận" value={selected.agreedSalary} />
          <PayslipValue label="Lương 1 ngày công" value={selected.dailyRate} />
          <PayslipValue label="Lương theo ngày công tính lương" value={selected.workdaySalary} />
          <PayslipValue label="Số giờ làm thêm" value={selected.overtimeHours} money={false} />
          <PayslipValue label="Thưởng KPI" value={selected.kpiBonus} />
          <PayslipValue label="Lương thực lãnh" value={selected.netSalary} prominent />
        </div>
        {selected.note && <p className="my-payslip-note"><b>Ghi chú:</b> {selected.note}</p>}
        <footer className="my-payslip-confirmation">
          {viewedError && <p className="error-banner" role="alert">{viewedError}</p>}
          {confirmationError && <p className="error-banner" role="alert">{confirmationError}</p>}
          {selected.employeeConfirmedAt
            ? <p className="success-banner" role="status">Đã xác nhận phiếu lương · {formatDateTime(selected.employeeConfirmedAt)}</p>
            : <button type="button" className="primary-button" disabled={confirming || !selected.id} onClick={() => void confirmSelected()}>{confirming ? 'Đang xác nhận…' : 'Xác nhận phiếu lương'}</button>}
        </footer>
      </article>}
    </div>}
  </section>
}

function PayslipValue({ label, value, money = true, prominent = false }: { label: string; value: number | null; money?: boolean; prominent?: boolean }) {
  return <div className={prominent ? 'prominent' : ''}><span>{label}</span><strong>{value === null ? '—' : money ? formatMoney(value) : `${formatNumber(value)} giờ`}</strong></div>
}

function formatMoney(value: number) { return `${new Intl.NumberFormat('vi-VN').format(Math.round(value))}đ` }
function formatNumber(value: number) { return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value) }
function formatDateTime(value: string) { return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) }
