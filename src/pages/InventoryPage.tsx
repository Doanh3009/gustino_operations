import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { INBOUND_PRODUCTS, MOVEMENT_LABELS, PRODUCTS, getInboundProducts, getProcessInputProducts, getProcessingOutputOptions, getProducts, productById } from '../lib/constants'
import { canvasToBlob, createId, shareOrDownloadBlob } from '../lib/browser'
import { addMovements, calculateStock, deleteMovements, ensureOperationDay, saveInventoryReport } from '../lib/store'
import { branchName as configuredBranchName } from '../lib/branches'
import { localDateKey } from '../lib/dates'
import { useLang } from '../lib/i18n'
import { fetchConfiguredProducts } from '../lib/products'
import type {
  AppUser,
  InventoryCountLine,
  InventoryReport,
  MovementType,
  Product,
  StockMovement,
} from '../types'
import type { InventoryTab, Page } from '../components/AppShell'

interface Props {
  user: AppUser
  movements: StockMovement[]
  onChanged: () => Promise<void>
  initialTab?: InventoryTab
  onNavigate: (page: Page) => void
}

interface VoucherLine { id: string; productId: string; quantity: string; note: string; entryWeightUnit?: 'kg' | 'g' }
interface ProcessLine { id: string; productId: string; quantity: string }
type InventoryCrmMode = 'stock' | 'inbound' | 'outbound' | 'count'
type InboundSub = 'material' | 'processing'
type InventoryPeriod = 'day' | 'month' | 'year' | 'all'

function crmModeFromTab(tab: InventoryTab): InventoryCrmMode {
  if (tab === 'inbound' || tab === 'processing_out') return 'inbound'
  if (tab === 'count') return 'count'
  return 'stock'
}

const newVoucherLine = (): VoucherLine => ({
  id: createId(),
  productId: INBOUND_PRODUCTS[0].id,
  quantity: '',
  note: '',
  entryWeightUnit: 'kg',
})

const newOutboundLine = (): VoucherLine => ({
  id: createId(),
  productId: '',
  quantity: '',
  note: '',
  entryWeightUnit: 'kg',
})

const newProcessLine = (kind: 'input' | 'output'): ProcessLine => ({
  id: createId(),
  productId: kind === 'input' ? 'chestnut-roasted-bulk' : 'chestnut-cooked-kg',
  quantity: '',
})

