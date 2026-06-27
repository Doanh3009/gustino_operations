import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { INBOUND_PRODUCTS, MOVEMENT_LABELS, PACKING_OPTIONS_BY_OUTPUT, PROCESS_INPUT_PRODUCTS, PROCESS_OUTPUT_OPTIONS_BY_INPUT, PRODUCTS } from '../lib/constants'
import { createId } from '../lib/browser'
import { addMovements, calculateStock, deleteMovements, ensureOperationDay, getOperationDay, saveInventoryReport } from '../lib/store'
import type {
  AppUser,
  InventoryCountLine,
  InventoryReport,
  MovementType,
  OperationDay,
  StockMovement,
} from '../types'
import type { InventoryTab } from '../components/AppShell'

interface Props {
  user: AppUser
  movements: StockMovement[]
  onChanged: () => Promise<void>
  onOpenHandover: () => void
  initialTab?: InventoryTab
}

interface VoucherLine { id: string; productId: string; quantity: string; note: string }
interface ProcessLine { id: string; productId: string; quantity: string; packing?: Record<string, string> }

const workflow: Array<{ id: InventoryTab | 'handover'; label: string }> = [
  { id: 'overview', label: 'Tồn kho' },
  { id: 'inbound', label: 'Nhập đầu ngày' },
  { id: 'processing_out', label: 'Chế biến & đóng túi' },
  { id: 'handover', label: 'Phát túi nhân viên' },
  { id: 'count', label: 'Kiểm kê cuối ca' },
]

const newVoucherLine = (): VoucherLine => ({
  id: createId(),
  productId: INBOUND_PRODUCTS[0].id,
  quantity: '',
  note: '',
})

const newProcessLine = (kind: 'input' | 'output'): ProcessLine => ({
  id: createId(),
  productId: kind === 'input' ? 'chestnut-roasted-bulk' : 'chestnut-cooked-kg',
  quantity: '',
  packing: {},
})

