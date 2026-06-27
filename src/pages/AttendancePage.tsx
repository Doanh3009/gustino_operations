import { useEffect, useMemo, useState } from 'react'
import {
  buildAttendanceReport,
  buildAttendanceDetailRows,
  checkIn,
  checkOut,
  createManualShiftRegistration,
  createSchedulePerson,
  createShiftRegistration,
  createWorkShift,
  deleteSchedulePerson,
  archiveWorkShift,
  fetchAttendanceRecords,
  fetchEmployees,
  fetchScheduleEntries,
  fetchSchedulePeople,
  fetchShiftRegistrations,
  fetchWorkShifts,
  permittedBranchIds,
  setScheduleEntry,
} from '../lib/attendance'
import { BRANCHES } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { roleLabel as accessRoleLabel } from '../lib/access'
import type {
  AppUser,
  AttendanceRecord,
  EmployeeProfile,
  EmploymentType,
  ScheduleEntry,
  SchedulePerson,
  ShiftRegistration,
  WorkShift,
} from '../types'
import type { Page } from '../components/AppShell'

type AttendanceTab = 'schedule' | 'board' | 'report'

export function AttendancePage({ user, onNavigate }: { user: AppUser; onNavigate: (page: Page) => void }) {
  const isManager = user.role === 'manager' || user.role === 'admin'
  const [tab, setTab] = useState<AttendanceTab>(isManager ? 'board' : 'schedule')
  const [shifts, setShifts] = useState<WorkShift[]>([])
  const [registrations, setRegistrations] = useState<ShiftRegistration[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [schedulePeople, setSchedulePeople] = useState<SchedulePerson[]>([])
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')

  async function refresh(showLoading = false) {
    if (showLoading) setLoading(true)
    try {
      const results = await Promise.allSettled([
        fetchWorkShifts(user),
        fetchShiftRegistrations(user),
        fetchAttendanceRecords(user),
        isManager ? fetchEmployees(user) : Promise.resolve([]),
        fetchSchedulePeople(user),
      ])
      const [nextShifts, nextRegistrations, nextRecords, nextEmployees, nextSchedulePeople] = results
      if (nextShifts.status === 'fulfilled') setShifts(nextShifts.value)
      if (nextRegistrations.status === 'fulfilled') setRegistrations(nextRegistrations.value)
      if (nextRecords.status === 'fulfilled') setRecords(nextRecords.value)
      if (nextEmployees.status === 'fulfilled') setEmployees(nextEmployees.value)
      if (nextSchedulePeople.status === 'fulfilled') setSchedulePeople(nextSchedulePeople.value)
      const failed = results.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined
      if (failed) throw failed.reason
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Không thể tải dữ liệu chấm công.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => { void refresh(true) }, [user.id])

  const tabs: Array<{ id: AttendanceTab; label: string; show: boolean }> = [
    { id: 'schedule', label: 'Hôm nay', show: !isManager },
    { id: 'board', label: isManager ? 'Bảng lịch' : 'Đăng ký tuần', show: true },
    { id: 'report', label: 'Bảng công', show: isManager },
  ]

  return (
    <div className="page attendance-page">
      <div className="function-navigation">
        <button className="function-back-button" onClick={() => onNavigate('launcher')}>
          <span>←</span> Trở lại
        </button>
        <button className="function-exit-button" onClick={() => onNavigate('launcher')}>
          Thoát
        </button>
      </div>
      <div className="page-heading attendance-heading">
        <div>
          <span className="eyebrow dark">QUY TRÌNH CA LÀM</span>
          <h1>{isManager ? 'Lập lịch, kiểm tra công, xuất bảng công' : 'Đăng ký lịch, check-in, check-out'}</h1>
          <p>{isManager
            ? '1) Lập lịch theo tuần. 2) Theo dõi check-in/out. 3) Xuất bảng công khi cần.'
            : '1) Đăng ký ca trong tuần. 2) Đến ca chụp selfie check-in. 3) Kết thúc ca check-out để tự tính công.'}</p>
        </div>
        <span className="attendance-role">{roleLabel(user.role)}</span>
      </div>

      {feedback && <div className="feedback-bar">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}

      <div className="attendance-tabs">
        {tabs.filter((item) => item.show).map((item) => (
          <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>
        ))}
      </div>

      {loading && <section className="section-card attendance-loading">Đang tải dữ liệu ca làm…</section>}
      {!loading && tab === 'schedule' && (
        <SchedulePanel
          user={user}
          registrations={registrations}
          records={records}
          onChanged={refresh}
          onFeedback={setFeedback}
        />
      )}
      {!loading && tab === 'board' && (
        <SharedScheduleBoard
          user={user}
          shifts={shifts}
          registrations={registrations}
          people={schedulePeople}
          onChanged={refresh}
          onFeedback={setFeedback}
        />
      )}
      {!loading && tab === 'report' && isManager && (
        <AttendanceReportPanel user={user} shifts={shifts} registrations={registrations} records={records} employees={employees} />
      )}
    </div>
  )
}

function SchedulePanel({
  user, registrations, records, onChanged, onFeedback,
}: {
  user: AppUser
  registrations: ShiftRegistration[]
  records: AttendanceRecord[]
  onChanged: () => Promise<void>
  onFeedback: (message: string) => void
}) {
  const [selfies, setSelfies] = useState<Record<string, File | undefined>>({})
  const [selfieLocalPreviews, setSelfieLocalPreviews] = useState<Record<string, string>>({})
  const [selfiePreviews, setSelfiePreviews] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState('')
  const ownRegistrations = registrations.filter((item) => item.userId === user.id && item.status !== 'rejected')
  const today = localDateKey()

  // Ảnh xem trước cục bộ để PG kiểm tra trước khi check-in (cho phép chụp lại)
  function pickSelfie(registration: ShiftRegistration, file?: File) {
    setSelfies((current) => ({ ...current, [registration.id]: file }))
    setSelfieLocalPreviews((current) => {
      const previous = current[registration.id]
      if (previous) URL.revokeObjectURL(previous)
      const next = { ...current }
      if (file) next[registration.id] = URL.createObjectURL(file)
      else delete next[registration.id]
      return next
    })
  }

  async function handleCheckIn(registration: ShiftRegistration) {
    const selfie = selfies[registration.id]
    if (!selfie) {
      onFeedback('Bạn cần chụp ảnh trước khi check-in.')
      return
    }
    setBusyId(registration.id)
    try {
      const record = await checkIn(user, registration, selfie)
      if (record.selfiePreviewUrl) {
        setSelfiePreviews((current) => ({ ...current, [registration.id]: record.selfiePreviewUrl! }))
      }
      pickSelfie(registration, undefined)
      onFeedback('Check-in thành công. Chúc bạn một ca làm việc tốt!')
      await onChanged()
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể check-in.')
    } finally {
      setBusyId('')
    }
  }

  async function handleCheckOut(record: AttendanceRecord, registration: ShiftRegistration) {
    const window = getCheckInWindow(registration)
    const now = new Date()
    if (now < window.checkOutOpensAt) {
      onFeedback(`Chưa được check-out sớm. Check-out mở từ ${window.checkOutOpensAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} (30 phút trước giờ ra).`)
      return
    }
    setBusyId(record.id)
    try {
      await checkOut(user, record)
      onFeedback('Check-out thành công. Thời gian làm việc đã được ghi nhận.')
      await onChanged()
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể check-out.')
    } finally {
      setBusyId('')
    }
  }

  // Phân loại: ca cần chấm (chưa hoàn tất) lên đầu, ca đã chấm xong tách riêng
  const now = new Date()
  const decorated = ownRegistrations.map((registration) => {
    const record = records.find((item) => item.shiftRegistrationId === registration.id)
    const checkInWindow = getCheckInWindow(registration)
    const canCheckIn = registration.workDate === today && !record
      && now >= checkInWindow.opensAt && now <= checkInWindow.closesAt
    const isCheckedOut = Boolean(record?.checkOutTime)
    const canCheckOut = Boolean(record && !record.checkOutTime) && now >= checkInWindow.checkOutOpensAt
    const checkOutTooEarly = Boolean(record && !record.checkOutTime) && now < checkInWindow.checkOutOpensAt
    return { registration, record, checkInWindow, canCheckIn, canCheckOut, isCheckedOut, checkOutTooEarly }
  })
  function sortKey(d: typeof decorated[number]) {
    if (d.canCheckIn || d.canCheckOut) return 0 // thao tác được ngay → lên đầu
    if (!d.record && d.registration.workDate >= today) return 1 // sắp tới
    if (d.record && !d.record.checkOutTime) return 2 // đang làm, chưa tới giờ ra
    return 3
  }
  const pending = decorated.filter((d) => !d.isCheckedOut)
    .sort((a, b) => sortKey(a) - sortKey(b) || a.registration.workDate.localeCompare(b.registration.workDate))
  const completed = decorated.filter((d) => d.isCheckedOut)
    .sort((a, b) => b.registration.workDate.localeCompare(a.registration.workDate))

  function renderCard(d: typeof decorated[number], readOnly: boolean) {
    const { registration, record, checkInWindow, canCheckIn, canCheckOut, checkOutTooEarly } = d
    const localPreview = selfieLocalPreviews[registration.id]
    return (
      <article className={`shift-card ${registration.status}${d.isCheckedOut ? ' done' : ''}`} key={registration.id}>
        <div className="shift-date">
          <strong>{new Date(`${registration.workDate}T00:00:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</strong>
          <small>{new Date(`${registration.workDate}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'short' })}</small>
        </div>
        <div className="shift-main">
          <span className={`attendance-status ${d.isCheckedOut ? 'done' : registration.status}`}>{d.isCheckedOut ? 'Đã chấm xong' : statusLabel(registration.status)}</span>
          <h3>{registration.startTime} – {registration.endTime}</h3>
          <p>{branchName(registration.branchId)}{registration.note ? ` · ${registration.note}` : ''}</p>
          {record && <div className="attendance-times">
            <span>Vào: <strong>{formatTime(record.checkInTime)}</strong></span>
            <span>Ra: <strong>{record.checkOutTime ? formatTime(record.checkOutTime) : 'Chưa check-out'}</strong></span>
            {record.checkInAddress && <span className="attendance-location">Vị trí: <strong>{record.checkInAddress}</strong></span>}
          </div>}
          {record && selfiePreviews[registration.id] && (
            <figure className="attendance-selfie-preview">
              <img src={selfiePreviews[registration.id]} alt="Ảnh chấm công đã đóng dấu" />
              <figcaption>Ảnh chấm công vừa lưu</figcaption>
            </figure>
          )}
          {!record && localPreview && (
            <figure className="attendance-selfie-preview">
              <img src={localPreview} alt="Ảnh chuẩn bị check-in" />
              <figcaption>Ảnh sắp chấm — chụp lại nếu bị rung/mờ</figcaption>
            </figure>
          )}
        </div>
        {!readOnly && (
          <div className="shift-actions">
            {canCheckIn && <>
              <label className="selfie-button">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(event) => pickSelfie(registration, event.target.files?.[0])}
                />
                {selfies[registration.id] ? '🔄 Chụp lại' : '📷 Chụp ảnh chấm công'}
              </label>
              <button className="primary-button" disabled={busyId === registration.id || !selfies[registration.id]} onClick={() => handleCheckIn(registration)}>
                {busyId === registration.id ? 'Đang định vị…' : 'Check-in'}
              </button>
            </>}
            {canCheckOut && <button className="primary-button checkout-button" disabled={busyId === record?.id} onClick={() => handleCheckOut(record!, registration)}>Check-out</button>}
            {checkOutTooEarly && (
              <small>Check-out mở lúc {checkInWindow.checkOutOpensAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} (30 phút trước giờ ra).</small>
            )}
            {!canCheckIn && !canCheckOut && !checkOutTooEarly && !record && (
              <small>{checkInHint(registration, checkInWindow, now)}</small>
            )}
          </div>
        )}
      </article>
    )
  }

  return (
    <>
      <section className="section-card attendance-schedule">
        <div className="section-title">
          <div><span className="eyebrow dark">CẦN CHẤM CÔNG</span><h2>Ca cần chấm</h2></div>
          <span className="date-chip">{pending.length} ca</span>
        </div>
        <div className="shift-card-list">
          {pending.map((d) => renderCard(d, false))}
          {!pending.length && <p className="empty-copy">Không có ca nào cần chấm công lúc này.</p>}
        </div>
      </section>
      {completed.length > 0 && (
        <section className="section-card attendance-schedule attendance-done">
          <div className="section-title">
            <div><span className="eyebrow dark">ĐÃ CHẤM CÔNG</span><h2>Ca đã hoàn tất</h2></div>
            <span className="date-chip">{completed.length} ca</span>
          </div>
          <div className="shift-card-list">
            {completed.map((d) => renderCard(d, true))}
          </div>
        </section>
      )}
    </>
  )
}