export function InventoryPage({ user, movements, onChanged, initialTab = 'overview', onNavigate }: Props) {
  const lang = useLang()
  const text = INVENTORY_TEXT[lang]
  const canOperateInventory = ['admin', 'manager', 'shift_leader'].includes(user.role)
  const [crmMode, setCrmMode] = useState<InventoryCrmMode>(crmModeFromTab(initialTab))
  const [inboundSub, setInboundSub] = useState<InboundSub>(initialTab === 'processing_out' ? 'processing' : 'material')
  const [voucherLines, setVoucherLines] = useState<VoucherLine[]>([newVoucherLine()])
  const [voucherNote, setVoucherNote] = useState('')
  const [outboundLines, setOutboundLines] = useState<VoucherLine[]>([newOutboundLine()])
  const [outboundNote, setOutboundNote] = useState('')
  const [processInputs, setProcessInputs] = useState<ProcessLine[]>([newProcessLine('input')])
  const [processOutputs, setProcessOutputs] = useState<ProcessLine[]>([newProcessLine('output')])
  const [batchPhase, setBatchPhase] = useState<'opening' | 'additional'>('opening')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [nextStepHint, setNextStepHint] = useState<'processing' | 'handover' | ''>('')
  const [productTick, setProductTick] = useState(0)
  const reportRef = useRef<HTMLDivElement>(null)
  // Dropdown nguyên liệu nhập kho / chế biến + thành phẩm chia mẻ lấy từ SKU admin cấu hình.
  const inboundProducts = useMemo(() => getInboundProducts(), [productTick])
  const processInputProducts = useMemo(() => getProcessInputProducts(), [productTick])
  const stock = useMemo(() => calculateStock(movements), [movements, productTick])
  const today = localDateKey()
  const [selectedDate, setSelectedDate] = useState(today)
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7))
  const [selectedYear, setSelectedYear] = useState(today.slice(0, 4))
  const [period, setPeriod] = useState<InventoryPeriod>('day')
  // Catalog SKU is shared company-wide. Every active SKU must remain visible at
  // every branch even when this branch currently has zero stock.
  const visibleOverviewStock = stock
  const outboundStockOptions = useMemo(
    () => visibleOverviewStock.filter((line) => line.expected > 0.0001),
    [visibleOverviewStock],
  )
  const lowStockLines = visibleOverviewStock.filter((line) => line.expected <= line.product.lowStock)
  const periodMovements = useMemo(
    () => movements.filter((item) => {
      if (period === 'all') return true
      if (period === 'year') return item.shiftDate.startsWith(selectedYear)
      if (period === 'month') return item.shiftDate.startsWith(selectedMonth)
      return item.shiftDate === selectedDate
    }),
    [movements, period, selectedDate, selectedMonth, selectedYear],
  )
  const dailyLoss = useMemo(() => calculateDailyLoss(periodMovements), [periodMovements])
  const availableDates = useMemo(() =>
    Array.from(new Set(movements.map((item) => item.shiftDate))).sort((a, b) => b.localeCompare(a)),
  [movements])

  useEffect(() => {
    const update = () => setProductTick((tick) => tick + 1)
    window.addEventListener('gustino-products-updated', update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener('gustino-products-updated', update)
      window.removeEventListener('storage', update)
    }
  }, [])
  useEffect(() => {
    void fetchConfiguredProducts(user).then(() => setProductTick((tick) => tick + 1)).catch(() => {})
  }, [user.id, user.authToken])
  useEffect(() => {
    setCrmMode(crmModeFromTab(initialTab))
    if (initialTab === 'processing_out') setInboundSub('processing')
    else if (initialTab === 'inbound') setInboundSub('material')
  }, [initialTab])
  useEffect(() => {
    if (selectedDate !== today || !availableDates.length) return
    if (availableDates.includes(today)) return
    setSelectedDate(availableDates[0])
    setSelectedMonth(availableDates[0].slice(0, 7))
    setSelectedYear(availableDates[0].slice(0, 4))
  }, [availableDates, selectedDate, today])

  async function makeSureDayIsOpen() {
    const day = await ensureOperationDay(user, today)
    return day
  }

  const documentCount = (type: MovementType) =>
    new Set(periodMovements.filter((item) => item.type === type).map((item) => item.documentId || item.id)).size

  const totals = {
    inbound: documentCount('inbound'),
    outbound: documentCount('sale_out'),
    low: lowStockLines.length,
    count: documentCount('count'),
  }

  function openCrmMode(mode: InventoryCrmMode) {
    setCrmMode(mode)
    setNextStepHint('')
  }

  function updateVoucherLine(id: string, patch: Partial<VoucherLine>) {
    setVoucherLines((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  function resetVoucher() {
    setVoucherLines([newVoucherLine()])
    setVoucherNote('')
  }

  function updateOutboundLine(id: string, patch: Partial<VoucherLine>) {
    setOutboundLines((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  function resetOutboundVoucher() {
    setOutboundLines([newOutboundLine()])
    setOutboundNote('')
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
        const product = productById(line.productId)!
        const enteredQuantity = Number(line.quantity)
        const inboundPackSize = product.inboundPackKg ?? product.inboundPackQuantity
        const storedQuantity = inboundPackSize
          ? enteredQuantity * inboundPackSize
          : quantityInProductUnit(product, line)
        const conversionNote = inboundPackSize
          ? `${enteredQuantity} ${product.inboundUnit} × ${inboundPackSize} ${product.unit} = ${storedQuantity} ${product.unit}`
          : product.unit === 'kg' && line.entryWeightUnit === 'g'
            ? `${enteredQuantity} g = ${storedQuantity} kg`
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
      }), user)
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

  async function saveOutboundVoucher() {
    if (!outboundStockOptions.length) {
      setFeedback('Kho hiện không có SKU nào còn tồn để lập phiếu xuất.')
      return
    }
    const defaultProductId = outboundStockOptions[0]?.product.id || ''
    const validLines = outboundLines
      .map((line) => {
        const productId = line.productId || defaultProductId
        const product = productById(productId)
        return { ...line, productId, quantityValue: product ? quantityInProductUnit(product, line) : Number(line.quantity) }
      })
      .filter((line) => line.productId && line.quantityValue > 0)
    if (!validLines.length) {
      setFeedback('Phiếu xuất phải có ít nhất một sản phẩm có số lượng lớn hơn 0.')
      return
    }
    const requestedByProduct = new Map<string, number>()
    validLines.forEach((line) => {
      requestedByProduct.set(line.productId, (requestedByProduct.get(line.productId) || 0) + line.quantityValue)
    })
    const shortLines: string[] = []
    for (const [productId, requested] of requestedByProduct) {
      const stockLine = stock.find((line) => line.product.id === productId)
      const available = stockLine?.expected || 0
      if (requested > available + 0.0001) {
        shortLines.push(`${stockLine?.product.name || productId}: cần ${formatNumber(requested)} ${stockLine?.product.unit || ''}, tồn ${formatNumber(available)}`)
      }
    }
    if (shortLines.length) {
      const proceed = window.confirm(`Tồn kho chưa đủ cho phiếu xuất:\n\n${shortLines.join('\n')}\n\nVẫn tiếp tục lập phiếu?`)
      if (!proceed) return
    }
    setSaving(true)
    const documentId = createId()
    const now = new Date().toISOString()
    try {
      await makeSureDayIsOpen()
      await addMovements(validLines.map((line) => {
        const product = productById(line.productId)
        return {
          id: createId(),
          documentId,
          branchId: user.branchId,
          productId: line.productId,
          type: 'sale_out' as const,
          quantity: line.quantityValue,
          shiftDate: today,
          note: ['[Phiếu xuất kho]', outboundNote, line.note].filter(Boolean).join(' — ') || '[Phiếu xuất kho]',
          createdBy: user.id,
          createdAt: now,
          measuredWeightKg: product?.unit === 'kg' ? line.quantityValue : undefined,
        }
      }), user)
      setFeedback(`Đã lưu phiếu xuất kho gồm ${validLines.length} dòng hàng.`)
      resetOutboundVoucher()
      await onChanged()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Không thể lưu phiếu xuất kho.')
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
    // Tồn không đủ (vd chưa nhập kho hôm nay) → KHÔNG chặn cứng, chỉ hỏi xác nhận rồi cho tiếp.
    let allowInsufficientStock = false
    const shortLines: string[] = []
    const requestedByProduct = new Map<string, number>()
    batchDrafts.forEach(({ input }) => {
      requestedByProduct.set(input.productId, (requestedByProduct.get(input.productId) || 0) + Number(input.quantity))
    })
    for (const [requestedProductId, requested] of requestedByProduct) {
      const available = stock.find((line) => line.product.id === requestedProductId)?.expected || 0
      if (requested > available) {
        const product = productById(requestedProductId)
        shortLines.push(`${product?.name}: cần ${formatNumber(requested)} ${product?.unit}, tồn ${formatNumber(available)} ${product?.unit}`)
      }
    }
    if (shortLines.length) {
      const proceed = window.confirm(
        `Tồn kho chưa đủ cho mẻ này (có thể do chưa ghi phiếu nhập):\n\n${shortLines.join('\n')}\n\nVẫn tiếp tục ghi nhận mẻ chế biến?`,
      )
      if (!proceed) return
      allowInsufficientStock = true
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
          note: `[${phaseLabel}] Thành phẩm sau rang/chế biến`,
          createdBy: user.id, createdAt: now, sourceProductId: input.productId, sourceQuantity: raw,
          measuredWeightKg: productById(output.productId)?.unit === 'kg' ? cook : undefined,
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
      return batchRows
    })
    try {
      await makeSureDayIsOpen()
      await addMovements(rows, user, { allowInsufficientStock })
      setProcessInputs([newProcessLine('input')])
      setProcessOutputs([newProcessLine('output')])
      setNote('')
      setBatchPhase('additional')
      setFeedback(`Đã lưu ${batchDrafts.length} mẻ rang/chế biến ${phaseLabel.toLowerCase()}. Cuối ca chỉ cần ghi nhận tồn thành phẩm thực tế.`)
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
      // Luôn cho phép xóa để sửa dữ liệu (ca trưởng chỉ xóa chứng từ chi nhánh mình).
      // Trước đây phiếu nhập/xuất bị chặn cứng khi sinh âm → user không xóa được.
      const proceed = window.confirm(`Xóa ${label} sẽ làm ${negative.product.name} âm ${formatNumber(negative.expected)} ${negative.product.unit} do đã có giao dịch phát sinh sau đó.\n\nVẫn xóa để sửa dữ liệu và kiểm lại các phiếu sau?`)
      if (!proceed) return
    }
    if (!window.confirm(`Xóa ${label}? Toàn bộ các dòng trong chứng từ này sẽ được xóa và tồn kho sẽ được tính lại.`)) return
    setSaving(true)
    try {
      await deleteMovements(user.branchId, rows.map((item) => item.id), user)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : `Không thể xóa ${label}.`)
      setSaving(false)
      return
    }
    // Xóa đã thành công trên máy chủ — lỗi tải lại (mạng chập chờn) KHÔNG được hiện như lỗi xóa.
    setFeedback(`Đã xóa ${label} và cập nhật lại tồn kho.`)
    try {
      await onChanged()
    } catch {
      // Bỏ qua; lần refresh 15s kế tiếp sẽ đồng bộ lại.
    } finally {
      setSaving(false)
    }
  }

  function copyTextReport() {
    const lines = stock.map((line) =>
      `• ${line.product.name}: dự kiến ${formatNumber(line.expected)} ${line.product.unit}` +
      (line.actual !== undefined ? ` | tồn kiểm gần nhất ${formatNumber(line.actual)}` : ''),
    )
    navigator.clipboard.writeText([
      '📦 BÁO CÁO KHO GUSTINO',
      `📅 Ngày: ${new Date().toLocaleDateString('vi-VN')}`,
      `👤 Người lập: ${user.name}`,
      '=====================',
      ...lines,
      '=====================',
      `Cảnh báo tồn thấp: ${totals.low} mặt hàng`,
      `Phiếu kiểm kê: ${totals.count}`,
    ].join('\n')).then(() => setFeedback('Đã sao chép báo cáo văn bản.'))
  }

  async function exportInfographic() {
    if (!reportRef.current) return
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(reportRef.current, {
      scale: 2,
      backgroundColor: '#f7f5ec',
      useCORS: true,
      logging: false,
      width: 1080,
      height: 1920,
      windowWidth: 1080,
      windowHeight: 1920,
    })
    const fileName = `GUSTINO_Kho_${user.branchId}_${today}.png`
    const blob = await canvasToBlob(canvas, 'image/png')
    const result = await shareOrDownloadBlob(blob, fileName, {
      title: `Báo cáo kho GUSTINO ${today}`,
      text: 'Trên iPhone, chọn “Lưu hình ảnh” hoặc “Lưu vào Tệp”.',
    })
    setFeedback(result === 'shared'
      ? 'Đã hoàn tất chia sẻ ảnh kho. Ảnh chỉ vào Photos/Tệp khi bạn chọn thao tác lưu trên iPhone.'
      : 'Trình duyệt đã nhận file ảnh kho. Hãy kiểm tra mục Tệp tải về.')
  }

  return (
    <div className="page inventory-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow dark">{canOperateInventory ? 'KHO CA TRƯỞNG' : text.reportEyebrow}</span>
          <h1>{canOperateInventory ? 'Quản lý kho' : text.reportTitle}</h1>
          <p>{canOperateInventory
            ? 'Bốn chức năng: Nhập hàng · Xuất bán · Kiểm kê · Tồn kho. Cuối ca chốt tồn thành phẩm ở màn Bàn giao ca.'
            : text.reportSubtitle}</p>
        </div>
      </div>
      {feedback && <div className="feedback-bar">{feedback}<button type="button" onClick={() => setFeedback('')}>×</button></div>}
      <BranchInventoryCrm
        user={user}
        mode={crmMode}
        stock={visibleOverviewStock}
        totals={totals}
        dailyLoss={dailyLoss}
        onMode={openCrmMode}
        text={text}
      />
      {(crmMode === 'stock' || crmMode === 'outbound') && (
        <InventoryPeriodBar
          period={period}
          selectedDate={selectedDate}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          availableDates={availableDates}
          rows={periodMovements.length}
          onPeriod={setPeriod}
          onDate={(value) => {
            setSelectedDate(value)
            setSelectedMonth(value.slice(0, 7))
            setSelectedYear(value.slice(0, 4))
          }}
          onMonth={(value) => {
            setSelectedMonth(value)
            setSelectedYear(value.slice(0, 4))
          }}
          onYear={setSelectedYear}
        />
      )}

      {/* ── TỒN KHO ── */}
      {crmMode === 'stock' && <>
        {lowStockLines.length > 0 && (
          <div className="low-stock-alert" role="alert">
            <strong>⚠ Kho gần hết {lowStockLines.length} mặt hàng</strong>
            <span>{lowStockLines.map((line) => `${line.product.name}: ${formatNumber(line.expected)} ${line.product.unit}`).join(' · ')}</span>
          </div>
        )}
        <section className="section-card inventory-smart-report">
          <div className="section-title">
            <div><span className="eyebrow dark">{text.currentStock}</span><h2>{text.smartList}</h2></div>
            <span className="date-chip">{visibleOverviewStock.length} {text.items}</span>
          </div>
          <SmartStockList stock={visibleOverviewStock} text={text} />
        </section>
        <div className="report-actions">
          <button type="button" className="secondary-button" onClick={copyTextReport}>▤ Sao chép báo cáo văn bản</button>
          <button type="button" className="primary-button" onClick={exportInfographic}>▧ Xuất infographic</button>
        </div>
        <InventoryInfographic ref={reportRef} user={user} stock={visibleOverviewStock} totals={totals} reportDate={selectedDate} />
      </>}

      {/* ── NHẬP (nguyên liệu + rang/chế biến) ── */}
      {crmMode === 'inbound' && canOperateInventory && <>
        <div className="inventory-subtabs" role="tablist">
          <button type="button" className={inboundSub === 'material' ? 'active' : ''} onClick={() => { setInboundSub('material'); setNextStepHint('') }}>① Nhập nguyên liệu</button>
          <button type="button" className={inboundSub === 'processing' ? 'active' : ''} onClick={() => { setInboundSub('processing'); setNextStepHint('') }}>② Rang / chế biến</button>
        </div>
        {nextStepHint && (
          <div className="inventory-next-step">
            <div>
              <span>{nextStepHint === 'processing' ? 'BƯỚC 2' : 'BƯỚC 4'}</span>
              <strong>{nextStepHint === 'processing' ? 'Tiếp theo: rang / chế biến' : 'Tiếp theo: mở POS bán hàng'}</strong>
              <small>
                {nextStepHint === 'processing'
                  ? 'Phiếu nhập đã vào kho. Chuyển sang rang/chế biến để ghi lượng lấy ra và thành phẩm sau rang.'
                  : 'Mẻ đã lưu vào tồn thành phẩm. Nhân viên bán không giới hạn theo menu, cuối ca ca trưởng ghi tồn thực tế.'}
              </small>
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                if (nextStepHint === 'processing') setInboundSub('processing')
                else onNavigate('sales')
                setNextStepHint('')
              }}
            >
              {nextStepHint === 'processing' ? 'Mở chế biến' : 'Mở POS'}
            </button>
          </div>
        )}
        {inboundSub === 'material' ? <>
          <VoucherEditor
            lines={voucherLines}
            products={inboundProducts}
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
        </> : <>
          <ProcessingBatchEditor
            inputs={processInputs}
            outputs={processOutputs}
            phase={batchPhase}
            note={note}
            saving={saving}
            stock={stock}
            inputProducts={processInputProducts}
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
        </>}
      </>}

      {/* ── XUẤT ── */}
      {crmMode === 'outbound' && (
        <>
          {canOperateInventory && (
            <OutboundVoucherEditor
              lines={outboundLines}
              note={outboundNote}
              stock={outboundStockOptions}
              saving={saving}
              onNote={setOutboundNote}
              onUpdate={updateOutboundLine}
              onAdd={() => setOutboundLines((items) => [...items, newOutboundLine()])}
              onRemove={(id) => setOutboundLines((items) => items.length === 1 ? items : items.filter((item) => item.id !== id))}
              onSave={saveOutboundVoucher}
            />
          )}
          <OutboundMovementHistory
            movements={periodMovements}
            saving={saving}
            canDelete={canOperateInventory}
            onDelete={(rows) => canOperateInventory && deleteMovementGroup(rows, 'phiếu xuất kho')}
          />
        </>
      )}

      {/* ── KIỂM KÊ ── */}
      {crmMode === 'count' && canOperateInventory && <>
        <section className="section-card inventory-smart-report">
          <div className="section-title">
            <div><span className="eyebrow dark">{text.count}</span><h2>{text.countTitle}</h2></div>
            <span className="date-chip">{totals.count} phiếu đã lưu</span>
          </div>
          <SmartStockList stock={visibleOverviewStock} text={text} compact />
        </section>
        <InventoryReportForm user={user} stock={stock} productTick={productTick} onChanged={onChanged} onFeedback={setFeedback} />
      </>}
    </div>
  )
}

