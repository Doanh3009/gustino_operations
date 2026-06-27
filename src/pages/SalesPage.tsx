import { useEffect, useMemo, useState } from 'react'
import { PRODUCTS } from '../lib/constants'
import { productSaleValues, soldBagQuantity } from '../lib/commission'
import { fetchBagAllocations, fetchBagShiftSessions, recordBagSale } from '../lib/shiftLedger'
import { createId } from '../lib/browser'
import {
  fetchSalesReceipts,
  loadLocalReceipts,
  saveLocalReceipts,
  saveSalesReceipt,
  type PaymentMethod,
  type SalesReceipt,
  type SalesReceiptLine,
} from '../lib/salesReceipts'
import { supabase } from '../lib/supabase'
import { localDateKey } from '../lib/dates'
import type { AppUser, BagAllocation, BagShiftSession } from '../types'
import type { Page } from '../components/AppShell'

const BAG_PRODUCTS = PRODUCTS.filter((p) => p.category === 'finished' && p.unit === 'túi')

interface EmployeeGroup {
  key: string
  employeeName: string
  employeeId?: string
  allocations: BagAllocation[]
}

export function SalesPage({ user, onNavigate }: { user: AppUser; onNavigate?: (page: Page) => void }) {
  const [allocations, setAllocations] = useState<BagAllocation[]>([])
  const [sessions, setSessions] = useState<BagShiftSession[]>([])
  const [cart, setCart] = useState<Record<string, number>>({})
  const [selectedSellerKey, setSelectedSellerKey] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [receipts, setReceipts] = useState<SalesReceipt[]>(loadLocalReceipts)
  const [lastReceipt, setLastReceipt] = useState<SalesReceipt | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [feedbackType, setFeedbackType] = useState<'ok' | 'err'>('ok')
  const canManageSales = user.role === 'shift_leader' || user.role === 'manager' || user.role === 'admin'
  const today = localDateKey()
  const openSession = sessions.find((s) => s.status === 'open')

  async function refresh(showLoading = false) {
    if (showLoading) setLoading(true)
    try {
      const [nextAllocations, nextSessions] = await Promise.all([
        fetchBagAllocations(user, { branchId: user.branchId, date: today }),
        fetchBagShiftSessions(user, { branchId: user.branchId, date: today }),
      ])
      setAllocations(nextAllocations)
      setSessions(nextSessions)
      setReceipts(await fetchSalesReceipts(user, { branchId: user.branchId, date: today }))
      setFeedback('')
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : 'Không thể tải sổ bán hàng.', 'err')
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => { void refresh(true) }, [user.id, user.branchId, today])

  useEffect(() => {
    const client = supabase
    if (!client) {
      const timer = window.setInterval(() => void refresh(), 5000)
      return () => window.clearInterval(timer)
    }
    const channel = client.channel(`sales-pos:${user.branchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bag_allocations', filter: `branch_id=eq.${user.branchId}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bag_shift_sessions', filter: `branch_id=eq.${user.branchId}` }, () => void refresh())
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [user.branchId, user.id, today])

  function showFeedback(msg: string, type: 'ok' | 'err' = 'ok') {
    setFeedback(msg)
    setFeedbackType(type)
  }

  const scopedAllocations = useMemo(() => {
    const open = allocations
      .filter((a) => !a.settledAt && BAG_PRODUCTS.some((p) => p.id === a.productId))
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'vi') || a.productId.localeCompare(b.productId))
    if (canManageSales) return open
    const userNameKey = normalizeName(user.name)
    return open.filter((a) => a.employeeId === user.id || normalizeName(a.employeeName) === userNameKey)
  }, [allocations, canManageSales, user.id, user.name])

  const employeeGroups: EmployeeGroup[] = useMemo(() => {
    const map = new Map<string, EmployeeGroup>()
    scopedAllocations.forEach((a) => {
      const key = a.employeeId || normalizeName(a.employeeName)
      const group = map.get(key) || { key, employeeName: a.employeeName, employeeId: a.employeeId, allocations: [] }
      group.allocations.push(a)
      map.set(key, group)
    })
    return Array.from(map.values())
  }, [scopedAllocations])

  useEffect(() => {
    if (!employeeGroups.length) return
    if (!selectedSellerKey || !employeeGroups.some((group) => group.key === selectedSellerKey)) {
      setSelectedSellerKey(employeeGroups[0].key)
    }
  }, [employeeGroups, selectedSellerKey])

  const selectedGroup = employeeGroups.find((group) => group.key === selectedSellerKey) || employeeGroups[0]
  const selectedAllocations = selectedGroup?.allocations || []
  const stats = scopedAllocations.reduce((t, a) => {
    const sold = soldBagQuantity(a)
    const values = productSaleValues(a.productId, sold)
    t.issued += a.issuedQuantity
    t.sold += sold
    t.remaining += remainingToSell(a)
    t.revenue += values.revenue
    return t
  }, { issued: 0, sold: 0, remaining: 0, revenue: 0 })
  const cartLines = useMemo(() => buildCartLines(selectedAllocations, cart), [selectedAllocations, cart])
  const bill = cartLines.reduce((sum, line) => ({
    quantity: sum.quantity + line.quantity,
    amount: sum.amount + line.total,
  }), { quantity: 0, amount: 0 })
  const todayReceipts = receipts.filter((receipt) => receipt.branchId === user.branchId && receipt.createdAt.slice(0, 10) === today)
  const sellerReceipts = selectedGroup ? todayReceipts.filter((receipt) => receipt.sellerKey === selectedGroup.key) : []
  const currentCartHasItems = cartLines.length > 0

  function addToCart(allocation: BagAllocation, quantity = 1) {
    const available = remainingToSell(allocation)
    if (available <= 0) return
    setCart((current) => {
      const currentQty = current[allocation.id] || 0
      const nextQty = Math.min(available, currentQty + quantity)
      return { ...current, [allocation.id]: nextQty }
    })
  }

  function setLineQuantity(allocationId: string, quantity: number) {
    const allocation = selectedAllocations.find((item) => item.id === allocationId)
    if (!allocation) return
    const max = remainingToSell(allocation)
    setCart((current) => {
      const next = { ...current }
      if (quantity <= 0) delete next[allocationId]
      else next[allocationId] = Math.min(quantity, max)
      return next
    })
  }

  function clearCart() {
    setCart({})
  }

  async function checkout() {
    if (!selectedGroup || !cartLines.length) {
      showFeedback('Hóa đơn chưa có món.', 'err')
      return
    }
    setCheckoutBusy(true)
    try {
      const updatedRows: BagAllocation[] = []
      for (const line of cartLines) {
        const allocation = selectedAllocations.find((item) => item.id === line.allocationId)
        if (!allocation) throw new Error('Một món trong hóa đơn không còn hợp lệ. Hãy tải lại trang.')
        if (line.quantity > remainingToSell(allocation)) {
          throw new Error(`${line.productName} chỉ còn ${remainingToSell(allocation)} túi.`)
        }
        updatedRows.push(await recordBagSale(user, allocation, line.quantity))
      }
      setAllocations((items) => items.map((item) => updatedRows.find((row) => row.id === item.id) || item))
      const receipt: SalesReceipt = {
        id: createId(),
        code: buildReceiptCode(todayReceipts.length + 1),
        branchId: user.branchId,
        businessDate: today,
        sellerKey: selectedGroup.key,
        sellerId: selectedGroup.employeeId,
        sellerName: selectedGroup.employeeName,
        paymentMethod,
        totalQuantity: bill.quantity,
        totalAmount: bill.amount,
        lines: cartLines,
        createdAt: new Date().toISOString(),
        createdBy: user.id,
        createdByName: user.name,
      }
      await saveSalesReceipt(user, receipt)
      const nextReceipts = [receipt, ...receipts].slice(0, 200)
      setReceipts(nextReceipts)
      if (!supabase) saveLocalReceipts(nextReceipts)
      setLastReceipt(receipt)
      setCart({})
      showFeedback(`Đã thanh toán ${receipt.code} · ${formatMoney(receipt.totalAmount)}.`, 'ok')
      await refresh()
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : 'Không thể thanh toán hóa đơn.', 'err')
    } finally {
      setCheckoutBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="page sales-page-v2 pos-page">
        <div className="section-card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>Đang tải quầy bán hàng…</div>
      </div>
    )
  }

  return (
    <div className="page sales-page-v2 pos-page">
      <div className="pos-topbar">
        <div>
          <span className="eyebrow dark">BÁN HÀNG</span>
          <h1>Thu ngân quầy</h1>
          <p>Mỗi lượt khách là một hóa đơn. Chọn món, thanh toán, hệ thống tự trừ túi đã phát.</p>
        </div>
        <div className="pos-topbar-actions">
          <span className={openSession ? 'sales-shift-pill open' : 'sales-shift-pill no-shift'}><i />{openSession ? `Ca ${openSession.sequence} đang mở` : 'Chưa có ca'}</span>
          {onNavigate && (
            <button className="sales-link-handover" onClick={() => onNavigate('handover')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 014-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 01-4 4H3" /></svg>
              Phát túi
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
        <article><span>Còn giữ</span><strong>{stats.remaining}</strong><small>túi chưa bán</small></article>
        <article><span>Hóa đơn</span><strong>{todayReceipts.length}</strong><small>trong ngày</small></article>
        <article><span>Ca</span><strong>{openSession ? openSession.sequence : '-'}</strong><small>{openSession ? 'đang hoạt động' : 'chưa mở'}</small></article>
      </div>

      {!scopedAllocations.length ? (
        <div className="sales-empty-state">
          <strong>Chưa có túi nào được phát hôm nay</strong>
          <p>Ca trưởng cần vào <b>Phát túi</b> để phát túi trước, sau đó nhân viên mới tạo hóa đơn bán hàng được.</p>
          {onNavigate && (
            <button className="sales-link-handover" onClick={() => onNavigate('handover')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 014-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 01-4 4H3" /></svg>
              Đi đến Phát túi
            </button>
          )}
        </div>
      ) : (
        <div className="pos-layout">
          <section className="pos-menu-panel">
            {canManageSales && (
              <div className="seller-tabs" aria-label="Chọn nhân viên bán">
                {employeeGroups.map((group) => {
                  const remaining = group.allocations.reduce((sum, item) => sum + remainingToSell(item), 0)
                  return (
                    <button
                      key={group.key}
                      className={group.key === selectedGroup?.key ? 'active' : ''}
                      onClick={() => {
                        if (currentCartHasItems && !window.confirm('Đổi nhân viên sẽ xóa hóa đơn đang nhập. Tiếp tục?')) return
                        setSelectedSellerKey(group.key)
                        setCart({})
                      }}
                    >
                      <strong>{group.employeeName}</strong>
                      <small>Còn {remaining} túi</small>
                    </button>
                  )
                })}
              </div>
            )}

            <div className="pos-panel-head">
              <div>
                <span className="eyebrow dark">MENU BÁN NHANH</span>
                <h2>{selectedGroup?.employeeName || user.name}</h2>
              </div>
              <span className="count-pill">{selectedAllocations.length} loại túi</span>
            </div>

            <div className="pos-product-grid">
              {selectedAllocations
                .slice()
                .sort((a, b) => remainingToSell(b) - remainingToSell(a))
                .map((allocation) => {
                  const product = PRODUCTS.find((item) => item.id === allocation.productId)
                  const remaining = remainingToSell(allocation)
                  const values = productSaleValues(allocation.productId, 1)
                  const inCart = cart[allocation.id] || 0
                  return (
                    <article key={allocation.id} className={remaining <= 0 ? 'sold-out' : ''}>
                      <button
                        className="pos-product-main"
                        disabled={remaining <= 0 || checkoutBusy}
                        onClick={() => addToCart(allocation, 1)}
                      >
                        <span>{shortProductName(product?.name || allocation.productId)}</span>
                        <strong>{formatMoney(values.price)}</strong>
                        <small>{remaining > 0 ? `Còn ${remaining} túi` : 'Đã hết'}</small>
                        {inCart > 0 && <b>{inCart}</b>}
                      </button>
                      <div className="pos-product-quick">
                        {[1, 2, 3].filter((qty) => qty <= remaining).map((qty) => (
                          <button key={qty} disabled={checkoutBusy} onClick={() => addToCart(allocation, qty)}>+{qty}</button>
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
                <strong>{selectedGroup?.employeeName || user.name}</strong>
              </div>
              <button disabled={!cartLines.length || checkoutBusy} onClick={clearCart}>Xóa</button>
            </div>

            <div className="bill-lines">
              {cartLines.map((line) => (
                <article key={line.allocationId}>
                  <div>
                    <strong>{shortProductName(line.productName)}</strong>
                    <small>{formatMoney(line.unitPrice)} / túi</small>
                  </div>
                  <div className="bill-qty">
                    <button disabled={checkoutBusy} onClick={() => setLineQuantity(line.allocationId, line.quantity - 1)}>−</button>
                    <b>{line.quantity}</b>
                    <button disabled={checkoutBusy} onClick={() => setLineQuantity(line.allocationId, line.quantity + 1)}>+</button>
                  </div>
                  <span>{formatMoney(line.total)}</span>
                </article>
              ))}
              {!cartLines.length && (
                <p className="bill-empty">Chạm món bên trái để thêm vào hóa đơn cho khách.</p>
              )}
            </div>

            <div className="payment-methods" aria-label="Chọn hình thức thanh toán">
              {([
                ['cash', 'Tiền mặt'],
                ['qr', 'QR'],
                ['card', 'Thẻ'],
              ] as Array<[PaymentMethod, string]>).map(([method, label]) => (
                <button key={method} className={paymentMethod === method ? 'active' : ''} onClick={() => setPaymentMethod(method)}>{label}</button>
              ))}
            </div>

            <div className="bill-total">
              <span>Tổng cộng</span>
              <strong>{formatMoney(bill.amount)}</strong>
              <small>{bill.quantity} túi · {paymentLabel(paymentMethod)}</small>
            </div>

            <button className="checkout-button" disabled={!cartLines.length || checkoutBusy} onClick={() => void checkout()}>
              {checkoutBusy ? 'Đang thanh toán…' : 'Thanh toán'}
            </button>

            <div className="receipt-history">
              <div className="receipt-history-head">
                <strong>Hóa đơn gần đây</strong>
                <span>{sellerReceipts.length}</span>
              </div>
              {sellerReceipts.slice(0, 5).map((receipt) => (
                <button key={receipt.id} onClick={() => setLastReceipt(receipt)}>
                  <span><strong>{receipt.code}</strong><small>{new Date(receipt.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · {receipt.totalQuantity} túi</small></span>
                  <b>{formatMoney(receipt.totalAmount)}</b>
                </button>
              ))}
              {!sellerReceipts.length && <small className="receipt-empty">Chưa có hóa đơn cho nhân viên này.</small>}
            </div>
          </aside>
        </div>
      )}

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
                <div><dt>Thanh toán</dt><dd>{paymentLabel(lastReceipt.paymentMethod)}</dd></div>
              </dl>
              <section>
                {lastReceipt.lines.map((line) => (
                  <div key={line.allocationId}>
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
          </div>
        </div>
      )}
    </div>
  )
}

function buildCartLines(allocations: BagAllocation[], cart: Record<string, number>): SalesReceiptLine[] {
  return Object.entries(cart).flatMap(([allocationId, quantity]) => {
    const allocation = allocations.find((item) => item.id === allocationId)
    if (!allocation || quantity <= 0) return []
    const product = PRODUCTS.find((item) => item.id === allocation.productId)
    const values = productSaleValues(allocation.productId, quantity)
    return [{
      allocationId,
      productId: allocation.productId,
      productName: product?.name || allocation.productId,
      quantity,
      unitPrice: productSaleValues(allocation.productId, 1).price,
      total: values.revenue,
    }]
  })
}

function remainingToSell(a: BagAllocation) {
  return Math.max(0, a.issuedQuantity - soldBagQuantity(a) - a.returnedQuantity - a.damagedQuantity)
}

function buildReceiptCode(sequence: number) {
  const now = new Date()
  const date = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}`
  return `HD${date}-${String(sequence).padStart(3, '0')}`
}

function paymentLabel(method: PaymentMethod) {
  return method === 'cash' ? 'Tiền mặt' : method === 'qr' ? 'QR chuyển khoản' : 'Thẻ'
}

function shortProductName(value: string) {
  return value
    .replace(/^Hạt dẻ\s*/i, '')
    .replace(/^Khoai lang mật\s*/i, 'Khoai ')
    .replace(/^Bánh hạt dẻ\s*/i, 'Bánh ')
    .trim()
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}
