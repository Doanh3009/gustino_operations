import { useMemo, useState } from 'react'
import { MOVEMENT_LABELS, productById } from '../lib/constants'
import { calculateStock, deleteMovements } from '../lib/store'
import type { AppUser, StockMovement } from '../types'

interface Props {
  user: AppUser
  movements: StockMovement[]
  onChanged: () => Promise<void>
}

interface MovementGroup {
  id: string
  rows: StockMovement[]
  createdAt: string
  shiftDate: string
  primaryType: StockMovement['type']
}

export function HistoryPage({ user, movements, onChanged }: Props) {
  const [feedback, setFeedback] = useState('')
  const [deletingId, setDeletingId] = useState('')
  const groupsByDate = useMemo(() => {
    const grouped = new Map<string, StockMovement[]>()
    movements.forEach((item) => {
      const key = item.documentId || item.id
      grouped.set(key, [...(grouped.get(key) || []), item])
    })
    const documents: MovementGroup[] = Array.from(grouped.entries()).map(([id, rows]) => ({
      id,
      rows,
      createdAt: rows.reduce((latest, item) => item.createdAt > latest ? item.createdAt : latest, rows[0].createdAt),
      shiftDate: rows[0].shiftDate,
      primaryType: getPrimaryType(rows),
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    const dates = new Map<string, MovementGroup[]>()
    documents.forEach((document) => {
      dates.set(document.shiftDate, [...(dates.get(document.shiftDate) || []), document])
    })
    return Array.from(dates.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [movements])

  async function removeGroup(group: MovementGroup) {
    const ids = new Set(group.rows.map((item) => item.id))
    const negative = calculateStock(movements.filter((item) => !ids.has(item.id)))
      .find((line) => line.expected < -0.0001)
    if (negative) {
      setFeedback(`Không thể xóa vì ${negative.product.name} sẽ bị âm ${formatNumber(negative.expected)} ${negative.product.unit}. Hãy xử lý giao dịch phát sinh sau trước.`)
      return
    }
    const label = group.primaryType === 'inbound' ? 'phiếu nhập kho' : 'mẻ chế biến'
    if (!window.confirm(`Xóa ${label}? Toàn bộ ${group.rows.length} dòng trong chứng từ sẽ bị xóa.`)) return
    setDeletingId(group.id)
    try {
      await deleteMovements(user.branchId, group.rows.map((item) => item.id), user)
      setFeedback(`Đã xóa ${label} và tính lại tồn kho.`)
      await onChanged()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : `Không thể xóa ${label}.`)
    } finally {
      setDeletingId('')
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div><span className="eyebrow dark">NHẬT KÝ HỆ THỐNG</span><h1>Lịch sử kho theo chứng từ</h1></div>
      </div>
      {feedback && <div className="feedback-bar">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}
      {!groupsByDate.length && <section className="section-card"><p className="empty-state">Chưa có giao dịch kho.</p></section>}
      <div className="history-date-list">
        {groupsByDate.map(([date, groups]) => (
          <section className="section-card history-day" key={date}>
            <div className="section-title">
              <div><span className="eyebrow dark">NGÀY VẬN HÀNH</span><h2>{formatDate(date)}</h2></div>
              <span className="date-chip">{groups.length} chứng từ</span>
            </div>
            <div className="document-list">
              {groups.map((group) => {
                const canDelete = group.primaryType === 'inbound' || group.primaryType === 'processing_out'
                return <details className="history-document" key={group.id}>
                  <summary>
                    <span className={`activity-icon ${group.primaryType}`}>{movementIcon(group.primaryType)}</span>
                    <div className="history-document-title">
                      <strong>{documentTitle(group)}</strong>
                      <small>{new Date(group.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · {group.rows.length} dòng · Mã {group.id.slice(0, 8)}</small>
                    </div>
                    <div className="history-document-totals">{summarizeProducts(group.rows)}</div>
                    <span className="details-arrow">⌄</span>
                  </summary>
                  <div className="history-document-body">
                    <div className="history-lines">
                      {group.rows.map((item) => {
                        const product = productById(item.productId)
                        return <div className="history-line" key={item.id}>
                          <span className={`movement-badge ${item.type}`}>{MOVEMENT_LABELS[item.type]}</span>
                          <strong>{product?.name || item.productId}</strong>
                          <b>{formatNumber(item.quantity)} {product?.unit}</b>
                          <small>{item.note || '—'}</small>
                        </div>
                      })}
                    </div>
                    {canDelete && <div className="history-document-actions">
                      <button className="danger-button" disabled={deletingId === group.id} onClick={() => removeGroup(group)}>
                        {deletingId === group.id ? 'Đang xóa…' : group.primaryType === 'inbound' ? 'Xóa phiếu nhập' : 'Xóa mẻ chế biến'}
                      </button>
                    </div>}
                  </div>
                </details>
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function getPrimaryType(rows: StockMovement[]): StockMovement['type'] {
  const priority: StockMovement['type'][] = ['inbound', 'sale_out', 'processing_out', 'count', 'adjustment', 'waste', 'packing_out', 'processing_in', 'packing_in', 'opening']
  return priority.find((type) => rows.some((item) => item.type === type)) || rows[0].type
}

function documentTitle(group: MovementGroup) {
  if (group.primaryType === 'inbound') return 'Phiếu nhập kho'
  if (group.primaryType === 'sale_out') return 'Phiếu xuất bán'
  if (group.primaryType === 'processing_out') return 'Mẻ chế biến và đóng gói'
  if (group.primaryType === 'count') return 'Phiếu kiểm kê'
  return MOVEMENT_LABELS[group.primaryType]
}

function summarizeProducts(rows: StockMovement[]) {
  const visibleRows = rows.filter((item) => ['inbound', 'sale_out', 'processing_out', 'processing_in', 'count'].includes(item.type))
  const summary = visibleRows.slice(0, 2).map((item) => {
    const product = productById(item.productId)
    return `${product?.name || item.productId}: ${formatNumber(item.quantity)} ${product?.unit || ''}`
  })
  return <><span>{summary.join(' · ')}</span>{visibleRows.length > 2 && <small>+{visibleRows.length - 2} sản phẩm</small>}</>
}

function movementIcon(type: StockMovement['type']) {
  if (type === 'inbound' || type === 'processing_in' || type === 'packing_in') return '＋'
  if (type === 'sale_out' || type === 'processing_out' || type === 'packing_out') return '−'
  if (type === 'count') return '✓'
  return '•'
}

function formatDate(date: string) {
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year}`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value)
}