function InventoryPeriodBar({
  period,
  selectedDate,
  selectedMonth,
  selectedYear,
  availableDates,
  rows,
  onPeriod,
  onDate,
  onMonth,
  onYear,
}: {
  period: InventoryPeriod
  selectedDate: string
  selectedMonth: string
  selectedYear: string
  availableDates: string[]
  rows: number
  onPeriod: (period: InventoryPeriod) => void
  onDate: (value: string) => void
  onMonth: (value: string) => void
  onYear: (value: string) => void
}) {
  const latestDate = availableDates[0]
  return (
    <section className="section-card inventory-period-bar">
      <div>
        <span className="eyebrow dark">DỮ LIỆU DÀI HẠN</span>
        <strong>{periodLabel(period, selectedDate, selectedMonth, selectedYear)}</strong>
        <small>{latestDate ? `Cập nhật gần nhất: ${formatDate(latestDate)}` : 'Chưa có phát sinh kho trong kỳ này'}</small>
      </div>
      <label>Khoảng xem
        <select value={period} onChange={(event) => onPeriod(event.target.value as InventoryPeriod)}>
          <option value="day">Theo ngày</option>
          <option value="month">Theo tháng</option>
          <option value="year">Theo năm</option>
          <option value="all">Tất cả</option>
        </select>
      </label>
      {period === 'day' && <label>Ngày<input type="date" value={selectedDate} onChange={(event) => onDate(event.target.value)} /></label>}
      {period === 'month' && <label>Tháng<input type="month" value={selectedMonth} onChange={(event) => onMonth(event.target.value)} /></label>}
      {period === 'year' && <label>Năm<input inputMode="numeric" value={selectedYear} onChange={(event) => onYear(event.target.value.replace(/[^\d]/g, '').slice(0, 4))} /></label>}
      {latestDate && (
        <button type="button" className="secondary-button" onClick={() => onDate(latestDate)}>
          Ngày gần nhất
        </button>
      )}
    </section>
  )
}

function BranchInventoryCrm({
  user, mode, stock, totals, dailyLoss, onMode, text,
}: {
  user: AppUser
  mode: InventoryCrmMode
  stock: ReturnType<typeof calculateStock>
  totals: { inbound: number; outbound: number; low: number; count: number }
  dailyLoss: ReturnType<typeof calculateDailyLoss>
  onMode: (mode: InventoryCrmMode) => void
  text: typeof INVENTORY_TEXT[keyof typeof INVENTORY_TEXT]
}) {
  const totalSku = stock.length
  const totalUnits = stock.reduce((sum, line) => sum + Math.max(0, line.expected), 0)
  const health = totals.low ? text.needOrder : dailyLoss.rate > 12 ? text.watchLoss : text.stable
  const actions: Array<{ id: InventoryCrmMode; icon: string; label: string; value: string; hint: string }> = [
    { id: 'stock', icon: '▦', label: text.stock, value: `${totalSku}`, hint: text.stockHint },
    { id: 'inbound', icon: '↓', label: text.inbound, value: `${totals.inbound}`, hint: text.inboundHint },
    { id: 'outbound', icon: '↑', label: text.outbound, value: `${totals.outbound}`, hint: text.outboundHint },
    { id: 'count', icon: '✓', label: text.count, value: `${totals.count}`, hint: text.countHint },
  ]
  return (
    <section className="inventory-crm-shell">
      <div className="inventory-crm-branch">
        <div>
          <span className="eyebrow dark">{text.branch}</span>
          <h2>{configuredBranchName(user.branchId) || user.branchId}</h2>
          <p>{text.totalWarehouse} · {health}</p>
        </div>
        <dl>
          <div><dt>{text.totalStock}</dt><dd>{formatNumber(totalUnits)}</dd></div>
          <div><dt>{text.lowStock}</dt><dd>{totals.low}</dd></div>
          <div><dt>{text.loss}</dt><dd>{dailyLoss.rate.toFixed(1)}%</dd></div>
        </dl>
      </div>
      <div className="inventory-crm-actions" aria-label="Chức năng kho theo chi nhánh">
        {actions.map((action) => (
          <button
            type="button"
            key={action.id}
            className={mode === action.id ? 'active' : ''}
            onClick={() => onMode(action.id)}
          >
            <span>{action.icon}</span>
            <strong>{action.label}</strong>
            <b>{action.value}</b>
            <small>{action.hint}</small>
          </button>
        ))}
      </div>
    </section>
  )
}

