import { useEffect, useMemo, useRef, useState } from 'react'
import { ShiftPhotoButton } from '../components/ShiftPhotoButton'
import { getProducts, getSaleProducts, isWarehouseProduct, productById, type ConfiguredProduct } from '../lib/constants'
import { burstGuard, createId, imageFileToDataUrl } from '../lib/browser'
import { calculateStock, ensureOperationDay, getOperationDay } from '../lib/store'
import { formatQuantity } from '../lib/inventoryEntry'
import { hasCountInput, productsToCount, uncountedProducts } from '../lib/shiftCountScope'
import { fetchAttendanceRecords, fetchShiftRegistrations, fetchWorkShifts, findAttendanceRecordForRegistration } from '../lib/attendance'
import { supabase, uniqueChannelName } from '../lib/supabase'
import { formatLocalDate, localDateKey } from '../lib/dates'
import { fetchConfiguredProducts } from '../lib/products'
import { branchName as configuredBranchName } from '../lib/branches'
import { notifyN8nShiftPhoto } from '../lib/n8nShiftPhoto'
import {
  canOpenNextScheduledOperationalShift,
  isDeputyShiftLeader,
  nextOperationalSequence,
  primaryLeadersScheduledFor,
  scheduledOperationalSequences,
} from '../lib/operationalShiftAssignment'
import { writeHandoverReportRequest, type HandoverReportRequest } from '../lib/handoverReportRequest'
import type { Page } from '../components/AppShell'
import {
  closeBagShift,
  fetchBagShiftSessions,
  ownsBagShiftSession,
  reopenBagShift,
  startBagShift,
  uploadBagShiftPhoto,
} from '../lib/shiftLedger'
import { fetchSalesReceipts, type SalesReceipt } from '../lib/salesReceipts'
import { sessionScopeWindow, timestampInScopeWindow } from '../lib/shiftReportScope'
import type { AppUser, AttendanceRecord, BagShiftSession, OperationDay, ShiftRegistration, StockMovement, WorkShift } from '../types'

function shiftLabel(sequence: number) {
  if (sequence === 1) return 'Ca sáng'
  if (sequence === 2) return 'Ca tối'
  return `Ca ${sequence}`
}

