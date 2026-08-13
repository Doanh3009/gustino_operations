import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppUser } from '../types'
import { localDateKey } from '../lib/dates'
import { useConfiguredBranches } from '../lib/branches'
import { confirmBlockedMessage, confirmRisky } from '../lib/deviceReadiness'
import {
  OPEN_RESIGNATION_STATUSES,
  RESIGNATION_HANDOVER_ITEMS,
  RESIGNATION_REASON_PRESETS,
  RESIGNATION_STATUS_LABELS,
  acknowledgeResignationRequest,
  canDecideResignation,
  canReviewBranchResignations,
  canSubmitResignation,
  canViewResignationInbox,
  decideResignationRequest,
  fetchResignationRequests,
  noticeDays,
  submitResignationRequest,
  withdrawResignationRequest,
  type ResignationRequest,
  type ResignationStatus,
} from '../lib/resignationRequests'
import { updateEmployeeCrmDetails } from '../lib/attendance'

/**
 * Trang "Đơn nghỉ việc" (#resignation) — một trang, ba góc nhìn theo vai trò:
 *  - Nhân viên / Ca trưởng / Ca phó: nộp đơn + theo dõi đơn của chính mình.
 *  - Ca trưởng, Ca phó: thêm hộp thư đơn của CHI NHÁNH MÌNH, chỉ để nắm thông tin.
 *  - Quản lý / Admin: hộp thư toàn hệ thống + duyệt hoặc từ chối.
 *
 * KHÔNG dùng `window.confirm`/`window.prompt` trần cho thao tác ghi: trong WebView
 * Zalo/Facebook chúng trả về false/null ngay mà không hiện hộp nào (BUG-137), người
 * bấm tưởng đã lưu. Quyết định duyệt/từ chối dùng biểu mẫu ngay trong trang; các
 * thao tác còn lại đi qua `confirmRisky` để phân biệt "người hủy" với "máy nuốt".
 */

const STATUS_TONE: Record<ResignationStatus, string> = {
  pending: 'warn',
  acknowledged: 'info',
  approved: 'ok',
  rejected: 'danger',
  withdrawn: 'muted',
}

/** Các mốc của một lá đơn, để vẽ dòng thời gian thay vì chỉ một cái nhãn. */
function timelineOf(request: ResignationRequest) {
  const steps = [
    { key: 'submitted', label: 'Nhân viên gửi đơn', at: request.createdAt, done: true },
    {
      key: 'acknowledged',
      label: 'Ca trưởng chi nhánh đã nắm',
      at: request.acknowledgedAt,
      done: Boolean(request.acknowledgedAt),
    },
    {
      key: 'decided',
      label: request.status === 'rejected' ? 'Quản lý không duyệt'
        : request.status === 'withdrawn' ? 'Nhân viên đã rút đơn'
        : 'Quản lý duyệt nghỉ việc',
      at: request.decidedAt || (request.status === 'withdrawn' ? request.updatedAt : undefined),
      done: ['approved', 'rejected', 'withdrawn'].includes(request.status),
    },
  ]
  return steps
}

function formatDate(value?: string) {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN')
}

function formatDateTime(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN', { hour12: false })
}

function addDays(dateKey: string, days: number) {
  const cursor = new Date(`${dateKey}T00:00:00`)
  cursor.setDate(cursor.getDate() + days)
  return localDateKey(cursor)
}

