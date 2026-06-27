import { useEffect, useMemo, useState } from 'react'
import { BRANCHES } from '../lib/constants'
import { permittedBranchIds } from '../lib/attendance'
import { fetchMovements, fetchReportSnapshots } from '../lib/store'
import { fetchBagAllocations } from '../lib/shiftLedger'
import { buildDailyRevenueRows } from '../lib/revenue'
import { summarizeEmployeeBagSales } from '../lib/commission'
import type { AppUser, BagAllocation, ReportSnapshot, StockMovement } from '../types'
import type { Page } from '../components/AppShell'

export function ManagerDashboardPage({
  user,
  onNavigate,
}: {
  user: AppUser
  onNavigate: (page: Page, section?: string) => void
}) {
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [snapshots, setSnapshots] = useState<ReportSnapshot[]>([])
  const [allocations, setAllocations] = useState<BagAllocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const branchIds = permittedBranchIds(user)
  const branches = BRANCHES.filter((branch) => branchIds.includes(branch.id))
  const range = monthRange()

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      try {
        const [nextMovements, nextSnapshots, nextAllocations] = await Promise.all([
          Promise.all(branchIds.map(fetchMovements)).then((items) => items.flat()),
          Promise.all(branchIds.map(fetchReportSnapshots)).then((items) => items.flat()),
          Promise.all(branchIds.map((id) => fetchBagAllocations(user, { branchId: id }))).then((items) => items.flat()),
        ])
        if (!active) return
        setMovements(nextMovements)
        setSnapshots(nextSnapshots)
        setAllocations(nextAllocations)
        setError('')
      } catch (reason) {
        if (!active) return
        setError(reason instanceof Error ? reason.message : 'Không thể tải tổng quan quản lý.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [user.id, user.branchId])

  const revenueRows = useMemo(
    () => buildDailyRevenueRows(snapshots, allocations, movements, { from: range.from, to: range.to }),
    [snapshots, allocations, movements, range.from, range.to],
  )
  const branchRows = branches.map((branch) => {
    const rows = revenueRows.filter((row) => row.branchId === branch.id)
    return {
      branchId: branch.id,
      branchName: branch.name,
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
      sold: rows.reduce((sum, row) => sum + row.totalSold, 0),
      days: rows.length,
    }
  }).sort((a, b) => b.revenue - a.revenue)
  const totalRevenue = branchRows.reduce((sum, row) => sum + row.revenue, 0)
  const maxRevenue = Math.max(...branchRows.map((row) => row.revenue), 1)
  const employeeRows = summarizeEmployeeBagSales(allocations.filter((allocation) => {
    const date = (allocation.settledAt || allocation.issuedAt).slice(0, 10)
    return date >= range.from && date <= range.to && branchIds.includes(allocation.branchId)
  }))
  const employeeByBranch = branches.map((branch) => {
    const rows = employeeRows
      .filter((row) => row.branchId === branch.id && row.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
    return { branch, rows, total: rows.reduce((sum, row) => sum + row.revenue, 0) }
  })
  const topEmployee = employeeRows.slice().sort((a, b) => b.revenue - a.revenue)[0]

  return (
    <div className="page manager-dashboard-page">
      <div className="manager-dashboard-hero">
        <div>
          <span className="eyebrow dark">TỔNG QUAN QUẢN LÝ</span>
          <h1>Dashboard toàn chuỗi</h1>
          <p>So sánh doanh số cửa hàng và tỷ trọng doanh thu nhân viên theo từng khu vực trong tháng này.</p>
        </div>
        <div className="manager-dashboard-actions">
          <button onClick={() => onNavigate('management')}>Mở Quản lý</button>
          <button onClick={() => onNavigate('management', 'inventory')}>Kho</button>
          <button onClick={() => onNavigate('management', 'payroll')}>Lương</button>
        </div>
      </div>

      {error && <div className="feedback-bar">{error}<button onClick={() => setError('')}>×</button></div>}
      {loading ? (
        <section className="section-card">Đang tải tổng quan toàn chuỗi…</section>
      ) : (
        <>
          <section className="manager-kpi-grid">
            <article><span>Doanh thu tháng</span><strong>{formatMoney(totalRevenue)}</strong><small>{branchRows.length} cửa hàng</small></article>
            <article><span>Túi đã bán</span><strong>{formatNumber(branchRows.reduce((sum, row) => sum + row.sold, 0))}</strong><small>toàn chuỗi</small></article>
            <article><span>Nhân viên có doanh số</span><strong>{employeeRows.length}</strong><small>{topEmployee ? `Top: ${topEmployee.employeeName}` : 'chưa có dữ liệu'}</small></article>
          </section>

          <section className="dashboard-two-column">
            <div className="section-card dashboard-panel">
              <div className="section-title">
                <div><span className="eyebrow dark">SO SÁNH CỬA HÀNG</span><h2>Doanh số theo chi nhánh</h2></div>
              </div>
              <div className="branch-revenue-bars">
                {branchRows.map((row, index) => (
                  <article key={row.branchId}>
                    <span className="branch-rank">{index + 1}</span>
                    <div>
                      <strong>{row.branchName}</strong>
                      <div className="branch-bar"><span style={{ width: `${Math.max(4, row.revenue / maxRevenue * 100)}%` }} /></div>
                      <small>{row.days} ngày có doanh thu · {formatNumber(row.sold)} túi</small>
                    </div>
                    <b>{formatMoney(row.revenue)}</b>
                  </article>
                ))}
                {!branchRows.length && <p className="empty-copy">Chưa có dữ liệu doanh thu trong tháng này.</p>}
              </div>
            </div>

            <div className="section-card dashboard-panel">
              <div className="section-title">
                <div><span className="eyebrow dark">NHÂN VIÊN THEO KHU VỰC</span><h2>Tỷ trọng doanh số</h2></div>
              </div>
              <div className="employee-pie-list">
                {employeeByBranch.map(({ branch, rows, total }) => (
                  <article key={branch.id}>
                    <div className="employee-pie" style={{ background: pieGradient(rows.map((row) => row.revenue)) }}>
                      <span>{total ? Math.round(total / Math.max(totalRevenue, 1) * 100) : 0}%</span>
                    </div>
                    <div className="employee-pie-copy">
                      <strong>{branch.name}</strong>
                      <small>{formatMoney(total)}</small>
                      {rows.slice(0, 4).map((row, index) => (
                        <span key={`${row.branchId}-${row.employeeKey}`}>
                          <i style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />
                          {row.employeeName} · {formatMoney(row.revenue)}
                        </span>
                      ))}
                      {!rows.length && <span>Chưa có nhân viên phát sinh doanh số.</span>}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

const PIE_COLORS = ['#1688d8', '#a8d12d', '#ef6fcf', '#e2a600', '#a173ff', '#ff6d78']

function pieGradient(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (!total) return 'conic-gradient(#e7edf2 0 100%)'
  let cursor = 0
  const stops = values.map((value, index) => {
    const start = cursor
    const end = cursor + value / total * 100
    cursor = end
    return `${PIE_COLORS[index % PIE_COLORS.length]} ${start}% ${end}%`
  })
  return `conic-gradient(${stops.join(', ')})`
}

function monthRange(offset = 0) {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return { from: localDateKey(first), to: localDateKey(last) }
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatMoney(value: number) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)} tr`
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

function formatNumber(value: number) {
  return Number(value.toFixed(2)).toLocaleString('vi-VN')
}