function SmartStockList({
  stock,
  text,
  compact = false,
}: {
  stock: ReturnType<typeof calculateStock>
  text: typeof INVENTORY_TEXT[keyof typeof INVENTORY_TEXT]
  compact?: boolean
}) {
  const [category, setCategory] = useState<'all' | 'raw' | 'packaging' | 'finished'>('all')
  const categoryLabel = (value: string) =>
    value === 'raw' ? text.raw : value === 'packaging' ? text.packaging : text.finished
  const presentCategories = (['raw', 'packaging', 'finished'] as const).filter((value) =>
    stock.some((line) => line.product.category === value))
  const sorted = [...stock].sort((a, b) => stockPriority(a) - stockPriority(b) || a.product.name.localeCompare(b.product.name, 'vi'))
  const activeCategory = category !== 'all' && presentCategories.includes(category) ? category : 'all'
  const filtered = activeCategory === 'all' ? sorted : sorted.filter((line) => line.product.category === activeCategory)
  const summaries = presentCategories.map((value) => {
    const rows = stock.filter((line) => line.product.category === value)
    return {
      value,
      label: categoryLabel(value),
      skuCount: rows.length,
      total: rows.reduce((sum, line) => sum + Math.max(0, line.expected), 0),
      low: rows.filter((line) => line.expected <= line.product.lowStock).length,
    }
  })
  return (
    <div className="smart-stock-wrap">
      <div className="inventory-category-summary">
        {summaries.map((summary) => (
          <article key={summary.value} className={summary.low ? 'warning' : ''}>
            <span>{summary.label}</span>
            <strong>{formatNumber(summary.total)}</strong>
            <small>{summary.skuCount} mặt hàng{summary.low ? ` · ${summary.low} sắp hết` : ' · đủ tồn'}</small>
          </article>
        ))}
      </div>
      {presentCategories.length > 1 && (
        <label className="stock-category-filter">
          <span>{text.categoryFilter}</span>
          <select value={activeCategory} onChange={(event) => setCategory(event.target.value as typeof category)}>
            <option value="all">{text.allCategories} ({stock.length})</option>
            {presentCategories.map((value) => (
              <option key={value} value={value}>
                {categoryLabel(value)} ({stock.filter((line) => line.product.category === value).length})
              </option>
            ))}
          </select>
        </label>
      )}
      <div className={compact ? 'smart-stock-list compact' : 'smart-stock-list'}>
        {filtered.map((line) => {
          const status = line.expected <= line.product.lowStock ? 'low' : 'good'
          return (
            <article className={status} key={line.product.id}>
              <div>
                <strong>{line.product.name}</strong>
                <small>{line.product.sku} · {categoryLabel(line.product.category)}</small>
              </div>
              <b>{formatStockQuantity(line.expected, line.product.unit)}</b>
              <em>{status === 'low' ? text.lowStatus : text.goodStatus}</em>
            </article>
          )
        })}
        {!filtered.length && <p className="empty-copy">{text.emptyStock}</p>}
      </div>
    </div>
  )
}

