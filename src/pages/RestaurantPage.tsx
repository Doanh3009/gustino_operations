import { useEffect, useMemo, useState } from 'react'
import { MOVEMENT_LABELS, PRODUCTS } from '../lib/constants'
import { useConfiguredBranches } from '../lib/branches'
import { calculateStock, fetchMovements, fetchReportSnapshots } from '../lib/store'
import { formatStockAmount } from '../lib/inventoryEntry'
import { fetchBagAllocations } from '../lib/shiftLedger'
import { buildDailyRevenueRows } from '../lib/revenue'
import type { AppUser, BagAllocation, ReportSnapshot, StockMovement } from '../types'

export function RestaurantPage({ user, movements }: { user: AppUser; movements: StockMovement[] }) {
  const [branchId, setBranchId] = useState(user.branchId)
  const [reports, setReports] = useState<ReportSnapshot[]>([])
  const [bagAllocations, setBagAllocations] = useState<BagAllocation[]>([])
  const [dashboardMovements, setDashboardMovements] = useState(movements)
  const branches = useConfiguredBranches({ user })
  const branch = branches.find((item) => item.id === branchId)
  const branchMovements = dashboardMovements.filter((item) => item.branchId === branchId)
  const stock = useMemo(() => calculateStock(branchMovements), [branchMovements])

  useEffect(() => {
    void fetchReportSnapshots(branchId, user).then(setReports)
    void fetchBagAllocations(user, { branchId }).then(setBagAllocations)
    void fetchMovements(branchId, user).then(setDashboardMovements)
  }, [branchId, user.id])

  const last7 = new Date()
  last7.setDate(last7.getDate() - 6)
  const revenueRows = buildDailyRevenueRows(reports, bagAllocations, branchMovements, {
    branchId,
    from: last7.toISOString().slice(0, 10),
  })
  const revenue = revenueRows.reduce((sum, item) => sum + item.revenue, 0)
  const sold = revenueRows.reduce((sum, item) => sum + item.totalSold, 0)
  const avgSalesRate = revenueRows.length
    ? revenueRows.reduce((sum, item) => sum + (item.salesRate || 0), 0) / revenueRows.length
    : 0
  const waste = branchMovements.filter((item) => item.type === 'waste').reduce((sum, item) => sum + item.quantity, 0)
  const lowStock = stock.filter((item) => item.expected <= item.product.lowStock)

  return (
    <div className="page restaurant-page">
      <div className="page-heading">
        <div><span className="eyebrow dark">NHÀ HÀNG / CHI NHÁNH</span><h1>Tổng quan hoạt động</h1></div>
        <select className="branch-dashboard-select" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled>
          {branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </div>

      <section className="restaurant-hero">
        <div><span>CHI NHÁNH ĐANG XEM</span><h2>{branch?.name}</h2><p>Dữ liệu 7 ngày gần nhất · {revenueRows.length} ngày có doanh thu</p></div>
        <div className="restaurant-grade"><small>XẾP LOẠI GẦN NHẤT</small><strong>{revenueRows.find((row) => row.grade)?.grade || 'CHƯA CÓ DỮ LIỆU'}</strong></div>
      </section>

      <div className="restaurant-kpis">
        <div className="restaurant-kpi primary"><span>Doanh thu 7 ngày</span><strong>{revenue.toLocaleString('vi-VN')}đ</strong><small>Snapshot đã chốt + doanh thu live</small></div>
        <div className="restaurant-kpi"><span>Sản phẩm đã bán</span><strong>{sold.toLocaleString('vi-VN')}</strong><small>Túi PG đã ghi nhận</small></div>
        <div className="restaurant-kpi"><span>Hiệu suất bán TB</span><strong>{avgSalesRate.toFixed(0)}%</strong><small>7 ngày gần nhất</small></div>
        <div className="restaurant-kpi warning"><span>Hao hụt kho</span><strong>{waste.toFixed(1)}</strong><small>Tổng lượng ghi nhận</small></div>
      </div>

      <div className="restaurant-grid">
        <section className="section-card">
          <div className="section-title"><div><span className="eyebrow dark">DOANH THU</span><h2>7 ngày gần nhất</h2></div></div>
          <div className="revenue-bars">
            {Array.from({ length: 7 }, (_, index) => {
              const date = new Date(last7)
              date.setDate(last7.getDate() + index)
              const key = date.toISOString().slice(0, 10)
              const dayRevenue = revenueRows.filter((item) => item.reportDate === key).reduce((sum, item) => sum + item.revenue, 0)
              const max = Math.max(1, ...revenueRows.map((item) => item.revenue))
              return <div key={key}><span>{dayRevenue ? `${Math.round(dayRevenue / 1000)}k` : '0'}</span><i style={{ height: `${Math.max(4, dayRevenue / max * 100)}%` }} /><small>{date.toLocaleDateString('vi-VN', { weekday: 'short' })}</small></div>
            })}
          </div>
        </section>
        <section className="section-card">
          <div className="section-title"><div><span className="eyebrow dark">CẢNH BÁO KHO</span><h2>Cần xử lý</h2></div><span className="alert-count">{lowStock.length}</span></div>
          <div className="alert-list">
            {lowStock.slice(0, 6).map((line) => <div key={line.product.id}><span><strong>{line.product.name}</strong><small>Ngưỡng tối thiểu {line.product.lowStock} {line.product.unit}</small></span><b>{formatStockAmount(line.expected, line.product.unit)}</b></div>)}
            {!lowStock.length && <p className="empty-copy">Không có cảnh báo tồn thấp.</p>}
          </div>
        </section>
      </div>

      <section className="section-card">
        <div className="section-title"><div><span className="eyebrow dark">HOẠT ĐỘNG GẦN ĐÂY</span><h2>Nhập – xuất – kiểm kê</h2></div></div>
        <div className="activity-list">
          {branchMovements.slice(0, 8).map((item) => {
            const product = PRODUCTS.find((product) => product.id === item.productId)
            return <div key={item.id}><span className={`activity-icon ${item.type}`}>↕</span><span><strong>{MOVEMENT_LABELS[item.type]} · {product?.name}</strong><small>{new Date(item.createdAt).toLocaleString('vi-VN')} · {item.note || 'Không có ghi chú'}</small></span><b>{item.quantity} {product?.unit}</b></div>
          })}
          {!branchMovements.length && <p className="empty-copy">Chi nhánh chưa có giao dịch kho.</p>}
        </div>
      </section>
    </div>
  )
}