export function ShiftHandoverPage({
  user,
  movements,
  onChanged,
  onNavigate,
}: {
  user: AppUser
  movements: StockMovement[]
  onChanged: () => Promise<void>
  onNavigate: (page: Page) => void
}) {
  // `today` phải bám đồng hồ: tính một lần lúc mount thì màn Bàn giao mở qua
  // nửa đêm (ca tối) sẽ giữ closure ngày HÔM QUA cho mọi lượt refresh/realtime
  // — fetch mãi dữ liệu ngày cũ. Tick 30s + effect phụ thuộc `today` bên dưới.
  const [clockTick, setClockTick] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])
  const today = localDateKey(new Date(clockTick))
  const [sessions, setSessions] = useState<BagShiftSession[]>([])
  const [receipts, setReceipts] = useState<SalesReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [registrations, setRegistrations] = useState<ShiftRegistration[]>([])
  const [workShifts, setWorkShifts] = useState<WorkShift[]>([])
  const [myAttendance, setMyAttendance] = useState<AttendanceRecord[]>([])
  const [closingBalances, setClosingBalances] = useState<Record<string, string>>({})
  const [discrepancyNote, setDiscrepancyNote] = useState('')
  const [openingPhoto, setOpeningPhoto] = useState('')
  const [closingPhoto, setClosingPhoto] = useState('')
  const [operationDay, setOperationDay] = useState<OperationDay | null>(null)
  const [productTick, setProductTick] = useState(0)
  const [autoStartFailed, setAutoStartFailed] = useState(false)
  const [takeOverArmed, setTakeOverArmed] = useState(false)
  const [standInArmed, setStandInArmed] = useState(false)
  const [coverArmed, setCoverArmed] = useState(false)
  const [closeArmed, setCloseArmed] = useState(false)
  const autoStartAttemptRef = useRef('')

  const saleProducts = useMemo(() => getSaleProducts(), [productTick])
  // Kiểm đếm cuối ca phải phủ MỌI thành phẩm kho, không riêng hàng cân ký.
  // Bản cũ chỉ lấy thành phẩm đơn vị kg nên "Bánh hạt dẻ thành phẩm" (đơn vị cái)
  // không bao giờ xuất hiện ở màn chốt ca ⇒ không có mốc kiểm kê nào ⇒ POS trừ
  // hoài mà không ai đếm lại, tồn tụt xuống −1.132 cái ở Lotte Vũng Tàu (06/08).
  const countProducts = useMemo(() => {
    const finishedProducts = getProducts().filter((product) =>
      product.active !== false && product.category === 'finished' && isWarehouseProduct(product),
    )
    return finishedProducts.length ? finishedProducts : saleProducts
  }, [productTick, saleProducts])
  const branchOpenSession = sessions.find((item) => item.status === 'open' && item.businessDate === today)
  const staleOpenSessions = sessions.filter((item) => item.status === 'open' && item.businessDate < today)
  const todaySessions = sessions.filter((item) => item.businessDate === today)
  const hasClosedShift = todaySessions.some((item) => item.status === 'closed')
  const dayClosed = operationDay?.status === 'closed'
  const dayLocked = dayClosed
  const openAttendances = myAttendance.filter((record) => !record.checkOutTime)
  const activeAttendance = openAttendances[0]
  const myApprovedRegistrations = registrations.filter((item) =>
    item.userId === user.id && item.workDate === today && item.status === 'approved',
  )
  const ownOpenSession = branchOpenSession && ownsBagShiftSession(branchOpenSession, user) ? branchOpenSession : undefined
  const foreignOpenSession = branchOpenSession && !ownOpenSession ? branchOpenSession : undefined
  // Ca trưởng trước về mà không bấm "Chốt & bàn giao ca" là ca vận hành đứng nguyên:
  // người của ca sau không mở được ca mới (chi nhánh còn ca đang mở) và trước đây cũng
  // KHÔNG có nút nào để chốt hộ — cả chi nhánh kẹt tới nửa đêm chờ cron. Máy chủ vốn
  // đã cho ca trưởng cùng chi nhánh chốt (`can_manage_branch`), chỉ giao diện là chặn.
  // Nay mở đúng một lối: phải bấm + xác nhận, phải đếm tồn thật và phải ghi lý do,
  // nên không có chuyện ca sau lặng lẽ chiếm ca trước (BUG-100 giữ nguyên).
  const canCoverForeignShift = Boolean(
    foreignOpenSession
    && !dayLocked
    && (user.role === 'manager' || user.role === 'admin'
      || (user.role === 'shift_leader' && activeAttendance && myApprovedRegistrations.length > 0)),
  )
  const coveringSession = coverArmed && canCoverForeignShift ? foreignOpenSession : undefined
  const openSession = ownOpenSession || coveringSession
  const anotherLeaderOpenSession = foreignOpenSession && !coveringSession ? foreignOpenSession : undefined
  const maxShiftsReached = !openSession && todaySessions.length >= 2
  // Chi nhánh ít ca trưởng (vd Vũng Tàu chỉ có 2 người) hay xếp CÙNG một ca trưởng
  // cho cả Ca 1 lẫn Ca 2 trong ngày, tức là 2 đăng ký + 2 bản ghi chấm công.
  // Trước đây chỉ xét đăng ký gắn với bản ghi chấm công ĐẦU TIÊN còn mở, nên sau khi
  // chốt Ca 1 hệ thống vẫn đọc ra đăng ký Ca 1 và từ chối mở Ca 2 → "chưa nhận được ca".
  // Giờ xét MỌI đăng ký đã duyệt mà ca trưởng đang check-in, rồi lấy đăng ký khớp
  // đúng sequence kế tiếp. Quy tắc BUG-100 giữ nguyên: vẫn phải có lịch + đã check-in.
  const startableRegistration = myApprovedRegistrations.find((registration) =>
    openAttendances.some((record) => record.shiftRegistrationId === registration.id)
    && canOpenNextScheduledOperationalShift(registration, todaySessions, workShifts),
  )
  const nextSequence = nextOperationalSequence(todaySessions)
  // Chủ ca luôn là CA TRƯỞNG. Ca phó dùng chung role `shift_leader` nên trước
  // đây ai check-in trước thì thành chủ ca — 28/07 tại Gold Coast ca phó bấm
  // sớm hơn ca trưởng 67 giây và cả Ca 1 mang tên ca phó. Ca phó vẫn chấm công,
  // nhập kho, chế biến và bán hàng trong ca; chỉ không đứng tên phiên ca.
  const viewerIsDeputy = isDeputyShiftLeader(user)
  const primaryLeadersForNextShift = primaryLeadersScheduledFor(nextSequence, today, registrations, workShifts)
    .filter((registration) => registration.userId !== user.id)
  const primaryLeaderNames = primaryLeadersForNextShift.map((registration) => registration.userName).join(', ')
  const deputyMustWaitForPrimary = Boolean(viewerIsDeputy && primaryLeadersForNextShift.length)
  const canAutoStartScheduledShift = Boolean(startableRegistration) && !deputyMustWaitForPrimary
  // Có ngày chi nhánh chỉ xếp đúng MỘT ca trưởng cho cả ngày. Khi đó không ai có
  // lịch cho sequence còn lại nên ca vận hành sẽ không bao giờ mở, kéo theo không
  // bàn giao và không chốt được ngày. Cho ca trưởng đang trong ca nhận tiếp,
  // nhưng phải bấm + xác nhận (KHÔNG tự động) nên không tái phát BUG-100.
  // Nếu có ca trưởng khác được xếp sequence kế tiếp thì vẫn phải chờ đúng người đó.
  // `employmentType` đến từ join hồ sơ nhân sự nên có thể RỖNG (bản ghi cũ, đường LAN,
  // hồ sơ chưa khai vị trí). Nếu coi rỗng là "không phải ca trưởng" thì hệ thống sẽ mời
  // ca trưởng Ca 1 nhận tiếp Ca 2 dù ĐÃ xếp người khác — đúng lỗi BUG-100 cũ. Vì vậy
  // rỗng phải hiểu là "có thể là ca trưởng" và tiếp tục chờ đúng người; chỉ loại khi
  // biết chắc đó là ca part-time. Kẹt thì đã có nút "Chốt thay" và quản lý gỡ.
  const anotherLeaderScheduledForNext = registrations.some((registration) =>
    registration.userId !== user.id
    && registration.workDate === today
    && registration.status === 'approved'
    && (registration.employmentType === 'leader' || registration.employmentType === undefined)
    && scheduledOperationalSequences(registration, workShifts).includes(nextSequence),
  )
  const canTakeOverNextShift = Boolean(
    !canAutoStartScheduledShift
    && !anotherLeaderScheduledForNext
    && !deputyMustWaitForPrimary
    && nextSequence <= 2
    && activeAttendance
    && myApprovedRegistrations.length,
  )
  // Ca trưởng vắng thì chi nhánh vẫn phải bán được. Ca phó mở ca THAY bằng tay
  // (bấm + xác nhận), phiên ca ghi rõ là mở thay; khi ca trưởng vào app, quyền
  // chủ ca tự chuyển về đúng người (`reconcileOperationalShift`).
  const canStandInForPrimary = Boolean(
    deputyMustWaitForPrimary
    && startableRegistration
    && !dayLocked
    && !branchOpenSession
    && nextSequence <= 2,
  )
  const stock = useMemo(() => calculateStock(movements), [movements])
  // Tồn THẬT, giữ nguyên dấu. Bản cũ chỉ có bản `Math.max(0, …)` nên SKU đang âm
  // trông như bằng 0 và bị loại khỏi danh sách kiểm đếm (điều kiện "> 0") — rơi
  // xuống âm một lần là kẹt âm vĩnh viễn vì không còn cơ hội được đếm lại.
  const expectedBalances = useMemo(
    () => Object.fromEntries(countProducts.map((product) => [
      product.id,
      stock.find((line) => line.product.id === product.id)?.expected || 0,
    ])),
    [stock, countProducts],
  )
  // Bản không âm: chỉ dùng cho tồn đầu ca (mở ca không ghi số âm vào sổ ca).
  const availableBalances = useMemo(
    () => Object.fromEntries(Object.entries(expectedBalances).map(([productId, value]) => [
      productId,
      Math.max(0, value),
    ])),
    [expectedBalances],
  )
  const exactShiftReceipts = useMemo(
    () => openSession ? receiptsInSession(receipts, openSession, sessions) : [],
    [receipts, sessions, openSession?.id, openSession?.startedAt, openSession?.endedAt],
  )
  const currentShiftReceipts = useMemo(
    () => openSession ? (exactShiftReceipts.length ? exactShiftReceipts : receipts) : [],
    [receipts, openSession?.id, exactShiftReceipts],
  )
  const usingDaySalesFallback = Boolean(openSession && receipts.length && !exactShiftReceipts.length)
  const receiptGroups = useMemo(() => groupReceiptsBySeller(currentShiftReceipts), [currentShiftReceipts])
  const shiftSalesTotal = currentShiftReceipts.reduce((sum, receipt) => ({
    quantity: sum.quantity + receipt.totalQuantity,
    revenue: sum.revenue + receipt.totalAmount,
    receipts: sum.receipts + 1,
  }), { quantity: 0, revenue: 0, receipts: 0 })

  async function refresh(showLoading = false) {
    if (showLoading) setLoading(true)
    try {
      const [nextSessions, nextRegistrations, nextAttendance, nextReceipts, nextWorkShifts] = await Promise.all([
        fetchBagShiftSessions(user, { branchId: user.branchId }),
        fetchShiftRegistrations(user, { branchId: user.branchId, from: today, to: today }),
        fetchAttendanceRecords(user, { branchId: user.branchId, userId: user.id, from: today, to: today }),
        fetchSalesReceipts(user, { branchId: user.branchId, date: today }),
        fetchWorkShifts(user),
      ])
      setSessions(nextSessions)
      setRegistrations(nextRegistrations)
      setMyAttendance(nextAttendance)
      setReceipts(nextReceipts)
      setWorkShifts(nextWorkShifts)
      void getOperationDay(user.branchId, today, user).then(setOperationDay).catch(() => {})
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Không thể tải bàn giao ca.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => {
    const update = () => setProductTick((tick) => tick + 1)
    window.addEventListener('gustino-products-updated', update)
    window.addEventListener('storage', update)
    void fetchConfiguredProducts(user).then(update).catch(() => {})
    return () => {
      window.removeEventListener('gustino-products-updated', update)
      window.removeEventListener('storage', update)
    }
  }, [user.id])

  useEffect(() => { void refresh(true) }, [user.id, user.branchId, today])
  useEffect(() => {
    const reload = () => void refresh()
    const reloadWhenVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }
    // Realtime chỉ để đánh thức; mất mạng/máy ngủ xong phải tự tải lại từ DB.
    window.addEventListener('focus', reload)
    window.addEventListener('online', reload)
    document.addEventListener('visibilitychange', reloadWhenVisible)
    const removeWindowListeners = () => {
      window.removeEventListener('focus', reload)
      window.removeEventListener('online', reload)
      document.removeEventListener('visibilitychange', reloadWhenVisible)
    }
    const client = supabase
    if (!client) {
      const timer = window.setInterval(() => void refresh(), 5000)
      return () => {
        window.clearInterval(timer)
        removeWindowListeners()
      }
    }
    // Mỗi hoá đơn POS bắn 1 event hoá đơn + n event dòng hàng, mà màn này tải
    // lại 5 truy vấn mỗi lượt → phải gộp burst thành một lần.
    const reloadSoon = burstGuard(reload)
    const channel = client.channel(uniqueChannelName(`shift-handover:${user.branchId}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bag_shift_sessions', filter: `branch_id=eq.${user.branchId}` }, reloadSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_receipts', filter: `branch_id=eq.${user.branchId}` }, reloadSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_receipt_items' }, reloadSoon)
      // SUBSCRIBED bắn cả khi rejoin sau rớt mạng → refetch bù các event đã lỡ.
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') reload()
      })
    return () => {
      removeWindowListeners()
      reloadSoon.cancel()
      void client.removeChannel(channel)
    }
  }, [user.branchId, user.id, today])

  useEffect(() => {
    setOpeningPhoto(openSession?.openingPhotoUrl || '')
    setClosingPhoto(openSession?.closingPhotoUrl || '')
    // Đổi ca thì bỏ trạng thái "đã bấm bàn giao, chờ xác nhận" để không lỡ chốt nhầm ca khác.
    setCloseArmed(false)
  }, [today, user.branchId, openSession?.id, openSession?.openingPhotoUrl, openSession?.closingPhotoUrl])

  // KHÔNG điền sẵn tồn dự kiến vào ô đếm. Bản cũ đổ sẵn số hệ thống nên ca trưởng
  // bấm chốt là con số SAI được đóng dấu thành "số đếm thật" và từ đó không bao giờ
  // tự sửa được nữa (Gold Coast: 273,92 kg hạt dẻ rang chính là số đổ sẵn đã chốt).
  // Đổi ca thì xoá sạch ô đếm để không mang số của ca trước sang.
  useEffect(() => {
    setClosingBalances({})
  }, [openSession?.id])

  async function handleStartShift(options: { takeOver?: boolean; standIn?: boolean } = {}) {
    if (dayLocked) {
      setFeedback('Ngày vận hành đã kết thúc sau đủ 2 ca. Sang ngày mới hệ thống sẽ cho nhận ca mới.')
      return
    }
    if (todaySessions.length >= 2) {
      setFeedback('Hôm nay đã đủ 2 ca. Không thể nhận thêm ca mới.')
      return
    }
    if (branchOpenSession) {
      if (ownsBagShiftSession(branchOpenSession, user)) return
      setFeedback(`${shiftLabel(branchOpenSession.sequence)} đang do ${branchOpenSession.leaderName} phụ trách. Chỉ ca trưởng đó mới có thể chốt & bàn giao trước khi Ca 2 nhận ca.`)
      return
    }
    if (!myApprovedRegistrations.length) {
      setFeedback('Bạn không có ca làm hôm nay nên chưa thể nhận ca. Hãy đăng ký/được xếp ca trong Chấm công trước.')
      return
    }
    if (!activeAttendance) {
      const hasCheckedOut = myApprovedRegistrations.some((registration) => findAttendanceRecordForRegistration(myAttendance, registration)?.checkOutTime)
      setFeedback(hasCheckedOut
        ? 'Bạn đã check-out ca hôm nay. Không thể nhận/mở ca vận hành sau khi đã kết ca cá nhân.'
        : 'Bạn chưa chấm công hôm nay. Hãy check-in trong Chấm công rồi quay lại nhận ca.')
      return
    }
    // Nhận tiếp có xác nhận: bỏ qua ràng buộc lịch, nhưng vẫn phải đã check-in và
    // có lịch làm hôm nay (2 điều kiện ở trên) — và chỉ khi không ai khác được xếp.
    if (!canAutoStartScheduledShift
      && !(options.takeOver && canTakeOverNextShift)
      && !(options.standIn && canStandInForPrimary)) {
      setFeedback(deputyMustWaitForPrimary
        ? `Bạn là ca phó nên không đứng tên chủ ca. ${primaryLeaderNames} (ca trưởng) là chủ ${shiftLabel(nextSequence)}.`
          + ' Bạn vẫn nhập kho, chế biến và bán hàng bình thường. Nếu ca trưởng vắng, bấm "Mở ca thay ca trưởng" bên dưới.'
        : nextSequence === 2
          ? 'Ca 2 chỉ tự nhận cho ca trưởng có lịch Ca 2 đã check-in. Ca trưởng Ca 1 không thể tự mở Ca 2.'
          : 'Ca vận hành chỉ tự mở cho ca trưởng có lịch Ca 1 đã check-in.')
      return
    }
    setBusy(true)
    try {
      const day = await ensureOperationDay(user, today)
      setOperationDay(day)
      const openingBalances = Object.fromEntries(countProducts.map((product) => [
        product.id,
        Math.max(0, availableBalances[product.id] || 0),
      ]))
      // Ca phó mở thay phải để lại dấu vết trong sổ ca cho quản lý rà soát.
      const standInNote = options.standIn
        ? `[CA PHÓ ĐỨNG THAY] ${user.name} (ca phó) mở ${shiftLabel(nextSequence)} lúc `
          + `${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} `
          + `vì ${primaryLeaderNames || 'ca trưởng được xếp ca này'} chưa mở ca.`
        : undefined
      let session = await startBagShift(user, today, openingBalances, { note: standInNote })
      if (openingPhoto && !session.openingPhotoUrl) {
        session = await uploadBagShiftPhoto(user, session, 'opening', openingPhoto).catch(() => session)
      }
      setAutoStartFailed(false)
      setStandInArmed(false)
      setTakeOverArmed(false)
      setFeedback(options.standIn
        ? `Đã mở ${shiftLabel(session.sequence)} thay ca trưởng. Sổ ca ghi rõ bạn là ca phó mở thay;`
          + ' khi ca trưởng vào ứng dụng, quyền chủ ca sẽ tự chuyển về ca trưởng.'
        : `Đã nhận ${shiftLabel(session.sequence)}. Tồn đầu ca đã lấy từ kho thành phẩm hiện tại.`)
      await refresh()
    } catch (error) {
      // Mở ca tự động có thể hỏng vì mạng chập chờn (điện thoại ngoài quầy).
      // Bật cờ để hiện nút nhận ca thủ công thay vì để ca trưởng kẹt vô hạn.
      setAutoStartFailed(true)
      setFeedback(`${error instanceof Error ? error.message : 'Không thể nhận ca.'} Hãy bấm "Nhận ca ngay" để thử lại.`)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (loading || dayLocked || branchOpenSession || maxShiftsReached || !canAutoStartScheduledShift) return
    // Đã thử tự mở và lỗi: dừng vòng tự động, chờ ca trưởng bấm nút thủ công.
    if (autoStartFailed) return
    const key = `${today}:scheduled:${activeAttendance?.id}:${startableRegistration?.id}:${todaySessions.length}`
    if (autoStartAttemptRef.current === key) return
    autoStartAttemptRef.current = key
    void handleStartShift()
  }, [loading, dayLocked, branchOpenSession?.id, maxShiftsReached, activeAttendance?.id, startableRegistration?.id, canAutoStartScheduledShift, autoStartFailed, todaySessions.length, user.id])

  async function saveShiftPhoto(kind: 'opening' | 'closing', file: File | undefined, targetSession = openSession) {
    if (!file) return
    if (dayLocked && !targetSession) {
      setFeedback('Ngày vận hành đã kết thúc, chỉ có thể bổ sung ảnh cho ca đã có trong lịch sử.')
      return
    }
    const dataUrl = await imageFileToDataUrl(file)
    if (!targetSession || targetSession.id === openSession?.id) {
      if (kind === 'opening') setOpeningPhoto(dataUrl)
      else setClosingPhoto(dataUrl)
    }
    if (targetSession) {
      try {
       const updatedSession = await uploadBagShiftPhoto(user, targetSession, kind, dataUrl)
        await refresh()
       setFeedback(kind === 'opening' ? 'Đã đồng bộ ảnh đầu ca vào sổ ca.' : 'Đã đồng bộ ảnh cuối ca vào sổ ca.')

        if (kind === 'closing' && targetSession.status === 'closed' && updatedSession.closingPhotoUrl) {
          void notifyN8nShiftPhoto(user, {
            shiftId: targetSession.id,
            branchId: targetSession.branchId,
            branchName: configuredBranchName(targetSession.branchId),
            businessDate: targetSession.businessDate,
            shiftSequence: targetSession.sequence,
            kind: 'closing',
            photoUrl: updatedSession.closingPhotoUrl,
          }).then((result) => {
            if (!result.sent && result.mode !== 'skipped' && result.mode !== 'disabled') {
              setFeedback(`Đã đồng bộ ảnh cuối ca, nhưng chưa gửi được sang n8n/Zalo: ${result.message || 'lỗi không rõ.'}`)
            }
          })
        }

        return
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : 'Không thể đồng bộ ảnh bàn giao.')
        return
      }
    }
    setFeedback(kind === 'opening' ? 'Đã giữ ảnh đầu ca. Ảnh sẽ đồng bộ khi nhận ca.' : 'Đã giữ ảnh cuối ca. Ảnh sẽ đồng bộ khi ca đang mở.')
  }

  async function handleCloseShift(options: { afterClose?: () => void } = {}) {
    if (!openSession) return
    if (dayLocked) {
      setFeedback('Ngày vận hành đã kết thúc, không thể chốt thêm ca.')
      return
    }
    const countableProducts = visibleProducts(openSession, movements, countProducts, expectedBalances)
    // Ô trống KHÔNG còn được hiểu ngầm là "đúng bằng số hệ thống": phải đếm thật.
    const notCounted = uncountedProducts(countableProducts, closingBalances)
    if (notCounted.length) {
      setFeedback(`Chưa đếm ${notCounted.length} mặt hàng: ${notCounted.map((product) => product.name).join(', ')}. Nhập số thực tế (gõ 0 nếu đã hết sạch) rồi mới bàn giao được.`)
      return
    }
    const actual = Object.fromEntries(countableProducts.map((product) => [
      product.id,
      Math.max(0, Number(closingBalances[product.id])),
    ]))
    const hasDiscrepancy = countableProducts.some((product) =>
      Math.abs((actual[product.id] || 0) - (expectedBalances[product.id] || 0)) > 0.001,
    )
    if (hasDiscrepancy && !discrepancyNote.trim()) {
      setFeedback('Có lệch tồn thành phẩm. Hãy nhập lý do ngắn trước khi bàn giao.')
      return
    }
    // Chốt thay người khác thì lý do là bắt buộc: đây là bằng chứng duy nhất cho biết
    // ai đếm tồn và vì sao ca trưởng của ca đó không tự chốt.
    if (coveringSession && !discrepancyNote.trim()) {
      setFeedback(`Bạn đang chốt thay ${coveringSession.leaderName}. Hãy ghi lý do (ví dụ: ca trưởng đã về, mình đếm tồn thay).`)
      return
    }
    const noteForClose = coveringSession
      ? `[CHỐT THAY ${coveringSession.leaderName} bởi ${user.name}] ${discrepancyNote.trim()}`
      : discrepancyNote
    setBusy(true)
    try {
      const openingPhotoSynced = Boolean(openSession.openingPhotoUrl || !openingPhoto)
      const closingPhotoSynced = Boolean(openSession.closingPhotoUrl || !closingPhoto)
      // KHÔNG đóng dấu `createdAt` bằng đồng hồ máy: phiếu kiểm kê là MỐC RESET
      // của `calculateStock`, đặt sai vị trí trên trục thời gian là tồn tính sai.
      // Mọi phiếu kho khác đều để máy chủ đóng dấu; điện thoại ca trưởng lệch giờ
      // (chuyện thường ở quầy) sẽ khiến mốc này nhảy trước/sau các phiếu bán,
      // nhập của chính ca đó, thậm chí nuốt luôn phiếu sửa tồn ghi sau nó.
      // `close_bag_shift_safe` dùng `coalesce(x.created_at, now())` nên bỏ trống
      // là server tự đóng dấu; đường ghi thẳng cũng để DB dùng `default now()`.
      const movementRows: StockMovement[] = countableProducts.map((product) => ({
        id: createId(),
        documentId: openSession.id,
        branchId: user.branchId,
        productId: product.id,
        type: 'count',
        quantity: actual[product.id] || 0,
        shiftDate: today,
        note: `[${shiftLabel(openSession.sequence)}] Kiểm đếm tồn thành phẩm cuối ca: ${formatNumber(actual[product.id] || 0)} ${product.unit}`,
        createdBy: user.id,
        createdAt: '',
      }))
      await closeBagShift(
        user,
        openSession,
        actual,
        noteForClose,
        [],
        movementRows.map((row) => ({
          id: row.id,
          product_id: row.productId,
          movement_type: row.type,
          quantity: row.quantity,
          shift_date: row.shiftDate,
          note: row.note,
          document_id: row.documentId || openSession.id,
          source_product_id: row.sourceProductId || null,
          source_quantity: row.sourceQuantity || null,
          measured_weight_kg: row.measuredWeightKg || null,
        })),
      )
      // Ghi yêu cầu chốt báo cáo NGAY sau khi đóng ca, trước refresh(): nếu ca
      // trưởng có lịch xuyên ca thì refresh() sẽ tự mở ca kế tiếp, màn Báo cáo
      // phải biết chốt ca VỪA đóng chứ không phải ca mới mở.
      const reportRequest: HandoverReportRequest = {
        shiftId: openSession.id,
        sequence: openSession.sequence,
        businessDate: today,
      }
      writeHandoverReportRequest(reportRequest)
      setDiscrepancyNote('')
      setCoverArmed(false)
      if (openingPhotoSynced) setOpeningPhoto('')
      if (closingPhotoSynced) setClosingPhoto('')
      setFeedback(openSession.sequence >= 2
        ? `Đã chốt ${shiftLabel(openSession.sequence)}. Đang tạo báo cáo Ca 2 và Tổng ngày.`
        : `Đã chốt ${shiftLabel(openSession.sequence)}. Đang tạo báo cáo Ca 1 để bàn giao Ca 2.`)
      const closingPhotoUrl = openSession.closingPhotoUrl
      if (closingPhotoUrl) {
        void notifyN8nShiftPhoto(user, {
          shiftId: openSession.id,
          branchId: openSession.branchId,
          branchName: configuredBranchName(openSession.branchId),
          businessDate: openSession.businessDate,
          shiftSequence: openSession.sequence,
          kind: 'closing',
          photoUrl: closingPhotoUrl,
        }).then((result) => {
          if (!result.sent && result.mode !== 'skipped' && result.mode !== 'disabled') {
            setFeedback(`Đã chốt ca, nhưng chưa gửi được ảnh cuối ca sang n8n/Zalo: ${result.message || 'lỗi không rõ.'}`)
          }
        })
      }
      await Promise.all([refresh(), onChanged()])
      options.afterClose?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể chốt bàn giao ca.'
      setFeedback(message.includes('Không thể chốt bàn giao ca') ? message : `Không thể chốt bàn giao ca: ${message}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleReopenShift(session: BagShiftSession) {
    const reason = window.prompt(
      `Mở lại ${shiftLabel(session.sequence)}?\n\nSố liệu kho mà lệnh chốt đã ghi sẽ được gỡ ra và ghi lại khi bạn chốt lần nữa.\nNhập lý do để quản lý biết:`,
      'Bấm nhầm nút chốt ca',
    )
    if (reason === null) return
    setBusy(true)
    try {
      await reopenBagShift(user, session, reason)
      await Promise.all([refresh(), onChanged()])
      setFeedback(`Đã mở lại ${shiftLabel(session.sequence)}. Bán tiếp bình thường, xong nhớ chốt lại ca.`)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Không thể mở lại ca.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="page"><section className="section-card">Đang tải bàn giao ca...</section></div>

  return (
    <div className="page handover-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow dark">BÀN GIAO CA</span>
          <h1>Nhận ca - xem bán hàng - chốt tồn</h1>
          <p>Ca trưởng ghi nhận tồn thành phẩm cuối ca. Nhân viên bán hàng bán trực tiếp theo menu POS.</p>
        </div>
        <div className="handover-heading-actions">
          <span className={`handover-shift-chip ${openSession ? 'open' : ''}`}>
            {openSession ? `${shiftLabel(openSession.sequence)} đang mở` : 'Chưa nhận ca'}
          </span>
          <button className="handover-link-sales" onClick={() => onNavigate('sales')}>Xem sổ bán hàng</button>
          {hasClosedShift && (
            <button className="handover-link-report" onClick={() => onNavigate('report')}>
              Xem báo cáo ngày
            </button>
          )}
        </div>
      </div>

      {feedback && <div className="feedback-bar">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}

      {/* Ảnh đầu ca đã chuyển lên trang Hôm nay (thống nhất 1 nơi). Vẫn có thể bổ sung ở lịch sử ca bên dưới. */}

      {staleOpenSessions.length > 0 && (
        <div className="feedback-bar">
          Còn {staleOpenSessions.length} ca ngày trước ({staleOpenSessions.map((item) => formatLocalDate(item.businessDate)).join(', ')}) chưa chốt.
          Ca hôm nay vẫn nhận bình thường; nhờ quản lý chốt ngày cũ để đóng ca treo.
        </div>
      )}

      {anotherLeaderOpenSession && (
        <section className="handover-start-card">
          <span>…</span>
          <div>
            <small>{shiftLabel(anotherLeaderOpenSession.sequence).toUpperCase()}</small>
            <h2>Đang chờ ca trưởng trước bàn giao</h2>
            <p>{anotherLeaderOpenSession.leaderName} đang phụ trách ca này. Nút chốt tồn chỉ hiện cho đúng ca trưởng đã mở ca; Ca 2 sẽ tự mở sau khi ca trước bàn giao xong.</p>
            {canCoverForeignShift && (
              <div className="handover-takeover-confirm">
                <p>
                  {`Nếu ${anotherLeaderOpenSession.leaderName} đã về mà chưa chốt, bạn đếm tồn thật rồi chốt thay để ca sau nhận được ca. `}
                  Ca vẫn ghi tên người mở, phần chốt ghi rõ tên bạn và lý do.
                </p>
                <button className="secondary-button wide" disabled={busy} onClick={() => setCoverArmed(true)}>
                  {`Chốt thay ${anotherLeaderOpenSession.leaderName}`}
                </button>
              </div>
            )}
          </div>
        </section>
      )}
      {coveringSession && (
        <div className="feedback-bar">
          {`Bạn đang chốt thay ${coveringSession.leaderName}. Hãy đếm tồn thành phẩm thực tế, ghi lý do rồi bấm "Chốt & bàn giao ca".`}
          <button type="button" onClick={() => setCoverArmed(false)}>×</button>
        </div>
      )}

      {!openSession && !anotherLeaderOpenSession && !maxShiftsReached && (
        <section className="handover-start-card">
          <span>1</span>
          <div>
            <small>{todaySessions.length === 0 ? 'CA SÁNG' : 'CA TỐI'}</small>
            <h2>{autoStartFailed && canAutoStartScheduledShift ? 'Ca chưa mở được - hãy nhận ca thủ công' : deputyMustWaitForPrimary ? `Ca trưởng đứng ${shiftLabel(nextSequence)}` : canAutoStartScheduledShift && todaySessions.length === 1 ? 'Đang tự nhận Ca tối theo lịch' : canAutoStartScheduledShift ? 'Đang tự mở ca sau check-in' : canTakeOverNextShift ? `Hôm nay chưa xếp ca trưởng cho ${shiftLabel(nextSequence)}` : activeAttendance ? 'Đang chờ đúng ca trưởng theo lịch' : 'Check-in để ca tự mở'}</h2>
            <p>{autoStartFailed && canAutoStartScheduledShift
              ? 'Bạn có đủ lịch và đã check-in, nhưng lần mở ca tự động vừa rồi không thành công (thường do mạng chập chờn). Bấm nút bên dưới để nhận ca ngay.'
              : deputyMustWaitForPrimary
              ? `Bạn là ca phó nên không đứng tên chủ ca. ${primaryLeaderNames} sẽ là chủ ${shiftLabel(nextSequence)}. `
                + 'Bạn vẫn chấm công, nhập kho, chế biến và bán hàng bình thường trong ca này.'
              : canTakeOverNextShift
              ? 'Không có ca trưởng nào khác được xếp ca này nên hệ thống không tự mở. Bạn đang trong ca và có thể nhận tiếp để kịp bàn giao và chốt ngày.'
              : canAutoStartScheduledShift && todaySessions.length === 1
              ? 'Ca sáng đã bàn giao. Ca trưởng có lịch Ca 2 và đã check-in sẽ tự nhận Ca tối, không cần bấm nhận ca.'
              : canAutoStartScheduledShift
              ? 'Hệ thống đang đồng bộ tồn thành phẩm hiện tại làm tồn đầu ca; bạn không cần bấm nút nhận ca.'
              : activeAttendance
                ? 'Phiên tiếp theo chỉ tự mở cho ca trưởng được xếp đúng Ca 1 hoặc Ca 2. Hệ thống không dùng ca trưởng trước để gán ca mới.'
                : 'Ca vận hành sẽ tự mở ngay khi ca trưởng check-in thành công. Phần Bàn giao vẫn giữ để kiểm tồn và chốt ca.'}</p>
            {canAutoStartScheduledShift && (
              <button className="primary-button wide" disabled={busy} onClick={() => void handleStartShift()}>
                {busy ? 'Đang nhận ca…' : 'Nhận ca ngay'}
              </button>
            )}
            {canStandInForPrimary && !standInArmed && (
              <button className="secondary-button wide" disabled={busy} onClick={() => setStandInArmed(true)}>
                Mở ca thay ca trưởng
              </button>
            )}
            {canStandInForPrimary && standInArmed && (
              <div className="handover-takeover-confirm">
                <p>
                  {`${primaryLeaderNames} (ca trưởng) chưa mở ${shiftLabel(nextSequence)}. `}
                  {'Bạn mở ca thay để chi nhánh bán được? Sổ ca sẽ ghi rõ ca phó mở thay, '}
                  {'và quyền chủ ca tự chuyển về ca trưởng ngay khi ca trưởng vào ứng dụng.'}
                </p>
                <button className="primary-button wide" disabled={busy} onClick={() => void handleStartShift({ standIn: true })}>
                  {busy ? 'Đang mở ca…' : `Xác nhận mở ${shiftLabel(nextSequence)} thay ca trưởng`}
                </button>
                <button className="secondary-button wide" disabled={busy} onClick={() => setStandInArmed(false)}>Huỷ</button>
              </div>
            )}
            {canTakeOverNextShift && !takeOverArmed && (
              <button className="secondary-button wide" disabled={busy} onClick={() => setTakeOverArmed(true)}>
                {`Nhận tiếp ${shiftLabel(nextSequence)}`}
              </button>
            )}
            {canTakeOverNextShift && takeOverArmed && (
              <div className="handover-takeover-confirm">
                <p>
                  {`Hôm nay không có ca trưởng nào khác được xếp ${shiftLabel(nextSequence)}. `}
                  {`Bạn nhận ${shiftLabel(nextSequence)} và chịu trách nhiệm chốt tồn, bàn giao ca này?`}
                </p>
                <button className="primary-button wide" disabled={busy} onClick={() => void handleStartShift({ takeOver: true })}>
                  {busy ? 'Đang nhận ca…' : `Xác nhận nhận ${shiftLabel(nextSequence)}`}
                </button>
                <button className="secondary-button wide" disabled={busy} onClick={() => setTakeOverArmed(false)}>Huỷ</button>
              </div>
            )}
          </div>
          {busy && <small className="attendance-busy-hint">Đang đồng bộ ca…</small>}
        </section>
      )}

      {maxShiftsReached && !dayClosed && (
        <section className="handover-start-card">
          <span>OK</span>
          <div>
            <small>ĐÃ ĐỦ CA HÔM NAY</small>
            <h2>Ca sáng và Ca tối đã bàn giao</h2>
            <p>Hôm nay đã hoàn thành 2 ca. Vào Báo cáo để chốt báo cáo ngày.</p>
          </div>
        </section>
      )}

      {openSession && (
        <>
          <section className="handover-balance-grid">
            {visibleProducts(openSession, movements, countProducts, expectedBalances).map((product) => (
              <article key={product.id}>
                <small>{product.name}</small>
                <strong>{formatNumber(expectedBalances[product.id] || 0)}</strong>
                <span>tồn thành phẩm</span>
              </article>
            ))}
            <article>
              <small>Tổng sản phẩm đã bán</small>
              <strong>{formatNumber(shiftSalesTotal.quantity)}</strong>
              <span>{formatMoney(shiftSalesTotal.revenue)} - {shiftSalesTotal.receipts} hóa đơn</span>
            </article>
          </section>

          <div className="handover-columns">
            <section className="section-card handover-employee-list">
              <div className="section-title">
                <div><span className="eyebrow dark">BÁN TRONG CA</span><h2>Nhân viên đã bán</h2></div>
                <span className="date-chip">{formatNumber(shiftSalesTotal.quantity)} sản phẩm</span>
              </div>
              <p className="handover-step-help">
                {usingDaySalesFallback
                  ? 'Chưa khớp được mốc giờ nhận ca, nên đang hiển thị toàn bộ hóa đơn POS hôm nay để ca trưởng vẫn thấy lượng nhân viên bán được.'
                  : 'Danh sách này lấy từ hóa đơn POS trong thời gian ca đang mở. Không còn bước phân bổ hay thu lại.'}
              </p>
              {!receiptGroups.length && <p className="empty-copy">Chưa có hóa đơn nào trong ca này.</p>}
              {receiptGroups.map((group) => (
                <article className="allocation-group" key={group.key}>
                  <div className="allocation-group-head">
                    <strong>{group.employeeName}</strong>
                    <small>{group.receiptCount} hóa đơn</small>
                  </div>
                  <div className="allocation-row settled">
                    <div className="allocation-main">
                      <span><strong>{formatNumber(group.quantity)} sản phẩm</strong><small>{formatMoney(group.revenue)}</small></span>
                      <b>{formatNumber(group.productCount)} món</b>
                    </div>
                    <div className="allocation-result">
                      {group.products.slice(0, 4).map((item) => (
                        <span key={item.productId}>{item.name} <strong>{formatNumber(item.quantity)}</strong></span>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </section>

            <section className="section-card handover-close-card">
              <div className="section-title"><div><span className="eyebrow dark">CHỐT TỒN</span><h2>{`Bàn giao ${shiftLabel(openSession.sequence)}`}</h2></div><b>2</b></div>
              <p className="handover-hint">Đếm tồn thành phẩm thực tế cuối ca — ô để trống là chưa đếm, gõ 0 nếu đã hết sạch. Số này kế thừa cho ca sau và là mốc chuẩn lại kho.</p>
              <div className="handover-count-grid">
                {visibleProducts(openSession, movements, countProducts, expectedBalances).map((product) => {
                  const expected = expectedBalances[product.id] || 0
                  const counted = hasCountInput(closingBalances[product.id])
                  const actual = counted ? Number(closingBalances[product.id]) : expected
                  return (
                    <label className={counted && Math.abs(actual - expected) > 0.001 ? 'different' : ''} key={product.id}>
                      <span>{product.name}</span>
                      <small>Dự kiến {formatNumber(expected)}</small>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        inputMode="decimal"
                        placeholder="Đếm thực tế"
                        value={closingBalances[product.id] ?? ''}
                        onChange={(event) => setClosingBalances((current) => ({ ...current, [product.id]: event.target.value }))}
                      />
                      <button
                        type="button"
                        className="handover-count-same"
                        onClick={() => setClosingBalances((current) => ({ ...current, [product.id]: String(Math.max(0, expected)) }))}
                      >= dự kiến</button>
                    </label>
                  )
                })}
              </div>
              <label className="handover-note">Ghi chú khi có chênh lệch
                <textarea value={discrepancyNote} onChange={(event) => setDiscrepancyNote(event.target.value)} placeholder="Ví dụ: thiếu 1 túi do rách bao bì" />
              </label>
              <div className="shift-photo-row">
                <PhotoPickers
                  kind="closing"
                  prefix={closingPhoto || openSession.closingPhotoUrl ? 'Đổi ảnh cuối ca' : 'Ảnh cuối ca'}
                  onPick={(file) => void saveShiftPhoto('closing', file)}
                />
                {closingPhoto && <img className="shift-photo-preview" src={closingPhoto} alt="Ảnh quầy cuối ca" />}
              </div>
              {!closeArmed && (
                <button
                  className="primary-button wide"
                  disabled={busy}
                  onClick={() => setCloseArmed(true)}
                >
                  {busy ? 'Đang chốt bàn giao…' : 'Chốt & bàn giao ca'}
                </button>
              )}
              {closeArmed && (
                <div className="handover-close-confirm">
                  <img src="/mascots/capy-attendance-camera.png" alt="" width="72" height="72" decoding="async" aria-hidden="true" />
                  <div>
                    <strong>Capy hỏi lại: chắc chắn bàn giao chưa?</strong>
                    <p>
                      {openSession.sequence >= 2
                        ? 'Đây là CA TỐI. Bàn giao xong hệ thống sẽ CHỐT NGÀY và tự gửi báo cáo Ca tối + Tổng ngày lên Zalo. Chỉ bàn giao khi ca đã bán xong và đã đếm đúng tồn.'
                        : 'Bàn giao Ca sáng để Ca tối nhận ca. Kiểm tra lại tồn thành phẩm đã đếm đúng chưa trước khi chốt.'}
                    </p>
                  </div>
                  <div className="handover-close-confirm-actions">
                    <button
                      className="primary-button wide"
                      disabled={busy}
                      onClick={() => void handleCloseShift({ afterClose: () => onNavigate('report') })}
                    >
                      {busy ? 'Đang chốt bàn giao…' : openSession.sequence >= 2 ? 'Đồng ý, chốt ngày & gửi báo cáo' : 'Đồng ý, bàn giao ca'}
                    </button>
                    <button className="secondary-button wide" disabled={busy} onClick={() => setCloseArmed(false)}>
                      Chưa, để tôi kiểm tra lại
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {todaySessions.filter((item) => item.status === 'closed').length > 0 && (
        <section className="section-card handover-history">
          <div className="section-title"><div><span className="eyebrow dark">HÔM NAY</span><h2>Các ca đã bàn giao</h2></div></div>
          {todaySessions.filter((item) => item.status === 'closed').map((session) => (
            <div key={session.id}>
              <span>
                <strong>{shiftLabel(session.sequence)} - {session.leaderName}</strong>
                <small>{formatTime(session.startedAt)} - {session.endedAt ? formatTime(session.endedAt) : ''}</small>
                <span className="handover-history-photos">
                  {session.openingPhotoUrl ? <img src={session.openingPhotoUrl} alt={`${shiftLabel(session.sequence)} đầu ca`} /> : <em>Thiếu đầu ca</em>}
                  {session.closingPhotoUrl ? <img src={session.closingPhotoUrl} alt={`${shiftLabel(session.sequence)} cuối ca`} /> : <em>Thiếu cuối ca</em>}
                </span>
              </span>
              <span className="handover-history-actions">
                <b>Đã bàn giao</b>
                {/* Bấm nhầm "Chốt & bàn giao ca" là chuyện thường ngày; trước đây
                    ca đóng nhầm là kẹt cứng, phải sửa tay dưới DB (BUG-114). */}
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || dayClosed}
                  title={dayClosed ? 'Ngày vận hành đã chốt. Hãy mở lại ngày trước.' : 'Mở lại ca nếu vừa bấm chốt nhầm'}
                  onClick={() => void handleReopenShift(session)}
                >
                  Mở lại ca
                </button>
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function PhotoPickers({
  prefix,
  compact = false,
  onPick,
}: {
  kind: 'opening' | 'closing'
  prefix: string
  compact?: boolean
  onPick: (file: File | undefined) => void
}) {
  // Gộp còn 1 nút: bấm vào chọn Chụp ảnh hoặc Tải ảnh lên.
  return <ShiftPhotoButton prefix={prefix} compact={compact} onPick={onPick} />
}

function receiptsInSession(receipts: SalesReceipt[], session: BagShiftSession, sessions: BagShiftSession[]) {
  // Vùng doanh thu không hở (BUG-117): hóa đơn bán trước giờ mở ca này (kể cả
  // trong khoảng trống sau khi ca trước đã đóng) vẫn phải hiện trong ca đang mở,
  // để số "doanh thu trong ca" khớp với ảnh báo cáo và Tổng ngày.
  const scopeWindow = sessionScopeWindow(session, sessions)
  return receipts.filter((receipt) => {
    if (receipt.branchId !== session.branchId || receipt.businessDate !== session.businessDate) return false
    return timestampInScopeWindow(receipt.createdAt, scopeWindow)
  })
}

function groupReceiptsBySeller(receipts: SalesReceipt[]) {
  const groups = new Map<string, {
    key: string
    employeeName: string
    quantity: number
    revenue: number
    receiptCount: number
    productCount: number
    products: Array<{ productId: string; name: string; quantity: number }>
    productMap: Map<string, { productId: string; name: string; quantity: number }>
  }>()
  receipts.forEach((receipt) => {
    const key = receipt.sellerId || receipt.sellerKey || normalizeName(receipt.sellerName)
    const current = groups.get(key) || {
      key,
      employeeName: receipt.sellerName,
      quantity: 0,
      revenue: 0,
      receiptCount: 0,
      productCount: 0,
      products: [],
      productMap: new Map<string, { productId: string; name: string; quantity: number }>(),
    }
    current.quantity += receipt.totalQuantity
    current.revenue += receipt.totalAmount
    current.receiptCount += 1
    receipt.lines.forEach((line) => {
      const product = productById(line.productId)
      const row = current.productMap.get(line.productId) || {
        productId: line.productId,
        name: product?.name || line.productName || line.productId,
        quantity: 0,
      }
      row.quantity += line.quantity
      current.productMap.set(line.productId, row)
    })
    current.products = Array.from(current.productMap.values()).sort((a, b) => b.quantity - a.quantity)
    current.productCount = current.products.length
    groups.set(key, current)
  })
  return Array.from(groups.values()).sort((a, b) => b.quantity - a.quantity || a.employeeName.localeCompare(b.employeeName, 'vi'))
}

/** Quy tắc chọn hàng phải đếm nằm ở `lib/shiftCountScope.ts` (có test bằng số). */
function visibleProducts(
  session: BagShiftSession,
  movements: StockMovement[],
  countProducts: ConfiguredProduct[],
  expectedBalances: Record<string, number>,
) {
  return productsToCount({
    products: countProducts,
    openingBalances: session.openingBalances,
    expectedBalances,
    movements,
    shiftStartedAt: session.startedAt,
  })
}

// Thành phẩm bàn giao theo kg, cho tới 4 số lẻ; số nguyên (vd số lượng bán) vẫn hiển thị nguyên.
// Tồn bàn giao phải đọc y hệt màn Kho: cùng 3 chữ số lẻ như DB, cùng cách viết
// số tiếng Việt. Bản cũ để 4 số lẻ nên lòi cả rác dấu phẩy động khi cộng dồn.
function formatNumber(value: number) { return formatQuantity(value) }
function formatMoney(value: number) { return `${Math.round(value).toLocaleString('vi-VN')}d` }
function formatTime(value: string) { return new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) }
function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}