function normalizeText(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export function ResignationPage({ user }: { user: AppUser }) {
  const today = localDateKey()
  const branches = useConfiguredBranches({ user })
  const branchName = useCallback(
    (branchId: string) => branches.find((branch) => branch.id === branchId)?.name || branchId,
    [branches],
  )

  const canSubmit = canSubmitResignation(user.role)
  const canDecide = canDecideResignation(user.role)
  const canReviewBranch = canReviewBranchResignations(user.role)
  const showInbox = canViewResignationInbox(user.role)

  const [requests, setRequests] = useState<ResignationRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')

  // Bộ lọc hộp thư
  const [statusFilter, setStatusFilter] = useState<'open' | 'all' | ResignationStatus>('open')
  const [branchFilter, setBranchFilter] = useState('')
  const [search, setSearch] = useState('')

  // Biểu mẫu nộp đơn
  const [lastWorkingDate, setLastWorkingDate] = useState(() => addDays(today, 30))
  const [reasonPreset, setReasonPreset] = useState('')
  const [reason, setReason] = useState('')
  const [handoverChecked, setHandoverChecked] = useState<string[]>([])
  const [handoverNote, setHandoverNote] = useState('')

  // Biểu mẫu quyết định (thay cho window.prompt)
  const [decisionFor, setDecisionFor] = useState<{ id: string; decision: 'approved' | 'rejected' } | null>(null)
  const [decisionNote, setDecisionNote] = useState('')
  const [closeProfile, setCloseProfile] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRequests(await fetchResignationRequests(user))
    } catch (reason_) {
      setError(reason_ instanceof Error ? reason_.message : 'Không tải được danh sách đơn nghỉ việc.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const reload = () => { void load() }
    const reloadWhenVisible = () => { if (document.visibilityState === 'visible') reload() }
    window.addEventListener('focus', reload)
    document.addEventListener('visibilitychange', reloadWhenVisible)
    return () => {
      window.removeEventListener('focus', reload)
      document.removeEventListener('visibilitychange', reloadWhenVisible)
    }
  }, [load])

  const myRequests = useMemo(
    () => requests.filter((request) => request.employeeId === user.id),
    [requests, user.id],
  )
  const myOpenRequest = myRequests.find((request) => OPEN_RESIGNATION_STATUSES.includes(request.status))

  const otherRequests = useMemo(
    () => requests.filter((request) => request.employeeId !== user.id),
    [requests, user.id],
  )

  const inboxRequests = useMemo(() => {
    const keyword = normalizeText(search)
    return otherRequests.filter((request) => {
      if (statusFilter === 'open' && !OPEN_RESIGNATION_STATUSES.includes(request.status)) return false
      if (statusFilter !== 'open' && statusFilter !== 'all' && request.status !== statusFilter) return false
      if (branchFilter && request.branchId !== branchFilter) return false
      if (keyword && !normalizeText(request.employeeName).includes(keyword)) return false
      return true
    })
  }, [otherRequests, statusFilter, branchFilter, search])

  const stats = useMemo(() => ({
    pending: otherRequests.filter((request) => request.status === 'pending').length,
    acknowledged: otherRequests.filter((request) => request.status === 'acknowledged').length,
    approved: otherRequests.filter((request) => request.status === 'approved').length,
    // Sắp nghỉ = đã duyệt và ngày làm cuối còn ở phía trước.
    leavingSoon: otherRequests.filter((request) =>
      request.status === 'approved' && request.lastWorkingDate >= today).length,
  }), [otherRequests, today])

  const draftNotice = noticeDays(today, lastWorkingDate)
  const composedReason = [reasonPreset, reason.trim()].filter(Boolean).join(' — ')
  const composedHandover = [
    ...handoverChecked.map((item) => `✓ ${item}`),
    handoverNote.trim(),
  ].filter(Boolean).join('\n')

  async function runAction(id: string, action: () => Promise<unknown>, successMessage: string) {
    setBusyId(id)
    setError('')
    setFeedback('')
    try {
      await action()
      await load()
      setFeedback(successMessage)
    } catch (reason_) {
      setError(reason_ instanceof Error ? reason_.message : 'Thao tác không thành công.')
    } finally {
      setBusyId('')
    }
  }

  async function submit() {
    setBusyId('new')
    setError('')
    setFeedback('')
    try {
      await submitResignationRequest(user, {
        lastWorkingDate,
        reason: composedReason,
        handoverNote: composedHandover,
      })
      setReason('')
      setReasonPreset('')
      setHandoverChecked([])
      setHandoverNote('')
      await load()
      setFeedback('Đã gửi đơn xin nghỉ việc. Quản lý và ca trưởng chi nhánh sẽ nhận được thông tin.')
    } catch (reason_) {
      setError(reason_ instanceof Error ? reason_.message : 'Không gửi được đơn xin nghỉ việc.')
    } finally {
      setBusyId('')
    }
  }

  function openDecision(request: ResignationRequest, decision: 'approved' | 'rejected') {
    setDecisionFor({ id: request.id, decision })
    setDecisionNote(request.decisionNote || '')
    setCloseProfile(decision === 'approved')
    setError('')
    setFeedback('')
  }

  async function confirmDecision(request: ResignationRequest) {
    if (!decisionFor) return
    const { decision } = decisionFor
    if (decision === 'rejected' && !decisionNote.trim()) {
      setError('Từ chối đơn phải ghi lý do để nhân viên biết.')
      return
    }
    setBusyId(request.id)
    setError('')
    try {
      await decideResignationRequest(user, request.id, decision, decisionNote)
      // Duyệt xong thì đóng luôn hồ sơ nhân sự để người này biến mất khỏi các báo
      // cáo tới và bảng thi đua. Chỉ Admin gọi được RPC hồ sơ; Quản lý duyệt xong
      // vẫn phải nhờ Admin đóng hồ sơ, và câu thông báo dưới nói thẳng điều đó.
      let profileNote = ''
      if (decision === 'approved' && closeProfile) {
        if (user.role === 'admin') {
          await updateEmployeeCrmDetails(user, request.employeeId, {
            employmentStatus: 'ended',
            employmentEndDate: request.lastWorkingDate,
            employmentNote: `Nghỉ việc theo đơn duyệt ngày ${formatDate(today)}.`,
          })
          profileNote = ' Hồ sơ đã chuyển sang Nghỉ việc, người này sẽ không còn trong bảng thi đua và các báo cáo kỳ sau.'
        } else {
          profileNote = ' Lưu ý: cần Admin vào Nhân sự đổi hồ sơ sang "Nghỉ việc" thì người này mới rời khỏi bảng thi đua và báo cáo kỳ sau.'
        }
      }
      setDecisionFor(null)
      setDecisionNote('')
      await load()
      setFeedback((decision === 'approved'
        ? `Đã duyệt đơn nghỉ việc của ${request.employeeName}.`
        : `Đã ghi nhận không duyệt đơn của ${request.employeeName}.`) + profileNote)
    } catch (reason_) {
      setError(reason_ instanceof Error ? reason_.message : 'Không lưu được quyết định.')
    } finally {
      setBusyId('')
    }
  }

  function withdraw(request: ResignationRequest) {
    const outcome = confirmRisky(
      `Rút lại đơn xin nghỉ việc ngày làm cuối ${formatDate(request.lastWorkingDate)}?\n\nĐơn sẽ chuyển sang trạng thái "Đã rút đơn" và bạn có thể nộp đơn mới.`,
    )
    if (outcome !== 'accepted') {
      setError(confirmBlockedMessage(outcome, 'Rút đơn'))
      return
    }
    void runAction(request.id, () => withdrawResignationRequest(user, request.id), 'Đã rút đơn xin nghỉ việc.')
  }

  return (
    <div className="page resignation-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow dark">NHÂN SỰ</span>
          <h1>Đơn xin nghỉ việc</h1>
        </div>
        <button type="button" className="secondary-button" disabled={loading} onClick={() => void load()}>
          {loading ? 'Đang tải…' : '↻ Tải lại'}
        </button>
      </div>

      {error && <div className="feedback-bar error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}
      {feedback && <div className="feedback-bar">{feedback}<button type="button" onClick={() => setFeedback('')}>×</button></div>}

      {showInbox && (
        <div className="resignation-stats">
          <article className={stats.pending ? 'warn' : ''}><small>Chờ xử lý</small><strong>{stats.pending}</strong></article>
          <article><small>Ca trưởng đã nắm</small><strong>{stats.acknowledged}</strong></article>
          <article><small>Đã duyệt</small><strong>{stats.approved}</strong></article>
          <article><small>Sắp nghỉ</small><strong>{stats.leavingSoon}</strong></article>
        </div>
      )}

      {canSubmit && (
        <section className="section-card resignation-form-card">
          <div className="section-title">
            <div><span className="eyebrow dark">NỘP ĐƠN</span><h2>Gửi đơn xin nghỉ việc</h2></div>
          </div>
          {myOpenRequest ? (
            <p className="empty-copy">
              Bạn đang có một đơn <b>{RESIGNATION_STATUS_LABELS[myOpenRequest.status].toLowerCase()}</b> (ngày làm cuối {formatDate(myOpenRequest.lastWorkingDate)}).
              Muốn sửa nội dung thì rút đơn cũ ở phần bên dưới rồi nộp lại.
            </p>
          ) : (
            <div className="resignation-form">
              <div className="resignation-form-row">
                <label>Ngày làm việc cuối cùng
                  <input
                    type="date"
                    min={today}
                    value={lastWorkingDate}
                    onChange={(event) => setLastWorkingDate(event.target.value || addDays(today, 30))}
                  />
                </label>
                <div className={`resignation-notice${draftNotice < 30 ? ' short' : ''}`}>
                  <small>Báo trước</small>
                  <b>{draftNotice} ngày</b>
                  <span>{draftNotice < 30
                    ? 'Ít hơn 30 ngày — quản lý có thể yêu cầu bàn giao gấp.'
                    : 'Đủ thời gian để chi nhánh xếp người thay.'}</span>
                </div>
              </div>

              <label>Lý do nghỉ việc
                <select value={reasonPreset} onChange={(event) => setReasonPreset(event.target.value)}>
                  <option value="">— Chọn lý do —</option>
                  {RESIGNATION_REASON_PRESETS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>Trình bày thêm
                <textarea
                  rows={3}
                  maxLength={1000}
                  placeholder="VD: Em chuyển về quê học tiếp từ đầu tháng sau nên không sắp xếp được ca tối."
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <small>{composedReason.trim().length}/10 ký tự tối thiểu (đã tính cả lý do đã chọn)</small>
              </label>

              <fieldset className="resignation-handover">
                <legend>Bàn giao trước khi nghỉ</legend>
                {RESIGNATION_HANDOVER_ITEMS.map((item) => (
                  <label key={item} className="resignation-check">
                    <input
                      type="checkbox"
                      checked={handoverChecked.includes(item)}
                      onChange={(event) => setHandoverChecked((current) =>
                        event.target.checked ? [...current, item] : current.filter((value) => value !== item))}
                    />
                    <span>{item}</span>
                  </label>
                ))}
                <label>Ghi chú bàn giao
                  <textarea
                    rows={2}
                    maxLength={1000}
                    placeholder="VD: Còn 2 ca đã đăng ký tuần này, em vẫn làm đủ."
                    value={handoverNote}
                    onChange={(event) => setHandoverNote(event.target.value)}
                  />
                </label>
              </fieldset>

              <div className="resignation-form-actions">
                <span className="resignation-form-hint">Đơn gửi tới quản lý và ca trưởng chi nhánh {branchName(user.branchId)}.</span>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busyId === 'new' || composedReason.trim().length < 10 || !lastWorkingDate}
                  onClick={() => void submit()}
                >{busyId === 'new' ? 'Đang gửi…' : 'Gửi đơn'}</button>
              </div>
            </div>
          )}
        </section>
      )}

      {canSubmit && (
        <section className="section-card">
          <div className="section-title">
            <div><span className="eyebrow dark">CỦA TÔI</span><h2>Đơn tôi đã gửi</h2></div>
            <span className="date-chip">{myRequests.length}</span>
          </div>
          {loading && <p className="empty-copy">Đang tải…</p>}
          {!loading && !myRequests.length && <p className="empty-copy">Bạn chưa gửi đơn xin nghỉ việc nào.</p>}
          <div className="resignation-list">
            {myRequests.map((request) => (
              <article key={request.id} className={`resignation-item tone-${STATUS_TONE[request.status]}`}>
                <header>
                  <div>
                    <strong>Ngày làm cuối {formatDate(request.lastWorkingDate)}</strong>
                    <small>Báo trước {noticeDays(request.createdAt.slice(0, 10), request.lastWorkingDate)} ngày</small>
                  </div>
                  <span className={`resignation-status tone-${STATUS_TONE[request.status]}`}>{RESIGNATION_STATUS_LABELS[request.status]}</span>
                </header>
                <ResignationTimeline request={request} />
                <p className="resignation-reason">{request.reason}</p>
                {request.handoverNote && <pre className="resignation-handover-note">{request.handoverNote}</pre>}
                {request.decisionNote && <p className="resignation-note">Phản hồi quản lý: {request.decisionNote}</p>}
                {OPEN_RESIGNATION_STATUSES.includes(request.status) && (
                  <footer>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busyId === request.id}
                      onClick={() => withdraw(request)}
                    >{busyId === request.id ? 'Đang xử lý…' : 'Rút đơn'}</button>
                  </footer>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {showInbox && (
        <section className="section-card">
          <div className="section-title">
            <div>
              <span className="eyebrow dark">{canDecide ? 'DUYỆT ĐƠN' : 'CHI NHÁNH CỦA TÔI'}</span>
              <h2>{canDecide ? 'Đơn nghỉ việc toàn hệ thống' : 'Đơn nghỉ việc tại chi nhánh'}</h2>
            </div>
            <span className="date-chip">{inboxRequests.length}</span>
          </div>

          <div className="resignation-filters">
            <label>Trạng thái
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                <option value="open">Đang chờ xử lý</option>
                <option value="all">Tất cả</option>
                <option value="approved">Đã duyệt</option>
                <option value="rejected">Không duyệt</option>
                <option value="withdrawn">Đã rút đơn</option>
              </select>
            </label>
            {canDecide && (
              <label>Chi nhánh
                <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
                  <option value="">Tất cả chi nhánh</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </label>
            )}
            <label>Tìm nhân viên
              <input
                type="search"
                placeholder="Gõ tên, không cần dấu"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>

          {canReviewBranch && !canDecide && (
            <p className="resignation-role-note" role="note">
              Ca trưởng nắm thông tin để chủ động xếp lịch thay người. Quyết định duyệt hay không thuộc về quản lý.
            </p>
          )}

          {loading && <p className="empty-copy">Đang tải…</p>}
          {!loading && !inboxRequests.length && (
            <p className="empty-copy">{statusFilter === 'open' ? 'Không có đơn nào đang chờ xử lý.' : 'Không có đơn nào khớp bộ lọc.'}</p>
          )}

          <div className="resignation-list">
            {inboxRequests.map((request) => (
              <article key={request.id} className={`resignation-item tone-${STATUS_TONE[request.status]}`}>
                <header>
                  <div>
                    <strong>{request.employeeName}</strong>
                    <small>{[request.positionTitle, branchName(request.branchId)].filter(Boolean).join(' · ')}</small>
                  </div>
                  <span className={`resignation-status tone-${STATUS_TONE[request.status]}`}>{RESIGNATION_STATUS_LABELS[request.status]}</span>
                </header>

                <div className="resignation-facts">
                  <span><small>Ngày làm cuối</small><b>{formatDate(request.lastWorkingDate)}</b></span>
                  <span><small>Báo trước</small><b>{noticeDays(request.createdAt.slice(0, 10), request.lastWorkingDate)} ngày</b></span>
                  <span><small>Gửi lúc</small><b>{formatDateTime(request.createdAt)}</b></span>
                </div>

                <ResignationTimeline request={request} />
                <p className="resignation-reason">{request.reason}</p>
                {request.handoverNote && <pre className="resignation-handover-note">{request.handoverNote}</pre>}
                {request.decisionNote && <p className="resignation-note">Ghi chú quyết định: {request.decisionNote}</p>}

                {decisionFor?.id === request.id ? (
                  <div className="resignation-decision-form">
                    <strong>{decisionFor.decision === 'approved' ? 'Duyệt nghỉ việc' : 'Không duyệt đơn'}</strong>
                    <label>Ghi chú quyết định{decisionFor.decision === 'rejected' ? ' (bắt buộc)' : ''}
                      <textarea
                        rows={2}
                        maxLength={500}
                        placeholder={decisionFor.decision === 'approved'
                          ? 'VD: Đồng ý, bàn giao xong trước ngày làm cuối.'
                          : 'VD: Chưa duyệt vì còn thiếu người ca tối, đề nghị lùi 2 tuần.'}
                        value={decisionNote}
                        onChange={(event) => setDecisionNote(event.target.value)}
                      />
                    </label>
                    {decisionFor.decision === 'approved' && (
                      <label className="resignation-check">
                        <input type="checkbox" checked={closeProfile} onChange={(event) => setCloseProfile(event.target.checked)} />
                        <span>Chuyển hồ sơ sang <b>Nghỉ việc</b> từ {formatDate(request.lastWorkingDate)} — ẩn khỏi bảng thi đua và báo cáo kỳ sau, dữ liệu cũ giữ nguyên.</span>
                      </label>
                    )}
                    <div className="resignation-decision-actions">
                      <button type="button" className="secondary-button" disabled={busyId === request.id} onClick={() => setDecisionFor(null)}>Hủy</button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={busyId === request.id || (decisionFor.decision === 'rejected' && !decisionNote.trim())}
                        onClick={() => void confirmDecision(request)}
                      >{busyId === request.id ? 'Đang lưu…' : 'Xác nhận'}</button>
                    </div>
                  </div>
                ) : (
                  <footer>
                    {request.status === 'pending' && (canReviewBranch || canDecide) && (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busyId === request.id}
                        onClick={() => void runAction(
                          request.id,
                          () => acknowledgeResignationRequest(user, request.id),
                          `Đã ghi nhận nắm thông tin đơn của ${request.employeeName}.`,
                        )}
                      >Đã nắm thông tin</button>
                    )}
                    {canDecide && OPEN_RESIGNATION_STATUSES.includes(request.status) && (
                      <>
                        <button type="button" className="secondary-button" disabled={busyId === request.id} onClick={() => openDecision(request, 'rejected')}>Không duyệt</button>
                        <button type="button" className="primary-button" disabled={busyId === request.id} onClick={() => openDecision(request, 'approved')}>Duyệt nghỉ việc</button>
                      </>
                    )}
                  </footer>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ResignationTimeline({ request }: { request: ResignationRequest }) {
  return (
    <ol className="resignation-timeline">
      {timelineOf(request).map((step) => (
        <li key={step.key} className={step.done ? 'done' : ''}>
          <span className="resignation-timeline-dot" aria-hidden="true" />
          <div>
            <b>{step.label}</b>
            <small>{step.done ? formatDateTime(step.at) : 'Chưa có'}</small>
          </div>
        </li>
      ))}
    </ol>
  )
}
