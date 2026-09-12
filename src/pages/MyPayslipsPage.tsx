import { useEffect, useState } from 'react'
import { fetchOwnPublishedPayslips, markOwnPayslipViewed, type PayrollEntry } from '../lib/payroll'
import type { AppUser } from '../types'

export function MyPayslipsPage({ user }: { user: AppUser }) {
  const [entries, setEntries] = useState<PayrollEntry[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
      const first = rows.find((entry) => entry.period === requestedPeriod) || rows[0]
      if (first?.id) {
        setSelectedId(first.id)
        if (!first.employeeViewedAt) void markOwnPayslipViewed(user, first.id).then(() => {
          if (active) setEntries((current) => current.map((entry) => entry.id === first.id ? { ...entry, employeeViewedAt: new Date().toISOString() } : entry))
        }).catch(() => undefined)
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

  const selected = entries.find((entry) => entry.id === selectedId) || entries[0]

  function openEntry(entry: PayrollEntry) {
    if (!entry.id) return
    setSelectedId(entry.id)
    if (entry.employeeViewedAt) return
    void markOwnPayslipViewed(user, entry.id).then(() => {
      setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, employeeViewedAt: new Date().toISOString() } : item))
    }).catch(() => undefined)
  }

  return <section className="my-payslips-page">
    <header className="payslip-header"><div><span className="eyebrow dark">THÔNG TIN CÁ NHÂN</span><h1>Phiếu lương của tôi</h1><p>Chỉ bạn và Admin hệ thống có thể xem các phiếu lương này.</p></div></header>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {loading ? <p className="empty-copy">Đang tải phiếu lương…</p> : !entries.length ? <div className="my-payslips-empty"><span aria-hidden="true">▤</span><h2>Chưa có phiếu lương</h2><p>Phiếu lương sẽ xuất hiện tại đây sau khi Admin gửi.</p></div> : <div className="my-payslips-layout">
      <aside className="my-payslips-list" aria-label="Danh sách phiếu lương">
        {entries.map((entry) => <button type="button" key={entry.id || entry.period} className={selected?.id === entry.id ? 'active' : ''} onClick={() => openEntry(entry)}>
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
