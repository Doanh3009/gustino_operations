import { useEffect, useMemo, useState } from 'react'
import { branchName, useConfiguredBranches } from '../lib/branches'
import { permittedBranchIds } from '../lib/attendance'
import { fetchReportSnapshots } from '../lib/store'
import { localDateKey } from '../lib/dates'
import { fetchSalesReceiptsRange, type SalesReceipt } from '../lib/salesReceipts'
import type { AppUser, ReportSnapshot } from '../types'

export function ReportArchivePage({ user }: { user: AppUser }) {
  return (
    <div className="page report-archive-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow dark">KHO BÁO CÁO</span>
          <h1>Bản lưu infographic đã chốt</h1>
        </div>
      </div>
      <ReportArchiveContent user={user} />
    </div>
  )
}

export function ReportArchiveContent({ user }: { user: AppUser }) {
  const today = localDateKey()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [day, setDay] = useState('')
  const [branchId, setBranchId] = useState(user.role === 'admin' || user.role === 'manager' ? '' : user.branchId)
  const [snapshots, setSnapshots] = useState<ReportSnapshot[]>([])
  const [receipts, setReceipts] = useState<SalesReceipt[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const branches = useConfiguredBranches({ includeInactive: true, user })
  const allowedBranchIds = permittedBranchIds(user)
  const branchOptions = branches.filter((branch) => allowedBranchIds.includes(branch.id))
  const canViewAllBranches = branchOptions.length > 1 && (user.role === 'admin' || user.role === 'manager')

  useEffect(() => {
    if (branchId === '' && canViewAllBranches) return
    if (branchId && allowedBranchIds.includes(branchId)) return
    setBranchId(canViewAllBranches ? '' : branchOptions[0]?.id || user.branchId)
  }, [allowedBranchIds.join('|'), branchId, branchOptions.length, canViewAllBranches, user.branchId])

  async function refresh(showLoading = false) {
    if (showLoading) setLoading(true)
    try {
      const ids = branchId ? [branchId] : allowedBranchIds
      const from = `${month}-01`
      const to = lastDayOfMonth(month)
      const [items, receiptRows] = await Promise.all([
        Promise.all(ids.map((id) => fetchReportSnapshots(id, user, { from, to }))).then((rows) => rows.flat()),
        fetchSalesReceiptsRange(user, { branchIds: ids, from, to }).catch(() => [] as SalesReceipt[]),
      ])
      setSnapshots(items)
      setReceipts(receiptRows)
      setFeedback('')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Không thể tải bản lưu báo cáo.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => { void refresh(true) }, [user.id, user.branchId, branchId, month])

  const filtered = useMemo(() => snapshots
    .filter((item) =>
      (!branchId || item.branchId === branchId)
      && (day ? item.reportDate === day : item.reportDate.startsWith(month)),
    )
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.createdAt.localeCompare(a.createdAt)),
  [snapshots, branchId, month, day])

  const groupedByDay = useMemo(() => {
    const map = new Map<string, ReportSnapshot[]>()
    filtered.forEach((item) => { map.set(item.reportDate, [...(map.get(item.reportDate) || []), item]) })
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  const selected = filtered.find((item) => item.id === selectedId) || filtered[0]
  const summary = selected?.payload.summary
  const dailyReport = selected?.payload.dailyReport as any
  const archiveEmployeeRows = useMemo(
    () => buildArchiveEmployeeRows(dailyReport?.employeeRows, receipts, selected),
    [dailyReport?.employeeRows, receipts, selected?.id],
  )
  const proofImages = Array.isArray(dailyReport?.proofImages)
    ? dailyReport.proofImages as Array<{ key?: string; label?: string; url?: string }>
    : [
        { key: 'opening', label: 'Đầu ca', url: selected?.payload.openingImage },
        { key: 'closing', label: 'Cuối ca', url: selected?.payload.closingImage },
      ]

  return (
    <div className="report-archive-content">
      {feedback && <div className="feedback-bar">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}

      <section className="my-record-filters report-archive-filters">
        <label>Chi nhánh
          <select value={branchId} onChange={(event) => { setBranchId(event.target.value); setSelectedId('') }}>
            {canViewAllBranches && <option value="">Tất cả chi nhánh</option>}
            {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        <label>Tháng<input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setDay(''); setSelectedId('') }} /></label>
        <label>Ngày<input type="date" value={day} onChange={(event) => {
          const value = event.target.value
          setDay(value)
          if (value) setMonth(value.slice(0, 7))
          setSelectedId('')
        }} /></label>
        {day && <button className="secondary-button" type="button" onClick={() => { setDay(''); setSelectedId('') }}>Xem cả tháng</button>}
        <button className="secondary-button" onClick={() => void refresh(true)}>Làm mới</button>
      </section>

      {loading ? <section className="section-card">Đang tải kho báo cáo...</section> : (
        <div className="report-archive-grid">
          <section className="section-card report-archive-list">
            <div className="section-title">
              <div><span className="eyebrow dark">BẢN LƯU</span><h2>{day ? formatDate(day) : formatMonth(month)}</h2></div>
              <span className="date-chip">{filtered.length}</span>
            </div>
            {groupedByDay.map(([date, items], index) => {
              const dayRevenue = items.reduce((sum, item) => sum + (item.payload.summary?.revenue || 0), 0)
              const hasSelected = items.some((item) => item.id === selected?.id)
              return (
                <details className="report-archive-day" key={date} open={index === 0 || hasSelected}>
                  <summary>
                    <span><strong>{formatDate(date)}</strong><small>{items.length} báo cáo</small></span>
                    <b>{formatMoney(dayRevenue)}</b>
                  </summary>
                  {items.map((item) => {
                    const itemSummary = item.payload.summary
                    return (
                      <button
                        className={selected?.id === item.id ? 'report-archive-row active' : 'report-archive-row'}
                        key={item.id}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <span><strong>{branchName(item.branchId, branches)}</strong><small>{itemSummary?.grade || 'Đã lưu'}</small></span>
                        <b>{formatMoney(itemSummary?.revenue || 0)}</b>
                      </button>
                    )
                  })}
                </details>
              )
            })}
            {!filtered.length && <p className="empty-copy">Chưa có báo cáo đã chốt trong bộ lọc này.</p>}
          </section>

          <section className="section-card report-archive-detail">
            <div className="section-title">
              <div><span className="eyebrow dark">INFOGRAPHIC</span><h2>{selected ? `${branchName(selected.branchId, branches)} · ${formatDate(selected.reportDate)}` : 'Chưa chọn báo cáo'}</h2></div>
            </div>
            {selected ? (
              <>
                <div className="report-archive-kpis">
                  <article><span>Doanh thu</span><strong>{formatMoney(summary?.revenue || 0)}</strong></article>
                  <article><span>Sản phẩm bán</span><strong>{formatNumber(summary?.totalSold || 0)}</strong></article>
                  <article><span>KPI</span><strong>{formatNumber(summary?.kpi || dailyReport?.totals?.teamKpi || 0)}%</strong></article>
                  <article><span>Xếp loại</span><strong>{summary?.grade || dailyReport?.grade || 'Đã lưu'}</strong></article>
                </div>
                <div className="report-archive-proof-grid">
                  {proofImages.map((image, index) => (
                    <figure key={image.key || index}>
                      {image.url ? <img src={image.url} alt={image.label || 'Ảnh báo cáo'} /> : <span>Chưa có ảnh</span>}
                      <figcaption>{image.label || `Ảnh ${index + 1}`}</figcaption>
                    </figure>
                  ))}
                </div>
                <div className="report-archive-lines">
                  {archiveEmployeeRows.map((row) => (
                    <div key={row.key || row.name}>
                      <span>
                        <strong>{row.name}</strong>
                        <small>
                          {formatNumber(row.sold || 0)} sản phẩm
                          {Number.isFinite(row.kpi) ? ` · KPI ${formatNumber(row.kpi || 0)}%` : ' · POS đã đồng bộ'}
                        </small>
                      </span>
                      <b>{formatMoney(row.revenue || 0)}</b>
                    </div>
                  ))}
                  {!archiveEmployeeRows.length && <p className="empty-copy">Bản lưu cũ chưa có chi tiết nhân viên.</p>}
                </div>
              </>
            ) : <p className="empty-copy">Chọn một bản lưu để xem lại.</p>}
          </section>
        </div>
      )}
    </div>
  )
}

interface ArchiveEmployeeRow {
  key?: string
  name: string
  sold: number
  revenue: number
  kpi?: number
}

function buildArchiveEmployeeRows(
  snapshotRows: unknown,
  receipts: SalesReceipt[],
  snapshot?: ReportSnapshot,
): ArchiveEmployeeRow[] {
  const rows = Array.isArray(snapshotRows)
    ? snapshotRows.filter((row): row is ArchiveEmployeeRow =>
        Boolean(row && typeof row === 'object' && typeof (row as ArchiveEmployeeRow).name === 'string'),
      )
    : []
  if (!snapshot) return rows

  const existingKeys = new Set<string>()
  rows.forEach((row) => {
    if (row.key) existingKeys.add(row.key)
    const nameKey = normalizeArchiveEmployeeName(row.name)
    existingKeys.add(nameKey)
    existingKeys.add(`${snapshot.branchId}|${nameKey}`)
  })

  const recovered = new Map<string, ArchiveEmployeeRow>()
  receipts
    .filter((receipt) =>
      receipt.branchId === snapshot.branchId
      && receipt.businessDate === snapshot.reportDate
      && receipt.sellerName.trim(),
    )
    .forEach((receipt) => {
      const nameKey = normalizeArchiveEmployeeName(receipt.sellerName)
      const key = `${receipt.branchId}|${receipt.sellerId || receipt.sellerKey || nameKey}`
      if (existingKeys.has(key) || existingKeys.has(nameKey) || existingKeys.has(`${receipt.branchId}|${nameKey}`)) return
      const current = recovered.get(key) || {
        key,
        name: receipt.sellerName,
        sold: 0,
        revenue: 0,
      }
      current.sold += receipt.totalQuantity
      current.revenue += receipt.totalAmount
      recovered.set(key, current)
    })

  return [...rows, ...recovered.values()]
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, 'vi'))
}

function normalizeArchiveEmployeeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value)
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function formatMonth(value: string) {
  const [year, month] = value.split('-')
  return `${month}/${year}`
}

function lastDayOfMonth(value: string) {
  const [year, month] = value.split('-').map(Number)
  return `${value}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
}