function RegistrationPanel({
  user, shifts, registrations, onChanged, onFeedback,
}: {
  user: AppUser
  shifts: WorkShift[]
  registrations: ShiftRegistration[]
  onChanged: () => Promise<void>
  onFeedback: (message: string) => void
}) {
  const branchIds = user.role === 'manager' || user.role === 'admin' ? permittedBranchIds(user) : [user.branchId]
  const [branchId, setBranchId] = useState(user.branchId)
  const [workDate, setWorkDate] = useState(localDateKey())
  const [shiftId, setShiftId] = useState('')
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('16:00')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const employmentType = user.employmentType || (user.role === 'shift_leader' ? 'leader' : 'part_time')
  const availableShifts = shifts.filter((item) =>
    item.branchId === branchId
    && (!item.employmentTypes?.length || item.employmentTypes.includes(employmentType)),
  )
  const matchingRegistrations = registrations.filter((item) =>
    item.branchId === branchId
    && item.workDate === workDate
    && (shiftId ? item.shiftId === shiftId : item.startTime === startTime && item.endTime === endTime)
    && item.status !== 'rejected',
  )
  const selectedShift = shifts.find((item) => item.id === shiftId)
  const recommendedStaff = selectedShift?.recommendedStaff || 3
  const crowdLevel = matchingRegistrations.length < recommendedStaff
    ? 'available'
    : matchingRegistrations.length === recommendedStaff
      ? 'balanced'
      : 'crowded'

  function selectShift(id: string) {
    setShiftId(id)
    const shift = shifts.find((item) => item.id === id)
    if (shift) {
      setStartTime(shift.startTime)
      setEndTime(shift.endTime)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (matchingRegistrations.length >= recommendedStaff) {
      const proceed = window.confirm(
        `Ca này đã có ${matchingRegistrations.length}/${recommendedStaff} người khuyến nghị. Bạn vẫn muốn đăng ký?`,
      )
      if (!proceed) return
    }
    setSaving(true)
    try {
      await createShiftRegistration(user, { branchId, workDate, startTime, endTime, shiftId: shiftId || undefined, note })
      setNote('')
      onFeedback('Đã thêm ca làm. Ca có hiệu lực ngay và không cần duyệt.')
      await onChanged()
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể đăng ký ca.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="attendance-two-column">
      <form className="entry-card attendance-form" onSubmit={submit}>
        <div className="section-title"><div><span className="eyebrow dark">THÊM CA LÀM</span><h2>Chọn ngày và giờ làm</h2></div></div>
        <div className="form-grid">
          <label>Chi nhánh
            <select value={branchId} disabled={branchIds.length === 1} onChange={(event) => { setBranchId(event.target.value); setShiftId('') }}>
              {BRANCHES.filter((item) => branchIds.includes(item.id)).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <label>Ngày làm việc
            <input type="date" min={localDateKey()} value={workDate} onChange={(event) => setWorkDate(event.target.value)} required />
          </label>
          <label className="full">Ca có sẵn
            <select value={shiftId} onChange={(event) => selectShift(event.target.value)}>
              <option value="">Tự chọn giờ</option>
              {availableShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} · {shift.startTime}–{shift.endTime}</option>)}
            </select>
          </label>
          <label>Giờ bắt đầu<input type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); setShiftId('') }} required /></label>
          <label>Giờ kết thúc<input type="time" value={endTime} onChange={(event) => { setEndTime(event.target.value); setShiftId('') }} required /></label>
          <label className="full">Ghi chú<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ví dụ: Có thể đến sớm 15 phút" /></label>
        </div>
        <div className={`shift-capacity-hint ${crowdLevel}`}>
          <strong>{matchingRegistrations.length}/{recommendedStaff} người</strong>
          <span>
            {crowdLevel === 'available' && 'Ca này vẫn còn thiếu người so với mức khuyến nghị.'}
            {crowdLevel === 'balanced' && 'Ca này đã vừa đủ người. Bạn vẫn có thể đăng ký thêm.'}
            {crowdLevel === 'crowded' && 'Ca này đang đông. Hệ thống chỉ cảnh báo, không khóa đăng ký.'}
          </span>
        </div>
        <button className="primary-button wide" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu ca làm'}</button>
      </form>
      <section className="section-card">
        <div className="section-title"><div><span className="eyebrow dark">GẦN ĐÂY</span><h2>Ca làm của tôi</h2></div></div>
        <div className="compact-shift-list">
          {registrations.filter((item) => item.userId === user.id).slice(0, 8).map((item) => (
            <div key={item.id}>
              <span><strong>{formatDate(item.workDate)} · {item.startTime}–{item.endTime}</strong><small>{branchName(item.branchId)}</small></span>
              <span className={`attendance-status ${item.status}`}>{statusLabel(item.status)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function SharedScheduleBoard({
  user, shifts, registrations, people, onChanged, onFeedback,
}: {
  user: AppUser
  shifts: WorkShift[]
  registrations: ShiftRegistration[]
  people: SchedulePerson[]
  onChanged: () => Promise<void>
  onFeedback: (message: string) => void
}) {
  const [branchId, setBranchId] = useState(user.branchId)
  const [from, setFrom] = useState(registrationWeekStartKey())
  const [liveUsers, setLiveUsers] = useState<string[]>([])
  const [selectedPersonId, setSelectedPersonId] = useState(user.id)
  const [savingCell, setSavingCell] = useState('')
  const [entries, setEntries] = useState<ScheduleEntry[]>([])
  const [setupOpen, setSetupOpen] = useState(false)
  const [overtimeOpen, setOvertimeOpen] = useState(false)
  const [overtimePersonId, setOvertimePersonId] = useState('')
  const [overtimeDate, setOvertimeDate] = useState(localDateKey())
  const [overtimeStart, setOvertimeStart] = useState('18:00')
  const [overtimeEnd, setOvertimeEnd] = useState('22:00')
  const [overtimeNote, setOvertimeNote] = useState('Ca tăng ca')
  const [overtimeBusy, setOvertimeBusy] = useState(false)
  const [personName, setPersonName] = useState('')
  const [personType, setPersonType] = useState<EmploymentType>('part_time')
  const [personPosition, setPersonPosition] = useState('Part-time')
  const [shiftName, setShiftName] = useState('')
  const [shiftStart, setShiftStart] = useState('08:00')
  const [shiftEnd, setShiftEnd] = useState('16:00')
  const [shiftType, setShiftType] = useState<EmploymentType>('part_time')
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${from}T00:00:00`)
    date.setDate(date.getDate() + index)
    return localDateKey(date)
  })
  const branchIds = user.role === 'manager' || user.role === 'admin' ? permittedBranchIds(user) : [user.branchId]
  const branchShifts = shifts.filter((shift) => shift.branchId === branchId)
  const sheetShiftOptions = Array.from(new Map(
    branchShifts
      .map((shift) => [`${shift.startTime}-${shift.endTime}`, shift]),
  ).values()).sort((a, b) => a.startTime.localeCompare(b.startTime))
  const schedulePeople = people
    .filter((person) => person.branchId === branchId && person.active)
    .sort((a, b) => {
      const aIsMe = a.profileId === user.id ? 0 : 1
      const bIsMe = b.profileId === user.id ? 0 : 1
      return aIsMe - bIsMe
        || a.sortOrder - b.sortOrder
        || employmentOrder(a.employmentType) - employmentOrder(b.employmentType)
        || a.name.localeCompare(b.name, 'vi')
    })
  const ownPerson = schedulePeople.find((person) => person.profileId === user.id)
  const displayEntries = useMemo(() => {
    const merged = new Map<string, ScheduleEntry>()
    entries.forEach((entry) => merged.set(`${entry.personId}|${entry.workDate}`, entry))
    for (const registration of registrations) {
      if (
        registration.branchId !== branchId
        || registration.status === 'rejected'
        || !registration.shiftId
        || registration.workDate < days[0]
        || registration.workDate > days[6]
      ) continue
      const person = schedulePeople.find((item) => item.profileId === registration.userId)
      if (!person) continue
      const key = `${person.id}|${registration.workDate}`
      if (!merged.has(key)) {
        merged.set(key, {
          id: `registration-${registration.id}`,
          personId: person.id,
          branchId: registration.branchId,
          workDate: registration.workDate,
          shiftId: registration.shiftId,
          startTime: registration.startTime,
          endTime: registration.endTime,
          note: registration.note,
        })
      }
    }
    return Array.from(merged.values())
  }, [branchId, days, entries, registrations, schedulePeople])

  async function loadEntries() {
    try {
      setEntries(await fetchScheduleEntries(user, { branchId, from: days[0], to: days[6] }))
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể tải bảng lịch chung.')
    }
  }

  useEffect(() => { void loadEntries() }, [branchId, from, user.id])

  useEffect(() => {
    const client = supabase
    if (!client) {
      const timer = window.setInterval(() => void onChanged(), 10000)
      return () => window.clearInterval(timer)
    }
    const channel = client.channel('schedule:company', { config: { presence: { key: user.id } } })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'schedule_entries',
      }, () => void Promise.all([loadEntries(), onChanged()]))
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'schedule_people',
      }, () => void onChanged())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'shifts',
      }, () => void onChanged())
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ name: string; branchId: string }>()
        setLiveUsers(Object.values(state).flat().map((entry) =>
          `${entry.name} · ${branchName(entry.branchId)}`,
        ).filter(Boolean))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await channel.track({
          name: user.name,
          branchId: user.branchId,
          page: 'schedule',
          at: new Date().toISOString(),
        })
      })
    return () => { void client.removeChannel(channel) }
  }, [user.id, user.name, user.branchId, branchId, from])

  useEffect(() => {
    if (user.role !== 'manager' && ownPerson) setSelectedPersonId(ownPerson.id)
  }, [branchId, user.id, user.role, ownPerson?.id])

  useEffect(() => {
    if (!overtimePersonId && ownPerson) setOvertimePersonId(ownPerson.id)
    if (user.role !== 'manager' && ownPerson && overtimePersonId !== ownPerson.id) setOvertimePersonId(ownPerson.id)
    if (user.role === 'manager' || user.role === 'admin' && overtimePersonId && !schedulePeople.some((person) => person.id === overtimePersonId)) {
      setOvertimePersonId(schedulePeople[0]?.id || '')
    }
  }, [ownPerson?.id, overtimePersonId, schedulePeople, user.role])

  useEffect(() => {
    if (!branchIds.includes(branchId)) setBranchId(branchIds[0] || user.branchId)
  }, [branchId, branchIds, user.branchId])

  async function changeCell(person: SchedulePerson, date: string, shiftId: string) {
    if (person.profileId !== user.id && user.role !== 'manager') return
    const key = `${person.id}-${date}`
    setSavingCell(key)
    try {
      await setScheduleEntry(user, {
        personId: person.id,
        branchId,
        workDate: date,
        shiftId: shiftId || undefined,
      })
      await Promise.all([loadEntries(), onChanged()])
      onFeedback(`Đã cập nhật ca của ${person.name}.`)
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể cập nhật ô lịch.')
    } finally {
      setSavingCell('')
    }
  }

  async function addPerson(event: React.FormEvent) {
    event.preventDefault()
    try {
      await createSchedulePerson(user, {
        name: personName,
        branchId,
        employmentType: personType,
        positionTitle: personPosition,
      })
      setPersonName('')
      await onChanged()
      onFeedback('Đã thêm nhân sự vào bảng lịch.')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể thêm nhân sự.')
    }
  }

  async function removePerson(person: SchedulePerson) {
    try {
      await deleteSchedulePerson(user, person.id)
      await onChanged()
      onFeedback(`Đã xóa ${person.name} khỏi bảng lịch.`)
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể xóa dòng nhân sự.')
    }
  }

  async function addShift(event: React.FormEvent) {
    event.preventDefault()
    try {
      await createWorkShift(user, {
        branchId,
        name: shiftName || `${shiftStart}-${shiftEnd}`,
        startTime: shiftStart,
        endTime: shiftEnd,
        employmentTypes: [shiftType],
      })
      setShiftName('')
      await onChanged()
      onFeedback('Đã thêm khung ca mới.')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể thêm khung ca.')
    }
  }

  async function addOvertime(event: React.FormEvent) {
    event.preventDefault()
    const person = schedulePeople.find((item) => item.id === overtimePersonId)
    if (!person?.profileId) {
      onFeedback('Nhân viên này chưa có tài khoản đăng nhập nên chưa thể thêm ca chấm công.')
      return
    }
    setOvertimeBusy(true)
    try {
      await createManualShiftRegistration(user, {
        userId: person.profileId,
        userName: person.name,
        branchId,
        workDate: overtimeDate,
        startTime: overtimeStart,
        endTime: overtimeEnd,
        note: overtimeNote || 'Ca tăng ca',
        employmentType: person.employmentType,
        positionTitle: person.positionTitle,
      })
      setOvertimeNote('Ca tăng ca')
      await onChanged()
      onFeedback(`Đã thêm ca làm cho ${person.name}.`)
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể thêm ca làm.')
    } finally {
      setOvertimeBusy(false)
    }
  }

  return (
    <>
      <section className="section-card shared-schedule-toolbar">
        <div>
          <span className="eyebrow dark">LỊCH CHUNG THEO CHI NHÁNH</span>
          <h2>Ai đã đăng ký ca nào?</h2>
          <p>Chọn tên ở cột trái, sau đó chọn khung giờ trong từng ô. Nhân viên chỉ sửa được hàng của mình; Quản lý được chỉnh toàn bảng.</p>
          <div className="schedule-live-users"><i />{liveUsers.length ? `${liveUsers.join(', ')} đang xem lịch` : 'Lịch tự đồng bộ khi có người đăng ký'}</div>
          {user.role === 'manager' || user.role === 'admin' && <button className="secondary-button schedule-setup-button" onClick={() => setSetupOpen((value) => !value)}>
            {setupOpen ? 'Đóng thiết lập' : '⚙ Thiết lập nhân sự & ca'}
          </button>}
        </div>
        <div className="shared-schedule-filters">
          <label>Chi nhánh
            <select value={branchId} disabled={branchIds.length === 1} onChange={(event) => setBranchId(event.target.value)}>
              {BRANCHES.filter((branch) => branchIds.includes(branch.id)).map((branch) =>
                <option key={branch.id} value={branch.id}>{branch.name}</option>,
              )}
            </select>
          </label>
          <label>Tuần bắt đầu
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
        </div>
      </section>

      <section className="section-card overtime-panel">
        <div>
          <span className="eyebrow dark">CA BỔ SUNG</span>
          <h2>+ Ca làm</h2>
          <p>Thêm ca tăng ca hoặc ca phát sinh. Ca này sẽ được tính công sau khi nhân viên check-in và check-out.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => setOvertimeOpen((value) => !value)}>
          {overtimeOpen ? 'Đóng' : '+ Thêm ca'}
        </button>
        {overtimeOpen && (
          <form className="overtime-form" onSubmit={addOvertime}>
            <label>Nhân viên
              <select value={overtimePersonId} onChange={(event) => setOvertimePersonId(event.target.value)} disabled={user.role !== 'manager'}>
                {schedulePeople.map((person) => (
                  <option key={person.id} value={person.id}>{person.name}{person.profileId === user.id ? ' · Tôi' : ''}</option>
                ))}
              </select>
            </label>
            <label>Ngày làm
              <input type="date" min={user.role === 'manager' || user.role === 'admin' ? undefined : localDateKey()} value={overtimeDate} onChange={(event) => setOvertimeDate(event.target.value)} />
            </label>
            <label>Bắt đầu
              <input type="time" value={overtimeStart} onChange={(event) => setOvertimeStart(event.target.value)} />
            </label>
            <label>Kết thúc
              <input type="time" value={overtimeEnd} onChange={(event) => setOvertimeEnd(event.target.value)} />
            </label>
            <label className="overtime-note">Ghi chú
              <input value={overtimeNote} onChange={(event) => setOvertimeNote(event.target.value)} placeholder="Ví dụ: tăng ca hỗ trợ quầy" />
            </label>
            <button className="primary-button" disabled={overtimeBusy || !overtimePersonId}>{overtimeBusy ? 'Đang lưu...' : 'Lưu ca làm'}</button>
          </form>
        )}
      </section>

      {setupOpen && user.role === 'manager' || user.role === 'admin' && (
        <section className="schedule-setup-panel">
          <form onSubmit={addPerson}>
            <strong>Thêm tên vào bảng</strong>
            <input value={personName} onChange={(event) => setPersonName(event.target.value)} placeholder="Họ và tên nhân viên" required />
            <select value={personType} onChange={(event) => {
              const type = event.target.value as EmploymentType
              setPersonType(type)
              setPersonPosition(employmentLabel(type))
            }}>
              <option value="leader">Ca trưởng / Ca phó</option>
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
            </select>
            <input value={personPosition} onChange={(event) => setPersonPosition(event.target.value)} placeholder="Vị trí" required />
            <button className="primary-button">+ Thêm dòng</button>
          </form>
          <form onSubmit={addShift}>
            <strong>Tạo khung ca</strong>
            <input value={shiftName} onChange={(event) => setShiftName(event.target.value)} placeholder="Tên ca (không bắt buộc)" />
            <input type="time" value={shiftStart} onChange={(event) => setShiftStart(event.target.value)} required />
            <input type="time" value={shiftEnd} onChange={(event) => setShiftEnd(event.target.value)} required />
            <select value={shiftType} onChange={(event) => setShiftType(event.target.value as EmploymentType)}>
              <option value="leader">Ca trưởng</option>
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
            </select>
            <button className="primary-button">+ Thêm ca</button>
          </form>
          <div className="schedule-shift-manager">
            {branchShifts.map((shift) => <span key={shift.id}>
              <b>{shift.startTime}-{shift.endTime}</b>
              <small>{shift.name}</small>
              <button onClick={() => void archiveWorkShift(user, shift.id).then(onChanged)}>×</button>
            </span>)}
          </div>
        </section>
      )}

      {/* Vertical per-employee layout */}
      <div className="vertical-shift-grid" style={{ marginBottom: 18 }}>
        {schedulePeople.map((person) => {
          const editable = person.profileId === user.id || user.role === 'manager' || user.role === 'admin'
          const personEntries = days.map((date) => {
            const registration = displayEntries.find((item) => item.personId === person.id && item.workDate === date)
            return { date, registration }
          }).filter(({ registration }) => registration)
          if (!editable && person.profileId !== user.id) return null
          return (
            <div className="vertical-employee-card" key={person.id}>
              <div className="vec-head">
                <span className="vec-avatar">{person.name.trim().slice(0, 1).toUpperCase()}</span>
                <div>
                  <span className="vec-name">{person.name}{person.profileId === user.id ? ' · Tôi' : ''}</span>
                  <span className="vec-role">{person.positionTitle || employmentLabel(person.employmentType)}</span>
                </div>
              </div>
              <div className="vec-shifts">
                {personEntries.length ? personEntries.map(({ date, registration }) => (
                  <div className="vec-shift-row registered" key={date}>
                    <span className="vec-shift-time">{new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
                    <span className="vec-shift-status ok">{registration!.startTime}–{registration!.endTime}</span>
                  </div>
                )) : (
                  <div className="vec-shift-row" style={{ color: 'var(--muted)', fontSize: 11 }}>Chưa đăng ký tuần này</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="schedule-scroll-hint">Bảng lịch chi tiết (kéo ngang để xem 7 ngày):</div>
      <div className="schedule-sheet-scroll">
        <section className="weekly-schedule-matrix" aria-label="Bảng đăng ký ca chung">
          <div className="weekly-schedule-row header">
            <strong>Họ và tên</strong><strong>Vị trí</strong>
            {days.map((date) => <strong key={date}>{new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })}</strong>)}
          </div>
          {schedulePeople.map((person) => {
            const editable = person.profileId === user.id || user.role === 'manager' || user.role === 'admin'
            const selected = selectedPersonId === person.id
            return (
            <div className={`weekly-schedule-row ${selected ? 'selected' : ''}`} key={person.id}>
              <button
                type="button"
                className="schedule-person-button"
                disabled={!editable}
                onClick={() => editable && setSelectedPersonId(person.id)}
              >
                {person.name}{person.profileId === user.id ? ' · Tôi' : ''}
              </button>
              <span className="schedule-position-cell">
                {person.positionTitle || employmentLabel(person.employmentType)}
                {user.role === 'manager' || user.role === 'admin' && person.profileId !== user.id && (
                  <button title="Xóa khỏi bảng lịch" onClick={() => void removePerson(person)}>×</button>
                )}
              </span>
              {days.map((date) => {
                const registration = displayEntries.find((item) => item.personId === person.id && item.workDate === date)
                const value = sheetShiftOptions.find((shift) =>
                  shift.id === registration?.shiftId
                  || (shift.startTime === registration?.startTime && shift.endTime === registration?.endTime),
                )?.id || ''
                const canChange = editable
                  && (user.role === 'manager' || user.role === 'admin' || date >= localDateKey())
                const extraRegistrations = registrations.filter((item) =>
                  person.profileId
                  && item.userId === person.profileId
                  && item.branchId === branchId
                  && item.workDate === date
                  && item.status !== 'rejected'
                  && (!registration || item.shiftId !== registration.shiftId || item.startTime !== registration.startTime || item.endTime !== registration.endTime)
                )
                return (
                  <div className={`schedule-day-cell ${canChange ? 'editable' : 'readonly'}`} key={date}>
                    <select
                      aria-label={`${person.name} ${formatDate(date)}`}
                      className={`schedule-cell ${registration ? shiftColor(registration.startTime) : 'off'}`}
                      value={value}
                      disabled={!canChange || savingCell === `${person.id}-${date}`}
                      onChange={(event) => void changeCell(person, date, event.target.value)}
                    >
                      <option value="">OFF</option>
                      {sheetShiftOptions.map((shift) =>
                        <option key={shift.id} value={shift.id}>{shift.startTime}-{shift.endTime}</option>,
                      )}
                    </select>
                    {extraRegistrations.map((item) => (
                      <span className="extra-shift-chip" key={item.id}>+ {item.startTime}-{item.endTime}</span>
                    ))}
                  </div>
                )
              })}
            </div>
          )})}
          {!schedulePeople.length && <p className="empty-copy">Chưa có nhân viên hoặc đăng ký ca trong tuần này.</p>}
        </section>
      </div>
      <section className="mobile-schedule-list" aria-label="Bảng đăng ký ca trên điện thoại">
        {schedulePeople.map((person) => {
          const editable = person.profileId === user.id || user.role === 'manager' || user.role === 'admin'
          return (
            <article className="mobile-schedule-card" key={person.id}>
              <header>
                <div>
                  <strong>{person.name}{person.profileId === user.id ? ' · Tôi' : ''}</strong>
                  <span>{person.positionTitle || employmentLabel(person.employmentType)}</span>
                </div>
                {user.role === 'manager' || user.role === 'admin' && person.profileId !== user.id && (
                  <button title="Xóa khỏi bảng lịch" onClick={() => void removePerson(person)}>×</button>
                )}
              </header>
              <div className="mobile-schedule-days">
                {days.map((date) => {
                  const registration = displayEntries.find((item) => item.personId === person.id && item.workDate === date)
                  const value = sheetShiftOptions.find((shift) =>
                    shift.id === registration?.shiftId
                    || (shift.startTime === registration?.startTime && shift.endTime === registration?.endTime),
                  )?.id || ''
                  const canChange = editable
                    && (user.role === 'manager' || user.role === 'admin' || date >= localDateKey())
                  const extraRegistrations = registrations.filter((item) =>
                    person.profileId
                    && item.userId === person.profileId
                    && item.branchId === branchId
                    && item.workDate === date
                    && item.status !== 'rejected'
                    && (!registration || item.shiftId !== registration.shiftId || item.startTime !== registration.startTime || item.endTime !== registration.endTime)
                  )
                  return (
                    <label className={`mobile-schedule-day ${canChange ? 'editable' : 'readonly'}`} key={date}>
                      <span>
                        <b>{new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'short' })}</b>
                        <small>{formatDate(date)}</small>
                      </span>
                      <select
                        aria-label={`${person.name} ${formatDate(date)}`}
                        className={`schedule-cell ${registration ? shiftColor(registration.startTime) : 'off'}`}
                        value={value}
                        disabled={!canChange || savingCell === `${person.id}-${date}`}
                        onChange={(event) => void changeCell(person, date, event.target.value)}
                      >
                        <option value="">OFF</option>
                        {sheetShiftOptions.map((shift) =>
                          <option key={shift.id} value={shift.id}>{shift.startTime}-{shift.endTime}</option>,
                        )}
                      </select>
                      {extraRegistrations.map((item) => (
                        <i key={item.id}>+ {item.startTime}-{item.endTime}</i>
                      ))}
                    </label>
                  )
                })}
              </div>
            </article>
          )
        })}
        {!schedulePeople.length && <p className="empty-copy">Chưa có nhân viên hoặc đăng ký ca trong tuần này.</p>}
      </section>
    </>
  )
}

function employmentOrder(type?: EmployeeProfile['employmentType']) {
  return type === 'leader' ? 0 : type === 'full_time' ? 1 : 2
}
function employmentLabel(type?: EmployeeProfile['employmentType']) {
  return type === 'leader' ? 'Ca trưởng / Ca phó' : type === 'full_time' ? 'Full-time' : type === 'part_time' ? 'Part-time' : 'Nhân viên'
}
function shiftColor(startTime: string) {
  if (startTime < '09:00') return 'morning'
  if (startTime < '12:00') return 'middle'
  if (startTime < '15:00') return 'afternoon'
  return 'evening'
}

function AttendanceReportPanel({
  user, shifts, registrations, records, employees,
}: {
  user: AppUser
  shifts: WorkShift[]
  registrations: ShiftRegistration[]
  records: AttendanceRecord[]
  employees: EmployeeProfile[]
}) {
  const today = new Date()
  const [branchId, setBranchId] = useState('')
  const [userId, setUserId] = useState('')
  const [from, setFrom] = useState(localDateKey(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [to, setTo] = useState(localDateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0)))
  const branchIds = permittedBranchIds(user)
  const filteredRegistrations = useMemo(() => registrations.filter((item) =>
    (!branchId || item.branchId === branchId)
    && (!userId || item.userId === userId)
    && item.workDate >= from && item.workDate <= to,
  ), [registrations, branchId, userId, from, to])
  const filteredRecords = useMemo(() => records.filter((item) =>
    (!branchId || item.branchId === branchId)
    && (!userId || item.userId === userId)
    && localDateKey(new Date(item.checkInTime)) >= from && localDateKey(new Date(item.checkInTime)) <= to,
  ), [records, branchId, userId, from, to])
  const grace = useMemo(() => new Map(shifts.map((item) => [item.id, item.graceMinutes])), [shifts])
  const rows = useMemo(() => buildAttendanceReport(filteredRegistrations, filteredRecords, grace), [filteredRegistrations, filteredRecords, grace])
  const detailRows = useMemo(() => buildAttendanceDetailRows(filteredRegistrations, filteredRecords, grace), [filteredRegistrations, filteredRecords, grace])

  function exportCsv() {
    const csv = [
      ['Nhân viên', 'Chi nhánh', 'Tổng ca', 'Tổng giờ', 'Ngày công', 'Đi trễ', 'Vắng', 'Quên check-out'],
      ...rows.map((row) => [row.employeeName, branchName(row.branchId), row.totalShifts, row.totalHours, row.workDays, row.lateCount, row.absentCount, row.missingCheckoutCount]),
    ].map((line) => line.map(csvCell).join(',')).join('\n')
    download(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `bang-cong-${from}-${to}.csv`)
  }

  async function exportXlsx() {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Tổng hợp')
    sheet.columns = [
      { header: 'Nhân viên', key: 'employeeName', width: 26 },
      { header: 'Chi nhánh', key: 'branch', width: 26 },
      { header: 'Tổng ca', key: 'totalShifts', width: 12 },
      { header: 'Tổng giờ', key: 'totalHours', width: 12 },
      { header: 'Ngày công', key: 'workDays', width: 12 },
      { header: 'Đi trễ', key: 'lateCount', width: 10 },
      { header: 'Vắng mặt', key: 'absentCount', width: 11 },
      { header: 'Quên check-out', key: 'missingCheckoutCount', width: 16 },
    ]
    rows.forEach((row) => sheet.addRow({ ...row, branch: branchName(row.branchId) }))
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1F33' } }
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    styleAttendanceSheet(sheet)

    const exportBranchIds = Array.from(new Set([
      ...rows.map((row) => row.branchId),
      ...detailRows.map((row) => row.branchId),
    ])).sort((a, b) => branchName(a).localeCompare(branchName(b), 'vi'))
    for (const id of exportBranchIds) {
      const branchSheet = workbook.addWorksheet(safeSheetName(branchName(id)))
      branchSheet.columns = attendanceDetailColumns()
      for (const row of detailRows.filter((item) => item.branchId === id)) {
        await addAttendanceDetailRow(branchSheet, row)
      }
      styleAttendanceSheet(branchSheet)
    }

    const buffer = await workbook.xlsx.writeBuffer()
    download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `bang-cong-${from}-${to}.xlsx`)
  }

  return (
    <>
      <section className="section-card attendance-filters">
        <div className="attendance-filter-grid">
          <label>Chi nhánh<select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Tất cả chi nhánh</option>{BRANCHES.filter((item) => branchIds.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Nhân viên<select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Tất cả nhân viên</option>{employees.filter((item) => !branchId || item.branchId === branchId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Từ ngày<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>Đến ngày<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </div>
        <div className="attendance-export-actions">
          <button className="secondary-button" onClick={exportCsv}>Xuất CSV</button>
          <button className="primary-button" onClick={exportXlsx}>Xuất Excel (.xlsx)</button>
        </div>
      </section>
      <section className="section-card stock-section">
        <div className="section-title"><div><span className="eyebrow dark">ATTENDANCE REPORT</span><h2>Bảng công tổng hợp</h2></div><span className="date-chip">{rows.length} nhân viên</span></div>
        <div className="table-scroll"><table className="data-table attendance-report-table">
          <thead><tr><th>Nhân viên</th><th>Chi nhánh</th><th>Tổng ca</th><th>Tổng giờ</th><th>Ngày công</th><th>Đi trễ</th><th>Vắng</th><th>Quên checkout</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={`${row.userId}-${row.branchId}`}><td><strong>{row.employeeName}</strong></td><td>{branchName(row.branchId)}</td><td>{row.totalShifts}</td><td>{row.totalHours}</td><td><strong>{row.workDays}</strong></td><td>{row.lateCount}</td><td>{row.absentCount}</td><td>{row.missingCheckoutCount}</td></tr>)}</tbody>
        </table></div>
        {!rows.length && <p className="empty-copy">Không có dữ liệu trong khoảng thời gian đã chọn.</p>}
      </section>
    </>
  )
}

function branchName(id: string) { return BRANCHES.find((item) => item.id === id)?.name || id }
function roleLabel(role: AppUser['role']) { return accessRoleLabel(role) }
function statusLabel(status: ShiftRegistration['status']) { return status === 'rejected' ? 'Không hiệu lực' : 'Đã đăng ký' }
function formatDate(date: string) { return new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN') }
function formatTime(date: string) { return new Date(date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) }
function formatDateTime(date: string) { return new Date(date).toLocaleString('vi-VN', { hour12: false }) }
function attendanceDetailStatus(status: 'completed' | 'working' | 'absent' | 'scheduled') {
  return ({ completed: 'Đã hoàn thành', working: 'Đang làm', absent: 'Vắng', scheduled: 'Chưa tới ca' })[status]
}
function styleAttendanceSheet(sheet: import('exceljs').Worksheet) {
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1F33' } }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } }
}
function attendanceDetailColumns() {
  return [
    { header: 'Ngày làm', key: 'workDate', width: 13 },
    { header: 'Nhân viên', key: 'employeeName', width: 26 },
    { header: 'Chi nhánh', key: 'branch', width: 24 },
    { header: 'Ca dự kiến', key: 'scheduled', width: 17 },
    { header: 'Giờ vào', key: 'checkIn', width: 20 },
    { header: 'Giờ ra', key: 'checkOut', width: 20 },
    { header: 'Giờ thực tế', key: 'totalHours', width: 13 },
    { header: 'Ngày công', key: 'workDayCredit', width: 12 },
    { header: 'Đi trễ (phút)', key: 'lateMinutes', width: 14 },
    { header: 'Trạng thái', key: 'status', width: 16 },
    { header: 'Địa chỉ check-in', key: 'address', width: 50 },
    { header: 'Tọa độ', key: 'coordinates', width: 24 },
    { header: 'Minh chứng selfie', key: 'selfieUrl', width: 18 },
    { header: 'Ghi chú', key: 'note', width: 30 },
  ]
}
async function addAttendanceDetailRow(sheet: import('exceljs').Worksheet, row: ReturnType<typeof buildAttendanceDetailRows>[number]) {
  const evidenceUrl = await selfieEvidenceUrl(row.selfieUrl)
  sheet.addRow({
    workDate: formatDate(row.workDate),
    employeeName: row.employeeName,
    branch: branchName(row.branchId),
    scheduled: `${row.scheduledStart}-${row.scheduledEnd}`,
    checkIn: row.checkInTime ? formatDateTime(row.checkInTime) : '',
    checkOut: row.checkOutTime ? formatDateTime(row.checkOutTime) : '',
    totalHours: row.totalHours,
    workDayCredit: row.workDayCredit,
    lateMinutes: row.lateMinutes,
    status: attendanceDetailStatus(row.status),
    address: row.checkInAddress || '',
    coordinates: row.checkInLatitude === undefined ? '' : `${row.checkInLatitude}, ${row.checkInLongitude}`,
    selfieUrl: evidenceUrl ? { text: 'Xem ảnh', hyperlink: evidenceUrl } : '',
    note: row.note,
  })
}
async function selfieEvidenceUrl(value?: string) {
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  if (value.startsWith('/')) return `${window.location.origin}${value}`
  if (!supabase) return value
  const signed = await supabase.storage.from('attendance-selfies').createSignedUrl(value, 60 * 60 * 24 * 30)
  return signed.data?.signedUrl || supabase.storage.from('attendance-selfies').getPublicUrl(value).data.publicUrl || value
}
function safeSheetName(value: string) {
  return value.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Chi nhánh'
}
function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
function getCheckInWindow(registration: ShiftRegistration) {
  const startsAt = new Date(`${registration.workDate}T${registration.startTime}:00`)
  const closesAt = new Date(`${registration.workDate}T${registration.endTime}:00`)
  if (registration.endTime <= registration.startTime) closesAt.setDate(closesAt.getDate() + 1)
  return {
    startsAt,
    opensAt: new Date(startsAt.getTime() - 30 * 60000),
    closesAt,
    // Không cho check-out sớm hơn 30 phút trước giờ ra
    checkOutOpensAt: new Date(closesAt.getTime() - 30 * 60000),
  }
}
function checkInHint(
  registration: ShiftRegistration,
  window: ReturnType<typeof getCheckInWindow>,
  now: Date,
) {
  if (registration.workDate !== localDateKey(now)) return 'Check-in vào đúng ngày đã đăng ký.'
  if (now < window.opensAt) {
    return `Mở check-in lúc ${window.opensAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}.`
  }
  if (now > window.closesAt) return 'Đã quá thời gian của ca này.'
  return 'Đang chuẩn bị mở chấm công.'
}
function weekStartKey(date = new Date()) {
  const start = new Date(date)
  const day = start.getDay()
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
  return localDateKey(start)
}
function registrationWeekStartKey(date = new Date()) {
  const start = new Date(date)
  const day = start.getDay()
  const offset = day === 0 ? 1 : -(day - 1)
  start.setDate(start.getDate() + offset)
  return localDateKey(start)
}
function csvCell(value: string | number) { return `"${String(value).replace(/"/g, '""')}"` }
function download(blob: Blob, name: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
}
