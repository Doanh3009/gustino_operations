import { useEffect, useMemo, useState } from 'react'
import { Pagination } from '../../components/admin/Pagination'
import { ErpListToolbar } from '../../components/admin/ErpListToolbar'
import { isBranchlessRole, roleLabel } from '../../lib/access'
import { emailToUsername } from '../../lib/authIdentity'
import type { EmployeeProfile, EmploymentStatus, EmploymentType, Role } from '../../types'

interface EmployeesPageProps {
  employees: EmployeeProfile[]
  branches: Array<{ id: string; name: string }>
  loading: boolean
  createOpen: boolean
  // Bỏ trống với vai trò chỉ xem (SUP MT): thiếu handler thì ErpListToolbar không vẽ nút "Tạo mới".
  onToggleCreate?: () => void
  onOpenEmployee: (employee: EmployeeProfile) => void
}

export function EmployeesPage({
  employees,
  branches,
  loading,
  createOpen,
  onToggleCreate,
  onOpenEmployee,
}: EmployeesPageProps) {
  const [search, setSearch] = useState('')
  const [branchId, setBranchId] = useState('')
  const [status, setStatus] = useState<'all' | EmploymentStatus | 'inactive'>('all')
  const [role, setRole] = useState<'all' | Role>('all')
  const [employmentType, setEmploymentType] = useState<'all' | EmploymentType>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const branchMap = useMemo(() => new Map(branches.map((branch) => [branch.id, branch.name])), [branches])
  const filteredEmployees = useMemo(() => employees.filter((employee) => {
    const query = normalizeSearch(search)
    const branchName = branchMap.get(employee.branchId || '') || ''
    const matchesSearch = !query || normalizeSearch([
      employee.name,
      employee.email,
      employee.positionTitle,
      roleLabel(employee.role),
      branchName,
    ].filter(Boolean).join(' ')).includes(query)
    const matchesBranch = !branchId
      || employee.branchId === branchId
      || (isBranchlessRole(employee.role) && branchId === 'all-branches')
    const matchesStatus = status === 'all'
      || (status === 'inactive'
        ? employee.active === false
        : employee.active !== false && (employee.employmentStatus || 'working') === status)
    const matchesRole = role === 'all' || employee.role === role
    const matchesType = employmentType === 'all' || employee.employmentType === employmentType
    return matchesSearch && matchesBranch && matchesStatus && matchesRole && matchesType
  }), [branchId, branchMap, employees, employmentType, role, search, status])

  useEffect(() => setPage(1), [search, branchId, status, role, employmentType])
  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const rows = filteredEmployees.slice((safePage - 1) * pageSize, safePage * pageSize)

  return (
    <section className="admin-module-page admin-employees-page">
      <header className="admin-module-header">
        <div>
          <span>Nhân sự / Nhân viên</span>
          <h2>Nhân viên</h2>
        </div>
      </header>

      <ErpListToolbar
        title="nhân viên"
        count={filteredEmployees.length}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Tìm tên, tài khoản, vị trí, chi nhánh…"
        primaryLabel={onToggleCreate ? (createOpen ? 'Đóng' : 'Tạo mới') : undefined}
        onPrimary={onToggleCreate}
        filters={<div className="admin-employee-directory-filters">
        <label>Chi nhánh
          <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">Tất cả</option>
            <option value="all-branches">Toàn hệ thống</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        <label>Tình trạng
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="all">Tất cả</option>
            <option value="probation">Thử việc</option>
            <option value="working">Đang làm việc</option>
            <option value="ended">Nghỉ việc</option>
            <option value="inactive">Tài khoản ngừng hoạt động</option>
          </select>
        </label>
        <label>Vai trò
          <select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
            <option value="all">Tất cả</option>
            <option value="admin">Admin hệ thống</option>
            <option value="manager">Quản lý</option>
            <option value="supmt">Giám sát (SUP MT)</option>
            <option value="shift_leader">Ca trưởng</option>
            <option value="staff">Nhân viên</option>
            <option value="cashier">Thu ngân POS</option>
            <option value="kitchen">Bếp</option>
          </select>
        </label>
        <label>Nhóm làm việc
          <select value={employmentType} onChange={(event) => setEmploymentType(event.target.value as typeof employmentType)}>
            <option value="all">Tất cả</option>
            <option value="leader">Ca trưởng / Ca phó</option>
            <option value="full_time">Full-time</option>
            <option value="part_time">Part-time</option>
          </select>
        </label>
        </div>}
      />

      <div className="admin-data-table-scroll">
        <table className="admin-data-table">
          <thead>
            <tr><th>Nhân viên</th><th>Vị trí</th><th>Chi nhánh</th><th>Tình trạng</th><th>Tài khoản</th><th aria-label="Thao tác" /></tr>
          </thead>
          <tbody>
            {rows.map((employee) => (
              <tr key={employee.id} onClick={() => onOpenEmployee(employee)}>
                <td><span className="admin-table-person"><i>{employee.avatarUrl ? <img src={employee.avatarUrl} alt="" /> : employee.name.slice(0, 1).toUpperCase()}</i><b>{employee.name}</b></span></td>
                <td>{employee.positionTitle || roleLabel(employee.role)}</td>
                <td>{employee.role === 'manager' || employee.role === 'kitchen' ? 'Toàn hệ thống' : branchMap.get(employee.branchId || '') || 'Chưa gán'}</td>
                <td><span className={`admin-status-badge ${employee.active === false ? 'inactive' : employee.employmentStatus || 'working'}`}>{employmentStatusLabel(employee)}</span></td>
                <td>@{emailToUsername(employee.email) || employee.id}</td>
                <td><button type="button" className="admin-row-action" onClick={(event) => { event.stopPropagation(); onOpenEmployee(employee) }}>Xem →</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && <p className="empty-copy">Đang tải danh sách nhân sự…</p>}
      {!loading && !rows.length && <p className="empty-copy">Không có nhân viên phù hợp bộ lọc.</p>}
      {!loading && filteredEmployees.length > 0 && (
        <Pagination
          total={filteredEmployees.length}
          page={safePage}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
        />
      )}
    </section>
  )
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function employmentStatusLabel(employee: EmployeeProfile) {
  if (employee.active === false) return 'Ngừng hoạt động'
  if (employee.employmentStatus === 'probation') return 'Thử việc'
  if (employee.employmentStatus === 'ended') return 'Nghỉ việc'
  return 'Đang làm việc'
}
