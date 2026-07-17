import { useEffect, useMemo, useRef, useState } from 'react'
import type { InventoryTab, Page } from '../components/AppShell'
import { PRODUCTS } from '../lib/constants'
import { branchName } from '../lib/branches'
import { calculateStock, fetchReportSnapshots, getOperationDay } from '../lib/store'
import { fetchBagShiftSessions, uploadBagShiftPhoto } from '../lib/shiftLedger'
import { imageFileToDataUrl } from '../lib/browser'
import { ShiftPhotoButton } from '../components/ShiftPhotoButton'
import { fetchSalesReceipts, type SalesReceipt } from '../lib/salesReceipts'
import { createSupplyRequests } from '../lib/supplyRequests'
import { fetchAttendanceRecords, fetchShiftRegistrations, findAttendanceRecordForRegistration } from '../lib/attendance'
import { localDateKey } from '../lib/dates'
import { supabase, uniqueChannelName } from '../lib/supabase'
import type { AppUser, AttendanceRecord, BagShiftSession, OperationDay, ShiftRegistration, StockMovement } from '../types'

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

const emptyOrderLine = (): OrderDraftLine => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  productName: '',
  quantity: '',
  unit: 'kg',
  note: '',
})

export function TodayPage({ user, movements, onNavigate, onOpenInventory }: Props) {
  const [operationDay, setOperationDay] = useState<OperationDay | null>(null)
  const [bagSessions, setBagSessions] = useState<BagShiftSession[]>([])
  const [salesReceipts, setSalesReceipts] = useState<SalesReceipt[]>([])
  const [registrations, setRegistrations] = useState<ShiftRegistration[]>([])
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([])
  const [reportedShiftIds, setReportedShiftIds] = useState<string[]>([])
  const [orderModal, setOrderModal] = useState(false)
  const [orderLines, setOrderLines] = useState<OrderDraftLine[]>(() => [emptyOrderLine()])
  const [orderBusy, setOrderBusy] = useState(false)
  const [orderFeedback, setOrderFeedback] = useState('')
  const [openingBusy, setOpeningBusy] = useState(false)
  const [openingFeedback, setOpeningFeedback] = useState('')
  const [closingBusy, setClosingBusy] = useState(false)
  const [closingFeedback, setClosingFeedback] = useState('')
  const [clockNow, setClockNow] = useState(() => new Date())
  const orderProductRef = useRef<HTMLInputElement>(null)
  const todayKey = localDateKey(clockNow)
  const todayItems = movements.filter((item) => item.shiftDate === todayKey)
  const currentBranchName = branchName(user.branchId)
  const stock = calculateStock(movements)
  const lowStock = stock.filter((line) => line.expected <= line.product.lowStock)
  const inboundDone = todayItems.some((item) => item.type === 'inbound')
  const processingDone = todayItems.some((item) => item.type === 'processing_in')
  const saleDone = salesReceipts.length > 0
  const closedBagSessions = bagSessions.filter((item) => item.status === 'closed')
  const openBagSession = bagSessions.find((item) => item.status === 'open')
  const latestClosedOwnSession = [...closedBagSessions]
    .filter((item) => item.leaderId === user.id || item.leaderName.trim().toLocaleLowerCase('vi') === user.name.trim().toLocaleLowerCase('vi'))
    .sort((a, b) => (b.endedAt || b.startedAt).localeCompare(a.endedAt || a.startedAt))[0]
  const expectedDailyShifts = 2
  const reportReady = Boolean(latestClosedOwnSession)
  const reportDone = operationDay?.status === 'closed'
  const userCheckedInToday = attendanceRecords.some((item) => item.userId === user.id)
  const attendanceReminder = buildAttendanceReminder(
    registrations.filter((item) => item.userId === user.id),
    attendanceRecords.filter((item) => item.userId === user.id),
    clockNow,
  )

  useEffect(() => {
    const updateClock = () => setClockNow(new Date())
    const timer = window.setInterval(updateClock, 15000)
    window.addEventListener('focus', updateClock)
    document.addEventListener('visibilitychange', updateClock)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', updateClock)
      document.removeEventListener('visibilitychange', updateClock)
    }
  }, [])

  useEffect(() => {
    void getOperationDay(user.branchId, todayKey, user).then(setOperationDay)
  }, [todayItems.length, todayKey, user.branchId])
  useEffect(() => {
    void fetchReportSnapshots(user.branchId, user).then((snapshots) => {
      const snapshot = snapshots.find((item) => item.reportDate === todayKey)
      setReportedShiftIds(Object.keys(snapshot?.payload.shiftReports || {}))
    }).catch(() => setReportedShiftIds([]))
  }, [todayKey, user.id, user.branchId, bagSessions])
  useEffect(() => {
    void Promise.all([
      fetchBagShiftSessions(user, { branchId: user.branchId, date: todayKey }),
      fetchSalesReceipts(user, { branchId: user.branchId, date: todayKey }).catch(() => [] as SalesReceipt[]),
    ]).then(([nextSessions, nextReceipts]) => {
      setBagSessions(nextSessions)
      setSalesReceipts(nextReceipts)
    }).catch(() => {
      // Trang bàn giao sẽ hiển thị lỗi chi tiết nếu máy chủ chưa sẵn sàng.
    })
  }, [todayKey, user.id, user.branchId])
  useEffect(() => {
    const reloadOperations = () => {
      void Promise.all([
        fetchBagShiftSessions(user, { branchId: user.branchId, date: todayKey }),
        fetchSalesReceipts(user, { branchId: user.branchId, date: todayKey }),
      ]).then(([nextSessions, nextReceipts]) => {
        setBagSessions(nextSessions)
        setSalesReceipts(nextReceipts)
      }).catch(() => undefined)
    }
    const timer = window.setInterval(reloadOperations, 8000)
    window.addEventListener('focus', reloadOperations)
    document.addEventListener('visibilitychange', reloadOperations)
    const client = user.authToken ? null : supabase
    const channel = client?.channel(uniqueChannelName(`today-live:${user.branchId}:${todayKey}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bag_shift_sessions', filter: `branch_id=eq.${user.branchId}` }, reloadOperations)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_receipts', filter: `branch_id=eq.${user.branchId}` }, reloadOperations)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_receipt_items' }, reloadOperations)
      .subscribe()
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', reloadOperations)
      document.removeEventListener('visibilitychange', reloadOperations)
      if (client && channel) void client.removeChannel(channel)
    }
  }, [todayKey, user.id, user.branchId, user.authToken])
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
  const scrollToOpeningPhoto = () => document.getElementById('today-opening-photo')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const scrollToClosingPhoto = () => document.getElementById('today-closing-photo')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const latestClosedSession = [...closedBagSessions].sort((a, b) => b.sequence - a.sequence)[0]
  const openingPhotoDone = Boolean(openBagSession?.openingPhotoUrl || latestClosedSession?.openingPhotoUrl)
  const closingPhotoDone = Boolean(openBagSession?.closingPhotoUrl || latestClosedSession?.closingPhotoUrl)
  const steps = [
    {
      number: 1,
      icon: '📷',
      title: 'Chụp hình quầy đầu ca',
      description: 'Ca tự mở sau khi ca trưởng check-in. Chụp quầy trước khi bắt đầu bán.',
      done: openingPhotoDone,
      action: openBagSession ? scrollToOpeningPhoto : () => onNavigate('attendance'),
      actionLabel: openBagSession ? 'Chụp ảnh đầu ca' : 'Check-in để mở ca',
    },
    {
      number: 2,
      icon: '↓',
      title: 'Nhập hàng đầu ngày',
      description: 'Ghi số nguyên liệu và hàng hóa vừa nhận vào kho.',
      done: inboundDone,
      action: () => onOpenInventory('inbound'),
      actionLabel: 'Nhập kho',
    },
    {
      number: 3,
      icon: '↔',
      title: 'Rang / chế biến',
      description: 'Ghi lượng lấy từ kho và lượng thành phẩm sau rang.',
      done: processingDone,
      action: () => onOpenInventory('processing_out'),
      actionLabel: 'Ghi mẻ chế biến',
    },
    {
      number: 4,
      icon: '◉',
      title: 'Nhân viên bán hàng',
      description: 'Nhân viên tạo hóa đơn POS trực tiếp theo menu đang hiển thị.',
      done: saleDone,
      action: () => onNavigate('sales'),
      actionLabel: 'Mở POS',
    },
    {
      number: 5,
      icon: '📸',
      title: 'Chụp hình quầy cuối ca',
      description: 'Chụp quầy cuối ca rồi vào Bàn giao để kiểm tồn và chốt ca.',
      done: closingPhotoDone && (!openBagSession || openBagSession.status === 'closed'),
      action: openBagSession ? scrollToClosingPhoto : () => onNavigate('handover'),
      actionLabel: openBagSession ? 'Chụp ảnh cuối ca' : 'Xem bàn giao',
    },
    {
      number: 6,
      icon: '▤',
      title: latestClosedOwnSession?.sequence === 1 ? 'Báo cáo cuối Ca 1' : 'Báo cáo cuối Ca 2 & Tổng ngày',
      description: latestClosedOwnSession?.sequence === 1
        ? 'Sau khi bàn giao Ca 1, mở báo cáo để kiểm tra dữ liệu Ca 1 và bấm Chốt báo cáo.'
        : 'Sau khi bàn giao Ca 2, xem Ca 2/Tổng ngày và dùng một nút Chốt báo cáo cho cả hai.',
      done: Boolean(latestClosedOwnSession && reportedShiftIds.includes(latestClosedOwnSession.id)),
      action: () => onNavigate('report'),
      actionLabel: 'Mở báo cáo cuối ca',
    },
  ]
  const nextStep = steps.find((step) => !step.done) || steps[steps.length - 1]
  const blockedByAttendance = !reportDone && !userCheckedInToday
  const needsOpeningPhoto = !reportDone && userCheckedInToday && Boolean(openBagSession) && !openBagSession?.openingPhotoUrl
  const actionStep = blockedByAttendance
    ? {
        number: 0,
        title: 'Chấm công trước khi vào ca',
        description: 'Hãy check-in trong mục Chấm công, sau đó mới nhập hàng, nhận ca và bán hàng.',
        action: () => onNavigate('attendance'),
        actionLabel: 'Mở chấm công',
      }
    : needsOpeningPhoto
      ? {
          number: 0,
          title: 'Chụp ảnh quầy đầu ca',
          description: 'Ca đã mở. Hãy chụp hoặc tải ảnh quầy đầu ca trước khi bán để đối chiếu cuối ca.',
          action: scrollToOpeningPhoto,
          actionLabel: 'Chụp ảnh đầu ca',
        }
      : reportReady
        ? {
            number: 6,
            title: latestClosedOwnSession?.sequence === 1 ? 'Mở báo cáo Ca 1' : 'Mở báo cáo Ca 2 & Tổng ngày',
            description: latestClosedOwnSession?.sequence === 1
              ? 'Ca 1 đã bàn giao. Báo cáo chỉ lấy dữ liệu Ca 1.'
              : 'Ca 2 đã bàn giao. Có thể xem riêng Ca 2 hoặc Tổng ngày trước khi chốt.',
            action: () => onNavigate('report'),
            actionLabel: 'Mở báo cáo',
          }
        : nextStep
  const completedSteps = steps.filter((step) => step.done).length
  const progress = completedSteps / steps.length * 100
  const soldProducts = salesReceipts.reduce((sum, item) => sum + item.totalQuantity, 0)
  const salesRevenue = salesReceipts.reduce((sum, item) => sum + item.totalAmount, 0)
  const topSellerRows = useMemo(() => {
    const map = new Map<string, { key: string; name: string; quantity: number; revenue: number; receipts: number }>()
    salesReceipts.forEach((receipt) => {
      const key = receipt.sellerId || receipt.sellerKey || receipt.sellerName
      const row = map.get(key) || { key, name: receipt.sellerName, quantity: 0, revenue: 0, receipts: 0 }
      row.quantity += receipt.totalQuantity
      row.revenue += receipt.totalAmount
      row.receipts += 1
      map.set(key, row)
    })
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity).slice(0, 5)
  }, [salesReceipts])
  const activePgCount = new Set(
    salesReceipts.map((item) => item.sellerId || item.sellerName),
  ).size
  const shiftLabel = openBagSession
    ? `Ca ${openBagSession.sequence} đang mở`
    : closedBagSessions.length
      ? `Đã chốt ${closedBagSessions.length}/${expectedDailyShifts} ca`
      : 'Chưa mở ca'
  const reportLabel = reportDone ? 'Đã chốt ngày' : reportReady ? 'Sẵn sàng xuất' : 'Chưa đủ dữ liệu'

  async function saveOpeningPhoto(file?: File) {
    if (!file) return
    if (!openBagSession) {
      setOpeningFeedback('Chưa có ca tự động. Hãy check-in ca trưởng rồi tải lại trang Hôm nay.')
      return
    }
    setOpeningBusy(true)
    setOpeningFeedback('')
    try {
      const dataUrl = await imageFileToDataUrl(file)
      await uploadBagShiftPhoto(user, openBagSession, 'opening', dataUrl)
      const next = await fetchBagShiftSessions(user, { branchId: user.branchId, date: todayKey })
      setBagSessions(next)
      setOpeningFeedback('Đã lưu ảnh quầy đầu ca.')
    } catch (error) {
      setOpeningFeedback(error instanceof Error ? error.message : 'Không thể lưu ảnh đầu ca.')
    } finally {
      setOpeningBusy(false)
    }
  }

  async function saveClosingPhoto(file?: File) {
    if (!file || !openBagSession) return
    setClosingBusy(true)
    setClosingFeedback('')
    try {
      const dataUrl = await imageFileToDataUrl(file)
      await uploadBagShiftPhoto(user, openBagSession, 'closing', dataUrl)
      const next = await fetchBagShiftSessions(user, { branchId: user.branchId, date: todayKey })
      setBagSessions(next)
      setClosingFeedback('Đã lưu ảnh quầy cuối ca. Bây giờ vào Bàn giao để kiểm tồn và chốt ca.')
    } catch (error) {
      setClosingFeedback(error instanceof Error ? error.message : 'Không thể lưu ảnh cuối ca.')
    } finally {
      setClosingBusy(false)
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
      setTimeout(() => setOrderModal(false), 1400)
    } catch (reason) {
      setOrderFeedback(reason instanceof Error ? reason.message : 'Không thể gửi yêu cầu.')
    } finally {
      setOrderBusy(false)
    }
  }

  return (
    <div className="page today-page shift-workspace-page">
      <section className="shift-hero-card">
        <div>
          <span className="eyebrow dark">BẢNG ĐIỀU PHỐI CA TRƯỞNG</span>
          <h1>{currentBranchName || 'Chi nhánh'} hôm nay</h1>
          <p>{new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })} · {user.name}</p>
        </div>
        <div className="shift-hero-status">
          <span className={reportDone ? 'shift-status closed' : !userCheckedInToday ? 'shift-status waiting' : openBagSession ? 'shift-status open' : 'shift-status waiting'}>
            <i /> {reportDone ? 'Đã chốt ngày' : !userCheckedInToday ? 'Cần check-in' : openBagSession ? shiftLabel : 'Chờ mở ca'}
          </span>
        </div>
      </section>

      {attendanceReminder && (
        <section className={`attendance-reminder-card ${attendanceReminder.tone}`}>
          <img className="attendance-capybara-image attendance-capybara" src="/mascots/capy-attendance-camera.png" alt="" width="256" height="256" decoding="async" aria-hidden="true" />
          <strong>{attendanceReminder.title}</strong>
          <span>{attendanceReminder.message}</span>
          <button onClick={() => onNavigate('attendance')}>Mở chấm công</button>
        </section>
      )}

      {!reportDone && (
        <section id="today-opening-photo" className={openBagSession?.openingPhotoUrl ? 'today-opening-photo-card ready' : 'today-opening-photo-card'}>
          <div className="today-opening-photo-copy">
            <span className="eyebrow dark">ẢNH QUẦY ĐẦU CA</span>
            <strong>{openBagSession?.openingPhotoUrl ? 'Đã có ảnh quầy đầu ca' : openBagSession ? 'Chụp ảnh quầy đầu ca' : 'Check-in để ca tự mở'}</strong>
            <small>{openBagSession
              ? 'Chụp hoặc tải 1 ảnh quầy trước khi bán để đối chiếu cuối ca. Bấm nút rồi chọn Chụp ảnh hoặc Tải ảnh lên.'
              : 'Sau khi ca trưởng check-in thành công, hệ thống tự mở Ca 1/Ca 2 và nút chụp ảnh sẽ hiện tại đây.'}</small>
            {openingFeedback && <em>{openingFeedback}</em>}
          </div>
          {openBagSession?.openingPhotoUrl && <img src={openBagSession.openingPhotoUrl} alt="Ảnh quầy đầu ca" />}
          <div className="today-opening-photo-action">
            {openBagSession
              ? <ShiftPhotoButton prefix={openBagSession.openingPhotoUrl ? 'Đổi ảnh đầu ca' : 'Ảnh đầu ca'} onPick={(file) => void saveOpeningPhoto(file)} />
              : <button type="button" className="secondary-button" onClick={() => onNavigate('attendance')}>Mở chấm công</button>}
            {openingBusy && <small className="attendance-busy-hint">Đang lưu ảnh…</small>}
          </div>
        </section>
      )}

      <section className="shift-kpi-grid" aria-label="Tổng quan ca">
        <article>
          <small>Trạng thái ca</small>
          <strong>{shiftLabel}</strong>
          <span>{reportReady ? 'Đủ điều kiện xuất báo cáo' : `${completedSteps}/${steps.length} bước đã xong`}</span>
        </article>
        <article>
          <small>Nhân viên đã bán</small>
          <strong>{activePgCount}</strong>
          <span>{salesReceipts.length.toLocaleString('vi-VN')} hóa đơn POS</span>
        </article>
        <article>
          <small>Đã bán</small>
          <strong>{soldProducts.toLocaleString('vi-VN')}</strong>
          <span>{Math.round(salesRevenue).toLocaleString('vi-VN')}đ doanh thu POS</span>
        </article>
        <article className={lowStock.length ? 'warning' : ''}>
          <small>Cảnh báo kho</small>
          <strong>{lowStock.length ? `${lowStock.length} món` : 'Ổn'}</strong>
          <span>{lowStock.length ? 'Cần kiểm tra tồn tối thiểu' : 'Không có tồn thấp'}</span>
        </article>
      </section>

      <section className="today-revenue-dashboard">
        <div className="today-revenue-main">
          <span className="eyebrow dark">DOANH THU CHI NHÁNH</span>
          <strong>{Math.round(salesRevenue).toLocaleString('vi-VN')}đ</strong>
          <small>{salesReceipts.length.toLocaleString('vi-VN')} hóa đơn · {soldProducts.toLocaleString('vi-VN')} sản phẩm đã bán hôm nay</small>
        </div>
        <div className="today-top-sellers">
          <div className="today-top-sellers-head">
            <strong>Top nhân viên</strong>
            <button type="button" onClick={() => onNavigate('sales')}>Mở POS</button>
          </div>
          {topSellerRows.length ? topSellerRows.map((seller, index) => (
            <article key={seller.key}>
              <b>{index + 1}</b>
              <span><strong>{seller.name}</strong><small>{seller.receipts} hóa đơn · {formatCompactNumber(seller.quantity)} sản phẩm</small></span>
              <em>{Math.round(seller.revenue).toLocaleString('vi-VN')}đ</em>
            </article>
          )) : <p>Chưa có hóa đơn POS hôm nay.</p>}
        </div>
      </section>

      <section className="shift-next-panel">
        <div className="shift-next-copy">
          <span>{reportDone ? '✓' : actionStep.number || '!'}</span>
          <div>
            <small>{reportDone ? 'NGÀY ĐÃ ĐÓNG' : blockedByAttendance ? 'CẦN LÀM TRƯỚC' : 'VIỆC NÊN LÀM TIẾP'}</small>
            <h2>{reportDone ? 'Báo cáo cuối ngày đã chốt' : actionStep.title}</h2>
            <p>{reportDone ? 'Dữ liệu đã vào báo cáo và dashboard quản lý.' : actionStep.description}</p>
          </div>
        </div>
        <button onClick={reportDone ? () => onNavigate('report') : actionStep.action}>
          {reportDone ? 'Xem báo cáo' : actionStep.actionLabel}
        </button>
      </section>

      <section className="shift-mini-flow" aria-label="Tiến độ vận hành">
        <div className="shift-mini-flow-head">
          <div>
            <span className="eyebrow dark">TIẾN ĐỘ NGÀY</span>
            <h2>{completedSteps}/{steps.length} bước hoàn tất</h2>
          </div>
          <strong>{Math.round(progress)}%</strong>
        </div>
        <div className="progress-track" aria-label={`Đã hoàn tất ${completedSteps} trên ${steps.length} bước`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="shift-flow-chips">
          {steps.map((step) => {
            const isCurrent = !reportDone && step.number === nextStep.number
            return (
              <button
                key={step.number}
                className={`${step.done ? 'done' : ''}${isCurrent ? ' current' : ''}`}
                onClick={blockedByAttendance ? () => onNavigate('attendance') : step.action}
              >
                <span>{step.done ? '✓' : step.number}</span>
                <strong>{step.title}</strong>
              </button>
            )
          })}
        </div>
      </section>

      {!reportDone && openBagSession && (
        <section id="today-closing-photo" className={openBagSession.closingPhotoUrl ? 'today-opening-photo-card today-closing-photo-card ready' : 'today-opening-photo-card today-closing-photo-card'}>
          <div className="today-opening-photo-copy">
            <span className="eyebrow dark">BƯỚC CUỐI · ẢNH QUẦY CUỐI CA</span>
            <strong>{openBagSession.closingPhotoUrl ? 'Đã có ảnh quầy cuối ca' : 'Chụp hình quầy cuối ca'}</strong>
            <small>Chụp ảnh sau khi kết thúc bán. Ảnh được gắn thẳng vào ca đang mở; sau đó vào Bàn giao để kiểm tồn và chốt ca.</small>
            {closingFeedback && <em>{closingFeedback}</em>}
          </div>
          {openBagSession.closingPhotoUrl && <img src={openBagSession.closingPhotoUrl} alt="Ảnh quầy cuối ca" />}
          <div className="today-opening-photo-action">
            <ShiftPhotoButton prefix={openBagSession.closingPhotoUrl ? 'Đổi ảnh cuối ca' : 'Ảnh cuối ca'} onPick={(file) => void saveClosingPhoto(file)} />
            <button type="button" className="secondary-button" onClick={() => onNavigate('handover')}>Mở Bàn giao</button>
            {closingBusy && <small className="attendance-busy-hint">Đang lưu ảnh…</small>}
          </div>
        </section>
      )}

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

function buildAttendanceReminder(registrations: ShiftRegistration[], records: AttendanceRecord[], now = new Date()) {
  const today = localDateKey(now)
  const activeRegistrations = registrations
    .filter((item) => item.workDate === today && item.status !== 'rejected')
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  for (const registration of activeRegistrations) {
    const record = findAttendanceRecordForRegistration(records, registration)
    const startsAt = new Date(`${registration.workDate}T${registration.startTime}:00`)
    const endsAt = new Date(`${registration.workDate}T${registration.endTime}:00`)
    if (registration.endTime <= registration.startTime) endsAt.setDate(endsAt.getDate() + 1)
    // Đồng bộ với màn hình Chấm công: mở nhắc và thao tác trước giờ ca 30 phút.
    const opensAt = new Date(startsAt.getTime() - 30 * 60000)
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
    if (record && !record.checkOutTime && now >= new Date(endsAt.getTime() - 30 * 60000)) {
      return {
        tone: 'soon',
        title: 'Sắp đến giờ check-out',
        message: `Ca ${registration.startTime}-${registration.endTime} đã mở check-out. Đừng quên chụp ảnh và check-out riêng cho ca này.`,
      }
    }
  }
  return null
}

function formatCompactNumber(value: number) {
  return Number(value.toFixed(2)).toLocaleString('vi-VN')
}
