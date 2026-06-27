import { useEffect, useRef, useState } from 'react'
import type { InventoryTab, Page } from '../components/AppShell'
import { BRANCHES, PRODUCTS } from '../lib/constants'
import { calculateStock, closeOperationDay, getOperationDay } from '../lib/store'
import { fetchBagAllocations, fetchBagShiftSessions } from '../lib/shiftLedger'
import { createSupplyRequests } from '../lib/supplyRequests'
import { fetchAttendanceRecords, fetchShiftRegistrations } from '../lib/attendance'
import { localDateKey } from '../lib/dates'
import type { AppUser, AttendanceRecord, BagAllocation, BagShiftSession, OperationDay, ShiftRegistration, StockMovement } from '../types'

interface Props {
  user: AppUser
  movements: StockMovement[]
  onNavigate: (page: Page) => void
  onOpenInventory: (tab: InventoryTab) => void
}

interface OrderDraftLine {
  id: string
  productName: string
  quantity: string
  unit: string
  note: string
}

const ORDER_DRAFT_KEY = 'gustino_supply_order_draft'

const emptyOrderLine = (): OrderDraftLine => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  productName: '',
  quantity: '',
  unit: 'kg',
  note: '',
})

function loadOrderDraft(): OrderDraftLine[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ORDER_DRAFT_KEY) || '[]') as OrderDraftLine[]
    const lines = parsed
      .filter((line) => line && typeof line === 'object')
      .map((line) => ({
        id: line.id || emptyOrderLine().id,
        productName: line.productName || '',
        quantity: line.quantity || '',
        unit: line.unit || 'kg',
        note: line.note || '',
      }))
    return lines.length ? lines : [emptyOrderLine()]
  } catch {
    return [emptyOrderLine()]
  }
}

