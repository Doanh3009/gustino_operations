import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { adjustmentKindLabel, adjustmentMinutes, fetchAttendanceAdjustments } from '../lib/attendanceAdjustments'
import {
  createAttendanceSupplement,
  fetchAttendanceRecords,
  fetchEmployees,
  fetchShiftRegistrations,
  permittedBranchIds,
  updateAttendanceRecordByAdmin,
} from '../lib/attendance'
import { branchName, useConfiguredBranches } from '../lib/branches'
import { downloadBlob } from '../lib/browser'
import { localDateKey } from '../lib/dates'
import { Time24Field } from './Time24Field'
import type { AppUser, AttendanceAdjustmentRequest, AttendanceRecord, EmployeeProfile, ShiftRegistration } from '../types'

export function AttendanceAdjustmentArchive({ user }: { user: AppUser }) {
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
  const [supplementRegistrationId, setSupplementRegistrationId] = useState('')
  const [supplementRegistrations, setSupplementRegistrations] = useState<ShiftRegistration[]>([])
  const [supplementRegistrationsLoading, setSupplementRegistrationsLoading] = useState(false)
  const [supplementScheduledStart, setSupplementScheduledStart] = useState('')
  const [supplementScheduledEnd, setSupplementScheduledEnd] = useState('')
  const [supplementStart, setSupplementStart] = useState('')
  const [supplementEnd, setSupplementEnd] = useState('')
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

  useEffect(() => {
    let cancelled = false
    setSupplementRegistrationId('')
    setSupplementRegistrations([])
    setSupplementRegistrationsLoading(false)
    setSupplementScheduledStart('')
    setSupplementScheduledEnd('')
    setSupplementStart('')
    setSupplementEnd('')
    if (!supplementEmployeeId || !supplementDate) return () => { cancelled = true }
    setSupplementRegistrationsLoading(true)
    void fetchShiftRegistrations(user, {
      userId: supplementEmployeeId,
      from: supplementDate,
      to: supplementDate,
    }).then((items) => {
      if (!cancelled) {
        const available = items.filter((item) => item.status !== 'rejected')
        setSupplementRegistrations(available)
        if (!available.length) setSupplementRegistrationId('manual')
      }
    }).catch((reason) => {
      if (!cancelled) setSupplementFeedback(reason instanceof Error ? reason.message : 'Không thể tải ca đã đăng ký của nhân viên.')
    }).finally(() => {
      if (!cancelled) setSupplementRegistrationsLoading(false)
    })
    return () => { cancelled = true }
  }, [user.id, supplementEmployeeId, supplementDate])

  const filteredEmployees = useMemo(
    () => employees.filter((employee) => !branchId || employee.branchId === branchId),
    [employees, branchId],
  )
  const supplementEmployees = useMemo(() => {
    const search = normalizeSearch(supplementEmployeeSearch)
    return employees
      .filter((employee) => employee.active !== false
        && Boolean(employee.branchId)
        && ['staff', 'shift_leader'].includes(employee.role)
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
    const registration = supplementRegistrations.find((item) => item.id === supplementRegistrationId)
    const usesManualRegistration = supplementRegistrationId === 'manual'
    if (!employee?.branchId) {
      setSupplementFeedback('Hãy chọn nhân viên có chi nhánh làm việc.')
      return
    }
    if (!registration && !usesManualRegistration) {
      setSupplementFeedback('Hãy chọn ca đã đăng ký hoặc chọn tự nhập ca bổ sung.')
      return
    }
    if (usesManualRegistration && (!supplementScheduledStart || !supplementScheduledEnd)) {
      setSupplementFeedback('Hãy nhập đủ giờ bắt đầu và kết thúc của ca bổ sung.')
      return
    }
    if (!supplementStart || !supplementEnd) {
      setSupplementFeedback('Hãy nhập riêng giờ check-in và check-out thực tế.')
      return
    }
    setSupplementBusy(true)
    setSupplementFeedback('')
    try {
      await createAttendanceSupplement(user, {
        userId: employee.id,
        branchId: employee.branchId,
        shiftRegistrationId: registration?.id,
        workDate: registration?.workDate || supplementDate,
        scheduledStartTime: usesManualRegistration ? supplementScheduledStart : undefined,
        scheduledEndTime: usesManualRegistration ? supplementScheduledEnd : undefined,
        checkInTime: supplementStart,
        checkOutTime: supplementEnd,
        reason: supplementReason,
      })
      await refresh()
      const scheduledTime = registration
        ? `${registration.startTime}-${registration.endTime}`
        : `${supplementScheduledStart}-${supplementScheduledEnd}`
      setSupplementFeedback(`Đã bổ sung giờ thực tế ${supplementStart}-${supplementEnd} cho ca ${scheduledTime} ngày ${supplementDate} của ${employee.name}.`)
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
              <p>Admin chọn ca nhân viên đã đăng ký hoặc tự nhập ca nếu chưa có, rồi nhập riêng giờ check-in/check-out thực tế.</p>
            </div>
          </div>
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
            <label className="span-2">Ca làm đã đăng ký
              <select value={supplementRegistrationId} onChange={(event) => setSupplementRegistrationId(event.target.value)} required disabled={!supplementEmployeeId || supplementRegistrationsLoading}>
                <option value="">{supplementRegistrationsLoading ? 'Đang tải ca…' : 'Chọn ca làm'}</option>
                {supplementRegistrations.map((registration) => (
                  <option key={registration.id} value={registration.id}>
                    {registration.startTime}–{registration.endTime}{registration.note ? ` · ${registration.note}` : ''}
                  </option>
                ))}
                <option value="manual">Tự nhập ca bổ sung (chưa có đăng ký)</option>
              </select>
            </label>
            {supplementRegistrationId === 'manual' && (
              <div className="attendance-supplement-time-pair span-2" aria-label="Giờ của ca bổ sung">
                <Time24Field label="Ca bắt đầu" value={supplementScheduledStart} onChange={setSupplementScheduledStart} allowEmpty required />
                <Time24Field label="Ca kết thúc" value={supplementScheduledEnd} onChange={setSupplementScheduledEnd} allowEmpty required />
              </div>
            )}
            <div className="attendance-supplement-time-pair" aria-label="Giờ check-in và check-out thực tế">
              <Time24Field label="Check-in thực tế" value={supplementStart} onChange={setSupplementStart} allowEmpty required />
              <Time24Field label="Check-out thực tế" value={supplementEnd} onChange={setSupplementEnd} allowEmpty required />
            </div>
            <label className="span-2">Lý do bổ sung
              <input value={supplementReason} onChange={(event) => setSupplementReason(event.target.value)} required placeholder="Ví dụ: máy chấm công không hiển thị nút check-in" />
            </label>
            <small className="attendance-supplement-help">Giờ ca và giờ chấm công thực tế là hai dữ liệu riêng. Chọn “Tự nhập ca bổ sung” chỉ khi nhân viên chưa đăng ký ca ngày đó.</small>
            <button className="primary-button" disabled={supplementBusy || !supplementEmployeeId || !supplementRegistrationId || !supplementStart || !supplementEnd || (supplementRegistrationId === 'manual' && (!supplementScheduledStart || !supplementScheduledEnd))}>{supplementBusy ? 'Đang bổ sung…' : 'Bổ sung công'}</button>
          </form>
          {supplementFeedback && <div className="feedback-bar">{supplementFeedback}<button type="button" onClick={() => setSupplementFeedback('')}>×</button></div>}
        </section>
      )}
    <section className="section-card attendance-adjustment-archive">
      <div className="section-title">
        <div>
          <span className="eyebrow dark">CHỨNG TỪ CÔNG</span>
          <h2>Đơn đi trễ / về sớm / quên check-out</h2>
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
