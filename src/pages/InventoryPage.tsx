import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { INBOUND_PRODUCTS, MOVEMENT_LABELS, PACKING_OPTIONS_BY_OUTPUT, PRODUCTS, getInboundProducts, getProcessInputProducts, getProcessingOutputOptions, getProducts, isWarehouseProduct, productById } from '../lib/constants'
import { canvasToBlob, createId, shareOrDownloadBlob } from '../lib/browser'
import { confirmBlockedMessage, confirmRisky } from '../lib/deviceReadiness'
import {
  STOCK_EPSILON,
  convertEntryToStockQuantity,
  defaultEntryUnit,
  formatQuantity,
  formatStockAmount,
  hasQuantityInput,
  hasStock,
  inboundEntryUnit,
  inboundPackSize,
  matchesProductQuery,
  parseQuantityInput,
  planOutbound,
  planStockReset,
  quantityInputValue,
  roundQuantity,
  sanitizeQuantityInput,
} from '../lib/inventoryEntry'
import type { EntryUnit, QuantityEntry, StockAvailability } from '../lib/inventoryEntry'
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

interface ProcessLine { id: string; productId: string; quantity: string }
type InventoryCrmMode = 'stock' | 'inbound' | 'outbound' | 'count'
type InboundSub = 'material' | 'processing'
/** Xuất kho có 2 việc: lấy hàng ra bán, và sửa lại tồn khi sổ sách lệch thực tế. */
type OutboundSub = 'issue' | 'reset'
type StockDisplayCategory = 'all' | 'raw' | 'packaging' | 'finished'
type InventoryPeriod = 'day' | 'month' | 'year' | 'all'
/** Bảng nhập liệu theo SKU: khoá là productId, không còn "dòng phiếu" phải tự thêm/xoá. */
type EntryMap = Record<string, QuantityEntry>