export function TodayPage({ user, movements, onNavigate, onOpenInventory }: Props) {
  const [operationDay, setOperationDay] = useState<OperationDay | null>(null)
  const [bagSessions, setBagSessions] = useState<BagShiftSession[]>([])
  const [bagAllocations, setBagAllocations] = useState<BagAllocation[]>([])
  const [registrations, setRegistrations] = useState<ShiftRegistration[]>([])
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([])
  const [closeShiftConfirm, setCloseShiftConfirm] = useState(false)
  const [closeShiftBusy, setCloseShiftBusy] = useState(false)
  const [closeShiftMsg, setCloseShiftMsg] = useState('')
  const [orderModal, setOrderModal] = useState(false)
  const [orderLines, setOrderLines] = useState<OrderDraftLine[]>(loadOrderDraft)
  const [orderBusy, setOrderBusy] = useState(false)
  const [orderFeedback, setOrderFeedback] = useState('')
  const orderProductRef = useRef<HTMLInputElement>(null)
  const todayKey = localDateKey()
  const todayItems = movements.filter((item) => item.shiftDate === todayKey)
  const branch = BRANCHES.find((item) => item.id === user.branchId)
  const stock = calculateStock(movements)
  const lowStock = stock.filter((line) => line.expected <= line.product.lowStock)
  const inboundDone = todayItems.some((item) => item.type === 'inbound')
  const processingDone = todayItems.some((item) => item.type === 'processing_in')
  const packingDone = todayItems.some((item) => item.type === 'packing_in')
  const saleDone = bagAllocations.length > 0
  const closedBagSessions = bagSessions.filter((item) => item.status === 'closed')
  const openBagSession = bagSessions.find((item) => item.status === 'open')
  const expectedDailyShifts = 2
  const reportReady = closedBagSessions.length >= expectedDailyShifts && !openBagSession
  const handoverDone = reportReady
  const reportDone = operationDay?.status === 'closed'
  const userCheckedInToday = attendanceRecords.some((item) => item.userId === user.id)
  const attendanceReminder = buildAttendanceReminder(
    registrations.filter((item) => item.userId === user.id),
    attendanceRecords.filter((item) => item.userId === user.id),
  )

  useEffect(() => {
    void getOperationDay(user.branchId, todayKey).then(setOperationDay)
  }, [todayItems.length, todayKey, user.branchId])
  useEffect(() => {
    void Promise.all([
      fetchBagShiftSessions(user, { branchId: user.branchId, date: todayKey }),
      fetchBagAllocations(user, { branchId: user.branchId, date: todayKey }),
    ]).then(([nextSessions, nextAllocations]) => {
      setBagSessions(nextSessions)
      setBagAllocations(nextAllocations)
    }).catch(() => {
      // Trang bàn giao sẽ hiển thị lỗi chi tiết nếu máy chủ chưa sẵn sàng.
    })
  }, [todayKey, user.id, user.branchId])
  useEffect(() => {
    void Promise.all([
      fetchShiftRegistrations(user, { branchId: user.branchId, from: todayKey, to: todayKey }),
      fetchAttendanceRecords(user, { branchId: user.branchId, from: todayKey, to: todayKey }),
    ]).then(([nextRegistrations, nextRecords]) => {
      setRegistrations(nextRegistrations)
      setAttendanceRecords(nextRecords)
    }).catch(() => {})
    const timer = window.setInterval(() => {
      void Promise.all([
        fetchShiftRegistrations(user, { branchId: user.branchId, from: todayKey, to: todayKey }),
        fetchAttendanceRecords(user, { branchId: user.branchId, from: todayKey, to: todayKey }),
      ]).then(([nextRegistrations, nextRecords]) => {
        setRegistrations(nextRegistrations)
        setAttendanceRecords(nextRecords)
      }).catch(() => {})
    }, 30000)
    return () => window.clearInterval(timer)
  }, [todayKey, user.id, user.branchId])
  useEffect(() => {
    localStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify(orderLines))
  }, [orderLines])

  const steps = [
    {
      number: 1,
      icon: '↓',
      title: 'Nhập hàng đầu ngày',
      description: 'Ghi số nguyên liệu và hàng hóa vừa nhận vào kho.',
      done: inboundDone,
      action: () => onOpenInventory('inbound'),
      actionLabel: 'Nhập kho',
    },
    {
      number: 2,
      icon: '↔',
      title: 'Lấy hàng ra chế biến',
      description: 'Ghi lượng lấy từ kho và lượng thành phẩm sau chế biến.',
      done: processingDone,
      action: () => onOpenInventory('processing_out'),
      actionLabel: 'Ghi mẻ chế biến',
    },
    {
      number: 3,
      icon: '▤',
      title: 'Đóng thành phẩm vào túi',
      description: 'Nhập số túi theo từng quy cách ngay trong mẻ chế biến.',
      done: packingDone,
      action: () => onOpenInventory('processing_out'),
      actionLabel: 'Ghi số túi',
    },
    {
      number: 4,
      icon: '◉',
      title: 'Chia hàng cho nhân viên bán',
      description: 'Phát túi theo nhân viên, thu túi và tự tính số bán.',
      done: saleDone,
      action: () => onNavigate('handover'),
      actionLabel: 'Mở sổ túi',
    },
    {
      number: 5,
      icon: '⇄',
      title: closedBagSessions.length === 1 && !openBagSession ? 'Nhận ca 2 / bàn giao tiếp' : 'Chốt và bàn giao ca',
      description: closedBagSessions.length === 1 && !openBagSession
        ? 'Ca 1 đã bàn giao. Ca trưởng ca 2 nhận lại đúng tồn quầy và tiếp tục bán.'
        : 'Đếm túi còn tại quầy, chuyển túi đang giữ sang ca sau.',
      done: handoverDone,
      action: () => onNavigate('handover'),
      actionLabel: closedBagSessions.length === 1 && !openBagSession ? 'Nhận ca 2' : 'Chốt bàn giao',
    },
    {
      number: 6,
      icon: '✓',
      title: 'Báo cáo cuối ngày',
      description: reportReady
        ? 'Ca 2 tổng hợp dữ liệu cả ngày, bổ sung hình ảnh/sự cố rồi chốt báo cáo.'
        : 'Báo cáo chỉ mở sau khi đã bàn giao đủ 2 ca trong ngày.',
      done: reportDone,
      action: () => reportReady ? onNavigate('report') : onNavigate('handover'),
      actionLabel: reportReady ? 'Mở báo cáo cuối ngày' : 'Xem bàn giao',
    },
  ]
  const nextStep = steps.find((step) => !step.done) || steps[steps.length - 1]
  const blockedByAttendance = !reportDone && !userCheckedInToday
  const actionStep = blockedByAttendance
    ? {
        number: 0,
        title: 'Chấm công trước khi mở ngày',
        description: 'Hãy check-in trong mục Chấm công, sau đó mới nhập hàng, nhận ca và phát túi.',
        action: () => onNavigate('attendance'),
        actionLabel: 'Mở chấm công',
      }
    : nextStep
  const completedSteps = steps.filter((step) => step.done).length
  const progress = completedSteps / steps.length * 100

  async function closeShift() {
    if (!closeShiftConfirm) {
      setCloseShiftConfirm(true)
      window.setTimeout(() => setCloseShiftConfirm(false), 5000)
      return
    }
    setCloseShiftBusy(true)
    setCloseShiftConfirm(false)
    try {
      await closeOperationDay(user, todayKey)
      void getOperationDay(user.branchId, todayKey).then(setOperationDay)
      setCloseShiftMsg('Ca đã được kết thành công.')
    } catch (reason) {
      setCloseShiftMsg(reason instanceof Error ? reason.message : 'Không thể kết ca.')
    } finally {
      setCloseShiftBusy(false)
    }
  }

  function updateOrderLine(id: string, patch: Partial<OrderDraftLine>) {
    setOrderLines((lines) => lines.map((line) => line.id === id ? { ...line, ...patch } : line))
  }

  function addOrderLine() {
    setOrderLines((lines) => [...lines, emptyOrderLine()])
  }

  function removeOrderLine(id: string) {
    setOrderLines((lines) => lines.length === 1 ? lines : lines.filter((line) => line.id !== id))
  }

  async function submitOrder(event: React.FormEvent) {
    event.preventDefault()
    const validLines = orderLines
      .map((line) => ({
        productName: line.productName.trim(),
        quantity: Number(line.quantity),
        unit: line.unit,
        note: line.note.trim(),
      }))
      .filter((line) => line.productName && Number.isFinite(line.quantity) && line.quantity > 0)
    if (!validLines.length) return
    setOrderBusy(true)
    try {
      await createSupplyRequests(user, validLines)
      setOrderFeedback(`Đã gửi ${validLines.length} món đến bếp và quản lý.`)
      const blankLine = emptyOrderLine()
      setOrderLines([blankLine])
      localStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify([blankLine]))
      setTimeout(() => setOrderModal(false), 1400)
    } catch (reason) {
      setOrderFeedback(reason instanceof Error ? reason.message : 'Không thể gửi yêu cầu.')
    } finally {
      setOrderBusy(false)
    }
  }

  return (
    <div className="page today-page">
      <div className="today-welcome">
        <div>
          <span className="eyebrow dark">{reportDone ? 'NGÀY VẬN HÀNH ĐÃ KẾT THÚC' : 'CA LÀM VIỆC HÔM NAY'}</span>
          <h1>{reportDone ? `Kết thúc ngày rồi, ${user.name}` : `Chào ${user.name}, mình bắt đầu nhé`}</h1>
          <p>{branch?.name} · {reportDone ? 'Báo cáo đã chốt · Chúc cả đội ngủ ngon.' : new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, flexShrink: 0 }}>
          <span className={reportDone ? 'shift-status closed' : !userCheckedInToday ? 'shift-status waiting' : operationDay ? 'shift-status open' : 'shift-status waiting'}>
            <i /> {reportDone ? 'Đã kết thúc ngày' : !userCheckedInToday ? 'Cần check-in' : operationDay ? 'Đang trong ca' : 'Chưa bắt đầu'}
          </span>
          {!reportDone && operationDay && reportReady && (
            <button className="close-shift-btn" onClick={() => onNavigate('report')}>
              Mở báo cáo cuối ngày →
            </button>
          )}
          {closeShiftMsg && (
            <span className={`close-shift-msg${closeShiftMsg.startsWith('Ca đã') ? ' success' : ' error'}`}>
              {closeShiftMsg}
            </span>
          )}
        </div>
      </div>

      {attendanceReminder && (
        <section className={`attendance-reminder-card ${attendanceReminder.tone}`}>
          <strong>{attendanceReminder.title}</strong>
          <span>{attendanceReminder.message}</span>
          <button onClick={() => onNavigate('attendance')}>Mở chấm công</button>
        </section>
      )}

      <div className="today-operations-layout">
        <nav className="today-step-rail" aria-label="Các bước vận hành của ca trưởng">
          <div className="today-step-rail-progress">
            <strong>{completedSteps}</strong>
            <span>/ {steps.length}</span>
          </div>
          {steps.map((step) => {
            const isCurrent = !reportDone && step.number === nextStep.number
            return (
              <button
                key={step.number}
                className={`today-rail-step${step.done ? ' done' : ''}${isCurrent ? ' current' : ''}`}
                onClick={blockedByAttendance ? () => onNavigate('attendance') : step.action}
                title={`Bước ${step.number}: ${step.title}`}
                aria-label={`Bước ${step.number}: ${step.title}`}
              >
                <span>{step.done ? '✓' : step.icon}</span>
                <small>{step.number}</small>
              </button>
            )
          })}
        </nav>

        <div className="today-command-stack">
          <section className="next-action-card today-command-card">
            <div className="next-action-copy">
              <span className="next-action-icon">{reportDone ? '✓' : actionStep.number || '!'}</span>
              <div>
                <small>{reportDone ? 'KẾT THÚC NGÀY' : blockedByAttendance ? 'CẦN CHẤM CÔNG' : 'VIỆC NÊN LÀM TIẾP'}</small>
                <h2>{reportDone ? 'Báo cáo đã chốt. Chúc cả đội ngủ ngon.' : actionStep.title}</h2>
                <p>{reportDone ? 'Không còn việc cần làm hôm nay. Dữ liệu đã vào lịch sử và dashboard.' : actionStep.description}</p>
              </div>
            </div>
            <button onClick={reportDone ? () => onNavigate('report') : actionStep.action}>
              {reportDone ? 'Xem báo cáo' : actionStep.actionLabel} <span>→</span>
            </button>
          </section>

          <section className={`today-flow${reportDone ? ' finished' : ''}`}>
            <div className="today-flow-head">
              <div>
                <span className="eyebrow dark">{reportDone ? 'NGÀY ĐÃ ĐÓNG' : 'LUỒNG VẬN HÀNH'}</span>
                <h2>{reportDone ? 'Kết thúc ngày' : '6 bước của một ngày vận hành'}</h2>
                <p>{reportDone ? '6/6 bước đã hoàn tất. Hẹn gặp lại vào ca sau.' : 'Bấm từng icon bên trái hoặc mở trực tiếp từng bước bên dưới.'}</p>
              </div>
              <div className="today-progress">
                <strong>{completedSteps}/{steps.length}</strong>
                <span>đã hoàn tất</span>
              </div>
            </div>
            <div className="progress-track" aria-label={`Đã hoàn tất ${completedSteps} trên ${steps.length} bước`}>
              <span style={{ width: `${progress}%` }} />
            </div>
            {reportDone ? (
              <div className="today-finished-panel">
                <span>✓</span>
                <div>
                  <strong>Ngày vận hành đã hoàn tất</strong>
                  <p>Báo cáo cuối ngày đã chốt. Cả đội có thể nghỉ ngơi rồi, chúc ngủ ngon.</p>
                </div>
                <button onClick={() => onNavigate('report')}>Xem báo cáo</button>
              </div>
            ) : (
              <div className="today-step-list">
                {steps.map((step) => {
                  const isCurrent = !reportDone && step.number === nextStep.number
                  return (
                    <button
                      key={step.number}
                      className={`today-step${step.done ? ' done' : ''}${isCurrent ? ' current' : ''}`}
                      onClick={blockedByAttendance ? () => onNavigate('attendance') : step.action}
                    >
                      <span className="today-step-number">{step.done ? '✓' : step.icon}</span>
                      <span className="today-step-copy">
                        <small>BƯỚC {step.number}</small>
                        <strong>{step.title}</strong>
                        <span>{step.description}</span>
                      </span>
                      <span className="today-step-state">{blockedByAttendance ? 'Cần check-in' : step.done ? 'Đã xong' : isCurrent ? 'Làm ngay' : 'Mở'}</span>
                      <b>→</b>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      <section className="today-priority-dock" aria-label="Chức năng trọng điểm">
        <button onClick={() => onNavigate('sales')}><span>₫</span><strong>Bán hàng</strong><small>Tạo hóa đơn</small></button>
        <button onClick={() => onNavigate('handover')}><span>⇄</span><strong>Bàn giao</strong><small>Phát/thu túi</small></button>
        <button onClick={() => onOpenInventory('overview')}><span>▦</span><strong>Tồn kho</strong><small>{lowStock.length ? `${lowStock.length} cảnh báo` : 'Đang ổn'}</small></button>
        <button onClick={() => onNavigate('orders')}><span>↑</span><strong>Đặt hàng</strong><small>Báo bếp</small></button>
        <button onClick={() => onOpenInventory('count')}><span>≡</span><strong>Kiểm kê</strong><small>Cuối ca</small></button>
        {user.role === 'shift_leader' && <button onClick={() => onNavigate('restaurant')}><span>◇</span><strong>Quản lý</strong><small>Doanh thu</small></button>}
      </section>

      {lowStock.length > 0 && <section className="today-warning">
        <strong>Có {lowStock.length} mặt hàng sắp hết</strong>
        <span>{lowStock.slice(0, 3).map((line) => PRODUCTS.find((item) => item.id === line.product.id)?.name).join(' · ')}</span>
        <button onClick={() => onOpenInventory('overview')}>Xem tồn kho</button>
      </section>}

      {/* Modal báo đặt hàng */}
      {orderModal && (
        <div className="supply-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOrderModal(false) }}>
          <div className="supply-modal">
            <div className="supply-modal-header">
              <span>↑</span>
              <div>
                <h2>Báo đặt hàng</h2>
                <p>Thêm nhiều món trong một lần gửi. Bếp sẽ nhận chuông và quản lý vẫn xem được.</p>
              </div>
              <button className="supply-modal-close" onClick={() => setOrderModal(false)} aria-label="Đóng">×</button>
            </div>
            {orderFeedback ? (
              <div className={`feedback-bar${orderFeedback.startsWith('Đã gửi') ? ' success' : ''}`} style={{ marginBottom: 0 }}>
                {orderFeedback}
              </div>
            ) : (
              <form onSubmit={submitOrder} style={{ display: 'grid', gap: 13 }}>
                <div className="supply-order-lines">
                  {orderLines.map((line, index) => (
                    <div className="supply-order-line" key={line.id}>
                      <div className="supply-order-line-head">
                        <strong>Món {index + 1}</strong>
                        {orderLines.length > 1 && (
                          <button type="button" onClick={() => removeOrderLine(line.id)}>Xóa</button>
                        )}
                      </div>
                      <label>
                        Hàng cần đặt
                        <input
                          ref={index === 0 ? orderProductRef : undefined}
                          value={line.productName}
                          onChange={(e) => updateOrderLine(line.id, { productName: e.target.value })}
                          placeholder="Hạt dẻ, đường, túi 110g..."
                          required={index === 0}
                        />
                      </label>
                      <div className="supply-order-qty">
                        <label>
                          Số lượng
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={line.quantity}
                            onChange={(e) => updateOrderLine(line.id, { quantity: e.target.value })}
                            placeholder="10"
                            required={index === 0}
                          />
                        </label>
                        <label>
                          Đơn vị
                          <select value={line.unit} onChange={(e) => updateOrderLine(line.id, { unit: e.target.value })}>
                            <option value="kg">kg</option>
                            <option value="túi">túi</option>
                            <option value="thùng">thùng</option>
                            <option value="hộp">hộp</option>
                            <option value="cái">cái</option>
                            <option value="lít">lít</option>
                          </select>
                        </label>
                      </div>
                      <label>
                        Ghi chú
                        <input
                          value={line.note}
                          onChange={(e) => updateOrderLine(line.id, { note: e.target.value })}
                          placeholder="Cần trước 9 giờ sáng, loại A..."
                        />
                      </label>
                    </div>
                  ))}
                </div>
                <button type="button" className="secondary-button" onClick={addOrderLine}>+ Thêm món</button>
                <div className="supply-modal-actions">
                  <button type="button" className="secondary-button" onClick={() => setOrderModal(false)}>Huỷ</button>
                  <button type="submit" className="primary-button" disabled={orderBusy}>
                    {orderBusy ? 'Đang gửi…' : 'Gửi yêu cầu →'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function buildAttendanceReminder(registrations: ShiftRegistration[], records: AttendanceRecord[]) {
  const now = new Date()
  const today = localDateKey(now)
  const activeRegistrations = registrations
    .filter((item) => item.workDate === today && item.status !== 'rejected')
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  for (const registration of activeRegistrations) {
    const record = records.find((item) => item.shiftRegistrationId === registration.id)
    const startsAt = new Date(`${registration.workDate}T${registration.startTime}:00`)
    const endsAt = new Date(`${registration.workDate}T${registration.endTime}:00`)
    if (registration.endTime <= registration.startTime) endsAt.setDate(endsAt.getDate() + 1)
    const opensAt = new Date(startsAt.getTime() - 15 * 60000)
    const lateAt = new Date(startsAt.getTime() + 5 * 60000)
    if (!record && now >= lateAt && now <= endsAt) {
      return {
        tone: 'late',
        title: 'Bạn đang trễ chấm công',
        message: `Ca ${registration.startTime}-${registration.endTime} đã bắt đầu. Hãy check-in ngay để lưu minh chứng.`,
      }
    }
    if (!record && now >= opensAt && now < lateAt) {
      return {
        tone: 'soon',
        title: 'Đến giờ chấm công',
        message: `Ca ${registration.startTime}-${registration.endTime} đã mở check-in. Nhớ chụp selfie trước khi vào ca.`,
      }
    }
    if (record && !record.checkOutTime && now >= new Date(endsAt.getTime() - 10 * 60000)) {
      return {
        tone: 'soon',
        title: 'Sắp đến giờ check-out',
        message: `Ca ${registration.startTime}-${registration.endTime} sắp kết thúc. Đừng quên check-out khi bàn giao xong.`,
      }
    }
  }
  return null
}