export function InventoryPage({ user, movements, onChanged, onOpenHandover, initialTab = 'overview' }: Props) {
  const [tab, setTab] = useState<InventoryTab>(initialTab)
  const [voucherLines, setVoucherLines] = useState<VoucherLine[]>([newVoucherLine()])
  const [voucherNote, setVoucherNote] = useState('')
  const [processInputs, setProcessInputs] = useState<ProcessLine[]>([newProcessLine('input')])
  const [processOutputs, setProcessOutputs] = useState<ProcessLine[]>([newProcessLine('output')])
  const [batchPhase, setBatchPhase] = useState<'opening' | 'additional'>('opening')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [nextStepHint, setNextStepHint] = useState<'processing' | 'handover' | ''>('')
  const reportRef = useRef<HTMLDivElement>(null)
  const stock = useMemo(() => calculateStock(movements), [movements])
  const today = new Date().toISOString().slice(0, 10)
  const [selectedDate, setSelectedDate] = useState(today)
  const overviewStock = useMemo(
    () => calculateStock(movements.filter((item) => item.shiftDate <= selectedDate)),
    [movements, selectedDate],
  )
  const visibleOverviewStock = useMemo(() => overviewStock.filter(isVisibleStockLine), [overviewStock])
  const lowStockLines = visibleOverviewStock.filter((line) => line.expected <= line.product.lowStock)
  const [operationDay, setOperationDay] = useState<OperationDay | null>(null)

  useEffect(() => {
    void getOperationDay(user.branchId, today).then(setOperationDay)
  }, [today, user.branchId])
  useEffect(() => setTab(initialTab), [initialTab])

  async function makeSureDayIsOpen() {
    const day = await ensureOperationDay(user, today)
    setOperationDay(day)
    return day
  }

  const documentCount = (type: MovementType) =>
    new Set(movements.filter((item) => item.type === type && item.shiftDate === selectedDate).map((item) => item.documentId || item.id)).size

  const totals = {
    inbound: documentCount('inbound'),
    outbound: documentCount('sale_out'),
    low: lowStockLines.length,
    variance: overviewStock.filter((line) => line.variance !== undefined && line.variance !== 0).length,
  }

  function updateVoucherLine(id: string, patch: Partial<VoucherLine>) {
    setVoucherLines((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  function resetVoucher() {
    setVoucherLines([newVoucherLine()])
    setVoucherNote('')
  }

  async function saveVoucher() {
    const validLines = voucherLines.filter((line) => Number(line.quantity) > 0)
    if (!validLines.length) {
      setFeedback('Phiếu phải có ít nhất một sản phẩm có số lượng lớn hơn 0.')
      return
    }
    setSaving(true)
    const documentId = createId()
    const now = new Date().toISOString()
    try {
      await makeSureDayIsOpen()
      await addMovements(validLines.map((line) => {
        const product = PRODUCTS.find((item) => item.id === line.productId)!
        const enteredQuantity = Number(line.quantity)
        const inboundPackSize = product.inboundPackKg ?? product.inboundPackQuantity
        const storedQuantity = inboundPackSize
          ? enteredQuantity * inboundPackSize
          : enteredQuantity
        const conversionNote = inboundPackSize
          ? `${enteredQuantity} ${product.inboundUnit} × ${inboundPackSize} ${product.unit} = ${storedQuantity} ${product.unit}`
          : ''
        return {
          id: createId(),
          documentId,
          branchId: user.branchId,
          productId: line.productId,
          type: 'inbound',
          quantity: storedQuantity,
          shiftDate: today,
          note: [conversionNote, voucherNote, line.note].filter(Boolean).join(' — '),
          createdBy: user.id,
          createdAt: now,
        }
      }))
      setFeedback(`Đã lưu phiếu nhập gồm ${validLines.length} sản phẩm.`)
      setNextStepHint('processing')
      resetVoucher()
      await onChanged()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Không thể lưu phiếu.')
    } finally {
      setSaving(false)
    }
  }

  async function saveProcessing() {
    const batchDrafts = processInputs.map((input, index) => ({
      input,
      output: processOutputs[index],
    })).filter((batch) => Number(batch.input.quantity) > 0 || Number(batch.output?.quantity) > 0)
    if (!batchDrafts.length) {
      setFeedback('Hãy nhập ít nhất một mẻ chế biến.')
      return
    }
    if (batchDrafts.some((batch) => Number(batch.input.quantity) <= 0 || Number(batch.output?.quantity) <= 0)) {
      setFeedback('Mỗi mẻ phải có đủ số lượng lấy từ kho và số lượng thành phẩm.')
      return
    }
    for (const { output } of batchDrafts) {
      const packedQuantity = (PACKING_OPTIONS_BY_OUTPUT[output.productId] || []).reduce(
        (sum, option) => sum + Number(output.packing?.[option.productId] || 0) * option.sourceQuantity,
        0,
      )
      if (packedQuantity > Number(output.quantity) + 0.0001) {
        const outputProduct = PRODUCTS.find((product) => product.id === output.productId)
        setFeedback(`Số lượng đã đóng gói dùng ${formatNumber(packedQuantity)} ${outputProduct?.unit}, vượt thành phẩm ${formatNumber(Number(output.quantity))} ${outputProduct?.unit}.`)
        return
      }
    }
    const requestedByProduct = new Map<string, number>()
    batchDrafts.forEach(({ input }) => {
      requestedByProduct.set(input.productId, (requestedByProduct.get(input.productId) || 0) + Number(input.quantity))
    })
    for (const [requestedProductId, requested] of requestedByProduct) {
      const available = stock.find((line) => line.product.id === requestedProductId)?.expected || 0
      if (requested > available) {
        const product = PRODUCTS.find((item) => item.id === requestedProductId)
        setFeedback(`Không đủ tồn ${product?.name}. Khả dụng ${formatNumber(available)} ${product?.unit}, mẻ yêu cầu ${formatNumber(requested)} ${product?.unit}.`)
        return
      }
    }
    if (batchDrafts.some(({ input, output }) => {
      return Number(output.quantity) > Number(input.quantity)
    })) {
      setFeedback('Số lượng thành phẩm của mỗi mẻ không thể lớn hơn số lượng nguyên liệu.')
      return
    }
    setSaving(true)
    const now = new Date().toISOString()
    const phaseLabel = batchPhase === 'opening' ? 'Đầu ca' : 'Phát sinh'
    const rows: StockMovement[] = batchDrafts.flatMap(({ input, output }) => {
      const documentId = createId()
      const stockQuantity = Number(input.quantity)
      const raw = stockQuantity
      const cook = Number(output.quantity)
      const loss = raw - cook
      const batchRows: StockMovement[] = [
        {
          id: createId(), documentId, branchId: user.branchId, productId: input.productId,
          type: 'processing_out', quantity: stockQuantity, shiftDate: today,
          note: `[${phaseLabel}] ${note || 'Mẻ rang'}`,
          createdBy: user.id, createdAt: now,
        },
        {
          id: createId(), documentId, branchId: user.branchId, productId: output.productId,
          type: 'processing_in', quantity: cook, shiftDate: today,
          note: `[${phaseLabel}] Thành phẩm chín`,
          createdBy: user.id, createdAt: now, sourceProductId: input.productId, sourceQuantity: raw,
        },
      ]
      if (loss > 0) {
        batchRows.push({
          id: createId(), documentId, branchId: user.branchId, productId: input.productId,
          type: 'waste', quantity: loss, shiftDate: today,
          note: `[${phaseLabel}] Hao hụt chế biến ${(loss / raw * 100).toFixed(1)}%`,
          createdBy: user.id, createdAt: now, sourceProductId: input.productId, sourceQuantity: raw,
        })
      }
      const packingOptions = PACKING_OPTIONS_BY_OUTPUT[output.productId] || []
      const packedQuantity = packingOptions.reduce(
        (sum, option) => sum + Number(output.packing?.[option.productId] || 0) * option.sourceQuantity,
        0,
      )
      if (packedQuantity > 0) {
        const outputProduct = PRODUCTS.find((product) => product.id === output.productId)
        batchRows.push({
          id: createId(), documentId, branchId: user.branchId, productId: output.productId,
          type: 'packing_out', quantity: packedQuantity, shiftDate: today,
          note: `[${phaseLabel}] Đóng gói ${formatNumber(packedQuantity)} ${outputProduct?.unit} thành đơn vị bán`,
          createdBy: user.id, createdAt: now,
        })
        packingOptions.forEach((option) => {
          const packs = Number(output.packing?.[option.productId] || 0)
          if (packs > 0) {
            batchRows.push({
              id: createId(), documentId, branchId: user.branchId, productId: option.productId,
              type: 'packing_in', quantity: packs, shiftDate: today,
              note: `[${phaseLabel}] Đóng ${formatNumber(packs)} ${PRODUCTS.find((product) => product.id === option.productId)?.unit} ${option.label} từ mẻ`,
              createdBy: user.id, createdAt: now, sourceProductId: output.productId, sourceQuantity: packedQuantity,
            })
          }
        })
      }
      return batchRows
    })
    try {
      await makeSureDayIsOpen()
      await addMovements(rows)
      setProcessInputs([newProcessLine('input')])
      setProcessOutputs([newProcessLine('output')])
      setNote('')
      setBatchPhase('additional')
      setFeedback(`Đã lưu ${batchDrafts.length} mẻ chế biến ${phaseLabel.toLowerCase()}. Báo cáo ca hôm nay sẽ tự động hiển thị.`)
      setNextStepHint('handover')
      await onChanged()
    } finally {
      setSaving(false)
    }
  }

  async function deleteMovementGroup(rows: StockMovement[], label: string) {
    const ids = new Set(rows.map((item) => item.id))
    const stockAfterDelete = calculateStock(movements.filter((item) => !ids.has(item.id)))
    const negative = stockAfterDelete.find((line) => line.expected < -0.0001)
    if (negative) {
      setFeedback(`Không thể xóa ${label} vì ${negative.product.name} sẽ bị âm ${formatNumber(negative.expected)} ${negative.product.unit}. Hãy xóa hoặc sửa giao dịch phát sinh sau đó trước.`)
      return
    }
    if (!window.confirm(`Xóa ${label}? Toàn bộ các dòng trong chứng từ này sẽ được xóa và tồn kho sẽ được tính lại.`)) return
    setSaving(true)
    try {
      await deleteMovements(user.branchId, rows.map((item) => item.id))
      setFeedback(`Đã xóa ${label} và cập nhật lại tồn kho.`)
      await onChanged()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : `Không thể xóa ${label}.`)
    } finally {
      setSaving(false)
    }
  }

  function copyTextReport() {
    const lines = stock.map((line) =>
      `• ${line.product.name}: dự kiến ${formatNumber(line.expected)} ${line.product.unit}` +
      (line.actual !== undefined ? ` | thực tế ${formatNumber(line.actual)} | lệch ${formatNumber(line.variance || 0)}` : ''),
    )
    navigator.clipboard.writeText([
      '📦 BÁO CÁO KHO GUSTINO',
      `📅 Ngày: ${new Date().toLocaleDateString('vi-VN')}`,
      `👤 Người lập: ${user.name}`,
      '=====================',
      ...lines,
      '=====================',
      `Cảnh báo tồn thấp: ${totals.low} mặt hàng`,
      `Mặt hàng lệch kho: ${totals.variance}`,
    ].join('\n')).then(() => setFeedback('Đã sao chép báo cáo văn bản.'))
  }

  async function exportInfographic() {
    if (!reportRef.current) return
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(reportRef.current, { scale: 2, backgroundColor: '#fffdf5' })
    const link = document.createElement('a')
    link.download = `GUSTINO_Kho_${today}.jpg`
    link.href = canvas.toDataURL('image/jpeg', 0.95)
    link.click()
  }

  return (
    <div className="page inventory-page">
      <div className="page-heading">
        <div><span className="eyebrow dark">LÀM HÀNG TRONG NGÀY</span><h1>Kho và chế biến</h1><p>Nhập kho, chế biến và đóng túi tại đây. Phát túi cho nhân viên được quản lý riêng theo từng ca.</p></div>
      </div>
      <OperationDayBar
        day={operationDay}
        onOpen={async () => {
          try {
            const day = await makeSureDayIsOpen()
            setFeedback(`Đã mở ngày vận hành ${new Date(day.businessDate).toLocaleDateString('vi-VN')}.`)
          } catch (error) {
            setFeedback(error instanceof Error ? error.message : 'Không thể mở ngày vận hành.')
          }
        }}
      />
      {feedback && <div className="feedback-bar">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}
      {nextStepHint && (
        <div className="inventory-next-step">
          <div>
            <span>{nextStepHint === 'processing' ? 'BƯỚC 2' : 'BƯỚC 3'}</span>
            <strong>{nextStepHint === 'processing' ? 'Tiếp theo: chế biến và đóng túi' : 'Tiếp theo: phát túi cho nhân viên'}</strong>
            <small>
              {nextStepHint === 'processing'
                ? 'Phiếu nhập đã vào kho. Bấm sang bước 2 để ghi lượng lấy ra, lượng thành phẩm chín và số túi đóng được.'
                : 'Mẻ đã lưu. Bấm mở sổ túi để phát cho nhân viên đang có ca hôm nay.'}
            </small>
          </div>
          <button
            className="primary-button"
            onClick={() => {
              if (nextStepHint === 'processing') setTab('processing_out')
              else onOpenHandover()
              setNextStepHint('')
            }}
          >
            {nextStepHint === 'processing' ? 'Mở bước 2' : 'Mở sổ túi'}
          </button>
        </div>
      )}
      <div className="workflow-tabs">
        {workflow.map((item, index) => (
          <button
            key={item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => item.id === 'handover' ? onOpenHandover() : setTab(item.id)}
          >
            <span>{index === 0 ? '⌂' : index}</span><strong>{item.label}</strong>
          </button>
        ))}
      </div>

      {tab === 'overview' && <>
        <div className="inventory-day-toolbar">
          <div>
            <span className="eyebrow dark">TỒN KHO THEO NGÀY</span>
            <strong>{selectedDate === today ? 'Tồn kho hôm nay' : `Tồn kho cuối ngày ${new Date(`${selectedDate}T00:00:00`).toLocaleDateString('vi-VN')}`}</strong>
          </div>
          <label>Chọn ngày
            <input type="date" value={selectedDate} max={today} onChange={(event) => setSelectedDate(event.target.value)} />
          </label>
        </div>
        {lowStockLines.length > 0 && (
          <div className="low-stock-alert" role="alert">
            <strong>⚠ Kho gần hết {lowStockLines.length} mặt hàng</strong>
            <span>{lowStockLines.map((line) => `${line.product.name}: ${formatNumber(line.expected)} ${line.product.unit}`).join(' · ')}</span>
          </div>
        )}
        <div className="stats-grid inventory-stats">
          <div className="stat-card"><span>Phiếu nhập hôm nay</span><strong>{totals.inbound}</strong><small>Tính theo chứng từ, không theo dòng</small></div>
          <div className="stat-card"><span>Phiếu xuất hôm nay</span><strong>{totals.outbound}</strong><small>Tính theo chứng từ, không theo dòng</small></div>
          <div className="stat-card warning"><span>Sắp hết hàng</span><strong>{totals.low}</strong><small>Dưới ngưỡng cảnh báo</small></div>
          <div className="stat-card danger"><span>Lệch kiểm kê</span><strong>{totals.variance}</strong><small>Cần giải trình</small></div>
        </div>
        <StockTable stock={visibleOverviewStock} selectedDate={selectedDate} canCount={selectedDate === today} onCount={() => setTab('count')} />
        <div className="report-actions">
          <button className="secondary-button" onClick={copyTextReport}>▤ Sao chép báo cáo văn bản</button>
          <button className="primary-button" onClick={exportInfographic}>▧ Xuất infographic</button>
        </div>
        <InventoryInfographic ref={reportRef} user={user} stock={visibleOverviewStock} totals={totals} reportDate={selectedDate} />
      </>}

      {tab === 'inbound' && (
        <>
          <VoucherEditor
            lines={voucherLines}
            note={voucherNote}
            saving={saving}
            onNote={setVoucherNote}
            onUpdate={updateVoucherLine}
            onAdd={() => setVoucherLines((items) => [...items, newVoucherLine()])}
            onRemove={(id) => setVoucherLines((items) => items.length === 1 ? items : items.filter((item) => item.id !== id))}
            onSave={saveVoucher}
          />
          <InboundVoucherHistory
            movements={movements.filter((item) => item.shiftDate === today)}
            saving={saving}
            onDelete={(rows) => deleteMovementGroup(rows, 'phiếu nhập kho')}
          />
        </>
      )}

      {tab === 'processing_out' && (
        <>
          <ProcessingBatchEditor
            inputs={processInputs}
            outputs={processOutputs}
            phase={batchPhase}
            note={note}
            saving={saving}
            stock={stock}
            onPhase={setBatchPhase}
            onNote={setNote}
            onInputs={setProcessInputs}
            onOutputs={setProcessOutputs}
            onSave={saveProcessing}
          />
          <ProcessingBatchHistory
            movements={movements.filter((item) => item.shiftDate === today)}
            saving={saving}
            onDelete={(rows) => deleteMovementGroup(rows, 'mẻ chế biến')}
          />
        </>
      )}

      {tab === 'count' && <InventoryReportForm user={user} stock={stock} onChanged={onChanged} onFeedback={setFeedback} />}
    </div>
  )
}

function ProcessingBatchHistory({
  movements, saving, onDelete,
}: {
  movements: StockMovement[]
  saving: boolean
  onDelete: (rows: StockMovement[]) => void
}) {
  const groups = new Map<string, StockMovement[]>()
  movements.forEach((item) => {
    const key = item.documentId || item.id
    groups.set(key, [...(groups.get(key) || []), item])
  })
  const batches = Array.from(groups.entries())
    .filter(([, rows]) => rows.some((item) => item.type === 'processing_out'))
    .sort((a, b) =>
    (b[1][0]?.createdAt || '').localeCompare(a[1][0]?.createdAt || ''),
  )
  return (
    <section className="section-card batch-history">
      <div className="section-title"><div><span className="eyebrow dark">NHẬT KÝ TRONG NGÀY</span><h2>Các mẻ đã chế biến</h2></div><span className="date-chip">{batches.length} mẻ</span></div>
      {!batches.length && <p className="empty-copy">Chưa có mẻ chế biến. Mỗi lần chế biến thêm hãy tạo một mẻ phát sinh mới.</p>}
      <div className="batch-history-list">
        {batches.map(([id, rows], index) => {
          const inputs = rows.filter((item) => item.type === 'processing_out')
          const outputs = rows.filter((item) => item.type === 'processing_in')
          const loss = rows.find((item) => item.type === 'waste')
          const lossProduct = loss ? PRODUCTS.find((product) => product.id === loss.productId) : undefined
          const phase = rows[0]?.note.includes('[Đầu ca]') ? 'Đầu ca' : 'Phát sinh'
          return <article key={id}>
            <div className="batch-history-head">
              <span className="batch-number">Mẻ #{batches.length - index}</span>
              <span className={phase === 'Đầu ca' ? 'batch-phase opening' : 'batch-phase'}>{phase}</span>
              <time>{new Date(rows[0]?.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</time>
              <button className="danger-button compact" disabled={saving} onClick={() => onDelete(rows)}>Xóa mẻ</button>
            </div>
            <div className="batch-history-flow">
              <div><small>NGUYÊN LIỆU</small>{inputs.map((item) => <span key={item.id}>{PRODUCTS.find((p) => p.id === item.productId)?.name}: <b>{item.quantity} {PRODUCTS.find((p) => p.id === item.productId)?.unit}</b>{item.measuredWeightKg ? ` · ${item.measuredWeightKg}kg thực tế` : ''}</span>)}</div>
              <i>→</i>
              <div><small>THÀNH PHẨM</small>{outputs.map((item) => <span key={item.id}>{PRODUCTS.find((p) => p.id === item.productId)?.name}: <b>{item.quantity} {PRODUCTS.find((p) => p.id === item.productId)?.unit}</b></span>)}</div>
              <div className="batch-loss"><small>HAO HỤT</small><strong>{loss ? `${formatNumber(loss.quantity)} ${lossProduct?.unit || ''}` : '0'}</strong></div>
            </div>
          </article>
        })}
      </div>
    </section>
  )
}

function InboundVoucherHistory({
  movements, saving, onDelete,
}: {
  movements: StockMovement[]
  saving: boolean
  onDelete: (rows: StockMovement[]) => void
}) {
  const groups = new Map<string, StockMovement[]>()
  movements.filter((item) => item.type === 'inbound').forEach((item) => {
    const key = item.documentId || item.id
    groups.set(key, [...(groups.get(key) || []), item])
  })
  const vouchers = Array.from(groups.entries()).sort((a, b) =>
    (b[1][0]?.createdAt || '').localeCompare(a[1][0]?.createdAt || ''),
  )
  return (
    <section className="section-card compact-history">
      <div className="section-title">
        <div><span className="eyebrow dark">PHIẾU ĐÃ LƯU HÔM NAY</span><h2>Lịch sử nhập kho</h2></div>
        <span className="date-chip">{vouchers.length} phiếu</span>
      </div>
      {!vouchers.length && <p className="empty-copy">Chưa có phiếu nhập kho hôm nay.</p>}
      <div className="document-list">
        {vouchers.map(([id, rows]) => <details className="document-card voucher-detail-card" key={id}>
          <summary className="document-summary">
            <div>
              <strong>Phiếu nhập · {new Date(rows[0].createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</strong>
              <small>{rows.length} sản phẩm · chạm để xem chi tiết</small>
            </div>
            <button
              className="danger-button compact"
              disabled={saving}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onDelete(rows)
              }}
            >
              Xóa phiếu
            </button>
          </summary>
          {rows[0].note && <p className="voucher-detail-note">{rows[0].note}</p>}
          <div className="document-products">
            {rows.map((item) => {
              const product = PRODUCTS.find((candidate) => candidate.id === item.productId)
              return <span key={item.id}><strong>{product?.name || item.productId}</strong><b>{formatNumber(item.quantity)} {product?.unit}</b><small>{item.note || 'Không có ghi chú dòng'}</small></span>
            })}
          </div>
        </details>)}
      </div>
    </section>
  )
}

function OperationDayBar({ day, onOpen }: { day: OperationDay | null; onOpen: () => void }) {
  return (
    <div className={`operation-day-bar ${day?.status || 'not-open'}`}>
      <span className="operation-day-dot" />
      <div>
        <strong>{day ? (day.status === 'open' ? 'Ngày vận hành đang mở' : 'Ngày vận hành đã chốt') : 'Chưa mở ngày vận hành'}</strong>
        <small>{day ? `Ngày ${new Date(day.businessDate).toLocaleDateString('vi-VN')} · Mọi phát sinh sẽ tự vào báo cáo cuối ngày` : 'Ngày sẽ tự mở khi lưu giao dịch đầu tiên, hoặc bạn có thể mở ngay.'}</small>
      </div>
      {!day && <button className="secondary-button" onClick={onOpen}>Mở ngày</button>}
    </div>
  )
}

function ProcessingBatchEditor({
  inputs, outputs, phase, note, saving, stock, onInputs, onOutputs, onPhase, onNote, onSave,
}: {
  inputs: ProcessLine[]
  outputs: ProcessLine[]
  phase: 'opening' | 'additional'
  note: string
  saving: boolean
  stock: ReturnType<typeof calculateStock>
  onInputs: (lines: ProcessLine[]) => void
  onOutputs: (lines: ProcessLine[]) => void
  onPhase: (phase: 'opening' | 'additional') => void
  onNote: (note: string) => void
  onSave: () => void
}) {
  const totalRaw = inputs.reduce((sum, line) => sum + Number(line.quantity || 0), 0)
  const totalCook = outputs.reduce((sum, line) => sum + Number(line.quantity || 0), 0)
  const totalLoss = totalRaw > 0 ? (totalRaw - totalCook) / totalRaw * 100 : 0

  const outputOptions = (inputId: string) => (PROCESS_OUTPUT_OPTIONS_BY_INPUT[inputId] || [])
    .map((id) => PRODUCTS.find((product) => product.id === id))
    .filter(Boolean) as typeof PRODUCTS

  function updateInput(index: number, patch: Partial<ProcessLine>) {
    onInputs(inputs.map((line, i) => i === index ? { ...line, ...patch } : line))
    if (patch.productId) {
      const nextOutput = outputOptions(patch.productId)[0]
      onOutputs(outputs.map((line, i) => i === index ? { ...line, productId: nextOutput?.id || line.productId, packing: {} } : line))
    }
  }

  function updateOutput(index: number, patch: Partial<ProcessLine>) {
    onOutputs(outputs.map((line, i) => i === index ? { ...line, ...patch } : line))
  }

  function addBatch() {
    onInputs([...inputs, newProcessLine('input')])
    onOutputs([...outputs, newProcessLine('output')])
  }

  function removeBatch(index: number) {
    if (inputs.length === 1) return
    onInputs(inputs.filter((_, i) => i !== index))
    onOutputs(outputs.filter((_, i) => i !== index))
  }

  return (
    <section className="processing-mobile-flow">
      <div className="report-batch-heading">
        <div><span className="eyebrow dark">QUY TRÌNH TRONG CA</span><h2>Chế biến và đóng gói</h2></div>
        <button className="primary-button" onClick={addBatch}>＋ Thêm mẻ</button>
      </div>
      <div className="batch-meta">
        <label>Loại mẻ<select value={phase} onChange={(event) => onPhase(event.target.value as 'opening' | 'additional')}><option value="opening">Đầu ca</option><option value="additional">Phát sinh trong ca</option></select></label>
        <div className="batch-time"><span>Thời điểm ghi nhận</span><strong>{new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</strong></div>
      </div>
      <div className="mobile-batch-list">
        {inputs.map((input, index) => {
          const output = outputs[index]
          const inputProduct = PRODUCTS.find((product) => product.id === input.productId)!
          const outputProduct = PRODUCTS.find((product) => product.id === output.productId)!
          const raw = Number(input.quantity || 0)
          const cook = Number(output.quantity || 0)
          const lossRate = raw > 0 ? (raw - cook) / raw * 100 : 0
          const available = stock.find((line) => line.product.id === input.productId)?.expected || 0
          const requested = inputs.filter((line) => line.productId === input.productId).reduce((sum, line) => sum + Number(line.quantity || 0), 0)
          const packingOptions = PACKING_OPTIONS_BY_OUTPUT[output.productId] || []
          const packedQuantity = packingOptions.reduce((sum, option) => sum + Number(output.packing?.[option.productId] || 0) * option.sourceQuantity, 0)
          return <article className="mobile-batch-card" key={input.id}>
            <div className="mobile-batch-title"><span>Mẻ #{index + 1}</span><button onClick={() => removeBatch(index)}>×</button></div>
            <div className="mobile-step"><span className="step-number">1</span><div>
              <label>Lấy nguyên liệu từ kho</label>
              <select value={input.productId} onChange={(event) => updateInput(index, { productId: event.target.value })}>{PROCESS_INPUT_PRODUCTS.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
              <small className={requested > available ? 'stock-available insufficient' : 'stock-available'}>Khả dụng {formatNumber(available)} {inputProduct.unit} · Mẻ dùng {formatNumber(requested)}</small>
              <div className="mobile-number-field"><input inputMode="decimal" value={input.quantity} onChange={(event) => updateInput(index, { quantity: cleanNumber(event.target.value) })} placeholder="Số lượng lấy ra" /><b>{inputProduct.unit}</b></div>
            </div></div>
            <div className="mobile-step"><span className="step-number">2</span><div>
              <label>Ghi nhận thành phẩm chín</label>
              <select value={output.productId} onChange={(event) => updateOutput(index, { productId: event.target.value, packing: {} })}>{outputOptions(input.productId).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
              <div className="mobile-number-field"><input inputMode="decimal" value={output.quantity} onChange={(event) => updateOutput(index, { quantity: cleanNumber(event.target.value) })} placeholder="Khối lượng sau chế biến" /><b>{outputProduct.unit}</b></div>
              <div className={lossRate > 15 ? 'mobile-loss bad' : 'mobile-loss'}><span>Hao hụt</span><strong>{Math.max(0, raw - cook).toFixed(2)} {inputProduct.unit} · {Math.max(0, lossRate).toFixed(1)}%</strong></div>
            </div></div>
            <div className="mobile-step"><span className="step-number">3</span><div>
              <label>Đóng thành đơn vị bán</label>
              {packingOptions.length ? <div className="packing-grid">{packingOptions.map((option) => {
                const packedProduct = PRODUCTS.find((product) => product.id === option.productId)
                return <label key={option.productId}><span>{option.label}</span><input inputMode="numeric" value={output.packing?.[option.productId] || ''} onChange={(event) => updateOutput(index, { packing: { ...(output.packing || {}), [option.productId]: event.target.value.replace(/\D/g, '') } })} placeholder={`0 ${packedProduct?.unit || ''}`} /></label>
              })}</div> : <p className="packing-notice">Thành phẩm này không cần đóng gói trong hệ thống.</p>}
              {packingOptions.length > 0 && <div className={packedQuantity > cook ? 'packing-balance bad' : 'packing-balance'}><span>Đã dùng {formatNumber(packedQuantity)} {outputProduct.unit}</span><strong>Còn {formatNumber(Math.max(0, cook - packedQuantity))} {outputProduct.unit}</strong></div>}
            </div></div>
          </article>
        })}
      </div>
      <div className="yield-summary"><div><span>Tổng đầu vào</span><strong>{totalRaw.toFixed(1)}</strong></div><div><span>Tổng chín</span><strong>{totalCook.toFixed(1)}</strong></div><div className={totalLoss > 15 ? 'bad' : ''}><span>Hao hụt chung</span><strong>{Math.max(0, totalLoss).toFixed(1)}%</strong></div></div>
      <label className="voucher-note">Ghi chú<textarea value={note} onChange={(event) => onNote(event.target.value)} placeholder="Ví dụ: rang bổ sung do lượng bán tăng…" /></label>
      <button className="primary-button wide" onClick={onSave} disabled={saving}>{saving ? 'Đang lưu…' : '✓ Hoàn tất chế biến và đóng gói'}</button>
    </section>
  )
}

function VoucherEditor({
  lines, note, saving, onNote, onUpdate, onAdd, onRemove, onSave,
}: {
  lines: VoucherLine[]
  note: string
  saving: boolean
  onNote: (value: string) => void
  onUpdate: (id: string, patch: Partial<VoucherLine>) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onSave: () => void
}) {
  return (
    <section className="entry-card voucher-card">
      <div className="section-title">
        <div><span className="eyebrow dark">BƯỚC 1 · ĐẦU NGÀY</span><h2>Nhập hàng vào kho</h2></div>
        <span className="date-chip">{new Date().toLocaleDateString('vi-VN')}</span>
      </div>
      <label className="voucher-note">Ghi chú chung / Nhà cung cấp / Người nhận
        <input value={note} onChange={(e) => onNote(e.target.value)} placeholder="Áp dụng cho toàn bộ phiếu" />
      </label>
      <p className="mobile-table-hint">Vuốt ngang bảng để nhập số lượng và ghi chú cho từng sản phẩm.</p>
      <div className="voucher-mobile-list">
        {lines.map((line, index) => {
          const allowedProducts = INBOUND_PRODUCTS
          const product = allowedProducts.find((item) => item.id === line.productId) || allowedProducts[0]
          const entryUnit = product.inboundUnit || product.unit
          const inboundPackSize = product.inboundPackKg ?? product.inboundPackQuantity
          const convertedQuantity = inboundPackSize
            ? Number(line.quantity || 0) * inboundPackSize
            : null
          return <article className="voucher-mobile-card" key={line.id}>
            <div className="voucher-mobile-card-head">
              <strong>Sản phẩm #{index + 1}</strong>
              {lines.length > 1 && <button className="row-remove" onClick={() => onRemove(line.id)}>×</button>}
            </div>
            <label>Sản phẩm
              <select value={product.id} onChange={(e) => onUpdate(line.id, { productId: e.target.value })}>
                {allowedProducts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <div className="voucher-mobile-quantity">
              <label>Số lượng
                <input inputMode="decimal" value={line.quantity} onChange={(e) => onUpdate(line.id, { quantity: cleanNumber(e.target.value) })} placeholder="Để trống nếu chưa nhập" />
              </label>
              <div><span>Đơn vị</span><strong>{entryUnit}</strong>{convertedQuantity !== null && <small>= {formatNumber(convertedQuantity)} {product.unit}</small>}</div>
            </div>
            <label>Ghi chú
              <input value={line.note} onChange={(e) => onUpdate(line.id, { note: e.target.value })} placeholder="Tùy chọn" />
            </label>
          </article>
        })}
      </div>
      <div className="voucher-table-wrap">
        <table className="voucher-table">
          <thead><tr><th>STT</th><th>Sản phẩm</th><th>ĐVT</th><th>Số lượng</th><th>Ghi chú dòng</th><th /></tr></thead>
          <tbody>
            {lines.map((line, index) => {
              const allowedProducts = INBOUND_PRODUCTS
              const product = allowedProducts.find((item) => item.id === line.productId) || allowedProducts[0]
              const entryUnit = product.inboundUnit || product.unit
              const inboundPackSize = product.inboundPackKg ?? product.inboundPackQuantity
              const convertedQuantity = inboundPackSize
                ? Number(line.quantity || 0) * inboundPackSize
                : null
              return <tr key={line.id}>
                <td>{index + 1}</td>
                <td><select value={product.id} onChange={(e) => onUpdate(line.id, { productId: e.target.value })}>{allowedProducts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td>
                <td><span className="unit-chip">{entryUnit}</span>{convertedQuantity !== null && <small className="inbound-conversion">= {formatNumber(convertedQuantity)} {product.unit}</small>}</td>
                <td><input inputMode="decimal" value={line.quantity} onChange={(e) => onUpdate(line.id, { quantity: cleanNumber(e.target.value) })} placeholder="0" /></td>
                <td><input value={line.note} onChange={(e) => onUpdate(line.id, { note: e.target.value })} placeholder="Tùy chọn" /></td>
                <td><button className="row-remove" onClick={() => onRemove(line.id)}>×</button></td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      <div className="voucher-footer">
        <button className="secondary-button" onClick={onAdd}>＋ Thêm sản phẩm</button>
        <div><span>{lines.filter((line) => Number(line.quantity) > 0).length} dòng có dữ liệu</span><button className="primary-button" onClick={onSave} disabled={saving}>{saving ? 'Đang lưu…' : '✓ Lưu toàn bộ phiếu'}</button></div>
      </div>
    </section>
  )
}

function InventoryReportForm({
  user, stock, onChanged, onFeedback,
}: {
  user: AppUser
  stock: ReturnType<typeof calculateStock>
  onChanged: () => Promise<void>
  onFeedback: (text: string) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [meta, setMeta] = useState({
    reportNo: String(Date.now()).slice(-4),
    reportDate: today,
    department: 'Nhà hàng',
    location: 'Kho đông / Kho phòng',
    shift: 'Tối',
    reporter: user.name,
  })
  const reportProducts = useMemo(() => PRODUCTS.filter(isInventoryReportProduct), [])
  const [lines, setLines] = useState<InventoryCountLine[]>(() => defaultInventoryLines(stock))
  const [newProductId, setNewProductId] = useState('')
  const [saving, setSaving] = useState(false)
  const availableProducts = reportProducts.filter((product) => !lines.some((line) => line.productId === product.id))

  function updateLine(productId: string, patch: Partial<InventoryCountLine>) {
    setLines((items) => items.map((item) => item.productId === productId ? { ...item, ...patch } : item))
  }
  function addReportLine() {
    const productId = newProductId || availableProducts[0]?.id
    if (!productId) return
    setLines((items) => [...items, { productId, freezerQty: 0, stockRoomQty: 0, orderNeeded: 0, note: '' }])
    setNewProductId('')
  }
  function removeReportLine(productId: string) {
    setLines((items) => items.filter((item) => item.productId !== productId))
  }

  async function save() {
    setSaving(true)
    const id = createId()
    const now = new Date().toISOString()
    const report: InventoryReport = {
      id, branchId: user.branchId, createdBy: user.id, createdAt: now,
      ...meta, lines,
    }
    try {
      await ensureOperationDay(user, meta.reportDate)
      await saveInventoryReport(report)
      await addMovements(lines.filter((line) => line.freezerQty + line.stockRoomQty > 0).map((line) => ({
        id: createId(),
        documentId: id,
        branchId: user.branchId,
        productId: line.productId,
        type: 'count' as const,
        quantity: line.freezerQty + line.stockRoomQty,
        shiftDate: meta.reportDate,
        note: `Kho đông ${line.freezerQty}; Kho phòng ${line.stockRoomQty}; Cần đặt ${line.orderNeeded}. ${line.note}`,
        createdBy: user.id,
        createdAt: now,
      })))
      await onChanged()
      onFeedback('Đã lưu phiếu kiểm kê nhiều sản phẩm theo mẫu nhà hàng.')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể lưu phiếu kiểm kê.')
    } finally {
      setSaving(false)
    }
  }

  function printReport() { window.print() }

  return (
    <section className="paper-report">
      <div className="paper-title"><h2>INVENTORY REPORT</h2><p>Báo Cáo Kiểm Kê Hàng Hóa</p></div>
      <div className="paper-meta">
        <label>Report No. / Số báo cáo<input value={meta.reportNo} onChange={(e) => setMeta({ ...meta, reportNo: e.target.value })} /></label>
        <label>Date / Ngày<input type="date" value={meta.reportDate} onChange={(e) => setMeta({ ...meta, reportDate: e.target.value })} /></label>
        <label>Department / Bộ phận<input value={meta.department} onChange={(e) => setMeta({ ...meta, department: e.target.value })} /></label>
        <label>Shift / Ca làm việc<input value={meta.shift} onChange={(e) => setMeta({ ...meta, shift: e.target.value })} /></label>
        <label>Location / Khu vực<input value={meta.location} onChange={(e) => setMeta({ ...meta, location: e.target.value })} /></label>
        <label>Reporter / Người báo cáo<input value={meta.reporter} onChange={(e) => setMeta({ ...meta, reporter: e.target.value })} /></label>
      </div>
      <div className="voucher-table-wrap">
        <table className="inventory-paper-table">
          <thead><tr><th>No.</th><th>Item Description<br /><small>Mô tả</small></th><th>Unit<br /><small>ĐVT</small></th><th>Freeze<br /><small>Kho đông</small></th><th>Stock Room<br /><small>Kho phòng</small></th><th>Order Quantity Needed<br /><small>Số lượng cần thiết</small></th><th>Notes<br /><small>Ghi chú</small></th></tr></thead>
          <tbody>{lines.map((line, index) => {
            const product = PRODUCTS.find((item) => item.id === line.productId)!
            const expected = stock.find((item) => item.product.id === line.productId)?.expected || 0
            return <tr key={line.productId}>
              <td>{index + 1}</td><td><strong>{product.name}</strong><small>Tồn dự kiến: {formatNumber(expected)}</small></td><td>{product.unit}</td>
              <td><input inputMode="decimal" value={line.freezerQty || ''} onChange={(e) => updateLine(line.productId, { freezerQty: Number(cleanNumber(e.target.value)) })} /></td>
              <td><input inputMode="decimal" value={line.stockRoomQty || ''} onChange={(e) => updateLine(line.productId, { stockRoomQty: Number(cleanNumber(e.target.value)) })} /></td>
              <td><input inputMode="decimal" value={line.orderNeeded || ''} onChange={(e) => updateLine(line.productId, { orderNeeded: Number(cleanNumber(e.target.value)) })} /></td>
              <td><input value={line.note} onChange={(e) => updateLine(line.productId, { note: e.target.value })} /><button className="row-remove no-print" onClick={() => removeReportLine(line.productId)}>×</button></td>
            </tr>
          })}
          {!lines.length && <tr><td colSpan={7} className="empty-state">Chưa có hàng hóa trong phiếu. Chọn món bên dưới để thêm dòng kiểm kê.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="inventory-report-line-tools no-print">
        <select value={newProductId} onChange={(event) => setNewProductId(event.target.value)} disabled={!availableProducts.length}>
          <option value="">Chọn hàng hóa cần thêm</option>
          {availableProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        <button className="secondary-button" onClick={addReportLine} disabled={!availableProducts.length}>+ Thêm dòng hàng hóa</button>
      </div>
      <div className="signature-grid"><div>Reporter’s Signature<br /><small>Chữ ký Người Báo Cáo</small></div><div>Leader’s Signature<br /><small>Chữ ký Người Phụ Trách</small></div></div>
      <div className="voucher-footer no-print"><button className="secondary-button" onClick={printReport}>🖨 In / Xuất PDF</button><button className="primary-button" onClick={save} disabled={saving}>{saving ? 'Đang lưu…' : '✓ Lưu phiếu kiểm kê'}</button></div>
    </section>
  )
}

function StockTable({
  stock, selectedDate, canCount, onCount,
}: {
  stock: ReturnType<typeof calculateStock>
  selectedDate: string
  canCount: boolean
  onCount: () => void
}) {
  return (
    <section className="section-card stock-section">
      <div className="section-title"><div><span className="eyebrow dark">TỒN CUỐI NGÀY</span><h2>Danh sách hàng hóa · {new Date(`${selectedDate}T00:00:00`).toLocaleDateString('vi-VN')}</h2></div>{canCount && <button className="text-button" onClick={onCount}>Lập phiếu kiểm kê →</button>}</div>
      <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Sản phẩm</th><th>SKU</th><th>Tồn dự kiến</th><th>Thực tế</th><th>Chênh lệch</th></tr></thead>
        <tbody>{stock.map((line) => <tr key={line.product.id}>
          <td><strong>{line.product.name}</strong><small>{line.product.category === 'raw' ? 'Nguyên liệu' : 'Thành phẩm'}</small></td>
          <td><code>{line.product.sku}</code></td>
          <td><strong className={line.expected <= line.product.lowStock ? 'text-warning' : ''}>{formatNumber(line.expected)} {line.product.unit}</strong></td>
          <td>{line.actual === undefined ? '—' : `${formatNumber(line.actual)} ${line.product.unit}`}</td>
          <td><span className={line.variance ? 'variance bad' : 'variance'}>{line.variance === undefined ? 'Chưa kiểm' : formatNumber(line.variance)}</span></td>
        </tr>)}
        {!stock.length && <tr><td colSpan={5} className="empty-state">Chưa có hàng hóa phát sinh trong ngày này.</td></tr>}
        </tbody>
      </table></div>
    </section>
  )
}

function cleanNumber(value: string) { return value.replace(/[^0-9.,]/g, '').replace(',', '.') }
function formatNumber(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(2) }
function isVisibleStockLine(line: ReturnType<typeof calculateStock>[number]) {
  return Math.abs(line.expected) > 0.0001
    || line.actual !== undefined
    || Boolean(line.variance)
}
function isInventoryReportProduct(product: typeof PRODUCTS[number]) {
  if (product.category === 'packaging') return false
  if (product.id.endsWith('-kg') || product.id.includes('-finished')) return false
  return true
}
function defaultInventoryLines(stock: ReturnType<typeof calculateStock>): InventoryCountLine[] {
  return stock
    .filter((line) => isInventoryReportProduct(line.product) && Math.abs(line.expected) > 0.0001)
    .map((line) => ({
      productId: line.product.id,
      freezerQty: 0,
      stockRoomQty: 0,
      orderNeeded: 0,
      note: '',
    }))
}

const InventoryInfographic = forwardRef<HTMLDivElement, {
  user: AppUser
  stock: ReturnType<typeof calculateStock>
  totals: { inbound: number; outbound: number; low: number; variance: number }
  reportDate: string
}>(({ user, stock, totals, reportDate }, ref) => (
  <div className="inventory-infographic" ref={ref}>
    <div className="info-header"><div><span>HẠT DẺ ÔNG LÝ</span><h2>BÁO CÁO TỒN KHO</h2></div><strong>{new Date(`${reportDate}T00:00:00`).toLocaleDateString('vi-VN')}</strong></div>
    <div className="info-metrics"><div><span>Phiếu nhập</span><strong>{totals.inbound}</strong></div><div><span>Phiếu xuất</span><strong>{totals.outbound}</strong></div><div><span>Tồn thấp</span><strong>{totals.low}</strong></div><div><span>Lệch kho</span><strong>{totals.variance}</strong></div></div>
    <div className="info-table">{stock.map((line) => <div key={line.product.id}><span>{line.product.name}</span><strong>{formatNumber(line.expected)} {line.product.unit}</strong></div>)}</div>
    <footer><span>Người lập: {user.name}</span><span>GUSTINO - HỆ THỐNG VẬN HÀNH</span></footer>
  </div>
))