function crmModeFromTab(tab: InventoryTab): InventoryCrmMode {
  if (tab === 'inbound' || tab === 'processing_out') return 'inbound'
  if (tab === 'count') return 'count'
  return 'stock'
}

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
  const [outboundSub, setOutboundSub] = useState<OutboundSub>('issue')
  const [inboundEntries, setInboundEntries] = useState<EntryMap>({})
  const [voucherNote, setVoucherNote] = useState('')
  const [outboundEntries, setOutboundEntries] = useState<EntryMap>({})
  const [outboundNote, setOutboundNote] = useState('')
  const [resetEntries, setResetEntries] = useState<EntryMap>({})
  const [resetNote, setResetNote] = useState('')
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
  // Bảng tồn dùng chung cho 3 màn nhập liệu (nhập / xuất / sửa tồn).
  const availabilityByProduct = useMemo<StockAvailability[]>(
    () => stock.map((line) => ({ product: line.product, available: line.expected })),
    [stock],
  )
  const inboundAvailability = useMemo<StockAvailability[]>(() => {
    const stockById = new Map(stock.map((line) => [line.product.id, line.expected]))
    const products = inboundProducts.length ? inboundProducts : INBOUND_PRODUCTS
    return products.map((product) => ({ product, available: stockById.get(product.id) || 0 }))
  }, [inboundProducts, stock])
  const outboundAvailability = useMemo(
    () => availabilityByProduct.filter((line) => hasStock(line.available)),
    [availabilityByProduct],
  )
  const lowStockLines = visibleOverviewStock.filter(stockNeedsAttention)
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

  const updateInboundEntry = entryUpdater(setInboundEntries)
  const updateOutboundEntry = entryUpdater(setOutboundEntries)
  const updateResetEntry = entryUpdater(setResetEntries)

  async function saveInboundVoucher() {
    const lines = inboundAvailability.flatMap(({ product }) => {
      const entry = inboundEntries[product.id]
      if (!entry || !hasQuantityInput(entry.quantity)) return []
      const { quantity, conversionNote } = convertEntryToStockQuantity(product, entry, { usePackSize: true })
      if (quantity <= 0) return []
      return [{ product, quantity, conversionNote, note: entry.note?.trim() || '' }]
    })
    if (!lines.length) {
      setFeedback('Chưa có mặt hàng nào được nhập số lượng. Gõ số vào ô của mặt hàng cần nhập kho rồi lưu.')
      return
    }
    setSaving(true)
    const documentId = createId()
    const now = new Date().toISOString()
    try {
      await makeSureDayIsOpen()
      await addMovements(lines.map((line) => ({
        id: createId(),
        documentId,
        branchId: user.branchId,
        productId: line.product.id,
        type: 'inbound' as const,
        quantity: line.quantity,
        shiftDate: today,
        note: [line.conversionNote, voucherNote, line.note].filter(Boolean).join(' — '),
        createdBy: user.id,
        createdAt: now,
      })), user)
      setFeedback(`Đã lưu phiếu nhập gồm ${lines.length} mặt hàng.`)
      setNextStepHint('processing')
      setInboundEntries({})
      setVoucherNote('')
      await onChanged()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Không thể lưu phiếu.')
    } finally {
      setSaving(false)
    }
  }

  async function saveOutboundVoucher() {
    if (!outboundAvailability.length) {
      setFeedback('Kho hiện không có mặt hàng nào còn tồn để lập phiếu xuất.')
      return
    }
    // `planOutbound` tự khớp về đúng tồn khi số gõ chỉ lệch mức làm tròn → không còn
    // cảnh "xuất xong vẫn dư 0,00x nên phải xuất lại lần nữa".
    const plan = planOutbound(outboundAvailability, outboundEntries)
    if (!plan.lines.length) {
      setFeedback('Chưa chọn mặt hàng nào để xuất. Gõ số lượng hoặc bấm “Xuất hết” ở mặt hàng cần lấy ra.')
      return
    }
    let allowInsufficientStock = false
    if (plan.shortages.length) {
      const detail = plan.shortages
        .map((item) => `${item.product.name}: cần ${formatStockAmount(item.requested, item.product.unit)}, tồn ${formatStockAmount(item.available, item.product.unit)}`)
        .join('\n')
      const proceed = confirmRisky(`Tồn kho chưa đủ cho phiếu xuất:\n\n${detail}\n\nVẫn tiếp tục lập phiếu?`)
      if (proceed !== 'accepted') {
        setFeedback(confirmBlockedMessage(proceed, 'Phiếu xuất'))
        return
      }
      allowInsufficientStock = true
    }
    setSaving(true)
    const documentId = createId()
    const now = new Date().toISOString()
    try {
      await makeSureDayIsOpen()
      await addMovements(plan.lines.map((line) => ({
        id: createId(),
        documentId,
        branchId: user.branchId,
        productId: line.product.id,
        type: 'sale_out' as const,
        quantity: line.quantity,
        shiftDate: today,
        note: [
          '[Phiếu xuất kho]',
          line.snapped ? `Xuất hết tồn ${formatStockAmount(line.available, line.product.unit)}` : '',
          outboundNote,
          line.note,
        ].filter(Boolean).join(' — '),
        createdBy: user.id,
        createdAt: now,
        measuredWeightKg: line.product.unit === 'kg' ? line.quantity : undefined,
      })), user, { allowInsufficientStock })
      const clearedCount = plan.lines.filter((line) => line.remaining <= STOCK_EPSILON).length
      setFeedback(`Đã lưu phiếu xuất ${plan.lines.length} mặt hàng${clearedCount ? ` · ${clearedCount} mặt hàng đã về 0` : ''}.`)
      setOutboundEntries({})
      setOutboundNote('')
      await onChanged()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Không thể lưu phiếu xuất kho.')
    } finally {
      setSaving(false)
    }
  }

  /**
   * SỬA TỒN — đường tắt cho tình huống "sổ kho sai": khai thẳng số đúng, hệ thống
   * ghi một phiếu kiểm kê (`count`) làm mốc reset. Không phải xuất hết rồi nhập lại.
   */
  async function saveStockReset() {
    const lines = planStockReset(availabilityByProduct, resetEntries)
    if (!lines.length) {
      setFeedback('Chưa có mặt hàng nào thay đổi. Nhập số tồn đúng (gõ 0 nếu đã hết sạch) rồi lưu.')
      return
    }
    const detail = lines
      .map((line) => `• ${line.product.name}: ${formatStockAmount(line.current, line.product.unit)} → ${formatStockAmount(line.target, line.product.unit)} (${formatDeltaAmount(line.delta, line.product.unit)})`)
      .join('\n')
    const confirmed = confirmRisky(`Đặt lại tồn kho cho ${lines.length} mặt hàng:\n\n${detail}\n\nSố khai sẽ thay cho số hệ thống đang tính. Xác nhận?`)
    if (confirmed !== 'accepted') {
      // Trước đây chỗ này `return` trắng: trong WebView Zalo hộp thoại không hiện,
      // hàm thoát ra không ghi gì và KHÔNG báo gì — ca trưởng tưởng đã lưu.
      setFeedback(confirmBlockedMessage(confirmed, 'Sửa tồn'))
      return
    }
    setSaving(true)
    const documentId = createId()
    const now = new Date().toISOString()
    try {
      await makeSureDayIsOpen()
      await addMovements(lines.map((line) => ({
        id: createId(),
        documentId,
        branchId: user.branchId,
        productId: line.product.id,
        type: 'count' as const,
        quantity: line.target,
        shiftDate: today,
        note: [
          `${STOCK_RESET_TAG} hệ thống ${formatStockAmount(line.current, line.product.unit)} → thực tế ${formatStockAmount(line.target, line.product.unit)} (${formatDeltaAmount(line.delta, line.product.unit)})`,
          resetNote,
          line.note,
        ].filter(Boolean).join(' — '),
        createdBy: user.id,
        createdAt: now,
      })), user)
      setFeedback(`Đã đặt lại tồn cho ${lines.length} mặt hàng. Tồn kho hiện lấy theo số vừa khai.`)
      setResetEntries({})
      setResetNote('')
      await onChanged()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Không thể lưu phiếu sửa tồn.')
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
      const proceed = confirmRisky(
        `Tồn kho chưa đủ cho mẻ này (có thể do chưa ghi phiếu nhập):\n\n${shortLines.join('\n')}\n\nVẫn tiếp tục ghi nhận mẻ chế biến?`,
      )
      if (proceed !== 'accepted') {
        setFeedback(confirmBlockedMessage(proceed, 'Mẻ chế biến'))
        return
      }
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
      const proceed = confirmRisky(`Xóa ${label} sẽ làm ${negative.product.name} âm ${formatNumber(negative.expected)} ${negative.product.unit} do đã có giao dịch phát sinh sau đó.\n\nVẫn xóa để sửa dữ liệu và kiểm lại các phiếu sau?`)
      if (proceed !== 'accepted') {
        setFeedback(confirmBlockedMessage(proceed, `Xóa ${label}`))
        return
      }
    }
    const confirmed = confirmRisky(`Xóa ${label}? Toàn bộ các dòng trong chứng từ này sẽ được xóa và tồn kho sẽ được tính lại.`)
    if (confirmed !== 'accepted') {
      setFeedback(confirmBlockedMessage(confirmed, `Xóa ${label}`))
      return
    }
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
            ? 'Nhập hàng · Xuất kho & sửa tồn · Kiểm kê · Tồn kho. Kho lệch số thì vào Xuất kho › Sửa tồn để khai thẳng số đúng.'
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
          <StockEntryBoard
            mode="in"
            eyebrow="BƯỚC 1 · ĐẦU NGÀY"
            title="Nhập hàng vào kho"
            hint="Gõ số lượng ngay tại mặt hàng cần nhập — không cần thêm dòng, không cần chọn trong danh sách xổ."
            rows={inboundAvailability}
            entries={inboundEntries}
            note={voucherNote}
            notePlaceholder="Áp dụng cho toàn bộ phiếu: nhà cung cấp, người giao…"
            noteLabel="Ghi chú chung / Nhà cung cấp / Người nhận"
            saveLabel="✓ Lưu phiếu nhập kho"
            saving={saving}
            onNote={setVoucherNote}
            onEntry={updateInboundEntry}
            onClear={() => setInboundEntries({})}
            onSave={saveInboundVoucher}
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

      {/* ── XUẤT + SỬA TỒN ── */}
      {crmMode === 'outbound' && (
        <>
          {canOperateInventory && (
            <div className="inventory-subtabs" role="tablist">
              <button type="button" className={outboundSub === 'issue' ? 'active' : ''} onClick={() => setOutboundSub('issue')}>① Xuất hàng khỏi kho</button>
              <button type="button" className={outboundSub === 'reset' ? 'active' : ''} onClick={() => setOutboundSub('reset')}>② Sửa tồn cho đúng</button>
            </div>
          )}
          {canOperateInventory && outboundSub === 'issue' && (
            <StockEntryBoard
              mode="out"
              eyebrow="PHIẾU XUẤT KHO"
              title="Lấy hàng ra khỏi kho"
              hint="Bấm “Xuất hết” là lấy đúng số tồn thật (kể cả phần lẻ) — kho về 0 trong một lần, không phải xuất đi xuất lại."
              rows={outboundAvailability}
              entries={outboundEntries}
              note={outboundNote}
              noteLabel="Ghi chú chung / Người nhận / Lý do xuất"
              notePlaceholder="Ví dụ: xuất ra quầy bán, chuyển ca, bổ sung tủ trưng bày…"
              saveLabel="✓ Lưu phiếu xuất kho"
              saving={saving}
              emptyCopy="Kho hiện không còn mặt hàng nào có tồn để xuất."
              footerNote={<>Kho lệch nhiều mặt hàng? Sang tab <b>② Sửa tồn cho đúng</b> để khai thẳng số đúng — nhanh hơn xuất hết rồi nhập lại.</>}
              onNote={setOutboundNote}
              onEntry={updateOutboundEntry}
              onClear={() => setOutboundEntries({})}
              onSave={saveOutboundVoucher}
            />
          )}
          {canOperateInventory && outboundSub === 'reset' && <>
            <StockEntryBoard
              mode="set"
              eyebrow="SỬA TỒN KHO"
              title="Đặt lại số tồn cho đúng thực tế"
              hint="Khai số đang có thật trong kho (gõ 0 nếu đã hết sạch). Hệ thống ghi một phiếu kiểm kê làm mốc — không cần xuất hết rồi nhập lại."
              rows={availabilityByProduct}
              entries={resetEntries}
              note={resetNote}
              noteLabel="Lý do sửa tồn"
              notePlaceholder="Ví dụ: kiểm lại kho đầu ca, sổ lệch do ghi thiếu phiếu…"
              saveLabel="✓ Lưu phiếu sửa tồn"
              saving={saving}
              onNote={setResetNote}
              onEntry={updateResetEntry}
              onClear={() => setResetEntries({})}
              onSave={saveStockReset}
            />
            <StockResetHistory
              movements={periodMovements}
              saving={saving}
              onDelete={(rows) => deleteMovementGroup(rows, 'phiếu sửa tồn')}
            />
          </>}
          {outboundSub === 'issue' && (
            <OutboundMovementHistory
              movements={periodMovements}
              saving={saving}
              canDelete={canOperateInventory}
              onDelete={(rows) => canOperateInventory && deleteMovementGroup(rows, 'phiếu xuất kho')}
            />
          )}
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
  const [category, setCategory] = useState<StockDisplayCategory>('all')
  // Kho không còn nhóm "món trong menu bán" — món menu đã bị loại khỏi calculateStock.
  const displayCategory = (line: ReturnType<typeof calculateStock>[number]): Exclude<StockDisplayCategory, 'all'> =>
    line.product.category
  const categoryLabel = (value: string) =>
    value === 'raw' ? text.raw
      : value === 'packaging' ? text.packaging
        : 'Thành phẩm chế biến'
  const presentCategories = (['finished', 'raw', 'packaging'] as const).filter((value) =>
    stock.some((line) => displayCategory(line) === value))
  const sorted = [...stock].sort((a, b) => stockPriority(a) - stockPriority(b) || a.product.name.localeCompare(b.product.name, 'vi'))
  const activeCategory = category !== 'all' && presentCategories.includes(category) ? category : 'all'
  const filtered = activeCategory === 'all' ? sorted : sorted.filter((line) => displayCategory(line) === activeCategory)
  const summaries = presentCategories.map((value) => {
    const rows = stock.filter((line) => displayCategory(line) === value)
    return {
      value,
      label: categoryLabel(value),
      skuCount: rows.length,
      total: rows.reduce((sum, line) => sum + Math.max(0, line.expected), 0),
      low: rows.filter(stockNeedsAttention).length,
    }
  })
  return (
    <div className="smart-stock-wrap">
      <div className="inventory-category-summary">
        {summaries.map((summary) => (
          <article key={summary.value} className={summary.low ? 'warning' : ''}>
            <span>{summary.label}</span>
            <strong>{formatNumber(summary.total)}</strong>
            <small>{summary.skuCount} mặt hàng{summary.low ? ` · ${summary.low} cần chú ý` : ' · đủ tồn'}</small>
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
                {categoryLabel(value)} ({stock.filter((line) => displayCategory(line) === value).length})
              </option>
            ))}
          </select>
        </label>
      )}
      <div className={compact ? 'smart-stock-list compact' : 'smart-stock-list'}>
        {filtered.map((line) => {
          const availability = stockAvailability(line)
          const status = availability === 'good' ? 'good' : 'low'
          return (
            <article className={status} key={line.product.id}>
              <div>
                <strong>{line.product.name}</strong>
                <small>{line.product.sku} · {categoryLabel(displayCategory(line))}</small>
              </div>
              <b>{formatStockQuantity(line.expected, line.product.unit)}</b>
              <em>{availability === 'out'
                ? 'Hết hàng'
                : availability === 'packing-residue'
                  ? 'Còn dư, chưa đủ đóng gói'
                  : availability === 'low'
                    ? text.lowStatus
                    : text.goodStatus}</em>
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
                return <span key={item.id}><strong>{product?.name || item.productId}</strong><b>{formatStockQuantity(item.quantity, product?.unit || '')}</b><small>{item.note || 'Xuất bán'}</small></span>
              })}
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

/**
 * BẢNG NHẬP LIỆU KHO DÙNG CHUNG cho 3 việc: nhập hàng, xuất hàng, sửa tồn.
 *
 * Thiết kế lại 05/08/2026 theo phản hồi ca trưởng — trước đây mỗi phiếu là một
 * danh sách "dòng" phải tự bấm thêm rồi chọn sản phẩm trong dropdown, số tồn lại
 * chỉ hiện 2 chữ số thập phân nên xuất hết mãi vẫn dư vài gram. Nay:
 *  · mỗi SKU là một dòng có sẵn, chỉ việc gõ số (có ô tìm kiếm + lọc nhóm),
 *  · hiện ĐỦ số lẻ như sổ kho lưu,
 *  · có nút “Xuất hết” / “Về 0” lấy đúng số tồn thật để kho về 0 dứt điểm.
 */
function StockEntryBoard({
  mode, eyebrow, title, hint, rows, entries, note, noteLabel, notePlaceholder, saveLabel, saving,
  emptyCopy, footerNote, onNote, onEntry, onClear, onSave,
}: {
  mode: 'in' | 'out' | 'set'
  eyebrow: string
  title: string
  hint: string
  rows: StockAvailability[]
  entries: EntryMap
  note: string
  noteLabel: string
  notePlaceholder: string
  saveLabel: string
  saving: boolean
  emptyCopy?: string
  footerNote?: React.ReactNode
  onNote: (value: string) => void
  onEntry: (productId: string, patch: Partial<QuantityEntry>) => void
  onClear: () => void
  onSave: () => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<StockDisplayCategory>('all')
  const [onlyFilled, setOnlyFilled] = useState(false)
  const presentCategories = (['finished', 'raw', 'packaging'] as const)
    .filter((value) => rows.some((row) => row.product.category === value))
  const activeCategory = category !== 'all' && presentCategories.includes(category) ? category : 'all'
  const filledIds = new Set(rows
    .filter((row) => hasQuantityInput(entries[row.product.id]?.quantity))
    .map((row) => row.product.id))
  const visibleRows = rows.filter((row) => {
    if (onlyFilled && !filledIds.has(row.product.id)) return false
    if (activeCategory !== 'all' && row.product.category !== activeCategory) return false
    return matchesProductQuery(row.product, query)
  })
  const outboundPlan = useMemo(() => mode === 'out' ? planOutbound(rows, entries) : null, [mode, rows, entries])
  const resetLines = useMemo(() => mode === 'set' ? planStockReset(rows, entries) : [], [mode, rows, entries])
  const clearedCount = outboundPlan?.lines.filter((line) => line.remaining <= STOCK_EPSILON).length || 0

  /** Đổ số tồn thật vào ô nhập (nút "Xuất hết") — lấy nguyên số lẻ, không làm tròn cho đẹp. */
  function fillFullStock(row: StockAvailability) {
    const unit = defaultEntryUnit(row.product, row.available)
    const rounded = roundQuantity(row.available)
    onEntry(row.product.id, {
      unit,
      quantity: quantityInputValue(unit === 'g' ? rounded * 1000 : rounded),
    })
  }

  const summary = mode === 'out'
    ? `${outboundPlan?.lines.length || 0} mặt hàng sẽ xuất${clearedCount ? ` · ${clearedCount} về 0` : ''}`
    : mode === 'set'
      ? `${resetLines.length} mặt hàng thay đổi tồn`
      : `${filledIds.size} mặt hàng sẽ nhập kho`

  return (
    <section className="entry-card stock-entry-board">
      <div className="section-title">
        <div><span className="eyebrow dark">{eyebrow}</span><h2>{title}</h2></div>
        <span className="date-chip">{new Date().toLocaleDateString('vi-VN')}</span>
      </div>
      {/* Một dòng hướng dẫn duy nhất: màn kho là màn thao tác nhanh, không phải trang đọc. */}
      <p className="stock-entry-hint">{hint} <span>Cân ký: 5,123 kg = 5.123 kg — cân hiện 5123 gram thì đổi đơn vị sang g.</span></p>
      <div className="stock-entry-tools">
        <input
          className="stock-entry-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="🔍 Tìm mặt hàng: hat de, bao bi…"
          inputMode="search"
          aria-label="Tìm mặt hàng"
        />
        {presentCategories.length > 1 && (
          <select
            className="stock-entry-filter"
            value={activeCategory}
            onChange={(event) => setCategory(event.target.value as StockDisplayCategory)}
            aria-label="Lọc theo nhóm hàng"
          >
            <option value="all">Tất cả nhóm ({rows.length})</option>
            {presentCategories.map((value) => (
              <option key={value} value={value}>
                {value === 'raw' ? 'Nguyên liệu' : value === 'packaging' ? 'Bao bì' : 'Thành phẩm'} ({rows.filter((row) => row.product.category === value).length})
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={onlyFilled ? 'chip-toggle active' : 'chip-toggle'}
          onClick={() => setOnlyFilled((value) => !value)}
          disabled={!filledIds.size}
        >
          {onlyFilled ? '✓ Dòng đã nhập' : `Dòng đã nhập (${filledIds.size})`}
        </button>
        <input
          className="stock-entry-voucher-note"
          value={note}
          onChange={(event) => onNote(event.target.value)}
          placeholder={notePlaceholder}
          aria-label={noteLabel}
          title={noteLabel}
        />
      </div>
      {!rows.length && <p className="empty-copy">{emptyCopy || 'Chưa có mặt hàng nào trong danh mục kho.'}</p>}
      {rows.length > 0 && !visibleRows.length && <p className="empty-copy">Không có mặt hàng nào khớp bộ lọc hiện tại.</p>}
      {visibleRows.length > 0 && (
        <div className="stock-entry-head" aria-hidden="true">
          <span>Mặt hàng</span>
          <span>{mode === 'set' ? 'Tồn hệ thống' : 'Đang có'}</span>
          <span>{mode === 'set' ? 'Tồn thực tế' : 'Số lượng'}</span>
          <span />
          <span>{mode === 'in' ? 'Sau nhập' : mode === 'out' ? 'Còn lại' : 'Lệch'}</span>
        </div>
      )}
      <div className="stock-entry-list">
        {visibleRows.map((row) => (
          <StockEntryRow
            key={row.product.id}
            mode={mode}
            row={row}
            entry={entries[row.product.id]}
            planLine={outboundPlan?.lines.find((line) => line.product.id === row.product.id)}
            onEntry={onEntry}
            onFillFullStock={() => fillFullStock(row)}
          />
        ))}
      </div>
      <div className="stock-entry-footer">
        <div className="stock-entry-summary">
          <strong>{summary}</strong>
          {footerNote && <small>{footerNote}</small>}
        </div>
        <div className="stock-entry-footer-actions">
          {mode === 'out' && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => visibleRows.forEach((row) => hasStock(row.available) && fillFullStock(row))}
              disabled={!visibleRows.length}
            >
              ⇧ Xuất hết {visibleRows.length} mặt hàng đang xem
            </button>
          )}
          {mode === 'set' && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => visibleRows.forEach((row) => onEntry(row.product.id, { quantity: '0' }))}
              disabled={!visibleRows.length}
            >
              ⊘ Khai hết sạch cho {visibleRows.length} mặt hàng đang xem
            </button>
          )}
          <button type="button" className="secondary-button" onClick={onClear} disabled={!filledIds.size}>↺ Xóa số đã nhập</button>
          <button type="button" className="primary-button" onClick={onSave} disabled={saving}>{saving ? 'Đang lưu…' : saveLabel}</button>
        </div>
      </div>
    </section>
  )
}

function StockEntryRow({
  mode, row, entry, planLine, onEntry, onFillFullStock,
}: {
  mode: 'in' | 'out' | 'set'
  row: StockAvailability
  entry?: QuantityEntry
  planLine?: ReturnType<typeof planOutbound>['lines'][number]
  onEntry: (productId: string, patch: Partial<QuantityEntry>) => void
  onFillFullStock: () => void
}) {
  const { product, available } = row
  const packSize = mode === 'in' ? inboundPackSize(product) : undefined
  const canPickWeightUnit = product.unit === 'kg' && !packSize
  const unit = entry?.unit || defaultEntryUnit(product, available) || 'kg'
  const filled = hasQuantityInput(entry?.quantity)
  const { quantity: converted, conversionNote } = convertEntryToStockQuantity(
    product,
    { quantity: entry?.quantity || '', unit },
    { usePackSize: mode === 'in' },
  )
  const entered = parseQuantityInput(entry?.quantity)
  const [noteOpen, setNoteOpen] = useState(false)
  // Kết quả để ở dạng NGẮN (một cụm số) cho vừa một dòng; câu đầy đủ nằm ở tooltip.
  const resultValue = mode === 'in'
    ? formatStockAmount(available + converted, product.unit)
    : mode === 'out'
      ? formatStockAmount(planLine ? planLine.remaining : available - converted, product.unit)
      : filled
        ? formatDeltaAmount(roundQuantity(converted - available), product.unit)
        : '—'
  const resultTitle = mode === 'in'
    ? `Tồn sau khi nhập: ${resultValue}`
    : mode === 'out'
      ? `Còn lại sau phiếu: ${resultValue}`
      : filled ? `Chênh lệch so với tồn hệ thống: ${resultValue}` : 'Chưa khai — tồn giữ nguyên'
  const shortage = mode === 'out' && !planLine?.snapped && converted > roundQuantity(available)
  const willClear = mode === 'out' && filled && planLine !== undefined && planLine.remaining <= STOCK_EPSILON
  const hintText = [
    conversionNote,
    planLine?.snapped ? `Đã khớp đúng tồn ${formatStockAmount(planLine.available, product.unit)}` : '',
    shortage ? `Vượt tồn ${formatStockAmount(roundQuantity(converted - available), product.unit)} — lưu sẽ phải xác nhận.` : '',
    mode === 'in' && packSize && entered > 0 ? `Quy cách 1 ${inboundEntryUnit(product)} = ${formatQuantity(packSize)} ${product.unit}` : '',
  ].filter(Boolean).join(' · ')
  return (
    <article className={`stock-entry-row${filled ? ' filled' : ''}${shortage ? ' shortage' : ''}`}>
      <div className="stock-entry-id">
        <strong title={product.name}>{product.name}</strong>
        <small>{product.sku}</small>
      </div>
      {/* Hiện ĐỦ số lẻ: đây chính là chỗ trước đây cắt còn 2 chữ số làm ca trưởng xuất thiếu. */}
      <b className="stock-entry-current" title={mode === 'set' ? 'Tồn hệ thống' : 'Đang có trong kho'}>{formatStockAmount(available, product.unit)}</b>
      <div className="stock-entry-input">
        <input
          inputMode="decimal"
          value={entry?.quantity || ''}
          onChange={(event) => onEntry(product.id, { quantity: sanitizeQuantityInput(event.target.value), unit })}
          placeholder={mode === 'set' ? 'Tồn thật' : 'Số lượng'}
          aria-label={`${mode === 'set' ? 'Tồn thực tế' : 'Số lượng'} của ${product.name}`}
        />
        {canPickWeightUnit
          ? (
            <select value={unit} onChange={(event) => onEntry(product.id, { unit: event.target.value as EntryUnit })} aria-label={`Đơn vị nhập của ${product.name}`}>
              <option value="kg">kg</option>
              <option value="g">g</option>
            </select>
          )
          : <span className="unit-chip">{mode === 'in' ? inboundEntryUnit(product) : product.unit}</span>}
      </div>
      <div className="stock-entry-actions">
        {mode === 'out' && (
          <button type="button" className="chip-action" onClick={onFillFullStock} disabled={!hasStock(available)}>Hết</button>
        )}
        {mode === 'set' && (
          <button type="button" className="chip-action" onClick={() => onEntry(product.id, { quantity: '0' })} disabled={!hasStock(available)}>Hết sạch</button>
        )}
        {mode === 'set' && hasStock(available) && (
          <button type="button" className="chip-action ghost" onClick={onFillFullStock} title="Điền đúng số tồn hệ thống">= Tồn</button>
        )}
        <button
          type="button"
          className={noteOpen ? 'chip-action ghost active' : 'chip-action ghost'}
          onClick={() => setNoteOpen((value) => !value)}
          title="Ghi chú cho dòng này"
          aria-label={`Ghi chú dòng ${product.name}`}
        >
          ✎{entry?.note ? '•' : ''}
        </button>
        <button
          type="button"
          className="chip-action ghost"
          onClick={() => { onEntry(product.id, { quantity: '', note: '' }); setNoteOpen(false) }}
          disabled={!filled}
          title="Xóa số đã nhập ở dòng này"
          aria-label={`Xóa số đã nhập của ${product.name}`}
        >
          ×
        </button>
      </div>
      <div className={`stock-entry-result${shortage ? ' insufficient' : ''}${willClear ? ' cleared' : ''}`} title={resultTitle}>
        <b>{resultValue}</b>
        {willClear && <i>về 0</i>}
      </div>
      {hintText && <small className={shortage ? 'stock-entry-hintline insufficient' : 'stock-entry-hintline'}>{hintText}</small>}
      {noteOpen && (
        <input
          className="stock-entry-note"
          value={entry?.note || ''}
          onChange={(event) => onEntry(product.id, { note: event.target.value })}
          placeholder={`Ghi chú cho ${product.name}`}
          aria-label={`Ghi chú dòng ${product.name}`}
        />
      )}
    </article>
  )
}

/** Lịch sử phiếu SỬA TỒN — xóa phiếu là bỏ mốc kiểm kê, tồn quay lại cách tính cũ. */
function StockResetHistory({
  movements, saving, onDelete,
}: {
  movements: StockMovement[]
  saving: boolean
  onDelete: (rows: StockMovement[]) => void
}) {
  const groups = groupMovementDocuments(
    movements.filter((item) => item.type === 'count' && item.note.includes(STOCK_RESET_TAG)),
  )
  return (
    <section className="section-card compact-history">
      <div className="section-title">
        <div><span className="eyebrow dark">SỬA TỒN ĐÃ LƯU</span><h2>Lịch sử đặt lại tồn</h2></div>
        <span className="date-chip">{groups.length} phiếu</span>
      </div>
      {!groups.length && <p className="empty-copy">Chưa có phiếu sửa tồn trong kỳ đang xem.</p>}
      <div className="document-list">
        {groups.map(([id, rows]) => (
          <details className="document-card" key={id}>
            <summary className="document-summary">
              <div>
                <strong>Phiếu sửa tồn · {new Date(rows[0].createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</strong>
                <small>{rows.length} mặt hàng · chạm để xem chi tiết</small>
              </div>
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
            </summary>
            <div className="document-products">
              {rows.map((item) => {
                const product = productById(item.productId)
                return (
                  <span key={item.id}>
                    <strong>{product?.name || item.productId}</strong>
                    <b>{formatStockQuantity(item.quantity, product?.unit || '')}</b>
                    <small>{item.note.replace(STOCK_RESET_TAG, '').trim()}</small>
                  </span>
                )
              })}
            </div>
          </details>
        ))}
      </div>
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
  const [lines, setLines] = useState<InventoryCountFormLine[]>(() => defaultInventoryLines(stock))
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

  function updateLine(productId: string, patch: Partial<InventoryCountFormLine>) {
    setLines((items) => items.map((item) => item.productId === productId ? { ...item, ...patch } : item))
  }
  function addReportLine() {
    const productId = newProductId || availableProducts[0]?.id
    if (!productId) return
    setLines((items) => [...items, { productId, freezerQty: '', stockRoomQty: '', orderNeeded: '', note: '' }])
    setNewProductId('')
  }
  function removeReportLine(productId: string) {
    setLines((items) => items.filter((item) => item.productId !== productId))
  }

  async function save() {
    // "Đã kiểm đếm" = người dùng ĐÃ nhập số (kể cả "0" khi hàng hết sạch).
    // Ô để trống = chưa kiểm — không được ghi movement count cho dòng đó,
    // vì count là mốc reset tồn: ghi 0 cho dòng chưa đếm sẽ xoá oan tồn kho.
    const countedLines = lines.filter(isCountedFormLine)
    if (!countedLines.length) {
      onFeedback('Chưa có dòng nào được kiểm đếm. Hãy nhập số thực tế (nhập 0 nếu hàng đã hết) rồi lưu lại.')
      return
    }
    setSaving(true)
    const id = createId()
    const now = new Date().toISOString()
    const report: InventoryReport = {
      id, branchId: user.branchId, createdBy: user.id, createdAt: now,
      ...meta,
      lines: lines.map((line) => ({
        productId: line.productId,
        freezerQty: parseCountInput(line.freezerQty),
        stockRoomQty: parseCountInput(line.stockRoomQty),
        orderNeeded: parseCountInput(line.orderNeeded),
        note: line.note,
        counted: isCountedFormLine(line),
      })),
    }
    try {
      await ensureOperationDay(user, meta.reportDate)
      await saveInventoryReport(report, user)
      await addMovements(countedLines.map((line) => ({
        id: createId(),
        documentId: id,
        branchId: user.branchId,
        productId: line.productId,
        type: 'count' as const,
        quantity: parseCountInput(line.freezerQty) + parseCountInput(line.stockRoomQty),
        shiftDate: meta.reportDate,
        note: `Kho đông ${parseCountInput(line.freezerQty)}; Kho phòng ${parseCountInput(line.stockRoomQty)}; Cần đặt ${parseCountInput(line.orderNeeded)}. ${line.note}`,
        createdBy: user.id,
        createdAt: now,
      })), user)
      await onChanged()
      onFeedback(`Đã lưu phiếu kiểm kê: ${countedLines.length} mặt hàng đã kiểm đếm (bao gồm cả mặt hàng đếm được 0).`)
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
              {/* Giữ nguyên chuỗi người dùng gõ: "0" phải hiện là "0" (hàng đã hết),
                  ô trống = chưa kiểm. Đừng quay lại pattern `value || ''` — nó nuốt số 0. */}
              <td><input inputMode="decimal" placeholder="Chưa kiểm" value={line.freezerQty} onChange={(e) => updateLine(line.productId, { freezerQty: cleanNumber(e.target.value) })} /></td>
              <td><input inputMode="decimal" placeholder="Chưa kiểm" value={line.stockRoomQty} onChange={(e) => updateLine(line.productId, { stockRoomQty: cleanNumber(e.target.value) })} /></td>
              <td><input inputMode="decimal" value={line.orderNeeded} onChange={(e) => updateLine(line.productId, { orderNeeded: cleanNumber(e.target.value) })} /></td>
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
  lines: InventoryCountFormLine[]
  stock: ReturnType<typeof calculateStock>
}) {
  const visibleLines = lines.flatMap((line) => {
    const stockLine = stock.find((item) => item.product.id === line.productId)
    const product = productById(line.productId) || stockLine?.product
    return product ? [{ line, product, expected: stockLine?.expected || 0 }] : []
  })
  const countedLines = visibleLines.filter(({ line }) => isCountedFormLine(line))
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
            {/* Ô đã kiểm hiện đúng số đếm được — kể cả 0 (hết hàng). Ô trống = chưa kiểm. */}
            <strong>{line.freezerQty.trim() !== '' ? formatNumber(parseCountInput(line.freezerQty)) : '—'}</strong>
            <strong>{line.stockRoomQty.trim() !== '' ? formatNumber(parseCountInput(line.stockRoomQty)) : '—'}</strong>
            <strong className={parseCountInput(line.orderNeeded) > 0 ? 'warning' : ''}>{parseCountInput(line.orderNeeded) > 0 ? `${formatNumber(parseCountInput(line.orderNeeded))} ${product.unit}` : '—'}</strong>
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
  if (stockNeedsAttention(line)) return 0
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
    outbound: 'Xuất kho',
    outboundHint: 'Lấy hàng ra · Sửa tồn',
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

/** Nhãn nhận diện phiếu sửa tồn trong `note` (movement `count` cũng dùng cho kiểm kê thường). */
const STOCK_RESET_TAG = '[SỬA TỒN]'

/** Cập nhật ô nhập của MỘT sku, giữ nguyên đơn vị/ghi chú đã chọn trước đó. */
function entryUpdater(setEntries: React.Dispatch<React.SetStateAction<EntryMap>>) {
  return (productId: string, patch: Partial<QuantityEntry>) => {
    setEntries((current) => ({
      ...current,
      [productId]: { ...(current[productId] ?? { quantity: '' }), ...patch },
    }))
  }
}

const cleanNumber = sanitizeQuantityInput
/**
 * Số lượng hiển thị ĐỦ 3 chữ số thập phân đúng như `stock_movements.quantity`
 * numeric(14,3). Bản cũ `toFixed(2)` giấu mất phần lẻ thứ ba: tồn 5.123 kg hiện
 * "5.12 kg", ca trưởng xuất theo số nhìn thấy thì kho còn dư 0.003 kg (BUG kho
 * "xuất mãi không hết"). Đừng quay lại làm tròn 2 số ở lớp hiển thị kho.
 */
const formatNumber = formatQuantity

function formatDeltaAmount(value: number, unit: string) {
  return `${value > 0 ? '+' : ''}${formatStockAmount(value, unit)}`
}

function stockAvailability(line: ReturnType<typeof calculateStock>[number]): 'out' | 'packing-residue' | 'low' | 'good' {
  if (line.expected <= STOCK_EPSILON) return 'out'
  const packingOptions = PACKING_OPTIONS_BY_OUTPUT[line.product.id] || []
  const minimumPackingQuantity = packingOptions.length
    ? Math.min(...packingOptions.map((option) => option.sourceQuantity))
    : undefined
  if (minimumPackingQuantity !== undefined && line.expected + 0.0001 < minimumPackingQuantity) return 'packing-residue'
  if (line.expected <= line.product.lowStock) return 'low'
  return 'good'
}

function stockNeedsAttention(line: ReturnType<typeof calculateStock>[number]) {
  return stockAvailability(line) !== 'good'
}

const formatStockQuantity = formatStockAmount
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
// Phiếu kiểm kê đếm hàng thật trong kho: nguyên vật liệu + thành phẩm chế biến (hàng bàn giao).
// Bao bì đếm riêng, món trong menu bán không thuộc kho.
function isInventoryReportProduct(product: Product & { price?: number }) {
  if (product.category === 'packaging') return false
  return isWarehouseProduct(product)
}
/**
 * Dòng nhập liệu của phiếu kiểm kê giữ CHUỖI người dùng gõ, không phải số:
 * chuỗi rỗng = "chưa kiểm", còn "0" = "đã kiểm, hàng hết sạch". Nếu lưu number
 * thì hai trạng thái này dính làm một và số 0 bị nuốt (BUG kiểm kê không nhập được 0).
 */
type InventoryCountFormLine = {
  productId: string
  freezerQty: string
  stockRoomQty: string
  orderNeeded: string
  note: string
}
/** Chuỗi nhập → số lượng: rỗng/không hợp lệ = 0, không bao giờ âm (cleanNumber đã chặn dấu trừ). */
function parseCountInput(value: string) {
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}
/** Dòng ĐÃ được kiểm đếm = có nhập ít nhất một ô số lượng (kể cả nhập "0"). */
function isCountedFormLine(line: Pick<InventoryCountFormLine, 'freezerQty' | 'stockRoomQty'>) {
  return line.freezerQty.trim() !== '' || line.stockRoomQty.trim() !== ''
}
function defaultInventoryLines(stock: ReturnType<typeof calculateStock>): InventoryCountFormLine[] {
  return stock
    .filter((line) => isInventoryReportProduct(line.product) && line.expected > 0.0001)
    .map((line) => ({
      productId: line.product.id,
      freezerQty: '',
      stockRoomQty: '',
      orderNeeded: '',
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
