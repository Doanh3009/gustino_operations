import { useEffect, useMemo, useRef, useState } from 'react'
import { getSaleProducts, productById } from '../lib/constants'
import { productSaleValues } from '../lib/commission'
import { fetchAttendanceRecords, fetchEmployees, fetchShiftRegistrations, findAttendanceRecordForRegistration } from '../lib/attendance'
import { burstGuard, createId } from '../lib/browser'
import {
  deleteSalesReceipt,
  fetchSalesReceipts,
  saveSalesReceipt,
  type SalesReceipt,
  type SalesReceiptLine,
} from '../lib/salesReceipts'
import { supabase, uniqueChannelName } from '../lib/supabase'
import { localDateKey } from '../lib/dates'
import { fetchConfiguredProducts } from '../lib/products'
import { branchName } from '../lib/branches'
import type { Page } from '../components/AppShell'
import type { AppUser, AttendanceRecord, EmployeeProfile, ShiftRegistration } from '../types'

interface SellerOption {
  key: string
  employeeName: string
  employeeId?: string
}

export function SalesPage({ user, onNavigate }: { user: AppUser; onNavigate?: (page: Page) => void }) {
  const [registrations, setRegistrations] = useState<ShiftRegistration[]>([])
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([])
  const [branchStaff, setBranchStaff] = useState<EmployeeProfile[]>([])
  const [cart, setCart] = useState<Record<string, number>>({})
  const [selectedSellerKey, setSelectedSellerKey] = useState(user.id)
  const [productTick, setProductTick] = useState(0)
  const saleProducts = useMemo(() => getSaleProducts(), [productTick])
  const [receipts, setReceipts] = useState<SalesReceipt[]>([])
  const [lastReceipt, setLastReceipt] = useState<SalesReceipt | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  // Id hóa đơn được giữ ổn định cho MỘT lần bấm thanh toán (kể cả khi retry sau
  // lỗi mạng): server nhận trùng id sẽ trả lại hóa đơn cũ thay vì tạo đơn mới
  // và trừ kho lần hai. Chỉ đổi id khi đơn đã lưu thành công hoặc giỏ thay đổi.
  const pendingReceiptIdRef = useRef('')
  const [feedback, setFeedback] = useState('')
  const [feedbackType, setFeedbackType] = useState<'ok' | 'err'>('ok')
  const canManageSales = user.role === 'shift_leader' || user.role === 'shift_deputy' || user.role === 'manager' || user.role === 'admin'
  // `today` bám đồng hồ để POS mở qua nửa đêm không ghi hóa đơn vào ngày cũ.
  const [clockTick, setClockTick] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])
  const today = localDateKey(new Date(clockTick))
  const [selectedDate, setSelectedDate] = useState(today)

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

  const activeAttendanceShift = useMemo(() => {
    const now = new Date()
    const todayRegistrations = registrations
      .filter((registration) => registration.userId === user.id && registration.workDate === selectedDate && registration.status !== 'rejected')
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
    return todayRegistrations.find((registration) => {
      const record = findAttendanceRecordForRegistration(attendanceRecords, registration)
      if (record && !record.checkOutTime) return true
      const startsAt = new Date(`${registration.workDate}T${registration.startTime}:00`)
      const endsAt = new Date(`${registration.workDate}T${registration.endTime}:00`)
      if (registration.endTime <= registration.startTime) endsAt.setDate(endsAt.getDate() + 1)
      return Boolean(record) && now >= startsAt && now <= endsAt
    }) || todayRegistrations.find((registration) => findAttendanceRecordForRegistration(attendanceRecords, registration))
  }, [attendanceRecords, registrations, selectedDate, user.id])

  const shiftPillLabel = activeAttendanceShift
    ? `Đã check-in ${activeAttendanceShift.startTime}-${activeAttendanceShift.endTime}`
    : 'Chưa có ca'
  const shiftPillOpen = Boolean(activeAttendanceShift)

  async function refresh(showLoading = false) {
    if (showLoading) setLoading(true)
    try {
      const [nextReceipts, nextRegistrations, nextAttendanceRecords, nextStaff] = await Promise.all([
        fetchSalesReceipts(user, { branchId: user.branchId, date: selectedDate }),
        fetchShiftRegistrations(user, { branchId: user.branchId, from: selectedDate, to: selectedDate }),
        fetchAttendanceRecords(user, { branchId: user.branchId, userId: canManageSales ? undefined : user.id, from: selectedDate, to: selectedDate }),
        canManageSales ? fetchEmployees(user) : Promise.resolve([] as EmployeeProfile[]),
      ])
      setReceipts(dedupeReceipts(nextReceipts))
      setRegistrations(nextRegistrations)
      setAttendanceRecords(nextAttendanceRecords)
      setBranchStaff(nextStaff)
      setFeedback('')
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : 'Không thể tải sổ bán hàng.', 'err')
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => { void refresh(true) }, [user.id, user.branchId, selectedDate])

  useEffect(() => {
    const reload = () => void refresh()
    const reloadWhenVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }
    // POS là màn doanh thu: mất mạng/máy ngủ xong PHẢI tự tải lại, không được
    // đứng im chờ realtime event không bao giờ tới.
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
    // Bán một hoá đơn là 1 event hoá đơn + n event dòng hàng; bảng dòng hàng
    // không có `branch_id` nên máy chi nhánh khác cũng nhận. Gộp lại một lượt.
    const reloadSoon = burstGuard(reload)
    const channel = client.channel(uniqueChannelName(`sales-pos:${user.branchId}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_receipts', filter: `branch_id=eq.${user.branchId}` }, reloadSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_receipt_items' }, reloadSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_registrations', filter: `branch_id=eq.${user.branchId}` }, reloadSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records', filter: `branch_id=eq.${user.branchId}` }, reloadSoon)
      // SUBSCRIBED bắn cả khi rejoin sau rớt mạng → refetch bù event đã lỡ.
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') reload()
      })
    return () => {
      removeWindowListeners()
      reloadSoon.cancel()
      void client.removeChannel(channel)
    }
  }, [user.branchId, user.id, selectedDate])

  function showFeedback(msg: string, type: 'ok' | 'err' = 'ok') {
    setFeedback(msg)
    setFeedbackType(type)
  }

  const sellerOptions = useMemo(() => {
    const map = new Map<string, SellerOption>()
    const add = (option: SellerOption) => {
      if (!option.key || !option.employeeName.trim()) return
      if (!map.has(option.key)) map.set(option.key, option)
    }
    add({ key: user.id, employeeId: user.id, employeeName: user.name })
    if (canManageSales) {
      registrations
        .filter((registration) => registration.branchId === user.branchId && registration.workDate === selectedDate && registration.status !== 'rejected')
        .forEach((registration) => add({ key: registration.userId, employeeId: registration.userId, employeeName: registration.userName }))
      branchStaff
        .filter((person) => person.branchId === user.branchId && person.active !== false && (person.role === 'staff' || person.role === 'shift_leader' || person.role === 'shift_deputy'))
        .forEach((person) => add({ key: person.id, employeeId: person.id, employeeName: person.name }))
      receipts.forEach((receipt) => add({
        key: receipt.sellerId || receipt.sellerKey || normalizeName(receipt.sellerName),
        employeeId: receipt.sellerId,
        employeeName: receipt.sellerName,
      }))
    }
    return Array.from(map.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'vi'))
  }, [branchStaff, canManageSales, receipts, registrations, selectedDate, user.branchId, user.id, user.name])

  useEffect(() => {
    if (!sellerOptions.length) return
    if (!selectedSellerKey || !sellerOptions.some((seller) => seller.key === selectedSellerKey)) {
      setSelectedSellerKey(canManageSales ? sellerOptions[0].key : user.id)
    }
  }, [sellerOptions, selectedSellerKey, canManageSales, user.id])

  const selectedSeller = sellerOptions.find((seller) => seller.key === selectedSellerKey) || sellerOptions[0] || {
    key: user.id,
    employeeId: user.id,
    employeeName: user.name,
  }
  const sellerMenuProducts = useMemo(() => saleProducts.map((product) => ({
    product,
    inCart: cart[product.id] || 0,
  })), [cart, saleProducts])
  const todayReceipts = receipts.filter((receipt) => receipt.branchId === user.branchId && receipt.businessDate === selectedDate)
  const sellerReceipts = todayReceipts.filter((receipt) =>
    (receipt.sellerId && receipt.sellerId === selectedSeller.employeeId)
    || receipt.sellerKey === selectedSeller.key
    || normalizeName(receipt.sellerName) === normalizeName(selectedSeller.employeeName),
  )
  const visibleReceipts = canManageSales ? todayReceipts : sellerReceipts
  const stats = visibleReceipts.reduce((sum, receipt) => ({
    sold: sum.sold + receipt.totalQuantity,
    revenue: sum.revenue + receipt.totalAmount,
    receipts: sum.receipts + 1,
  }), { sold: 0, revenue: 0, receipts: 0 })
  const cartLines = useMemo(
    () => buildCartLines(cart, { branchId: user.branchId, date: selectedDate }),
    [cart, user.branchId, selectedDate],
  )
  const bill = cartLines.reduce((sum, line) => ({
    quantity: sum.quantity + line.quantity,
    amount: sum.amount + line.total,
  }), { quantity: 0, amount: 0 })
  const currentCartHasItems = cartLines.length > 0
  const receiptsByDate = Array.from(
    visibleReceipts.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).reduce((map, receipt) => {
      const key = receipt.businessDate || receipt.createdAt.slice(0, 10)
      map.set(key, [...(map.get(key) || []), receipt])
      return map
    }, new Map<string, SalesReceipt[]>()).entries(),
  ).sort((a, b) => b[0].localeCompare(a[0]))

  function addProductToCart(productId: string, quantity = 1) {
    // Giỏ đổi nội dung = ý định mua mới → id idempotency cũ không còn đại diện
    // cho giỏ này nữa, phải cấp id mới ở lần thanh toán kế tiếp.
    pendingReceiptIdRef.current = ''
    setCart((current) => ({
      ...current,
      [productId]: Math.max(0, (current[productId] || 0) + quantity),
    }))
  }

  function setLineQuantity(productId: string, quantity: number) {
    pendingReceiptIdRef.current = ''
    setCart((current) => {
      const next = { ...current }
      if (quantity <= 0) delete next[productId]
      else next[productId] = Math.max(1, quantity)
      return next
    })
  }

  function clearCart() {
    setCart({})
    pendingReceiptIdRef.current = ''
  }

  // NV xóa hóa đơn của mình trong ngày; ca trưởng/quản lý/admin xóa mọi hóa đơn.
  function canDeleteReceipt(receipt: SalesReceipt) {
    if (canManageSales) return true
    const isOwn = receipt.createdBy === user.id || receipt.sellerId === user.id
    return isOwn && receipt.businessDate === today
  }

  async function handleDeleteReceipt(receipt: SalesReceipt) {
    if (!canDeleteReceipt(receipt)) return
    if (!window.confirm(`Xóa hóa đơn ${receipt.code} (${formatMoney(receipt.totalAmount)})? Doanh thu sẽ được trừ tương ứng.`)) return
    try {
      await deleteSalesReceipt(user, receipt)
      setReceipts((items) => items.filter((item) => item.id !== receipt.id))
      if (lastReceipt?.id === receipt.id) setLastReceipt(null)
      showFeedback(`Đã xóa hóa đơn ${receipt.code}.`, 'ok')
      await refresh()
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : 'Không thể xóa hóa đơn.', 'err')
    }
  }

  async function checkout() {
    if (!selectedSeller || !cartLines.length) {
      showFeedback('Hóa đơn chưa có món.', 'err')
      return
    }
    if (selectedDate !== today) {
      showFeedback('Chỉ tạo hóa đơn cho ngày hôm nay. Ngày cũ dùng để xem lại dữ liệu đã lưu.', 'err')
      return
    }
    setCheckoutBusy(true)
    try {
      // Nhân viên KHÔNG thu tiền: hóa đơn chỉ gồm món + số lượng. Thành tiền hiển
      // thị tính từ giá cấu hình; server tự tra lại giá trong database khi lưu
      // (không tin giá client) nên đây chỉ là số tham khảo cho nhân viên soát.
      if (!pendingReceiptIdRef.current) pendingReceiptIdRef.current = createId()
      const receipt: SalesReceipt = {
        id: pendingReceiptIdRef.current,
        code: buildReceiptCode(selectedDate, todayReceipts.length + 1),
        branchId: user.branchId,
        businessDate: selectedDate,
        sellerKey: selectedSeller.key,
        sellerId: selectedSeller.employeeId,
        sellerName: selectedSeller.employeeName,
        totalQuantity: bill.quantity,
        totalAmount: bill.amount,
        lines: cartLines,
        createdAt: new Date().toISOString(),
        createdBy: user.id,
        createdByName: user.name,
      }
      const savedReceipt = await saveSalesReceipt(user, receipt)
      pendingReceiptIdRef.current = ''
      setReceipts((items) => dedupeReceipts([savedReceipt, ...items]).slice(0, 200))
      setLastReceipt(savedReceipt)
      setCart({})
      showFeedback(`Đã ghi nhận bán hàng ${savedReceipt.code} - ${formatMoney(savedReceipt.totalAmount)}.`, 'ok')
      await refresh()
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : 'Không thể tạo hóa đơn.', 'err')
    } finally {
      setCheckoutBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="page sales-page-v2 pos-page">
        <div className="section-card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>Đang tải quầy bán hàng...</div>
      </div>
    )
  }

  return (
    <div className="page sales-page-v2 pos-page">
      <div className="pos-topbar">
        <div>
          <span className="eyebrow dark">BÁN HÀNG</span>
          <h1>POS bán hàng PG</h1>
        </div>
        <div className="pos-topbar-actions">
          <label className="pos-date-filter">Ngày
            <input type="date" value={selectedDate} onChange={(event) => { setSelectedDate(event.target.value); setCart({}) }} />
          </label>
          <span className={shiftPillOpen ? 'sales-shift-pill open' : 'sales-shift-pill no-shift'}><i />{shiftPillLabel}</span>
          {canManageSales && onNavigate && (
            <button type="button" className="secondary-button sales-next-button" onClick={() => onNavigate('handover')}>
              Chốt tồn ca
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div className={`feedback-bar${feedbackType === 'ok' ? ' success' : ''}`}>
          {feedback}
          <button onClick={() => setFeedback('')}>×</button>
        </div>
      )}

      <div className="pos-summary-strip">
        <article><span>Đã bán</span><strong>{stats.sold}</strong><small>{formatMoney(stats.revenue)}</small></article>
        <article><span>Hóa đơn</span><strong>{stats.receipts}</strong><small>{formatDate(selectedDate)}</small></article>
        <article><span>Menu</span><strong>{saleProducts.length}</strong><small>món đang hiển thị</small></article>
        <article><span>Ca</span><strong>{activeAttendanceShift ? 'OK' : '-'}</strong><small>{activeAttendanceShift ? 'đã check-in' : 'chưa mở'}</small></article>
      </div>

      <div className="pos-layout">
        <section className="pos-menu-panel">
          {canManageSales && sellerOptions.length > 0 && (
            <div className="seller-tabs" aria-label="Chọn nhân viên bán">
              {sellerOptions.map((seller) => {
                const sold = todayReceipts
                  .filter((receipt) => (receipt.sellerId && receipt.sellerId === seller.employeeId) || receipt.sellerKey === seller.key)
                  .reduce((sum, receipt) => sum + receipt.totalQuantity, 0)
                return (
                  <button
                    key={seller.key}
                    className={seller.key === selectedSeller.key ? 'active' : ''}
                    onClick={() => {
                      if (currentCartHasItems && !window.confirm('Đổi nhân viên sẽ xóa hóa đơn đang nhập. Tiếp tục?')) return
                      setSelectedSellerKey(seller.key)
                      setCart({})
                    }}
                  >
                    <strong>{seller.employeeName}</strong>
                    <small>Đã bán {sold} sản phẩm</small>
                  </button>
                )
              })}
            </div>
          )}

          <div className="pos-panel-head">
            <div>
              <span className="eyebrow dark">MENU BÁN NHANH</span>
              <h2>{selectedSeller.employeeName}</h2>
            </div>
            <span className="count-pill">{sellerMenuProducts.length} món</span>
          </div>

          <div className="pos-product-grid">
            {sellerMenuProducts
              .slice()
              .sort((a, b) => a.product.name.localeCompare(b.product.name, 'vi'))
              .map(({ product, inCart }) => {
                const values = productSaleValues(product.id, 1, { branchId: user.branchId, date: selectedDate })
                return (
                  <article key={product.id}>
                    <button
                      className={`pos-product-main${values.discounted ? ' is-promo' : ''}`}
                      disabled={checkoutBusy}
                      onClick={() => addProductToCart(product.id, 1)}
                    >
                      <span>{shortProductName(product.name)}</span>
                      <strong>{formatMoney(values.price)}</strong>
                      {/* Giá gốc gạch ngang: nhân viên phải thấy ngay là món
                          đang khuyến mãi, nếu không sẽ đọc giá cũ cho khách. */}
                      {values.discounted
                        ? <small className="pos-product-was">{formatMoney(values.basePrice)}</small>
                        : <small>Bán không giới hạn</small>}
                      {inCart > 0 && <b>{inCart}</b>}
                    </button>
                    <div className="pos-product-quick">
                      {[1, 2, 3].map((qty) => (
                        <button key={qty} disabled={checkoutBusy} onClick={() => addProductToCart(product.id, qty)}>+{qty}</button>
                      ))}
                    </div>
                  </article>
                )
              })}
          </div>
        </section>

        <aside className="pos-bill-panel">
          <div className="bill-head">
            <div>
              <span>HÓA ĐƠN MỚI</span>
              <strong>{selectedSeller.employeeName}</strong>
            </div>
            <button disabled={!cartLines.length || checkoutBusy} onClick={clearCart}>Xóa</button>
          </div>

          <div className="bill-lines">
            {cartLines.map((line) => (
              <article key={line.productId}>
                <div>
                  <strong>{shortProductName(line.productName)}</strong>
                  <small>{formatMoney(line.unitPrice)} / sản phẩm</small>
                </div>
                <div className="bill-qty">
                  <button disabled={checkoutBusy} onClick={() => setLineQuantity(line.productId, line.quantity - 1)}>-</button>
                  <b>{line.quantity}</b>
                  <button disabled={checkoutBusy} onClick={() => setLineQuantity(line.productId, line.quantity + 1)}>+</button>
                </div>
                <span>{formatMoney(line.total)}</span>
              </article>
            ))}
            {!cartLines.length && (
              <p className="bill-empty">Chạm món bên trái để thêm vào hóa đơn cho khách.</p>
            )}
          </div>

          <div className="bill-total">
            <span>Tổng cộng</span>
            <strong>{formatMoney(bill.amount)}</strong>
            <small>{bill.quantity} sản phẩm - tạo mã đối soát</small>
          </div>

          {/* Nhân viên KHÔNG thu tiền: đã bỏ hẳn ô nhập tiền + chọn phương thức
              thanh toán. Chỉ xác nhận món + số lượng, hệ thống tự tính doanh thu
              theo giá cấu hình trong database. */}
          <button className="pos-checkout-button" disabled={!cartLines.length || checkoutBusy} onClick={() => void checkout()}>
            {checkoutBusy ? 'Đang lưu...' : 'Xác nhận bán hàng'}
          </button>

          <div className="receipt-history">
            <div className="receipt-history-head">
              <strong>{canManageSales ? 'Hóa đơn đã bán (cả chi nhánh)' : 'Hóa đơn của bạn'}</strong>
              <span>{visibleReceipts.length}</span>
            </div>
            {receiptsByDate.length ? receiptsByDate.map(([date, dayReceipts], index) => (
              <details className="receipt-history-day" key={date} open={index === 0}>
                <summary>
                  <span><strong>{formatDate(date)}</strong><small>{dayReceipts.length} hóa đơn</small></span>
                  <b>{formatMoney(dayReceipts.reduce((sum, receipt) => sum + receipt.totalAmount, 0))}</b>
                </summary>
                {dayReceipts.map((receipt) => (
                  <div className="receipt-history-row" key={receipt.id}>
                    <button className="receipt-history-view" onClick={() => setLastReceipt(receipt)}>
                      <span><strong>{receipt.code}</strong><small>{new Date(receipt.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} - {receipt.totalQuantity} sản phẩm{canManageSales ? ` - ${receipt.sellerName}` : ''}</small></span>
                      <b>{formatMoney(receipt.totalAmount)}</b>
                    </button>
                    {canDeleteReceipt(receipt) && (
                      <button className="receipt-history-delete" title="Xóa hóa đơn bấm nhầm" aria-label={`Xóa hóa đơn ${receipt.code}`} onClick={() => void handleDeleteReceipt(receipt)}>Xóa</button>
                    )}
                  </div>
                ))}
              </details>
            )) : <small className="receipt-empty">Chưa có hóa đơn nào.</small>}
          </div>
        </aside>
      </div>

      {lastReceipt && (
        <div className="receipt-modal-backdrop" onClick={(event) => { if (event.currentTarget === event.target) setLastReceipt(null) }}>
          <div className="receipt-modal">
            <button className="receipt-close" onClick={() => setLastReceipt(null)}>×</button>
            <div className="receipt-paper">
              <header>
                <strong>GUSTINO</strong>
                <span>Hóa đơn bán hàng</span>
                <b>{lastReceipt.code}</b>
              </header>
              <dl>
                <div><dt>Thời gian</dt><dd>{new Date(lastReceipt.createdAt).toLocaleString('vi-VN', { hour12: false })}</dd></div>
                <div><dt>Nhân viên</dt><dd>{lastReceipt.sellerName}</dd></div>
                <div><dt>Chi nhánh</dt><dd>{branchName(lastReceipt.branchId)}</dd></div>
              </dl>
              <section>
                {lastReceipt.lines.map((line) => (
                  <div key={line.productId}>
                    <span>{shortProductName(line.productName)} x {line.quantity}</span>
                    <b>{formatMoney(line.total)}</b>
                  </div>
                ))}
              </section>
              <footer>
                <span>Tổng cộng</span>
                <strong>{formatMoney(lastReceipt.totalAmount)}</strong>
              </footer>
              <p>Cảm ơn quý khách!</p>
            </div>
            <button type="button" className="receipt-print-button" onClick={printPosReceipt}>In hóa đơn</button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Giá ghi vào hóa đơn là giá TẠI THỜI ĐIỂM BÁN, nên phải truyền đúng chi nhánh
 * và ngày nghiệp vụ để lớp khuyến mãi áp được. Hóa đơn đã ghi giữ nguyên mức
 * này về sau, kể cả khi chương trình kết thúc.
 */
function buildCartLines(
  cart: Record<string, number>,
  pricing: { branchId: string; date: string },
): SalesReceiptLine[] {
  return Object.entries(cart).flatMap(([productId, quantity]) => {
    if (quantity <= 0) return []
    const product = productById(productId)
    const values = productSaleValues(productId, quantity, pricing)
    return [{
      productId,
      productName: product?.name || productId,
      quantity,
      unitPrice: values.price,
      total: values.revenue,
    }]
  })
}

function buildReceiptCode(businessDate: string, sequence: number) {
  const date = `${businessDate.slice(8, 10)}${businessDate.slice(5, 7)}`
  return `HD${date}-${String(sequence).padStart(3, '0')}`
}

function dedupeReceipts(receipts: SalesReceipt[]) {
  const map = new Map<string, SalesReceipt>()
  receipts.forEach((receipt) => map.set(receipt.id, receipt))
  return Array.from(map.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function shortProductName(value: string) {
  return value
    .replace(/^Hạt dẻ\s*/i, '')
    .replace(/^Hat de\s*/i, '')
    .replace(/^Khoai lang mật\s*/i, 'Khoai ')
    .replace(/^Khoai lang mat\s*/i, 'Khoai ')
    .replace(/^Bánh hạt dẻ\s*/i, 'Bánh ')
    .replace(/^Banh hat de\s*/i, 'Bánh ')
    .trim()
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}d`
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-')
  return day && month && year ? `${day}/${month}/${year}` : value
}

function printPosReceipt() {
  document.body.classList.add('printing-pos-receipt')
  const cleanup = () => document.body.classList.remove('printing-pos-receipt')
  window.addEventListener('afterprint', cleanup, { once: true })
  window.print()
  window.setTimeout(cleanup, 1000)
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}
