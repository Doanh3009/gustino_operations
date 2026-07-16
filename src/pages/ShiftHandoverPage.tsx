import { useEffect, useMemo, useRef, useState } from 'react'
import { ShiftPhotoButton } from '../components/ShiftPhotoButton'
import { getFinishedBulkProducts, getSaleProducts, productById, type ConfiguredProduct } from '../lib/constants'
import { createId, imageFileToDataUrl } from '../lib/browser'
import { calculateStock, ensureOperationDay, getOperationDay } from '../lib/store'
import { fetchAttendanceRecords, fetchShiftRegistrations, findAttendanceRecordForRegistration } from '../lib/attendance'
import { supabase, uniqueChannelName } from '../lib/supabase'
import { formatLocalDate, localDateKey } from '../lib/dates'
import { fetchConfiguredProducts } from '../lib/products'
import type { Page } from '../components/AppShell'
import {
  closeBagShift,
  fetchBagShiftSessions,
  startBagShift,
  uploadBagShiftPhoto,
} from '../lib/shiftLedger'
import { fetchSalesReceipts, type SalesReceipt } from '../lib/salesReceipts'
import type { AppUser, AttendanceRecord, BagShiftSession, OperationDay, ShiftRegistration, StockMovement } from '../types'

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
  const today = localDateKey()
  const [sessions, setSessions] = useState<BagShiftSession[]>([])
  const [receipts, setReceipts] = useState<SalesReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [registrations, setRegistrations] = useState<ShiftRegistration[]>([])
  const [myAttendance, setMyAttendance] = useState<AttendanceRecord[]>([])
  const [closingBalances, setClosingBalances] = useState<Record<string, string>>({})
  const [discrepancyNote, setDiscrepancyNote] = useState('')
  const [openingPhoto, setOpeningPhoto] = useState('')
  const [closingPhoto, setClosingPhoto] = useState('')
  const [operationDay, setOperationDay] = useState<OperationDay | null>(null)
  const [productTick, setProductTick] = useState(0)
  const autoStartAttemptRef = useRef('')

  const saleProducts = useMemo(() => getSaleProducts(), [productTick])
  const countProducts = useMemo(() => {
    const finishedProducts = getFinishedBulkProducts()
    return finishedProducts.length ? finishedProducts : saleProducts
  }, [productTick, saleProducts])
  const openSession = sessions.find((item) => item.status === 'open' && item.businessDate === today)
  const staleOpenSessions = sessions.filter((item) => item.status === 'open' && item.businessDate < today)
  const todaySessions = sessions.filter((item) => item.businessDate === today)
  const dayClosed = operationDay?.status === 'closed'
  const dayLocked = dayClosed
  const maxShiftsReached = !openSession && todaySessions.length >= 2
  const activeAttendance = myAttendance.find((record) => !record.checkOutTime)
  const stock = useMemo(() => calculateStock(movements), [movements])
  const availableBalances = useMemo(
    () => Object.fromEntries(countProducts.map((product) => [
      product.id,
      Math.max(0, stock.find((line) => line.product.id === product.id)?.expected || 0),
    ])),
    [stock, countProducts],
  )
  const exactShiftReceipts = useMemo(
    () => openSession ? receiptsInSession(receipts, openSession) : [],
    [receipts, openSession?.id, openSession?.startedAt, openSession?.endedAt],
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
      const [nextSessions, nextRegistrations, nextAttendance, nextReceipts] = await Promise.all([
        fetchBagShiftSessions(user, { branchId: user.branchId }),
        fetchShiftRegistrations(user, { branchId: user.branchId, from: today, to: today }),
        fetchAttendanceRecords(user, { branchId: user.branchId, userId: user.id, from: today, to: today }),
        fetchSalesReceipts(user, { branchId: user.branchId, date: today }),
      ])
      setSessions(nextSessions)
      setRegistrations(nextRegistrations)
      setMyAttendance(nextAttendance)
      setReceipts(nextReceipts)
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

  useEffect(() => { void refresh(true) }, [user.id, user.branchId])
  useEffect(() => {
    const client = supabase
    if (!client) {
      const timer = window.setInterval(() => void refresh(), 5000)
      return () => window.clearInterval(timer)
    }
    const channel = client.channel(uniqueChannelName(`shift-handover:${user.branchId}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bag_shift_sessions', filter: `branch_id=eq.${user.branchId}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_receipts', filter: `branch_id=eq.${user.branchId}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_receipt_items' }, () => void refresh())
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [user.branchId, user.id])

  useEffect(() => {
    setOpeningPhoto(openSession?.openingPhotoUrl || '')
    setClosingPhoto(openSession?.closingPhotoUrl || '')
  }, [today, user.branchId, openSession?.id, openSession?.openingPhotoUrl, openSession?.closingPhotoUrl])

  useEffect(() => {
    if (!openSession) return
    setClosingBalances(Object.fromEntries(
      visibleProducts(openSession, movements, countProducts, availableBalances)
        .map((product) => [product.id, String(availableBalances[product.id] || 0)]),
    ))
  }, [openSession?.id, JSON.stringify(availableBalances), countProducts])

  async function handleStartShift() {
    if (dayLocked) {
      setFeedback('Ngày vận hành đã kết thúc sau đủ 2 ca. Sang ngày mới hệ thống sẽ cho nhận ca mới.')
      return
    }
    if (todaySessions.length >= 2) {
      setFeedback('Hôm nay đã đủ 2 ca. Không thể nhận thêm ca mới.')
      return
    }
    const myRegistrations = registrations.filter((item) =>
      item.userId === user.id && item.workDate === today && item.status === 'approved',
    )
    if (!myRegistrations.length) {
      setFeedback('Bạn không có ca làm hôm nay nên chưa thể nhận ca. Hãy đăng ký/được xếp ca trong Chấm công trước.')
      return
    }
    const activeAttendance = myRegistrations
      .map((registration) => findAttendanceRecordForRegistration(myAttendance, registration))
      .find((record) => record && !record.checkOutTime)
    if (!activeAttendance) {
      const hasCheckedOut = myRegistrations.some((registration) => findAttendanceRecordForRegistration(myAttendance, registration)?.checkOutTime)
      setFeedback(hasCheckedOut
        ? 'Bạn đã check-out ca hôm nay. Không thể nhận/mở ca vận hành sau khi đã kết ca cá nhân.'
        : 'Bạn chưa chấm công hôm nay. Hãy check-in trong Chấm công rồi quay lại nhận ca.')
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
      let session = await startBagShift(user, today, openingBalances)
      if (openingPhoto && !session.openingPhotoUrl) {
        session = await uploadBagShiftPhoto(user, session, 'opening', openingPhoto).catch(() => session)
      }
      setFeedback(`Đã nhận ${shiftLabel(session.sequence)}. Tồn đầu ca đã lấy từ kho thành phẩm hiện tại.`)
      await refresh()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Không thể nhận ca.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (loading || dayLocked || openSession || maxShiftsReached || !activeAttendance) return
    const key = `${today}:${activeAttendance.id}:${todaySessions.length}`
    if (autoStartAttemptRef.current === key) return
    autoStartAttemptRef.current = key
    void handleStartShift()
  }, [loading, dayLocked, openSession?.id, maxShiftsReached, activeAttendance?.id, todaySessions.length])

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
        await uploadBagShiftPhoto(user, targetSession, kind, dataUrl)
        await refresh()
        setFeedback(kind === 'opening' ? 'Đã đồng bộ ảnh đầu ca vào sổ ca.' : 'Đã đồng bộ ảnh cuối ca vào sổ ca.')
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
    const productsToCount = visibleProducts(openSession, movements, countProducts, availableBalances)
    const actual = Object.fromEntries(productsToCount.map((product) => [
      product.id,
      Math.max(0, Number(closingBalances[product.id] ?? availableBalances[product.id] ?? 0)),
    ]))
    const hasDiscrepancy = productsToCount.some((product) =>
      Math.abs((actual[product.id] || 0) - (availableBalances[product.id] || 0)) > 0.001,
    )
    if (hasDiscrepancy && !discrepancyNote.trim()) {
      setFeedback('Có lệch tồn thành phẩm. Hãy nhập lý do ngắn trước khi bàn giao.')
      return
    }
    setBusy(true)
    try {
      const openingPhotoSynced = Boolean(openSession.openingPhotoUrl || !openingPhoto)
      const closingPhotoSynced = Boolean(openSession.closingPhotoUrl || !closingPhoto)
      const now = new Date()
      const movementRows: StockMovement[] = productsToCount.map((product, index) => ({
        id: createId(),
        documentId: openSession.id,
        branchId: user.branchId,
        productId: product.id,
        type: 'count',
        quantity: actual[product.id] || 0,
        shiftDate: today,
        note: `[${shiftLabel(openSession.sequence)}] Kiểm đếm tồn thành phẩm cuối ca: ${formatNumber(actual[product.id] || 0)} ${product.unit}`,
        createdBy: user.id,
        createdAt: new Date(now.getTime() + index + 1).toISOString(),
      }))
      await closeBagShift(
        user,
        openSession,
        actual,
        discrepancyNote,
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
          created_at: row.createdAt,
        })),
      )
      setDiscrepancyNote('')
      if (openingPhotoSynced) setOpeningPhoto('')
      if (closingPhotoSynced) setClosingPhoto('')
      setFeedback(openSession.sequence >= 2
        ? `Đã chốt ${shiftLabel(openSession.sequence)}. Chuyển sang báo cáo cuối ngày để chốt doanh thu và đóng ngày.`
        : `Đã chốt ${shiftLabel(openSession.sequence)}. Tồn thành phẩm sẽ thành tồn đầu ca 2.`)
      await Promise.all([refresh(), onChanged()])
      options.afterClose?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể chốt bàn giao ca.'
      setFeedback(message.includes('Không thể chốt bàn giao ca') ? message : `Không thể chốt bàn giao ca: ${message}`)
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className={`handover-shift-chip ${openSession ? 'open' : ''}`}>
            {openSession ? `${shiftLabel(openSession.sequence)} đang mở` : 'Chưa nhận ca'}
          </span>
          <button className="handover-link-sales" onClick={() => onNavigate('sales')}>Xem sổ bán hàng</button>
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

      {!openSession && !maxShiftsReached && (
        <section className="handover-start-card">
          <span>1</span>
          <div>
            <small>{todaySessions.length === 0 ? 'CA SÁNG' : 'CA TỐI'}</small>
            <h2>{activeAttendance ? 'Đang tự mở ca sau check-in' : 'Check-in để ca tự mở'}</h2>
            <p>{activeAttendance
              ? 'Hệ thống đang đồng bộ tồn thành phẩm hiện tại làm tồn đầu ca; bạn không cần bấm nút nhận ca.'
              : 'Ca vận hành sẽ tự mở ngay khi ca trưởng check-in thành công. Phần Bàn giao vẫn giữ để kiểm tồn và chốt ca.'}</p>
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
            {visibleProducts(openSession, movements, countProducts, availableBalances).map((product) => (
              <article key={product.id}>
                <small>{product.name}</small>
                <strong>{formatNumber(availableBalances[product.id] || 0)}</strong>
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
              <p className="handover-hint">Đếm tồn thành phẩm thực tế cuối ca. Số này sẽ kế thừa cho ca sau và còn trong kho để ngày mai bán tiếp.</p>
              <div className="handover-count-grid">
                {visibleProducts(openSession, movements, countProducts, availableBalances).map((product) => {
                  const expected = availableBalances[product.id] || 0
                  const actual = Number(closingBalances[product.id] ?? expected)
                  return (
                    <label className={actual !== expected ? 'different' : ''} key={product.id}>
                      <span>{product.name}</span>
                      <small>Dự kiến {formatNumber(expected)}</small>
                      <input type="number" min="0" step="0.0001" inputMode="decimal" value={closingBalances[product.id] ?? String(expected)} onChange={(event) => setClosingBalances((current) => ({ ...current, [product.id]: event.target.value }))} />
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
              <button
                className="primary-button wide"
                disabled={busy}
                onClick={() => openSession.sequence >= 2
                  ? void handleCloseShift({ afterClose: () => onNavigate('report') })
                  : void handleCloseShift()}
              >
                {openSession.sequence >= 2 ? 'Báo cáo cuối ngày' : 'Chốt & bàn giao ca'}
              </button>
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
                <span className="handover-history-photo-actions">
                  <PhotoPickers kind="opening" prefix={session.openingPhotoUrl ? 'Sửa đầu ca' : 'Bổ sung đầu ca'} compact onPick={(file) => void saveShiftPhoto('opening', file, session)} />
                  <PhotoPickers kind="closing" prefix={session.closingPhotoUrl ? 'Sửa cuối ca' : 'Bổ sung cuối ca'} compact onPick={(file) => void saveShiftPhoto('closing', file, session)} />
                </span>
              </span>
              <b>Đã bàn giao</b>
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

function receiptsInSession(receipts: SalesReceipt[], session: BagShiftSession) {
  return receipts.filter((receipt) => {
    if (receipt.branchId !== session.branchId || receipt.businessDate !== session.businessDate) return false
    if (receipt.createdAt < session.startedAt) return false
    if (session.endedAt && receipt.createdAt > session.endedAt) return false
    return true
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

function visibleProducts(
  session: BagShiftSession,
  movements: StockMovement[],
  countProducts: ConfiguredProduct[],
  availableBalances: Record<string, number>,
) {
  const ids = new Set<string>()
  countProducts.forEach((product) => {
    if ((session.openingBalances[product.id] || 0) > 0) ids.add(product.id)
    if ((availableBalances[product.id] || 0) > 0) ids.add(product.id)
  })
  movements
    .filter((item) => item.type === 'processing_in' && item.createdAt >= session.startedAt)
    .forEach((item) => ids.add(item.productId))
  if (!ids.size) countProducts.slice(0, 4).forEach((product) => ids.add(product.id))
  return countProducts.filter((product) => ids.has(product.id))
}

// Thành phẩm bàn giao theo kg, cho tới 4 số lẻ; số nguyên (vd số lượng bán) vẫn hiển thị nguyên.
function formatNumber(value: number) { return Number(value.toFixed(4)).toLocaleString('vi-VN', { maximumFractionDigits: 4 }) }
function formatMoney(value: number) { return `${Math.round(value).toLocaleString('vi-VN')}d` }
function formatTime(value: string) { return new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) }
function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}
