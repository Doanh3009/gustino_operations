import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { adjustmentKindLabel, adjustmentMinutes, fetchAttendanceAdjustments } from '../lib/attendanceAdjustments'
import {
  createAttendanceSupplement,
  fetchAttendanceRecords,
  fetchEmployees,
  permittedBranchIds,
  updateAttendanceRecordByAdmin,
} from '../lib/attendance'
import { branchName, useConfiguredBranches } from '../lib/branches'
import { downloadBlob } from '../lib/browser'
import { localDateKey } from '../lib/dates'
import { Time24Field } from './Time24Field'
import type { AppUser, AttendanceAdjustmentRequest, AttendanceRecord, EmployeeProfile } from '../types'

interface Props {
  user: AppUser
  /**
   * Component này chứa HAI nghiệp vụ khác nhau và §69/§70 xếp chúng vào hai
   * tầng khác nhau: "Bổ sung công" là nút chính của trang Chấm công, còn
   * "Chứng từ công" nằm sau menu `•••`. `mode` chỉ chọn phần nào được vẽ —
   * logic, RPC và validation không đổi. Mặc định `both` giữ nguyên hành vi cũ
   * cho mọi nơi gọi khác.
   */
  mode?: 'both' | 'supplement' | 'archive'
  /** Báo cho trang cha tải lại bảng công sau khi bổ sung / chốt giờ ra. */
  onChanged?: () => void
}

