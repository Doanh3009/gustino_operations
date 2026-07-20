import { useEffect, useMemo, useState } from 'react'
import { Pagination } from '../../components/admin/Pagination'
import { ErpListToolbar } from '../../components/admin/ErpListToolbar'
import type { SalesReceipt } from '../../lib/salesReceipts'
import type { Branch, EmployeeProfile } from '../../types'

interface Props {
  branches: Branch[]
  employees: EmployeeProfile[]
  receipts: SalesReceipt[]
  from: string
  to: string
  loading: boolean
  createOpen: boolean
  deletingId?: string
  onToggleCreate: () => void
  onOpenBranch: (branch: Branch) => void
  onDeleteBranch?: (branch: Branch) => void
}

export function BranchesPage({ branches, employees, receipts, from, to, loading, createOpen, deletingId = '', onToggleCreate, onOpenBranch, onDeleteBranch }: Props) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const query = normalizeSearch(search)
  const rows = useMemo(() => branches.map((branch) => {
    const staff = employees.filter((employee) => employee.branchId === branch.id)
    const sales = receipts.filter((receipt) => receipt.branchId === branch.id && receipt.businessDate >= from && receipt.businessDate <= to)
    return {
      branch,
      employeeCount: staff.length,
      activeCount: staff.filter((employee) => employee.active !== false).length,
      receiptCount: sales.length,
      revenue: sales.reduce((sum, receipt) => sum + receipt.totalAmount, 0),
    }
  }).filter(({ branch }) => !query || normalizeSearch(branch.name).includes(query)),
  [branches, employees, from, query, receipts, to])

  useEffect(() => setPage(1), [search])
  const safePage = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)))
  const visibleRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize)

  return (
    <section className="admin-module-page admin-branches-page">
      <header className="admin-module-header">
        <div><span>Vận hành / Chi nhánh</span><h2>Chi nhánh</h2></div>
      </header>
      <ErpListToolbar
        title="chi nhánh"
        count={rows.length}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Tìm tên, địa chỉ, quản lý…"
        primaryLabel={createOpen ? 'Đóng' : 'Tạo mới'}
        onPrimary={onToggleCreate}
      />
      <div className="admin-data-table-scroll">
        <table className="admin-data-table">
          <thead><tr><th>Chi nhánh</th><th>Nhân sự</th><th>Đơn hàng</th><th>Doanh thu</th><th aria-label="Thao tác" /></tr></thead>
          <tbody>{visibleRows.map(({ branch, employeeCount, activeCount, receiptCount, revenue }) => (
            <tr key={branch.id} onClick={() => onOpenBranch(branch)}>
              <td><span className="admin-table-person"><i>{branch.name.slice(0, 1).toUpperCase()}</i><b>{branch.name}</b></span></td>
              <td>{activeCount}/{employeeCount} đang hoạt động</td><td>{receiptCount}</td>
              <td><b>{formatMoney(revenue)}</b><small>{from} → {to}</small></td>
              <td>
                <span className="admin-branch-row-actions">
                  <button type="button" className="admin-row-action" onClick={(event) => { event.stopPropagation(); onOpenBranch(branch) }}>Xem →</button>
                  {onDeleteBranch && (
                    <button
                      type="button"
                      className="admin-row-action danger"
                      disabled={deletingId === branch.id}
                      onClick={(event) => {
                        event.stopPropagation()
                        onDeleteBranch(branch)
                      }}
                    >
                      {deletingId === branch.id ? 'Đang xóa…' : 'Xóa'}
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {loading && <p className="empty-copy">Đang tải danh sách chi nhánh…</p>}
      {!loading && !visibleRows.length && <p className="empty-copy">Không có chi nhánh phù hợp bộ lọc.</p>}
      {!loading && rows.length > 0 && <Pagination total={rows.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} />}
    </section>
  )
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}
