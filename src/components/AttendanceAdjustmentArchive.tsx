import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { adjustmentKindLabel, adjustmentMinutes, fetchAttendanceAdjustments } from '../lib/attendanceAdjustments'
import { createAttendanceSupplement, fetchEmployees, permittedBranchIds } from '../lib/attendance'
import { branchName, useConfiguredBranches } from '../lib/branches'
import { downloadBlob } from '../lib/browser'
import { localDateKey } from '../lib/dates'
import type { AppUser, AttendanceAdjustmentRequest, EmployeeProfile } from '../types'

export function AttendanceAdjustmentArchive({ user }: { user: AppUser }) {
  const today = new Date()
  const [branchId, setBranchId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [from, setFrom] = useState(localDateKey(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [to, setTo] = useState(localDateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0)))
  const [rows, setRows] = useState<AttendanceAdjustmentRequest[]>([])
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [supplementEmployeeId, setSupplementEmployeeId] = useState('')
  const [supplementDate, setSupplementDate] = useState(localDateKey())
  const [supplementStart, setSupplementStart] = useState('08:00')
  const [supplementEnd, setSupplementEnd] = useState('16:00')
  const [supplementReason, setSupplementReason] = useState('Hệ thống chấm công gặp lỗi')
  const [supplementBusy, setSupplementBusy] = useState(false)
  const [supplementFeedback, setSupplementFeedback] = useState('')
  const branches = useConfiguredBranches({ user })
  const allowedBranches = permittedBranchIds(user)

  async function refresh() {
    setLoading(true)
    try {
      const [nextRows, nextEmployees] = await Promise.all([
        fetchAttendanceAdjustments(user, { branchId, userId: employeeId, from, to }),
        fetchEmployees(user, { includeInactive: true }).catch(() => [] as EmployeeProfile[]),
      ])
      setRows(nextRows)
      setEmployees(nextEmployees)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể tải chứng từ.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [user.id, branchId, employeeId, from, to])

  const filteredEmployees = useMemo(
    () => employees.filter((employee) => !branchId || employee.branchId === branchId),
    [employees, branchId],
  )

  function exportCsv() {
    const csv = [
      ['Ngày', 'Loại đơn', 'Nhân viên', 'Chi nhánh', 'Giờ ca', 'Giờ thực tế', 'Phút', 'Lý do', 'Ghi chú', 'Tạo lúc'],
      ...rows.map((row) => [
        row.workDate,
        adjustmentKindLabel(row.kind),
        row.userName,
        branchName(row.branchId),
        row.scheduledTime,
        row.actualTime,
        adjustmentMinutes(row),
        row.reason,
        row.evidenceNote,
        new Date(row.createdAt).toLocaleString('vi-VN', { hour12: false }),
      ]),
    ].map((line) => line.map(csvCell).join(',')).join('\n')
    downloadBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `chung-tu-cong-${from}-${to}.csv`)
  }

  async function addAttendanceSupplement(event: FormEvent) {
    event.preventDefault()
    const employee = employees.find((item) => item.id === supplementEmployeeId)
    if (!employee?.branchId) {
      setSupplementFeedback('Hãy chọn nhân viên có chi nhánh làm việc.')
      return
    }
    setSupplementBusy(true)
    setSupplementFeedback('')
    try {
      await createAttendanceSupplement(user, {
        userId: employee.id,
        branchId: employee.branchId,
        workDate: supplementDate,
        startTime: supplementStart,
        endTime: supplementEnd,
        reason: supplementReason,
      })
      setSupplementFeedback(`Đã bổ sung công ${supplementStart}-${supplementEnd} ngày ${supplementDate} cho ${employee.name}. Dữ liệu đang đồng bộ realtime.`)
    } catch (reason) {
      setSupplementFeedback(reason instanceof Error ? reason.message : 'Không thể bổ sung công cho nhân viên.')
    } finally {
      setSupplementBusy(false)
    }
  }

  return (
    <>
      {user.role === 'admin' && (
        <section className="section-card attendance-supplement-card">
          <div className="section-title">
            <div>
              <span className="eyebrow dark">BỔ SUNG CÔNG</span>
              <h2>Khôi phục công khi hệ thống gặp lỗi</h2>
              <p>Admin nhập đúng ca đã làm. Hệ thống tạo đăng ký ca và bản ghi vào/ra riêng, sau đó đồng bộ realtime vào bảng công và báo cáo.</p>
            </div>
          </div>
          <form className="attendance-adjustment-form" onSubmit={addAttendanceSupplement}>
            <label>Nhân viên
              <select value={supplementEmployeeId} onChange={(event) => setSupplementEmployeeId(event.target.value)} required>
                <option value="">Chọn nhân viên</option>
                {employees.filter((employee) => employee.active !== false && Boolean(employee.branchId) && ['staff', 'shift_leader'].includes(employee.role)).map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.name} · {branchName(employee.branchId || '')}</option>
                ))}
              </select>
            </label>
            <label>Ngày làm
              <input type="date" max={localDateKey()} value={supplementDate} onChange={(event) => setSupplementDate(event.target.value)} required />
            </label>
            <label>Giờ vào
              <input type="time" value={supplementStart} onChange={(event) => setSupplementStart(event.target.value)} required />
            </label>
            <label>Giờ ra
              <input type="time" value={supplementEnd} onChange={(event) => setSupplementEnd(event.target.value)} required />
            </label>
            <label className="span-2">Lý do bổ sung
              <input value={supplementReason} onChange={(event) => setSupplementReason(event.target.value)} required placeholder="Ví dụ: máy chấm công không hiển thị nút check-in" />
            </label>
            <small className="span-2">Chỉ bổ sung sau khi ca đã kết thúc. Ca đang hoặc chưa diễn ra vẫn phải check-in/check-out bình thường.</small>
            <button className="primary-button" disabled={supplementBusy || !supplementEmployeeId}>{supplementBusy ? 'Đang bổ sung…' : 'Bổ sung công'}</button>
          </form>
          {supplementFeedback && <div className="feedback-bar">{supplementFeedback}<button type="button" onClick={() => setSupplementFeedback('')}>×</button></div>}
        </section>
      )}
    <section className="section-card attendance-adjustment-archive">
      <div className="section-title">
        <div>
          <span className="eyebrow dark">CHỨNG TỪ CÔNG</span>
          <h2>Đơn đi trễ / về sớm đã lưu</h2>
        </div>
        <button className="secondary-button" type="button" onClick={exportCsv} disabled={!rows.length}>Xuất CSV</button>
      </div>
      <div className="attendance-filter-grid">
        <label>Chi nhánh
          <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">Tất cả chi nhánh</option>
            {branches.filter((branch) => allowedBranches.includes(branch.id)).map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
        </label>
        <label>Nhân viên
          <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
            <option value="">Tất cả nhân viên</option>
            {filteredEmployees.map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.name}</option>
            ))}
          </select>
        </label>
        <label>Từ ngày
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>Đến ngày
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>
      {error && <div className="feedback-bar">{error}<button onClick={() => setError('')}>x</button></div>}
      <div className="table-scroll">
        <table className="data-table attendance-adjustment-table">
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Loại</th>
              <th>Nhân viên</th>
              <th>Chi nhánh</th>
              <th>Giờ ca</th>
              <th>Giờ thực tế</th>
              <th>Phút</th>
              <th>Lý do</th>
              <th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.workDate}</td>
                <td>{adjustmentKindLabel(row.kind)}</td>
                <td><strong>{row.userName}</strong></td>
                <td>{branchName(row.branchId)}</td>
                <td>{row.scheduledTime}</td>
                <td>{row.actualTime}</td>
                <td>{adjustmentMinutes(row)}</td>
                <td>{row.reason}</td>
                <td>{row.evidenceNote || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && !rows.length && <p className="empty-copy">Chưa có chứng từ trong bộ lọc này.</p>}
      {loading && <p className="empty-copy">Đang tải chứng từ...</p>}
    </section>
    </>
  )
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