export function AttendanceAdjustmentArchive({ user, mode = 'both', onChanged }: Props) {
  const today = new Date()
  const [branchId, setBranchId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [from, setFrom] = useState(localDateKey(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [to, setTo] = useState(localDateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0)))
  const [rows, setRows] = useState<AttendanceAdjustmentRequest[]>([])
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [closingId, setClosingId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [supplementEmployeeId, setSupplementEmployeeId] = useState('')
  const [supplementEmployeeSearch, setSupplementEmployeeSearch] = useState('')
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
      const [nextRows, nextEmployees, nextRecords] = await Promise.all([
        fetchAttendanceAdjustments(user, { branchId, userId: employeeId, from, to }),
        fetchEmployees(user, { includeInactive: true }).catch(() => [] as EmployeeProfile[]),
        // Cần bản ghi chấm công để nối đơn "Quên check-out" với đúng ca còn treo.
        fetchAttendanceRecords(user, { branchId, userId: employeeId, from, to })
          .catch(() => [] as AttendanceRecord[]),
      ])
      setRows(nextRows)
      setEmployees(nextEmployees)
      setRecords(nextRecords)
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
  const supplementEmployees = useMemo(() => {
    const search = normalizeSearch(supplementEmployeeSearch)
    return employees
      .filter((employee) => employee.active !== false
        && Boolean(employee.branchId)
        && ['staff', 'shift_leader', 'shift_deputy'].includes(employee.role)
        && (!search || normalizeSearch(`${employee.name} ${branchName(employee.branchId || '')}`).includes(search)))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  }, [employees, supplementEmployeeSearch])

  /**
   * Ca còn treo đúng với đơn "Quên check-out": cùng nhân viên, cùng ngày làm, chưa có giờ ra.
   * Không có bản ghi nào khớp thì đơn chỉ còn giá trị lưu vết, không có gì để chốt.
   */
  function openRecordForRequest(row: AttendanceAdjustmentRequest) {
    if (row.kind !== 'missing_checkout') return undefined
    return records.find((record) =>
      record.userId === row.userId
      && !record.checkOutTime
      && localDateKey(new Date(record.checkInTime)) === row.workDate,
    )
  }

  /**
   * Chốt giờ ra theo đúng giờ nhân viên khai trong đơn (BUG-113).
   *
   * Trước đây đơn "Quên check-out" chỉ được lưu lại: bản ghi vẫn treo vô thời hạn,
   * bảng công thiếu ngày công đó và nhân viên vẫn thấy thẻ đỏ "Quá hạn check-out".
   * Nút này dùng đúng RPC chỉnh công đã có (`admin_update_attendance_record`) nên
   * vẫn ghi audit, vẫn chặn giờ ra tương lai và ca quá 18 giờ.
   */
  async function closeMissingCheckout(row: AttendanceAdjustmentRequest) {
    const record = openRecordForRequest(row)
    if (!record) {
      setError('Không tìm thấy ca còn treo khớp với đơn này. Có thể ca đã được chốt hoặc đã bị xóa.')
      return
    }
    const checkIn = new Date(record.checkInTime)
    const checkOut = new Date(`${row.workDate}T${row.actualTime}:00`)
    // Ca qua đêm: giờ khai nhỏ hơn giờ vào thì thuộc ngày hôm sau.
    if (checkOut.getTime() <= checkIn.getTime()) checkOut.setDate(checkOut.getDate() + 1)
    const confirmed = window.confirm(
      `Chốt giờ ra ${row.actualTime} ngày ${row.workDate} cho ${row.userName}?\n\n`
      + 'Bảng công và bảng lương sẽ được tính lại theo giờ này. Thao tác được ghi vào nhật ký chỉnh công.',
    )
    if (!confirmed) return
    setClosingId(row.id)
    setError('')
    try {
      await updateAttendanceRecordByAdmin(user, {
        recordId: record.id,
        checkInTime: checkIn.toISOString(),
        checkOutTime: checkOut.toISOString(),
        reason: `Đơn quên check-out: ${row.reason}`.slice(0, 400),
      })
      await refresh()
      onChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể chốt giờ ra theo đơn này.')
    } finally {
      setClosingId('')
    }
  }

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
      await refresh()
      onChanged?.()
      setSupplementFeedback(`Đã bổ sung công ${supplementStart}-${supplementEnd} ngày ${supplementDate} cho ${employee.name}. Dữ liệu đang đồng bộ realtime.`)
    } catch (reason) {
      setSupplementFeedback(reason instanceof Error ? reason.message : 'Không thể bổ sung công cho nhân viên.')
    } finally {
      setSupplementBusy(false)
    }
  }

  return (
    <>
      {user.role === 'admin' && mode !== 'archive' && (
        <section className="section-card attendance-supplement-card">
          {mode === 'both' && (
            <div className="section-title">
              <div>
                <span className="eyebrow dark">BỔ SUNG CÔNG</span>
                <h2>Khôi phục công khi hệ thống gặp lỗi</h2>
                <p>Admin nhập đúng ca đã làm. Hệ thống tạo đăng ký ca và bản ghi vào/ra riêng, sau đó đồng bộ realtime vào bảng công và báo cáo.</p>
              </div>
            </div>
          )}
          <form className="attendance-adjustment-form attendance-supplement-form" onSubmit={addAttendanceSupplement}>
            <label className="span-2 attendance-supplement-search">Tìm nhanh nhân viên
              <input
                type="search"
                value={supplementEmployeeSearch}
                onChange={(event) => setSupplementEmployeeSearch(event.target.value)}
                placeholder="Nhập tên hoặc chi nhánh (có thể không dấu)…"
              />
            </label>
            <label>Nhân viên
              <select value={supplementEmployeeId} onChange={(event) => setSupplementEmployeeId(event.target.value)} required>
                <option value="">{supplementEmployees.length ? 'Chọn nhân viên' : 'Không tìm thấy nhân viên'}</option>
                {supplementEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.name} · {branchName(employee.branchId || '')}</option>
                ))}
              </select>
            </label>
            <label>Ngày làm
              <input type="date" max={localDateKey()} value={supplementDate} onChange={(event) => setSupplementDate(event.target.value)} required />
            </label>
            <div className="attendance-supplement-time-pair" aria-label="Giờ vào và giờ ra">
              <Time24Field label="Giờ vào" value={supplementStart} onChange={setSupplementStart} />
              <Time24Field label="Giờ ra" value={supplementEnd} onChange={setSupplementEnd} />
            </div>
            <label className="span-2">Lý do bổ sung
              <input value={supplementReason} onChange={(event) => setSupplementReason(event.target.value)} required placeholder="Ví dụ: máy chấm công không hiển thị nút check-in" />
            </label>
            <small className="attendance-supplement-help">Chỉ bổ sung sau khi ca đã kết thúc. Ca đang hoặc chưa diễn ra vẫn phải check-in/check-out bình thường.</small>
            <button className="primary-button" disabled={supplementBusy || !supplementEmployeeId}>{supplementBusy ? 'Đang bổ sung…' : 'Bổ sung công'}</button>
          </form>
          {supplementFeedback && <div className="feedback-bar">{supplementFeedback}<button type="button" onClick={() => setSupplementFeedback('')}>×</button></div>}
        </section>
      )}
    {mode !== 'supplement' && (
    <section className="section-card attendance-adjustment-archive">
      <div className="section-title">
        {mode === 'both'
          ? <div>
            <span className="eyebrow dark">CHỨNG TỪ CÔNG</span>
            <h2>Đơn đi trễ / về sớm / quên check-out</h2>
          </div>
          : <div />}
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
              <th>Xử lý</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const pendingRecord = openRecordForRequest(row)
              return (
              <tr key={row.id}>
                <td data-label="Ngày">{row.workDate}</td>
                <td data-label="Loại">{adjustmentKindLabel(row.kind)}</td>
                <td data-label="Nhân viên"><strong>{row.userName}</strong></td>
                <td data-label="Chi nhánh">{branchName(row.branchId)}</td>
                <td data-label="Giờ ca">{row.scheduledTime}</td>
                <td data-label="Giờ thực tế">{row.actualTime}</td>
                <td data-label="Phút">{adjustmentMinutes(row)}</td>
                <td data-label="Lý do" className="adjustment-longtext">{row.reason}</td>
                <td data-label="Ghi chú" className="adjustment-longtext">{row.evidenceNote || '-'}</td>
                <td data-label="Xử lý">
                  {row.kind !== 'missing_checkout'
                    ? '-'
                    : !pendingRecord
                      ? <span className="adjustment-done">Đã chốt giờ ra</span>
                      : user.role !== 'admin'
                        ? <span className="adjustment-waiting">Chờ Admin chốt</span>
                        : (
                          <button
                            type="button"
                            className="mini-button"
                            disabled={closingId === row.id}
                            onClick={() => void closeMissingCheckout(row)}
                          >
                            {closingId === row.id ? 'Đang chốt…' : `Chốt giờ ra ${row.actualTime}`}
                          </button>
                        )}
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!loading && !rows.length && <p className="empty-copy">Chưa có chứng từ trong bộ lọc này.</p>}
      {loading && <p className="empty-copy">Đang tải chứng từ...</p>}
    </section>
    )}
    </>
  )
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}
