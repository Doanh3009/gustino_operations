import { useEffect, useMemo, useRef, useState } from 'react'
import { BRANCHES, PRODUCTS } from '../lib/constants'
import { calculateStock } from '../lib/store'
import {
  createSupplyRequests,
  fetchSupplyRequests,
  type SupplyRequest,
} from '../lib/supplyRequests'
import type { AppUser, StockMovement } from '../types'

interface Props {
  user: AppUser
  movements: StockMovement[]
}

interface OrderDraftLine {
  id: string
  productName: string
  quantity: string
  unit: string
  note: string
}

const ORDER_DRAFT_KEY = 'gustino_supply_order_page_draft'

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

export function OrdersPage({ user, movements }: Props) {
  const [lines, setLines] = useState<OrderDraftLine[]>(loadOrderDraft)
  const [requests, setRequests] = useState<SupplyRequest[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const firstInputRef = useRef<HTMLInputElement>(null)
  const branch = BRANCHES.find((item) => item.id === user.branchId)
  const branchIds = useMemo(() => [user.branchId], [user.branchId])
  const stock = useMemo(() => calculateStock(movements), [movements])
  const lowStock = stock
    .filter((line) => line.expected <= line.product.lowStock && line.product.lowStock > 0)
    .sort((a, b) => a.expected - b.expected)
    .slice(0, 8)
  const pending = requests.filter((item) => item.status === 'pending')
  const activeRequests = requests.filter((item) => item.status !== 'fulfilled' && item.status !== 'cancelled')
  const doneRequests = requests.filter((item) => item.status === 'fulfilled' || item.status === 'cancelled')

  useEffect(() => {
    localStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify(lines))
  }, [lines])

  async function refresh() {
    setLoading(true)
    try {
      setRequests(await fetchSupplyRequests(user, branchIds))
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Không thể tải danh sách đặt hàng.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [user.id, user.branchId])

  function updateLine(id: string, patch: Partial<OrderDraftLine>) {
    setLines((items) => items.map((line) => line.id === id ? { ...line, ...patch } : line))
  }

  function addLine() {
    setLines((items) => [...items, emptyOrderLine()])
  }

  function removeLine(id: string) {
    setLines((items) => items.length === 1 ? items : items.filter((line) => line.id !== id))
  }

  function addLowStockLine(productName: string, unit: string) {
    setLines((items) => {
      const blank = items.find((line) => !line.productName.trim() && !line.quantity.trim())
      if (blank) {
        return items.map((line) => line.id === blank.id ? { ...line, productName, unit } : line)
      }
      return [...items, { ...emptyOrderLine(), productName, unit }]
    })
    window.setTimeout(() => firstInputRef.current?.focus(), 50)
  }

  async function submitOrder(event: React.FormEvent) {
    event.preventDefault()
    const validLines = lines
      .map((line) => ({
        productName: line.productName.trim(),
        quantity: Number(line.quantity),
        unit: line.unit.trim() || 'kg',
        note: line.note.trim(),
      }))
      .filter((line) => line.productName && Number.isFinite(line.quantity) && line.quantity > 0)
    if (!validLines.length) {
      setFeedback('Hãy nhập ít nhất một món và số lượng lớn hơn 0.')
      return
    }
    setBusy(true)
    try {
      await createSupplyRequests(user, validLines)
      const blank = emptyOrderLine()
      setLines([blank])
      localStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify([blank]))
      setFeedback(`Đã gửi ${validLines.length} món đến bếp/quản lý.`)
      await refresh()
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Không thể gửi yêu cầu đặt hàng.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page orders-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow dark">ĐẶT HÀNG</span>
          <h1>Báo hàng cần nhập</h1>
          <p>{branch?.name || user.branchId} · Gửi nhiều món một lần, bếp và quản lý cùng nhìn thấy trạng thái xử lý.</p>
        </div>
        <span className={pending.length ? 'date-chip warning' : 'date-chip'}>{pending.length} đơn chờ nhận</span>
      </div>

      {feedback && <div className={`feedback-bar${feedback.startsWith('Đã gửi') ? ' success' : ''}`}>{feedback}<button onClick={() => setFeedback('')}>×</button></div>}

      <div className="orders-layout">
        <section className="entry-card orders-form-card">
          <div className="section-title">
            <div><span className="eyebrow dark">PHIẾU MỚI</span><h2>Danh sách hàng cần đặt</h2></div>
            <button className="secondary-button" type="button" onClick={addLine}>+ Thêm món</button>
          </div>
          {lowStock.length > 0 && (
            <div className="order-low-stock-strip">
              {lowStock.map((line) => (
                <button type="button" key={line.product.id} onClick={() => addLowStockLine(line.product.name, line.product.unit)}>
                  <strong>{line.product.name}</strong>
                  <small>Còn {formatNumber(line.expected)} {line.product.unit}</small>
                </button>
              ))}
            </div>
          )}
          <form onSubmit={submitOrder}>
            <div className="supply-order-lines page-order-lines">
              {lines.map((line, index) => (
                <div className="supply-order-line" key={line.id}>
                  <div className="supply-order-line-head">
                    <strong>Món {index + 1}</strong>
                    {lines.length > 1 && <button type="button" onClick={() => removeLine(line.id)}>Xóa</button>}
                  </div>
                  <label>Hàng cần đặt
                    <input
                      ref={index === 0 ? firstInputRef : undefined}
                      list="order-product-suggestions"
                      value={line.productName}
                      onChange={(event) => updateLine(line.id, { productName: event.target.value })}
                      placeholder="Hạt dẻ, đường, túi 110g..."
                      required={index === 0}
                    />
                  </label>
                  <div className="supply-order-qty">
                    <label>Số lượng
                      <input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={line.quantity}
                        onChange={(event) => updateLine(line.id, { quantity: event.target.value })}
                        placeholder="10"
                        required={index === 0}
                      />
                    </label>
                    <label>Đơn vị
                      <select value={line.unit} onChange={(event) => updateLine(line.id, { unit: event.target.value })}>
                        <option value="kg">kg</option>
                        <option value="túi">túi</option>
                        <option value="thùng">thùng</option>
                        <option value="hộp">hộp</option>
                        <option value="cái">cái</option>
                        <option value="chai">chai</option>
                        <option value="phần">phần</option>
                        <option value="lít">lít</option>
                      </select>
                    </label>
                  </div>
                  <label>Ghi chú
                    <input
                      value={line.note}
                      onChange={(event) => updateLine(line.id, { note: event.target.value })}
                      placeholder="Cần trước 9 giờ sáng, loại A..."
                    />
                  </label>
                </div>
              ))}
            </div>
            <datalist id="order-product-suggestions">
              {PRODUCTS.map((product) => <option key={product.id} value={product.name} />)}
            </datalist>
            <div className="supply-modal-actions orders-actions">
              <button type="button" className="secondary-button" onClick={() => setLines([emptyOrderLine()])}>Làm lại</button>
              <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi yêu cầu →'}</button>
            </div>
          </form>
        </section>

        <section className="section-card orders-status-card">
          <div className="section-title">
            <div><span className="eyebrow dark">TRẠNG THÁI</span><h2>Đơn đã gửi</h2></div>
            <button className="text-button" onClick={() => void refresh()}>{loading ? 'Đang tải…' : 'Tải lại'}</button>
          </div>
          <div className="supply-request-list">
            {activeRequests.map((request) => <OrderRequestItem key={request.id} request={request} />)}
            {!activeRequests.length && <p className="empty-copy">{loading ? 'Đang tải đơn đặt hàng…' : 'Chưa có đơn đang xử lý.'}</p>}
          </div>
          {doneRequests.length > 0 && (
            <details className="orders-done-list">
              <summary>Đơn đã xong / đã hủy ({doneRequests.length})</summary>
              <div className="supply-request-list">
                {doneRequests.slice(0, 20).map((request) => <OrderRequestItem key={request.id} request={request} />)}
              </div>
            </details>
          )}
        </section>
      </div>
    </div>
  )
}

function OrderRequestItem({ request }: { request: SupplyRequest }) {
  return (
    <article className={`supply-request-item${request.status === 'pending' ? ' pending' : ''}`}>
      <span className="supply-request-icon">↑</span>
      <span>
        <strong>{request.productName} · {formatNumber(request.quantity)} {request.unit}</strong>
        <small>{formatDateTime(request.createdAt)} · {request.requestedByName}{request.note ? ` · "${request.note}"` : ''}</small>
      </span>
      <span className={`supply-status-badge ${request.status}`}>{statusLabel(request.status)}</span>
    </article>
  )
}

function statusLabel(status: SupplyRequest['status']) {
  return status === 'pending' ? 'Chờ nhận'
    : status === 'acknowledged' ? 'Đã nhận'
      : status === 'cancelled' ? 'Đã hủy'
        : 'Hoàn thành'
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('vi-VN', { hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