function OutboundMovementHistory({
  movements, saving, canDelete = true, onDelete,
}: {
  movements: StockMovement[]
  saving: boolean
  canDelete?: boolean
  onDelete: (rows: StockMovement[]) => void
}) {
  const groups = groupMovementDocuments(movements.filter((item) => item.type === 'sale_out'))
  const totalQty = groups.reduce((sum, [, rows]) => sum + rows.reduce((rowSum, item) => rowSum + item.quantity, 0), 0)
  return (
    <section className="section-card compact-history outbound-history">
      <div className="section-title">
        <div><span className="eyebrow dark">XUẤT KHO</span><h2>Hàng lấy ra bán</h2></div>
        <span className="date-chip">{groups.length} phiếu · {formatNumber(totalQty)} đơn vị</span>
      </div>
      {!groups.length && <p className="empty-copy">Chưa có phiếu xuất kho bán hàng trong ngày này.</p>}
      <div className="document-list">
        {groups.map(([id, rows]) => (
          <details className="document-card outbound-detail-card" key={id}>
            <summary className="document-summary">
              <div>
                <strong>Phiếu xuất bán · {new Date(rows[0].createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</strong>
                <small>{rows.length} dòng hàng · lấy khỏi kho để bán</small>
              </div>
              {canDelete && (
                <button
                  type="button"
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
              )}
            </summary>
            <div className="document-products">
              {rows.map((item) => {
                const product = PRODUCTS.find((candidate) => candidate.id === item.productId)
                return <span key={item.id}><strong>{product?.name || item.productId}</strong><b>{formatNumber(item.quantity)} {product?.unit}</b><small>{item.note || 'Xuất bán'}</small></span>
              })}
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

function OutboundVoucherEditor({
  lines, note, stock, saving, onNote, onUpdate, onAdd, onRemove, onSave,
}: {
  lines: VoucherLine[]
  note: string
  stock: ReturnType<typeof calculateStock>
  saving: boolean
  onNote: (value: string) => void
  onUpdate: (id: string, patch: Partial<VoucherLine>) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onSave: () => void
}) {
  const firstProductId = stock[0]?.product.id || ''
  const activeLines = lines.filter((line) => Number(line.quantity) > 0)
  const totalQty = activeLines.reduce((sum, line) => {
    const product = stock.find((item) => item.product.id === (line.productId || firstProductId))?.product
    return sum + (product ? quantityInProductUnit(product, line) : Number(line.quantity || 0))
  }, 0)
  return (
    <section className="entry-card voucher-card outbound-voucher-card">
      <div className="section-title">
        <div><span className="eyebrow dark">PHIẾU XUẤT KHO</span><h2>Lấy hàng khỏi kho bán</h2></div>
        <span className="date-chip">{new Date().toLocaleDateString('vi-VN')}</span>
      </div>
      <p className="outbound-voucher-note">
        Phiếu này trừ tồn kho ngay khi lưu. Nếu xuất nhầm số lượng, xóa cả phiếu trong lịch sử bên dưới rồi lập lại.
      </p>
      <p className="inventory-weight-warning">⚠ Với hàng cân ký: <b>5,123 kg = 5.123 kg</b>. Nếu số cân là 5123 gram, chọn đơn vị <b>g</b> trước khi lưu.</p>
      <label className="voucher-note">Ghi chú chung / Người nhận / Lý do xuất
        <input value={note} onChange={(event) => onNote(event.target.value)} placeholder="Ví dụ: xuất ra quầy bán, chuyển ca, bổ sung tủ trưng bày..." />
      </label>
      {!stock.length && <p className="empty-copy">Chưa có SKU nào còn tồn để lập phiếu xuất.</p>}
      {stock.length > 0 && (
        <>
          <div className="voucher-mobile-list">
            {lines.map((line, index) => {
              const selectedProductId = line.productId || firstProductId
              const stockLine = stock.find((item) => item.product.id === selectedProductId) || stock[0]
              const requested = lines
                .filter((item) => (item.productId || firstProductId) === stockLine.product.id)
                .reduce((sum, item) => sum + quantityInProductUnit(stockLine.product, item), 0)
              return <article className="voucher-mobile-card" key={line.id}>
                <div className="voucher-mobile-card-head">
                  <strong>Dòng xuất #{index + 1}</strong>
                  {lines.length > 1 && <button type="button" className="row-remove" onClick={() => onRemove(line.id)}>×</button>}
                </div>
                <label>Sản phẩm
                  <select value={selectedProductId} onChange={(event) => onUpdate(line.id, { productId: event.target.value, entryWeightUnit: 'kg' })}>
                    {stock.map((item) => <option key={item.product.id} value={item.product.id}>{item.product.name}</option>)}
                  </select>
                </label>
                <div className="voucher-mobile-quantity">
                  <label>Số lượng xuất
                    <input inputMode="decimal" value={line.quantity} onChange={(event) => onUpdate(line.id, { quantity: cleanNumber(event.target.value) })} placeholder="0" />
                  </label>
                  <div><span>Đơn vị nhập</span>{stockLine.product.unit === 'kg'
                    ? <select value={line.entryWeightUnit || 'kg'} onChange={(event) => onUpdate(line.id, { entryWeightUnit: event.target.value as 'kg' | 'g' })}><option value="kg">kg</option><option value="g">gram (g)</option></select>
                    : <strong>{stockLine.product.unit}</strong>}</div>
                </div>
                <small className="stock-available">Khả dụng: {formatStockQuantity(stockLine.expected, stockLine.product.unit)}</small>
                <small className={requested > stockLine.expected ? 'stock-available insufficient' : 'stock-available'}>
                  Tổng đang xuất SKU này: {formatNumber(requested)} {stockLine.product.unit}
                </small>
                <label>Ghi chú dòng
                  <input value={line.note} onChange={(event) => onUpdate(line.id, { note: event.target.value })} placeholder="Tùy chọn" />
                </label>
              </article>
            })}
          </div>
          <div className="voucher-table-wrap">
            <table className="voucher-table">
              <thead><tr><th>STT</th><th>Sản phẩm</th><th>Khả dụng</th><th>ĐVT nhập</th><th>Số lượng xuất</th><th>Ghi chú dòng</th><th /></tr></thead>
              <tbody>
                {lines.map((line, index) => {
                  const selectedProductId = line.productId || firstProductId
                  const stockLine = stock.find((item) => item.product.id === selectedProductId) || stock[0]
                  const requested = lines
                    .filter((item) => (item.productId || firstProductId) === stockLine.product.id)
                    .reduce((sum, item) => sum + quantityInProductUnit(stockLine.product, item), 0)
                  return <tr key={line.id}>
                    <td>{index + 1}</td>
                    <td><select value={selectedProductId} onChange={(event) => onUpdate(line.id, { productId: event.target.value, entryWeightUnit: 'kg' })}>{stock.map((item) => <option key={item.product.id} value={item.product.id}>{item.product.name}</option>)}</select></td>
                    <td><span className={requested > stockLine.expected ? 'stock-available insufficient' : 'stock-available'}>{formatNumber(stockLine.expected)} {stockLine.product.unit}</span></td>
                    <td>{stockLine.product.unit === 'kg'
                      ? <select value={line.entryWeightUnit || 'kg'} onChange={(event) => onUpdate(line.id, { entryWeightUnit: event.target.value as 'kg' | 'g' })}><option value="kg">kg</option><option value="g">g</option></select>
                      : <span className="unit-chip">{stockLine.product.unit}</span>}</td>
                    <td><input inputMode="decimal" value={line.quantity} onChange={(event) => onUpdate(line.id, { quantity: cleanNumber(event.target.value) })} placeholder="0" /></td>
                    <td><input value={line.note} onChange={(event) => onUpdate(line.id, { note: event.target.value })} placeholder="Tùy chọn" /></td>
                    <td><button type="button" className="row-remove" onClick={() => onRemove(line.id)}>×</button></td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
          <div className="voucher-footer">
            <button type="button" className="secondary-button" onClick={onAdd}>＋ Thêm sản phẩm</button>
            <div><span>{activeLines.length} dòng · {formatNumber(totalQty)} đơn vị</span><button type="button" className="primary-button" onClick={onSave} disabled={saving}>{saving ? 'Đang lưu...' : '✓ Lưu phiếu xuất kho'}</button></div>
          </div>
        </>
      )}
    </section>
  )
}

function DailyLossPanel({ movements, selectedDate }: { movements: StockMovement[]; selectedDate: string }) {
  const loss = calculateDailyLoss(movements)
  const rows = movements.filter((item) => item.type === 'waste').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return (
    <section className="section-card daily-loss-panel">
      <div className="section-title">
        <div><span className="eyebrow dark">HAO HỤT MỖI NGÀY</span><h2>{new Date(`${selectedDate}T00:00:00`).toLocaleDateString('vi-VN')}</h2></div>
        <span className={loss.rate > 12 ? 'loss-grade bad' : loss.rate > 7 ? 'loss-grade warn' : 'loss-grade good'}>{loss.rate.toFixed(1)}%</span>
      </div>
      <div className="daily-loss-kpis">
        <div><span>Đầu vào có đo</span><strong>{formatNumber(loss.totalSource)}</strong></div>
        <div><span>Hao hụt</span><strong>{formatNumber(loss.totalLoss)}</strong></div>
        <div><span>Số mẻ/phiếu</span><strong>{loss.documentCount}</strong></div>
      </div>
      <div className="loss-smart-list">
        {rows.map((item) => {
          const product = PRODUCTS.find((candidate) => candidate.id === item.productId)
          const rate = item.sourceQuantity ? item.quantity / item.sourceQuantity * 100 : 0
          return (
            <article key={item.id}>
              <div><strong>{product?.name || item.productId}</strong><small>{item.note || MOVEMENT_LABELS[item.type]}</small></div>
              <b>{formatNumber(item.quantity)} {product?.unit}</b>
              <span>{rate ? `${rate.toFixed(1)}%` : 'Chưa có định mức'}</span>
            </article>
          )
        })}
        {!rows.length && <p className="empty-copy">Chưa ghi nhận hao hụt trong ngày này.</p>}
      </div>
    </section>
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
              <button type="button" className="danger-button compact" disabled={saving} onClick={() => onDelete(rows)}>Xóa mẻ</button>
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
  movements, saving, canDelete = true, onDelete,
}: {
  movements: StockMovement[]
  saving: boolean
  canDelete?: boolean
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
            {canDelete && (
              <button
                type="button"
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
            )}
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

function ProcessingBatchEditor({
  inputs, outputs, phase, note, saving, stock, inputProducts, onInputs, onOutputs, onPhase, onNote, onSave,
}: {
  inputs: ProcessLine[]
  outputs: ProcessLine[]
  phase: 'opening' | 'additional'
  note: string
  saving: boolean
  stock: ReturnType<typeof calculateStock>
  inputProducts: Product[]
  onInputs: (lines: ProcessLine[]) => void
  onOutputs: (lines: ProcessLine[]) => void
  onPhase: (phase: 'opening' | 'additional') => void
  onNote: (note: string) => void
  onSave: () => void
}) {
  const totalRaw = inputs.reduce((sum, line) => sum + Number(line.quantity || 0), 0)
  const totalCook = outputs.reduce((sum, line) => sum + Number(line.quantity || 0), 0)
  const totalLoss = totalRaw > 0 ? (totalRaw - totalCook) / totalRaw * 100 : 0

  // Mapping đọc trực tiếp từ danh mục SKU hiện hành; không loại thành phẩm theo cái.
  const outputOptions = (inputId: string): Product[] => getProcessingOutputOptions(inputId)

  function updateInput(index: number, patch: Partial<ProcessLine>) {
    onInputs(inputs.map((line, i) => i === index ? { ...line, ...patch } : line))
    if (patch.productId) {
      const nextOutput = outputOptions(patch.productId)[0]
      onOutputs(outputs.map((line, i) => i === index ? { ...line, productId: nextOutput?.id || line.productId } : line))
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
        <div><span className="eyebrow dark">QUY TRÌNH TRONG CA</span><h2>Rang / chế biến</h2></div>
        <button type="button" className="primary-button" onClick={addBatch}>＋ Thêm mẻ</button>
      </div>
      <div className="batch-meta">
        <label>Loại mẻ<select value={phase} onChange={(event) => onPhase(event.target.value as 'opening' | 'additional')}><option value="opening">Đầu ca</option><option value="additional">Phát sinh trong ca</option></select></label>
        <div className="batch-time"><span>Thời điểm ghi nhận</span><strong>{new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</strong></div>
      </div>
      <div className="mobile-batch-list">
        {inputs.map((input, index) => {
          const output = outputs[index]
          const inputProduct = inputProducts.find((product) => product.id === input.productId) || inputProducts[0] || PRODUCTS[0]
          const outputProduct = outputOptions(input.productId).find((product) => product.id === output.productId) || outputOptions(input.productId)[0] || PRODUCTS[0]
          const raw = Number(input.quantity || 0)
          const cook = Number(output.quantity || 0)
          const lossRate = raw > 0 ? (raw - cook) / raw * 100 : 0
          const available = stock.find((line) => line.product.id === input.productId)?.expected || 0
          const requested = inputs.filter((line) => line.productId === input.productId).reduce((sum, line) => sum + Number(line.quantity || 0), 0)
          return <article className="mobile-batch-card" key={input.id}>
            <div className="mobile-batch-title"><span>Mẻ #{index + 1}</span><button type="button" onClick={() => removeBatch(index)}>×</button></div>
            <div className="mobile-step"><span className="step-number">1</span><div>
              <label>Lấy nguyên liệu từ kho</label>
              <select value={input.productId} onChange={(event) => updateInput(index, { productId: event.target.value })}>{inputProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
              <small className={requested > available ? 'stock-available insufficient' : 'stock-available'}>Khả dụng {formatNumber(available)} {inputProduct.unit} · Mẻ dùng {formatNumber(requested)}</small>
              <div className="mobile-number-field"><input inputMode="decimal" value={input.quantity} onChange={(event) => updateInput(index, { quantity: cleanNumber(event.target.value) })} placeholder="Số lượng lấy ra" /><b>{inputProduct.unit}</b></div>
            </div></div>
            <div className="mobile-step"><span className="step-number">2</span><div>
              <label>Ghi nhận thành phẩm chín</label>
              <select value={output.productId} onChange={(event) => updateOutput(index, { productId: event.target.value })}>{outputOptions(input.productId).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
              <div className="mobile-number-field"><input inputMode="decimal" value={output.quantity} onChange={(event) => updateOutput(index, { quantity: cleanNumber(event.target.value) })} placeholder="Khối lượng sau chế biến" /><b>{outputProduct.unit}</b></div>
              <div className={lossRate > 15 ? 'mobile-loss bad' : 'mobile-loss'}><span>Hao hụt</span><strong>{Math.max(0, raw - cook).toFixed(2)} {inputProduct.unit} · {Math.max(0, lossRate).toFixed(1)}%</strong></div>
            </div></div>
          </article>
        })}
      </div>
      <div className="yield-summary"><div><span>Tổng đầu vào</span><strong>{totalRaw.toFixed(1)}</strong></div><div><span>Tổng chín</span><strong>{totalCook.toFixed(1)}</strong></div><div className={totalLoss > 15 ? 'bad' : ''}><span>Hao hụt chung</span><strong>{Math.max(0, totalLoss).toFixed(1)}%</strong></div></div>
      <label className="voucher-note">Ghi chú<textarea value={note} onChange={(event) => onNote(event.target.value)} placeholder="Ví dụ: rang bổ sung do lượng bán tăng…" /></label>
      <button type="button" className="primary-button wide" onClick={onSave} disabled={saving}>{saving ? 'Đang lưu…' : '✓ Lưu mẻ rang/chế biến'}</button>
    </section>
  )
}

function VoucherEditor({
  lines, products, note, saving, onNote, onUpdate, onAdd, onRemove, onSave,
}: {
  lines: VoucherLine[]
  products: Product[]
  note: string
  saving: boolean
  onNote: (value: string) => void
  onUpdate: (id: string, patch: Partial<VoucherLine>) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onSave: () => void
}) {
  const allowedProducts = products.length ? products : INBOUND_PRODUCTS
  return (
    <section className="entry-card voucher-card">
      <div className="section-title">
        <div><span className="eyebrow dark">BƯỚC 1 · ĐẦU NGÀY</span><h2>Nhập hàng vào kho</h2></div>
        <span className="date-chip">{new Date().toLocaleDateString('vi-VN')}</span>
      </div>
      <label className="voucher-note">Ghi chú chung / Nhà cung cấp / Người nhận
        <input value={note} onChange={(e) => onNote(e.target.value)} placeholder="Áp dụng cho toàn bộ phiếu" />
      </label>
      <p className="inventory-weight-warning">⚠ Nhập số ký bằng dấu phẩy hoặc dấu chấm thập phân: <b>5,123 kg = 5.123 kg</b>. Nếu cân theo gram, hãy chọn <b>g</b>; không nhập 5123 khi đang chọn kg.</p>
      <p className="mobile-table-hint">Vuốt ngang bảng để nhập số lượng và ghi chú cho từng sản phẩm.</p>
      <div className="voucher-mobile-list">
        {lines.map((line, index) => {
          const product = allowedProducts.find((item) => item.id === line.productId) || allowedProducts[0]
          const entryUnit = product.inboundUnit || product.unit
          const inboundPackSize = product.inboundPackKg ?? product.inboundPackQuantity
          const canChooseWeightUnit = product.unit === 'kg' && !inboundPackSize
          const convertedQuantity = inboundPackSize
            ? Number(line.quantity || 0) * inboundPackSize
            : null
          return <article className="voucher-mobile-card" key={line.id}>
            <div className="voucher-mobile-card-head">
              <strong>Sản phẩm #{index + 1}</strong>
              {lines.length > 1 && <button type="button" className="row-remove" onClick={() => onRemove(line.id)}>×</button>}
            </div>
            <label>Sản phẩm
              <select value={product.id} onChange={(e) => onUpdate(line.id, { productId: e.target.value, entryWeightUnit: 'kg' })}>
                {allowedProducts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <div className="voucher-mobile-quantity">
              <label>Số lượng
                <input inputMode="decimal" value={line.quantity} onChange={(e) => onUpdate(line.id, { quantity: cleanNumber(e.target.value) })} placeholder="Để trống nếu chưa nhập" />
              </label>
              <div><span>Đơn vị</span>{canChooseWeightUnit
                ? <select value={line.entryWeightUnit || 'kg'} onChange={(e) => onUpdate(line.id, { entryWeightUnit: e.target.value as 'kg' | 'g' })}><option value="kg">kg</option><option value="g">gram (g)</option></select>
                : <strong>{entryUnit}</strong>}{convertedQuantity !== null && <small>= {formatNumber(convertedQuantity)} {product.unit}</small>}</div>
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
              const product = allowedProducts.find((item) => item.id === line.productId) || allowedProducts[0]
              const entryUnit = product.inboundUnit || product.unit
              const inboundPackSize = product.inboundPackKg ?? product.inboundPackQuantity
              const canChooseWeightUnit = product.unit === 'kg' && !inboundPackSize
              const convertedQuantity = inboundPackSize
                ? Number(line.quantity || 0) * inboundPackSize
                : null
              return <tr key={line.id}>
                <td>{index + 1}</td>
                <td><select value={product.id} onChange={(e) => onUpdate(line.id, { productId: e.target.value, entryWeightUnit: 'kg' })}>{allowedProducts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td>
                <td>{canChooseWeightUnit
                  ? <select value={line.entryWeightUnit || 'kg'} onChange={(e) => onUpdate(line.id, { entryWeightUnit: e.target.value as 'kg' | 'g' })}><option value="kg">kg</option><option value="g">g</option></select>
                  : <span className="unit-chip">{entryUnit}</span>}{convertedQuantity !== null && <small className="inbound-conversion">= {formatNumber(convertedQuantity)} {product.unit}</small>}</td>
                <td><input inputMode="decimal" value={line.quantity} onChange={(e) => onUpdate(line.id, { quantity: cleanNumber(e.target.value) })} placeholder="0" /></td>
                <td><input value={line.note} onChange={(e) => onUpdate(line.id, { note: e.target.value })} placeholder="Tùy chọn" /></td>
                <td><button type="button" className="row-remove" onClick={() => onRemove(line.id)}>×</button></td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      <div className="voucher-footer">
        <button type="button" className="secondary-button" onClick={onAdd}>＋ Thêm sản phẩm</button>
        <div><span>{lines.filter((line) => Number(line.quantity) > 0).length} dòng có dữ liệu</span><button type="button" className="primary-button" onClick={onSave} disabled={saving}>{saving ? 'Đang lưu…' : '✓ Lưu toàn bộ phiếu'}</button></div>
      </div>
    </section>
  )
}

function InventoryReportForm({
  user, stock, productTick, onChanged, onFeedback,
}: {
  user: AppUser
  stock: ReturnType<typeof calculateStock>
  productTick: number
  onChanged: () => Promise<void>
  onFeedback: (text: string) => void
}) {
  const today = localDateKey()
  const [meta, setMeta] = useState({
    reportNo: String(Date.now()).slice(-4),
    reportDate: today,
    department: 'Nhà hàng',
    location: 'Kho đông / Kho phòng',
    shift: 'Tối',
    reporter: user.name,
  })
  const reportProducts = useMemo(() => getProducts().filter(isInventoryReportProduct), [productTick])
  const [lines, setLines] = useState<InventoryCountLine[]>(() => defaultInventoryLines(stock))
  const [newProductId, setNewProductId] = useState('')
  const [saving, setSaving] = useState(false)
  const [exportingImage, setExportingImage] = useState(false)
  const voucherRef = useRef<HTMLElement>(null)
  const posterRef = useRef<HTMLDivElement>(null)
  const availableProducts = reportProducts.filter((product) => !lines.some((line) => line.productId === product.id))

  useEffect(() => {
    const refreshedDefaults = defaultInventoryLines(stock)
    setLines((current) => {
      const existingIds = new Set(current.map((line) => line.productId))
      const additions = refreshedDefaults.filter((line) => !existingIds.has(line.productId))
      return additions.length ? [...current, ...additions] : current
    })
  }, [productTick])

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
      await saveInventoryReport(report, user)
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
      })), user)
      await onChanged()
      onFeedback('Đã lưu phiếu kiểm kê nhiều sản phẩm theo mẫu nhà hàng.')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể lưu phiếu kiểm kê.')
    } finally {
      setSaving(false)
    }
  }

  function printReport() { window.print() }

  async function saveInventoryCountImage() {
    if (!posterRef.current || exportingImage) return
    setExportingImage(true)
    try {
      const { default: html2canvas } = await import('html2canvas')
      const captureHeight = Math.ceil(posterRef.current.scrollHeight)
      const canvas = await html2canvas(posterRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        width: 1080,
        height: captureHeight,
        windowWidth: 1080,
        windowHeight: captureHeight,
      })
      const blob = await canvasToBlob(canvas, 'image/png')
      const fileName = `GUSTINO_Kiem_ke_kho_${user.branchId}_${meta.reportDate}_${meta.reportNo || 'bao-cao'}.png`
      const result = await shareOrDownloadBlob(blob, fileName, {
        title: `Phiếu kiểm kê kho ${meta.reportDate}`,
        text: `Tồn kho hiện tại - ${configuredBranchName(user.branchId) || user.branchId}`,
      })
      onFeedback(result === 'shared'
        ? 'Đã mở bảng chia sẻ ảnh phiếu kiểm kê. Chọn Zalo để gửi vào nhóm báo cáo.'
        : 'Đã tạo ảnh phiếu kiểm kê. Hãy gửi file ảnh vừa tải vào nhóm báo cáo.')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Không thể tạo ảnh phiếu kiểm kê.')
    } finally {
      setExportingImage(false)
    }
  }

  return (<>
    <section className="paper-report inventory-count-report" ref={voucherRef}>
      <div className="paper-title"><h2>INVENTORY REPORT</h2><p>Báo Cáo Kiểm Kê Hàng Hóa</p></div>
      <div className="inventory-count-snapshot">
        <span>TỒN HỆ THỐNG HIỆN TẠI</span>
        <strong>{lines.filter((line) => (stock.find((item) => item.product.id === line.productId)?.expected || 0) > 0.0001).length} mặt hàng đang có trong kho</strong>
        <small>Số tồn là dữ liệu lũy kế hiện tại; Kho đông/Kho phòng là số kiểm đếm thực tế.</small>
      </div>
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
          <thead><tr><th>STT</th><th>Hàng hóa<br /><small>Mô tả</small></th><th>ĐVT</th><th>Tồn hiện tại</th><th>Kho đông</th><th>Kho phòng</th><th>Số lượng cần đặt</th><th>Ghi chú</th></tr></thead>
          <tbody>{lines.map((line, index) => {
            const product = productById(line.productId) || stock.find((item) => item.product.id === line.productId)?.product
            if (!product) return null
            const expected = stock.find((item) => item.product.id === line.productId)?.expected || 0
            return <tr key={line.productId}>
              <td>{index + 1}</td><td><strong>{product.name}</strong><small>{product.sku}</small></td><td>{product.unit}</td>
              <td className="inventory-current-stock"><strong>{formatStockQuantity(expected, product.unit)}</strong><small>Dữ liệu hệ thống</small></td>
              <td><input inputMode="decimal" value={line.freezerQty || ''} onChange={(e) => updateLine(line.productId, { freezerQty: Number(cleanNumber(e.target.value)) })} /></td>
              <td><input inputMode="decimal" value={line.stockRoomQty || ''} onChange={(e) => updateLine(line.productId, { stockRoomQty: Number(cleanNumber(e.target.value)) })} /></td>
              <td><input inputMode="decimal" value={line.orderNeeded || ''} onChange={(e) => updateLine(line.productId, { orderNeeded: Number(cleanNumber(e.target.value)) })} /></td>
              <td><input value={line.note} onChange={(e) => updateLine(line.productId, { note: e.target.value })} /><button type="button" className="row-remove no-print" data-html2canvas-ignore="true" onClick={() => removeReportLine(line.productId)}>×</button></td>
            </tr>
          })}
          {!lines.length && <tr><td colSpan={8} className="empty-state">Chưa có hàng đang tồn trong kho. Chọn hàng hóa bên dưới nếu cần kiểm kê bổ sung.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="inventory-report-line-tools no-print" data-html2canvas-ignore="true">
        <select value={newProductId} onChange={(event) => setNewProductId(event.target.value)} disabled={!availableProducts.length}>
          <option value="">Chọn hàng hóa cần thêm</option>
          {availableProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        <button type="button" className="secondary-button" onClick={addReportLine} disabled={!availableProducts.length}>+ Thêm dòng hàng hóa</button>
      </div>
      <div className="signature-grid"><div>Chữ ký người báo cáo</div><div>Chữ ký người phụ trách</div></div>
      <div className="voucher-footer no-print" data-html2canvas-ignore="true">
        <div>
          <button type="button" className="secondary-button" onClick={printReport}>🖨 In / Xuất PDF</button>
          <button type="button" className="secondary-button" onClick={() => void saveInventoryCountImage()} disabled={exportingImage}>{exportingImage ? 'Đang tạo ảnh…' : '▧ Lưu / chia sẻ ảnh'}</button>
        </div>
        <button type="button" className="primary-button" onClick={save} disabled={saving}>{saving ? 'Đang lưu…' : '✓ Lưu phiếu kiểm kê'}</button>
      </div>
    </section>
    <InventoryCountPoster
      posterRef={posterRef}
      user={user}
      meta={meta}
      lines={lines}
      stock={stock}
    />
  </>)
}

function InventoryCountPoster({
  posterRef,
  user,
  meta,
  lines,
  stock,
}: {
  posterRef: React.RefObject<HTMLDivElement | null>
  user: AppUser
  meta: {
    reportNo: string
    reportDate: string
    department: string
    location: string
    shift: string
    reporter: string
  }
  lines: InventoryCountLine[]
  stock: ReturnType<typeof calculateStock>
}) {
  const visibleLines = lines.flatMap((line) => {
    const stockLine = stock.find((item) => item.product.id === line.productId)
    const product = productById(line.productId) || stockLine?.product
    return product ? [{ line, product, expected: stockLine?.expected || 0 }] : []
  })
  const countedLines = visibleLines.filter(({ line }) => line.freezerQty > 0 || line.stockRoomQty > 0)
  const branchLabel = configuredBranchName(user.branchId) || user.branchId
  return (
    <div className={`inventory-count-poster${visibleLines.length > 14 ? ' dense' : ''}`} ref={posterRef}>
      <header>
        <h2>INVENTORY REPORT</h2>
        <p>Báo Cáo Kiểm Kê Hàng Hóa</p>
      </header>
      <section className="inventory-count-poster-snapshot">
        <span>TỒN HỆ THỐNG HIỆN TẠI</span>
        <div>
          <strong>{visibleLines.filter(({ expected }) => expected > 0.0001).length} mặt hàng đang có trong kho</strong>
          <small>Số tồn là dữ liệu lũy kế hiện tại; Kho đông/Kho phòng là số kiểm đếm thực tế.</small>
        </div>
      </section>
      <section className="inventory-count-poster-identity">
        <div><span>Report No. / Số báo cáo</span><strong>{meta.reportNo || '—'}</strong></div>
        <div><span>Date / Ngày</span><strong>{new Date(`${meta.reportDate}T00:00:00`).toLocaleDateString('vi-VN')}</strong></div>
        <div><span>Branch / Chi nhánh</span><strong>{branchLabel}</strong></div>
        <div><span>Reporter / Người báo cáo</span><strong>{meta.reporter || user.name}</strong></div>
        <div><span>Department / Bộ phận · Khu vực</span><strong>{meta.department || '—'} · {meta.location || '—'}</strong></div>
        <div><span>Shift / Ca làm việc</span><strong>{meta.shift || '—'}</strong></div>
      </section>
      <section className="inventory-count-poster-table">
        <div className="inventory-count-poster-row head">
          <span>HÀNG HÓA</span><span>TỒN HỆ THỐNG</span><span>KHO ĐÔNG</span><span>KHO PHÒNG</span><span>CẦN ĐẶT</span>
        </div>
        {visibleLines.map(({ line, product, expected }, index) => (
          <div className="inventory-count-poster-row" key={line.productId}>
            <span><i>{index + 1}</i><b>{product.name}</b><small>{product.sku} · {product.unit}</small></span>
            <strong>{formatStockQuantity(expected, product.unit)}</strong>
            <strong>{line.freezerQty > 0 ? formatNumber(line.freezerQty) : '—'}</strong>
            <strong>{line.stockRoomQty > 0 ? formatNumber(line.stockRoomQty) : '—'}</strong>
            <strong className={line.orderNeeded > 0 ? 'warning' : ''}>{line.orderNeeded > 0 ? `${formatNumber(line.orderNeeded)} ${product.unit}` : '—'}</strong>
          </div>
        ))}
      </section>
      <section className="inventory-count-poster-signatures">
        <div><span>NGƯỜI LẬP PHIẾU</span><strong>{meta.reporter || user.name}</strong><small>{countedLines.length} mặt hàng đã kiểm đếm · Ký và ghi rõ họ tên</small></div>
        <div><span>NGƯỜI PHỤ TRÁCH</span><strong>________________</strong><small>Ký và xác nhận</small></div>
      </section>
      <footer><span>Dữ liệu hệ thống được đồng bộ tại thời điểm xuất ảnh</span><b>GUSTINO · VẬN HÀNH KHO</b></footer>
    </div>
  )
}

function StockTable({
  stock, canCount, onCount,
}: {
  stock: ReturnType<typeof calculateStock>
  canCount: boolean
  onCount: () => void
}) {
  return (
    <section className="section-card stock-section">
      <div className="section-title"><div><span className="eyebrow dark">TỒN KHO TỔNG</span><h2>Danh sách hàng hóa lũy kế</h2></div>{canCount && <button type="button" className="text-button" onClick={onCount}>Lập phiếu kiểm kê →</button>}</div>
      <div className="adm-list">
        {stock.map((line) => (
          <article className="adm-row" key={line.product.id}>
            <div className="adm-row-head">
              <div className="adm-row-id">
                <strong>{line.product.name}</strong>
                <small>{line.product.sku} · {line.product.category === 'raw' ? 'Nguyên liệu' : 'Thành phẩm'}</small>
              </div>
              <div className="adm-row-hero">
                <b className={line.expected <= line.product.lowStock ? 'text-warning' : ''}>{formatNumber(line.expected)}</b>
                <span>{line.product.unit} dự kiến</span>
              </div>
            </div>
            <div className="adm-metrics">
              <span><i>Thực tế</i><b>{line.actual === undefined ? '—' : `${formatNumber(line.actual)} ${line.product.unit}`}</b></span>
            </div>
          </article>
        ))}
        {!stock.length && <p className="empty-copy">Chưa có hàng hóa trong kho.</p>}
      </div>
    </section>
  )
}

function stockPriority(line: ReturnType<typeof calculateStock>[number]) {
  if (line.expected <= line.product.lowStock) return 0
  if (line.product.category === 'finished') return 1
  if (line.product.category === 'raw') return 2
  return 3
}

function groupMovementDocuments(rows: StockMovement[]) {
  const groups = new Map<string, StockMovement[]>()
  rows.forEach((item) => {
    const key = item.documentId || item.id
    groups.set(key, [...(groups.get(key) || []), item])
  })
  return Array.from(groups.entries()).sort((a, b) =>
    (b[1][0]?.createdAt || '').localeCompare(a[1][0]?.createdAt || ''),
  )
}

function calculateDailyLoss(rows: StockMovement[]) {
  const wasteRows = rows.filter((item) => item.type === 'waste' && item.sourceProductId && item.sourceQuantity)
  const totalLoss = wasteRows.reduce((sum, item) => sum + item.quantity, 0)
  const totalSource = wasteRows.reduce((sum, item) => sum + (item.sourceQuantity || 0), 0)
  return {
    totalLoss,
    totalSource,
    rate: totalSource > 0 ? totalLoss / totalSource * 100 : 0,
    documentCount: new Set(wasteRows.map((item) => item.documentId || item.id)).size,
  }
}

const INVENTORY_TEXT = {
  vi: {
    reportEyebrow: 'BÁO CÁO KHO',
    locale: 'vi-VN',
    reportTitle: 'Kho theo chi nhánh',
    reportSubtitle: 'Theo dõi tổng tồn kho, nhập kho, rang/chế biến và kiểm kê theo từng chi nhánh.',
    branch: 'CHI NHÁNH',
    totalWarehouse: 'Tổng kho lũy kế',
    needOrder: 'Cần đặt hàng',
    watchLoss: 'Theo dõi hao hụt',
    stable: 'Ổn định',
    totalStock: 'Tổng tồn',
    lowStock: 'Sắp hết',
    stock: 'Tồn kho',
    stockHint: 'SKU đang có số dư',
    inbound: 'Nhập hàng',
    inboundHint: 'Nguyên liệu · Chế biến',
    outbound: 'Xuất bán',
    outboundHint: 'Phiếu lấy ra bán',
    loss: 'Hao hụt',
    count: 'Kiểm kê',
    countHint: 'Ghi nhận tồn thực tế',
    unitsIn: 'đơn vị vào kho',
    unitsOut: 'đơn vị lấy ra bán',
    lossToday: 'hao hụt',
    todayStock: 'Tồn kho tổng',
    endStock: 'Tồn kho đến ngày',
    date: 'Ngày',
    countTitle: 'Ghi nhận tồn thực tế',
    createCount: 'Lập phiếu kiểm kê',
    currentStock: 'TỒN KHO HIỆN TẠI',
    smartList: 'Danh sách thông minh theo mức ưu tiên',
    items: 'mặt hàng',
    raw: 'Nguyên liệu',
    packaging: 'Bao bì',
    finished: 'Thành phẩm',
    lowStatus: 'Sắp hết',
    goodStatus: 'Đủ bán',
    emptyStock: 'Chưa có hàng hóa trong kho.',
    categoryFilter: 'Phân loại',
    allCategories: 'Tất cả loại',
  },
  en: {
    reportEyebrow: 'INVENTORY REPORT',
    locale: 'en-US',
    reportTitle: 'Inventory by branch',
    reportSubtitle: 'Track total stock, inbound, processing, and counts by branch.',
    branch: 'BRANCH',
    totalWarehouse: 'Total warehouse balance',
    needOrder: 'Reorder needed',
    watchLoss: 'Watch loss',
    stable: 'Stable',
    totalStock: 'Total stock',
    lowStock: 'Low stock',
    stock: 'Stock',
    stockHint: 'SKUs with balance',
    inbound: 'Inbound',
    inboundHint: 'Materials · Processing',
    outbound: 'Outbound',
    outboundHint: 'Sell-out vouchers',
    loss: 'Loss',
    count: 'Stock count',
    countHint: 'Record physical stock',
    unitsIn: 'units received',
    unitsOut: 'units sold out',
    lossToday: 'loss',
    todayStock: 'Total stock',
    endStock: 'End stock',
    date: 'Date',
    countTitle: 'Record physical stock',
    createCount: 'Create count sheet',
    currentStock: 'CURRENT STOCK',
    smartList: 'Priority smart list',
    items: 'items',
    raw: 'Raw material',
    packaging: 'Packaging',
    finished: 'Finished goods',
    lowStatus: 'Low stock',
    goodStatus: 'Ready to sell',
    emptyStock: 'No warehouse stock yet.',
    categoryFilter: 'Category',
    allCategories: 'All categories',
  },
} as const

function cleanNumber(value: string) { return value.replace(/[^0-9.,]/g, '').replace(',', '.') }
function normalizeDisplayQuantity(value: number) { return Math.abs(value) < .00005 ? 0 : value }
function formatNumber(value: number) {
  const normalized = normalizeDisplayQuantity(value)
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(2)
}
function quantityInProductUnit(product: Product, line: Pick<VoucherLine, 'quantity' | 'entryWeightUnit'>) {
  const quantity = Number(line.quantity)
  if (product.unit === 'kg' && line.entryWeightUnit === 'g') return quantity / 1000
  return quantity
}
function formatStockQuantity(value: number, unit: string) {
  const normalized = normalizeDisplayQuantity(value)
  if (unit === 'kg') {
    const grams = normalized * 1000
    if (normalized !== 0 && Math.abs(normalized) < 1) return `${formatNumber(grams)} g`
    return `${formatNumber(normalized)} kg`
  }
  return `${formatNumber(normalized)} ${unit}`.trim()
}
function formatDate(value: string) {
  const [year, month, day] = value.split('-')
  return day && month && year ? `${day}/${month}/${year}` : value
}
function periodLabel(period: InventoryPeriod, date: string, month: string, year: string) {
  if (period === 'all') return 'Tất cả dữ liệu đã lưu'
  if (period === 'year') return `Năm ${year || '—'}`
  if (period === 'month') {
    const [y, m] = month.split('-')
    return m && y ? `Tháng ${m}/${y}` : 'Theo tháng'
  }
  return `Ngày ${formatDate(date)}`
}
function isInventoryReportProduct(product: Product) {
  if (product.category === 'packaging') return false
  if (product.id.endsWith('-kg') || product.id.includes('-finished')) return false
  return true
}
function defaultInventoryLines(stock: ReturnType<typeof calculateStock>): InventoryCountLine[] {
  return stock
    .filter((line) => isInventoryReportProduct(line.product) && line.expected > 0.0001)
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
  totals: { inbound: number; outbound: number; low: number; count: number }
  reportDate: string
}>(({ user, stock, totals, reportDate }, ref) => (
  <div className={`inventory-infographic${stock.length > 15 ? ' dense' : ''}`} ref={ref}>
    <div className="info-header"><div><span>GUSTINO · VẬN HÀNH KHO</span><h2>BÁO CÁO TỒN KHO</h2><p>Tổng hợp hàng đang có trong kho</p></div><strong>{new Date(`${reportDate}T00:00:00`).toLocaleDateString('vi-VN')}</strong></div>
    <div className="info-identity">
      <div><span>CHI NHÁNH</span><strong>{configuredBranchName(user.branchId) || user.branchId}</strong></div>
      <div><span>NGƯỜI LẬP BÁO CÁO</span><strong>{user.name}</strong></div>
    </div>
    <div className="info-metrics"><div><span>Mặt hàng có tồn</span><strong>{stock.filter((line) => line.expected > 0.0001).length}</strong></div><div><span>Nhập trong kỳ</span><strong>{totals.inbound}</strong></div><div><span>Xuất trong kỳ</span><strong>{totals.outbound}</strong></div><div className={totals.low ? 'warning' : ''}><span>Cần chú ý</span><strong>{totals.low}</strong></div></div>
    <div className="info-table"><div className="head"><span>HÀNG HÓA</span><strong>TỒN HIỆN TẠI</strong></div>{stock.map((line, index) => <div key={line.product.id}><span><i>{index + 1}</i><b>{line.product.name}</b><small>{line.product.sku}</small></span><strong>{formatStockQuantity(line.expected, line.product.unit)}</strong></div>)}</div>
    <footer><span>Ngày báo cáo: {new Date(`${reportDate}T00:00:00`).toLocaleDateString('vi-VN')}</span><span>GUSTINO · HỆ THỐNG VẬN HÀNH</span></footer>
  </div>
))
