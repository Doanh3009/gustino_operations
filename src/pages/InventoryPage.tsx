import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { INBOUND_PRODUCTS, PACKING_OPTIONS_BY_OUTPUT, getInboundProducts, getProcessInputProducts, getProcessingOutputOptions, getProducts, productById } from '../lib/constants'
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
import {
  isStockManagedProduct,
  splitWarehouseLines,
  summarizeFinishedToday,
} from '../lib/warehouseScope'
import { addMovements, calculateStock, deleteMovements, ensureOperationDay, saveInventoryReport } from '../lib/store'
import { branchName as configuredBranchName } from '../lib/branches'
import { localDateKey } from '../lib/dates'
import { fetchConfiguredProducts } from '../lib/products'
import type {
  AppUser,
  InventoryReport,
  MovementType,
  Product,
  StockMovement,
} from '../types'
import type { InventoryTab, Page } from '../components/AppShell'

interface Props {
  user: AppUser
  movements: StockMovement[]
  /** Sổ kho đã tải xong chưa. Chưa xong thì KHÔNG được vẽ bảng tồn toàn số 0. */
  movementsStatus?: 'loading' | 'ready' | 'error'
  onChanged: () => Promise<void>
  initialTab?: InventoryTab
  onNavigate: (page: Page) => void
}

interface ProcessLine { id: string; productId: string; quantity: string }

/**
 * MỘT tầng điều hướng. Mọi việc của kho nằm trên cùng một thanh chip dính đỉnh
 * màn — không có tab con, không có thẻ chức năng chiếm nửa màn hình đầu.
 */
type InventoryMode = 'stock' | 'inbound' | 'processing' | 'outbound' | 'reset' | 'count'
type StockDisplayCategory = 'all' | 'raw' | 'packaging'
/** Bảng nhập liệu theo SKU: khoá là productId, không còn "dòng phiếu" phải tự thêm/xoá. */
type EntryMap = Record<string, QuantityEntry>

function modeFromTab(tab: InventoryTab): InventoryMode {
  if (tab === 'processing_out') return 'processing'
  if (tab === 'inbound') return 'inbound'
  if (tab === 'count') return 'count'
  return 'stock'
}

const MODE_LABELS: Record<InventoryMode, string> = {
  stock: 'Tồn kho',
  inbound: 'Nhập hàng',
  processing: 'Chế biến',
  outbound: 'Xuất kho',
  reset: 'Sửa tồn',
  count: 'Kiểm kê',
}

/**
 * SKU "hay dùng" của chi nhánh: có phát sinh trong 7 ngày gần nhất, xếp theo số
 * lần đụng tới. Mỗi ca chỉ động vào vài mặt hàng nhưng danh mục có 30+ SKU —
 * đưa nhóm này lên đầu là bỏ được đoạn cuộn tìm dài nhất của màn kho.
 */
function recentProductIds(movements: StockMovement[], today: string) {
  const since = new Date(`${today}T00:00:00`)
  since.setDate(since.getDate() - 7)
  const sinceKey = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`
  const hits = new Map<string, number>()
  movements.forEach((item) => {
    if (item.shiftDate < sinceKey) return
    hits.set(item.productId, (hits.get(item.productId) || 0) + 1)
  })
  return new Set(Array.from(hits.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([productId]) => productId))
}

const newProcessLine = (kind: 'input' | 'output'): ProcessLine => ({
  id: createId(),
  productId: kind === 'input' ? 'chestnut-roasted-bulk' : 'chestnut-cooked-kg',
  quantity: '',
})

export function InventoryPage({ user, movements, movementsStatus = 'ready', onChanged, initialTab = 'overview', onNavigate }: Props) {
  const canOperateInventory = ['admin', 'manager', 'shift_leader'].includes(user.role)
  const [mode, setMode] = useState<InventoryMode>(modeFromTab(initialTab))
  const [inboundEntries, setInboundEntries] = useState<EntryMap>({})
  const [voucherNote, setVoucherNote] = useState('')
  const [outboundEntries, setOutboundEntries] = useState<EntryMap>({})
  const [outboundNote, setOutboundNote] = useState('')
  const [resetEntries, setResetEntries] = useState<EntryMap>({})
  const [resetNote, setResetNote] = useState('')
  const [showHiddenInReset, setShowHiddenInReset] = useState(false)
  const [processInputs, setProcessInputs] = useState<ProcessLine[]>([newProcessLine('input')])
  const [processOutputs, setProcessOutputs] = useState<ProcessLine[]>([newProcessLine('output')])
  const [batchPhase, setBatchPhase] = useState<'opening' | 'additional'>('opening')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [productTick, setProductTick] = useState(0)
  const reportRef = useRef<HTMLDivElement>(null)
  const today = localDateKey()
  // Dropdown nguyên liệu nhập kho / chế biến lấy từ SKU admin cấu hình.
  const inboundProducts = useMemo(() => getInboundProducts(), [productTick])
  const processInputProducts = useMemo(() => getProcessInputProducts(), [productTick])
  const stock = useMemo(() => calculateStock(movements), [movements, productTick])
  /**
   * Bảng tồn sau khi loại thành phẩm + món menu + SKU đã tắt (`warehouseScope`).
   * `hiddenLines` là phần bị ẩn NHƯNG còn số dư — vẫn mở được ở màn Sửa tồn để
   * không lặp lại cái bẫy "mặt hàng biến mất khỏi màn là mất luôn đường sửa".
   */
  const { managed: warehouseStock, hidden: hiddenLines } = useMemo(
    () => splitWarehouseLines(stock),
    [stock],
  )
  const loadingStock = movementsStatus === 'loading' && !movements.length
  const [selectedDate, setSelectedDate] = useState(today)
  const availabilityByProduct = useMemo<StockAvailability[]>(
    () => warehouseStock.map((line) => ({ product: line.product, available: line.expected })),
    [warehouseStock],
  )
  const hiddenAvailability = useMemo<StockAvailability[]>(
    () => hiddenLines.map((line) => ({ product: line.product, available: line.expected })),
    [hiddenLines],
  )
  const inboundAvailability = useMemo<StockAvailability[]>(() => {
    const stockById = new Map(stock.map((line) => [line.product.id, line.expected]))
    const products = (inboundProducts.length ? inboundProducts : INBOUND_PRODUCTS)
      .filter((product) => isStockManagedProduct(product))
    return products.map((product) => ({ product, available: stockById.get(product.id) || 0 }))
  }, [inboundProducts, stock])
  const outboundAvailability = useMemo(
    () => availabilityByProduct.filter((line) => hasStock(line.available)),
    [availabilityByProduct],
  )
  const resetAvailability = useMemo(
    () => showHiddenInReset ? [...availabilityByProduct, ...hiddenAvailability] : availabilityByProduct,
    [availabilityByProduct, hiddenAvailability, showHiddenInReset],
  )
  const lowStockLines = warehouseStock.filter(stockNeedsAttention)
  const recentIds = useMemo(() => recentProductIds(movements, today), [movements, today])
  const todayMovements = useMemo(
    () => movements.filter((item) => item.shiftDate === today),
    [movements, today],
  )
  const availableDates = useMemo(() =>
    Array.from(new Set(movements.map((item) => item.shiftDate))).sort((a, b) => b.localeCompare(a)),
  [movements])
  const dayMovements = useMemo(
    () => movements.filter((item) => item.shiftDate === selectedDate),
    [movements, selectedDate],
  )

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
    setMode(modeFromTab(initialTab))
  }, [initialTab])

  async function makeSureDayIsOpen() {
    return ensureOperationDay(user, today)
  }

  const documentCount = (type: MovementType) =>
    new Set(todayMovements.filter((item) => item.type === type).map((item) => item.documentId || item.id)).size

  const totals = {
    inbound: documentCount('inbound'),
    outbound: documentCount('sale_out'),
    low: lowStockLines.length,
    count: documentCount('count'),
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
      setFeedback('Chưa chọn mặt hàng nào để xuất. Gõ số lượng hoặc bấm “Hết” ở mặt hàng cần lấy ra.')
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
    const lines = planStockReset(resetAvailability, resetEntries)
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
    if (batchDrafts.some(({ input, output }) => Number(output.quantity) > Number(input.quantity))) {
      setFeedback('Số lượng thành phẩm của mỗi mẻ không thể lớn hơn số lượng nguyên liệu.')
      return
    }
    setSaving(true)
    const now = new Date().toISOString()
    const phaseLabel = batchPhase === 'opening' ? 'Đầu ca' : 'Phát sinh'
    const rows: StockMovement[] = batchDrafts.flatMap(({ input, output }) => {
      const documentId = createId()
      const raw = Number(input.quantity)
      const cook = Number(output.quantity)
      const loss = raw - cook
      const batchRows: StockMovement[] = [
        {
          id: createId(), documentId, branchId: user.branchId, productId: input.productId,
          type: 'processing_out', quantity: raw, shiftDate: today,
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
      await addMovements(rows, user, { allowInsufficientStock })
      setProcessInputs([newProcessLine('input')])
      setProcessOutputs([newProcessLine('output')])
      setNote('')
      setBatchPhase('additional')
      setFeedback(`Đã lưu ${batchDrafts.length} mẻ rang/chế biến ${phaseLabel.toLowerCase()}.`)
      await onChanged()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Không thể lưu mẻ chế biến.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteMovementGroup(rows: StockMovement[], label: string) {
    const ids = new Set(rows.map((item) => item.id))
    const stockAfterDelete = calculateStock(movements.filter((item) => !ids.has(item.id)))
    const negative = stockAfterDelete.find((line) => isStockManagedProduct(line.product) && line.expected < -0.0001)
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
    const lines = warehouseStock.map((line) =>
      `• ${line.product.name}: ${formatStockAmount(line.expected, line.product.unit)}`,
    )
    navigator.clipboard.writeText([
      '📦 TỒN KHO GUSTINO',
      `📅 ${new Date().toLocaleDateString('vi-VN')} · ${configuredBranchName(user.branchId) || user.branchId}`,
      `👤 ${user.name}`,
      '—————————————',
      ...lines,
      '—————————————',
      `Sắp hết: ${totals.low} mặt hàng`,
    ].join('\n')).then(() => setFeedback('Đã sao chép bảng tồn kho.'))
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
      ? 'Đã hoàn tất chia sẻ ảnh kho.'
      : 'Trình duyệt đã nhận file ảnh kho. Hãy kiểm tra mục Tệp tải về.')
  }

  const visibleModes: InventoryMode[] = canOperateInventory
    ? ['stock', 'inbound', 'processing', 'outbound', 'reset', 'count']
    : ['stock', 'outbound']

  return (
    <div className="page wh">
      <header className="wh-head">
        <div className="wh-head-line">
          <b>Kho</b>
          <span title={configuredBranchName(user.branchId) || user.branchId}>
            {configuredBranchName(user.branchId) || user.branchId}
          </span>
          <em>{loadingStock ? 'đang tải…' : `${warehouseStock.length} mặt hàng${totals.low ? ` · ${totals.low} sắp hết` : ''}`}</em>
        </div>
        <nav className="wh-tabs" role="tablist" aria-label="Chức năng kho">
          {visibleModes.map((item) => (
            <button
              type="button"
              key={item}
              role="tab"
              aria-selected={mode === item}
              className={mode === item ? 'active' : ''}
              onClick={() => setMode(item)}
            >
              {MODE_LABELS[item]}
              {item === 'inbound' && totals.inbound ? <b>{totals.inbound}</b> : null}
              {item === 'outbound' && totals.outbound ? <b>{totals.outbound}</b> : null}
              {item === 'count' && totals.count ? <b>{totals.count}</b> : null}
            </button>
          ))}
        </nav>
      </header>

      {movementsStatus === 'error' && !movements.length && (
        <p className="wh-alert" role="alert">
          Chưa tải được sổ kho (mất mạng hoặc máy chủ bận). Số đang hiện KHÔNG phải tồn thật — đừng ghi phiếu lúc này.
        </p>
      )}
      {feedback && (
        <p className="wh-flash">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback('')} aria-label="Đóng thông báo">×</button>
        </p>
      )}

      {/* ── TỒN KHO ── */}
      {mode === 'stock' && (
        <StockOverview
          lines={warehouseStock}
          loading={loadingStock}
          finishedToday={summarizeFinishedToday(todayMovements, today)}
          onCopy={copyTextReport}
          onExport={() => void exportInfographic()}
        />
      )}

      {/* ── NHẬP HÀNG ── */}
      {mode === 'inbound' && canOperateInventory && <>
        <EntryList
          mode="in"
          title="Nhập hàng vào kho"
          hint="Gõ số ngay tại mặt hàng cần nhập. Cân ký: 5,123 kg = 5.123 kg — cân hiện 5123 gram thì đổi đơn vị sang g."
          rows={inboundAvailability}
          entries={inboundEntries}
          recentIds={recentIds}
          loading={loadingStock}
          note={voucherNote}
          noteLabel="Ghi chú chung / Nhà cung cấp / Người giao"
          saveLabel="Lưu phiếu nhập"
          saving={saving}
          onNote={setVoucherNote}
          onEntry={updateInboundEntry}
          onClear={() => setInboundEntries({})}
          onSave={saveInboundVoucher}
        />
        <DocumentLog
          title="Phiếu nhập hôm nay"
          rows={todayMovements.filter((item) => item.type === 'inbound')}
          saving={saving}
          onDelete={(rows) => deleteMovementGroup(rows, 'phiếu nhập kho')}
        />
      </>}

      {/* ── CHẾ BIẾN ── */}
      {mode === 'processing' && canOperateInventory && <>
        <FinishedTodayTable rows={summarizeFinishedToday(todayMovements, today)} />
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
          movements={todayMovements}
          saving={saving}
          onDelete={(rows) => deleteMovementGroup(rows, 'mẻ chế biến')}
        />
      </>}

      {/* ── XUẤT KHO ── */}
      {mode === 'outbound' && <>
        {canOperateInventory && (
          <EntryList
            mode="out"
            title="Lấy hàng ra khỏi kho"
            hint="Bấm “Hết” là lấy đúng số tồn thật (kể cả phần lẻ) — kho về 0 trong một lần."
            rows={outboundAvailability}
            entries={outboundEntries}
            recentIds={recentIds}
            loading={loadingStock}
            note={outboundNote}
            noteLabel="Ghi chú chung / Người nhận / Lý do xuất"
            saveLabel="Lưu phiếu xuất"
            saving={saving}
            emptyCopy="Kho hiện không còn mặt hàng nào có tồn để xuất."
            onNote={setOutboundNote}
            onEntry={updateOutboundEntry}
            onClear={() => setOutboundEntries({})}
            onSave={saveOutboundVoucher}
          />
        )}
        <DateFilterBar
          value={selectedDate}
          dates={availableDates}
          onChange={setSelectedDate}
        />
        <DocumentLog
          title="Phiếu xuất trong ngày đang xem"
          rows={dayMovements.filter((item) => item.type === 'sale_out')}
          saving={saving}
          canDelete={canOperateInventory}
          onDelete={(rows) => canOperateInventory && deleteMovementGroup(rows, 'phiếu xuất kho')}
        />
      </>}

      {/* ── SỬA TỒN ── */}
      {mode === 'reset' && canOperateInventory && <>
        <EntryList
          mode="set"
          title="Đặt lại tồn cho đúng thực tế"
          hint="Khai số đang có thật trong kho (gõ 0 nếu hết sạch). Hệ thống ghi một phiếu kiểm kê làm mốc — không cần xuất hết rồi nhập lại."
          rows={resetAvailability}
          entries={resetEntries}
          recentIds={recentIds}
          loading={loadingStock}
          note={resetNote}
          noteLabel="Lý do sửa tồn"
          saveLabel="Lưu phiếu sửa tồn"
          saving={saving}
          extraTool={hiddenLines.length > 0 ? (
            <button
              type="button"
              className={showHiddenInReset ? 'wh-chip active' : 'wh-chip'}
              onClick={() => setShowHiddenInReset((value) => !value)}
              title="Thành phẩm / mặt hàng đã tắt nhưng sổ kho vẫn còn số dư"
            >
              {showHiddenInReset ? '✓ Hàng đã ẩn' : `Hàng đã ẩn (${hiddenLines.length})`}
            </button>
          ) : null}
          onNote={setResetNote}
          onEntry={updateResetEntry}
          onClear={() => setResetEntries({})}
          onSave={saveStockReset}
        />
        <DateFilterBar
          value={selectedDate}
          dates={availableDates}
          onChange={setSelectedDate}
        />
        <DocumentLog
          title="Phiếu sửa tồn trong ngày đang xem"
          rows={dayMovements.filter((item) => item.type === 'count' && item.note.includes(STOCK_RESET_TAG))}
          saving={saving}
          onDelete={(rows) => deleteMovementGroup(rows, 'phiếu sửa tồn')}
        />
      </>}

      {/* ── KIỂM KÊ ── */}
      {mode === 'count' && canOperateInventory && (
        <InventoryReportForm
          user={user}
          stock={warehouseStock}
          productTick={productTick}
          onChanged={onChanged}
          onFeedback={setFeedback}
        />
      )}

      {mode === 'stock' && (
        <InventoryInfographic ref={reportRef} user={user} stock={warehouseStock} totals={totals} reportDate={today} />
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   TỒN KHO — bảng dòng phẳng, không thẻ. Mỗi mặt hàng đúng một dòng.
   ──────────────────────────────────────────────────────────────────────────── */

function StockOverview({
  lines, loading, finishedToday, onCopy, onExport,
}: {
  lines: ReturnType<typeof calculateStock>
  loading: boolean
  finishedToday: ReturnType<typeof summarizeFinishedToday>
  onCopy: () => void
  onExport: () => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<StockDisplayCategory>('all')
  const presentCategories = (['raw', 'packaging'] as const)
    .filter((value) => lines.some((line) => line.product.category === value))
  const activeCategory = category !== 'all' && presentCategories.includes(category as 'raw' | 'packaging')
    ? category
    : 'all'
  const sorted = [...lines].sort((a, b) =>
    stockPriority(a) - stockPriority(b) || a.product.name.localeCompare(b.product.name, 'vi'))
  const visible = sorted.filter((line) => {
    if (activeCategory !== 'all' && line.product.category !== activeCategory) return false
    return matchesProductQuery(line.product, query)
  })

  if (loading) return <SkeletonRows label="Đang tải tồn kho…" />

  return (
    <>
      <div className="wh-toolbar">
        <input
          className="wh-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="🔍 Tìm mặt hàng…"
          inputMode="search"
          aria-label="Tìm mặt hàng"
        />
        {presentCategories.length > 1 && (
          <select
            className="wh-select"
            value={activeCategory}
            onChange={(event) => setCategory(event.target.value as StockDisplayCategory)}
            aria-label="Lọc theo nhóm hàng"
          >
            <option value="all">Tất cả ({lines.length})</option>
            {presentCategories.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABELS[value]} ({lines.filter((line) => line.product.category === value).length})
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="wh-table">
        <div className="wh-tr wh-th" aria-hidden="true">
          <span>Mặt hàng</span>
          <span>Tồn</span>
          <span>Tình trạng</span>
        </div>
        {visible.map((line) => {
          const availability = stockAvailability(line)
          return (
            <div className={`wh-tr status-${availability}`} key={line.product.id}>
              <span className="wh-name">
                <strong>{line.product.name}</strong>
                <small>{line.product.sku} · {CATEGORY_LABELS[line.product.category as 'raw' | 'packaging'] || line.product.category}</small>
              </span>
              <span className="wh-num">{formatStockAmount(line.expected, line.product.unit)}</span>
              <span className="wh-state">{STOCK_STATE_LABELS[availability]}</span>
            </div>
          )
        })}
        {!visible.length && (
          <p className="wh-empty">
            {lines.length ? 'Không có mặt hàng nào khớp bộ lọc.' : 'Kho chưa có nguyên liệu hay bao bì nào.'}
          </p>
        )}
      </div>

      {/* Thành phẩm không còn là hàng tồn: nhìn theo NGÀY ở đây, không cộng dồn. */}
      <FinishedTodayTable rows={finishedToday} />

      <div className="wh-linkrow">
        <button type="button" onClick={onCopy}>▤ Sao chép bảng tồn</button>
        <button type="button" onClick={onExport}>▧ Xuất ảnh</button>
      </div>
    </>
  )
}

/**
 * THÀNH PHẨM HÔM NAY — thay cho cột tồn cộng dồn đã bị gỡ khỏi màn Kho.
 *
 * Chủ quán: thành phẩm không để dồn qua ngày, chỉ cần biết hôm nay chế biến bao
 * nhiêu và còn bao nhiêu. Bảng này chỉ đọc phiếu CỦA NGÀY, nên số âm tích lũy
 * trong sổ không kéo theo vào đây.
 */
function FinishedTodayTable({ rows }: { rows: ReturnType<typeof summarizeFinishedToday> }) {
  const detailed = rows.flatMap((row) => {
    const product = productById(row.productId)
    if (!product || product.category !== 'finished') return []
    return [{ row, product }]
  })
  if (!detailed.length) {
    return (
      <section className="wh-block">
        <h2 className="wh-blocktitle">Thành phẩm hôm nay</h2>
        <p className="wh-empty">Hôm nay chưa có mẻ chế biến nào. Thành phẩm tính theo ngày, không cộng dồn qua ngày.</p>
      </section>
    )
  }
  return (
    <section className="wh-block">
      <h2 className="wh-blocktitle">Thành phẩm hôm nay</h2>
      <div className="wh-table wh-table-4">
        <div className="wh-tr wh-th" aria-hidden="true">
          <span>Thành phẩm</span>
          <span>Chế biến</span>
          <span>Đã bán</span>
          <span>Còn lại</span>
        </div>
        {detailed.map(({ row, product }) => (
          <div className="wh-tr" key={row.productId}>
            <span className="wh-name"><strong>{product.name}</strong><small>{product.sku}</small></span>
            <span className="wh-num">{formatStockAmount(row.made, product.unit)}</span>
            <span className="wh-num">{formatStockAmount(row.sold + row.packed, product.unit)}</span>
            <span className={row.left < -0.0005 ? 'wh-num negative' : 'wh-num strong'}>
              {formatStockAmount(row.left, product.unit)}
            </span>
          </div>
        ))}
      </div>
      <p className="wh-hint">
        Chỉ tính phiếu trong ngày hôm nay. Thành phẩm không hiển thị ở bảng tồn kho vì không để dồn qua nhiều ngày —
        POS vẫn trừ bình thường sau mỗi lần bán.
      </p>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   BẢNG NHẬP LIỆU dùng chung cho nhập / xuất / sửa tồn.
   Dòng dày, không thẻ: điện thoại 2 hàng, máy tính 1 hàng.
   ──────────────────────────────────────────────────────────────────────────── */

function EntryList({
  mode, title, hint, rows, entries, recentIds, loading, note, noteLabel, saveLabel, saving,
  emptyCopy, extraTool, onNote, onEntry, onClear, onSave,
}: {
  mode: 'in' | 'out' | 'set'
  title: string
  hint: string
  rows: StockAvailability[]
  entries: EntryMap
  recentIds: Set<string>
  loading: boolean
  note: string
  noteLabel: string
  saveLabel: string
  saving: boolean
  emptyCopy?: string
  extraTool?: React.ReactNode
  onNote: (value: string) => void
  onEntry: (productId: string, patch: Partial<QuantityEntry>) => void
  onClear: () => void
  onSave: () => void
}) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  /**
   * Mỗi lúc chỉ MỘT dòng mở ô nhập.
   *
   * Bản trước bày ô nhập ở cả 30 dòng: màn hình toàn hộp trống cao 44px, phải
   * cuộn rất lâu mới thấy hết danh sách và không biết mình đang gõ dòng nào.
   * Thực tế một phiếu chỉ đụng 3–8 mặt hàng, nên danh sách để gọn cho dễ tìm,
   * chạm vào mặt hàng nào mới mở bàn phím số cho đúng mặt hàng đó.
   */
  const [openId, setOpenId] = useState('')
  const filledIds = new Set(rows
    .filter((row) => hasQuantityInput(entries[row.product.id]?.quantity))
    .map((row) => row.product.id))
  // Thứ tự cố định: đang nhập → hay dùng → còn tồn → phần còn lại.
  const rankOf = (row: StockAvailability) => filledIds.has(row.product.id) ? 0
    : recentIds.has(row.product.id) ? 1
      : hasStock(row.available) ? 2
        : 3
  const sortedRows = [...rows].sort((a, b) =>
    rankOf(a) - rankOf(b) || a.product.name.localeCompare(b.product.name, 'vi'))
  const searching = Boolean(query.trim())
  const shortlist = sortedRows.filter((row) => rankOf(row) < 3)
  const baseRows = showAll || searching || shortlist.length < 6 ? sortedRows : shortlist
  const visibleRows = baseRows.filter((row) => matchesProductQuery(row.product, query))
  const hiddenCount = sortedRows.length - baseRows.length
  const outboundPlan = useMemo(() => mode === 'out' ? planOutbound(rows, entries) : null, [mode, rows, entries])
  const resetLines = useMemo(() => mode === 'set' ? planStockReset(rows, entries) : [], [mode, rows, entries])
  const clearedCount = outboundPlan?.lines.filter((line) => line.remaining <= STOCK_EPSILON).length || 0

  /** Đổ số tồn thật vào ô nhập (nút "Hết") — lấy nguyên số lẻ, không làm tròn cho đẹp. */
  function fillFullStock(row: StockAvailability) {
    const unit = defaultEntryUnit(row.product, row.available)
    const rounded = roundQuantity(row.available)
    onEntry(row.product.id, {
      unit,
      quantity: quantityInputValue(unit === 'g' ? rounded * 1000 : rounded),
    })
  }

  const changedCount = mode === 'out'
    ? outboundPlan?.lines.length || 0
    : mode === 'set' ? resetLines.length : filledIds.size
  const summary = mode === 'out'
    ? `${changedCount} mặt hàng sẽ xuất${clearedCount ? ` · ${clearedCount} về 0` : ''}`
    : mode === 'set'
      ? `${changedCount} mặt hàng đổi tồn`
      : `${changedCount} mặt hàng sẽ nhập`

  if (loading) return <SkeletonRows label="Đang tải tồn kho…" />

  return (
    <section className="wh-entry">
      <h2 className="wh-blocktitle">{title}</h2>
      <p className="wh-hint">{hint}</p>

      <div className="wh-toolbar">
        <input
          className="wh-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="🔍 Tìm mặt hàng…"
          inputMode="search"
          aria-label="Tìm mặt hàng"
        />
        {mode === 'out' && (
          <button
            type="button"
            className="wh-chip"
            onClick={() => visibleRows.forEach((row) => hasStock(row.available) && fillFullStock(row))}
            disabled={!visibleRows.length}
          >⇧ Hết tất cả</button>
        )}
        {extraTool}
      </div>

      {!rows.length && <p className="wh-empty">{emptyCopy || 'Chưa có mặt hàng nào trong danh mục kho.'}</p>}
      {rows.length > 0 && !visibleRows.length && <p className="wh-empty">Không có mặt hàng nào khớp từ khóa.</p>}

      {visibleRows.length > 0 && (
        <div className="wh-etable">
          <div className="wh-etr wh-th" aria-hidden="true">
            <span>Mặt hàng</span>
            <span>{mode === 'set' ? 'Tồn hệ thống' : 'Đang có'}</span>
            <span>{mode === 'set' ? 'Tồn thực tế' : 'Số lượng'}</span>
          </div>
          {visibleRows.map((row) => (
            <EntryRow
              key={row.product.id}
              mode={mode}
              row={row}
              entry={entries[row.product.id]}
              recent={recentIds.has(row.product.id)}
              open={openId === row.product.id}
              planLine={outboundPlan?.lines.find((line) => line.product.id === row.product.id)}
              onOpen={() => setOpenId((current) => current === row.product.id ? '' : row.product.id)}
              onEntry={onEntry}
              onFillFullStock={() => fillFullStock(row)}
            />
          ))}
        </div>
      )}

      {hiddenCount > 0 && !searching && (
        <button type="button" className="wh-more" onClick={() => setShowAll(true)}>
          Hiện thêm {hiddenCount} mặt hàng ít dùng
        </button>
      )}
      {showAll && !searching && (
        <button type="button" className="wh-more" onClick={() => setShowAll(false)}>
          Thu gọn về mặt hàng hay dùng
        </button>
      )}

      {noteOpen && (
        <input
          className="wh-notefield"
          value={note}
          onChange={(event) => onNote(event.target.value)}
          placeholder={noteLabel}
          aria-label={noteLabel}
          autoFocus
        />
      )}

      {/* Thanh lưu dính đáy: bấm lưu được ở BẤT KỲ vị trí cuộn nào. */}
      <div className="wh-savebar">
        <span className="wh-savebar-text">{summary}</span>
        <button
          type="button"
          className={noteOpen || note ? 'wh-chip active' : 'wh-chip'}
          onClick={() => setNoteOpen((value) => !value)}
          title={noteLabel}
        >✎{note ? ' •' : ''}</button>
        <button type="button" className="wh-chip" onClick={onClear} disabled={!filledIds.size}>↺</button>
        <button
          type="button"
          className="wh-save"
          onClick={onSave}
          disabled={saving || !changedCount}
        >{saving ? 'Đang lưu…' : `${saveLabel}${changedCount ? ` (${changedCount})` : ''}`}</button>
      </div>
    </section>
  )
}

/** Bước cộng/trừ nhanh: hàng cân ký nhảy 0,5; hàng đếm cái/túi nhảy 1 đơn vị. */
function quickStepFor(product: Product, unit: EntryUnit | undefined, packSize?: number) {
  if (packSize) return 1
  if (unit === 'g') return 100
  return product.unit === 'kg' ? 0.5 : 1
}

function EntryRow({
  mode, row, entry, recent, open, planLine, onOpen, onEntry, onFillFullStock,
}: {
  mode: 'in' | 'out' | 'set'
  row: StockAvailability
  entry?: QuantityEntry
  recent?: boolean
  open: boolean
  planLine?: ReturnType<typeof planOutbound>['lines'][number]
  onOpen: () => void
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
  const resultValue = mode === 'in'
    ? formatStockAmount(available + converted, product.unit)
    : mode === 'out'
      ? formatStockAmount(planLine ? planLine.remaining : available - converted, product.unit)
      : filled
        ? formatDeltaAmount(roundQuantity(converted - available), product.unit)
        : '—'
  const shortage = mode === 'out' && !planLine?.snapped && converted > roundQuantity(available)
  const willClear = mode === 'out' && filled && planLine !== undefined && planLine.remaining <= STOCK_EPSILON
  const hintText = [
    conversionNote,
    planLine?.snapped ? `Đã khớp đúng tồn ${formatStockAmount(planLine.available, product.unit)}` : '',
    shortage ? `Vượt tồn ${formatStockAmount(roundQuantity(converted - available), product.unit)} — lưu sẽ phải xác nhận.` : '',
    mode === 'in' && packSize && entered > 0 ? `Quy cách 1 ${inboundEntryUnit(product)} = ${formatQuantity(packSize)} ${product.unit}` : '',
  ].filter(Boolean).join(' · ')
  // Cộng/trừ nhanh bằng ngón cái: phần lớn thao tác kho là "thêm 1 túi", "bớt
  // nửa ký" — không đáng phải bật bàn phím số và gõ lại cả con số.
  const step = quickStepFor(product, unit, packSize)
  function bumpQuantity(delta: number) {
    const next = Math.max(0, roundQuantity((entered || 0) + delta))
    onEntry(product.id, { unit, quantity: next > 0 ? quantityInputValue(next) : '' })
  }
  const enteredLabel = filled
    ? `${entry?.quantity} ${mode === 'in' ? inboundEntryUnit(product) : unit}`
    : ''
  return (
    <div className={`wh-etr${filled ? ' filled' : ''}${shortage ? ' shortage' : ''}${open ? ' open' : ''}`}>
      {/* Hàng gọn: tên · tồn · số đã nhập. Chạm vào là mở bàn phím số cho ĐÚNG
          mặt hàng này — không bày 30 ô trống ra màn hình cùng lúc. */}
      <button type="button" className="wh-pickrow" onClick={onOpen} aria-expanded={open}>
        <span className="wh-name">
          <strong>{product.name}</strong>
          <small>{product.sku}{recent ? ' · hay dùng' : ''}</small>
        </span>
        {/* Hiện ĐỦ số lẻ: đây chính là chỗ trước đây cắt còn 2 chữ số làm ca trưởng xuất thiếu. */}
        <span className="wh-num wh-have">{formatStockAmount(available, product.unit)}</span>
        <span className={filled ? 'wh-pick set' : 'wh-pick'}>{filled ? enteredLabel : '＋'}</span>
      </button>

      {open && (
        <div className="wh-edit">
          <span className="wh-input">
            <button
              type="button"
              className="wh-step"
              onClick={() => bumpQuantity(-step)}
              disabled={!filled}
              aria-label={`Bớt ${step} ở ${product.name}`}
            >−</button>
            <input
              inputMode="decimal"
              autoFocus
              value={entry?.quantity || ''}
              onChange={(event) => onEntry(product.id, { quantity: sanitizeQuantityInput(event.target.value), unit })}
              placeholder={mode === 'set' ? 'Tồn thật' : '0'}
              aria-label={`${mode === 'set' ? 'Tồn thực tế' : 'Số lượng'} của ${product.name}`}
            />
            <button
              type="button"
              className="wh-step"
              onClick={() => bumpQuantity(step)}
              aria-label={`Thêm ${step} ở ${product.name}`}
            >+</button>
            {canPickWeightUnit
              ? (
                <select
                  value={unit}
                  onChange={(event) => onEntry(product.id, { unit: event.target.value as EntryUnit })}
                  aria-label={`Đơn vị nhập của ${product.name}`}
                >
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                </select>
              )
              : <b className="wh-unit">{mode === 'in' ? inboundEntryUnit(product) : product.unit}</b>}
          </span>
          <span className="wh-rowactions">
            {mode === 'out' && (
              <button type="button" className="wh-chip small" onClick={onFillFullStock} disabled={!hasStock(available)}>Hết</button>
            )}
            {mode === 'set' && (
              <button type="button" className="wh-chip small" onClick={() => onEntry(product.id, { quantity: '0' })}>Hết sạch</button>
            )}
            {mode === 'set' && hasStock(available) && (
              <button type="button" className="wh-chip small" onClick={onFillFullStock} title="Điền đúng số tồn hệ thống">= Tồn</button>
            )}
            {filled && <>
              <button
                type="button"
                className={noteOpen ? 'wh-chip small active' : 'wh-chip small'}
                onClick={() => setNoteOpen((value) => !value)}
                aria-label={`Ghi chú dòng ${product.name}`}
              >✎{entry?.note ? '•' : ''}</button>
              <button
                type="button"
                className="wh-chip small"
                onClick={() => { onEntry(product.id, { quantity: '', note: '' }); setNoteOpen(false) }}
                aria-label={`Xóa số đã nhập của ${product.name}`}
              >×</button>
            </>}
            <button type="button" className="wh-chip small done" onClick={onOpen}>Xong</button>
          </span>
          {filled && (
            <span className={`wh-result${shortage ? ' insufficient' : ''}${willClear ? ' cleared' : ''}`}>
              {resultValue}{willClear ? ' ✓' : ''}
            </span>
          )}
          {hintText && <small className={shortage ? 'wh-rowhint insufficient' : 'wh-rowhint'}>{hintText}</small>}
          {noteOpen && (
            <input
              className="wh-rownote"
              value={entry?.note || ''}
              onChange={(event) => onEntry(product.id, { note: event.target.value })}
              placeholder={`Ghi chú cho ${product.name}`}
              aria-label={`Ghi chú dòng ${product.name}`}
            />
          )}
        </div>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Nhật ký chứng từ — một phiếu là một dòng mở ra, không phải thẻ.
   ──────────────────────────────────────────────────────────────────────────── */

function DocumentLog({
  title, rows, saving, canDelete = true, onDelete,
}: {
  title: string
  rows: StockMovement[]
  saving: boolean
  canDelete?: boolean
  onDelete: (rows: StockMovement[]) => void
}) {
  const groups = groupMovementDocuments(rows)
  return (
    <section className="wh-block">
      <h2 className="wh-blocktitle">{title}<i>{groups.length} phiếu</i></h2>
      {!groups.length && <p className="wh-empty">Chưa có phiếu nào.</p>}
      <div className="wh-doclist">
        {groups.map(([id, docRows]) => (
          <details className="wh-doc" key={id}>
            <summary>
              <span>
                <strong>{new Date(docRows[0].createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</strong>
                <small>{docRows.length} mặt hàng</small>
              </span>
              {canDelete && (
                <button
                  type="button"
                  className="wh-del"
                  disabled={saving}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onDelete(docRows)
                  }}
                >Xóa</button>
              )}
            </summary>
            <div className="wh-docbody">
              {docRows.map((item) => {
                const product = productById(item.productId)
                return (
                  <div className="wh-tr" key={item.id}>
                    <span className="wh-name"><strong>{product?.name || item.productId}</strong><small>{item.note || '—'}</small></span>
                    <span className="wh-num">{formatStockAmount(item.quantity, product?.unit || '')}</span>
                  </div>
                )
              })}
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

function DateFilterBar({
  value, dates, onChange,
}: {
  value: string
  dates: string[]
  onChange: (value: string) => void
}) {
  return (
    <div className="wh-toolbar wh-daterow">
      <label className="wh-datelabel">
        Ngày xem
        <input type="date" value={value} onChange={(event) => onChange(event.target.value)} />
      </label>
      {dates[0] && dates[0] !== value && (
        <button type="button" className="wh-chip" onClick={() => onChange(dates[0])}>
          Ngày gần nhất ({formatDate(dates[0])})
        </button>
      )}
    </div>
  )
}

function SkeletonRows({ label }: { label: string }) {
  return (
    <div className="wh-skeleton" role="status" aria-live="polite">
      <p>{label}</p>
      {[0, 1, 2, 3, 4].map((index) => <span key={index} />)}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Chế biến
   ──────────────────────────────────────────────────────────────────────────── */

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

  return (
    <section className="wh-entry">
      <h2 className="wh-blocktitle">Rang / chế biến<i>{inputs.length} mẻ</i></h2>
      <div className="wh-toolbar">
        <select
          className="wh-select"
          value={phase}
          onChange={(event) => onPhase(event.target.value as 'opening' | 'additional')}
          aria-label="Loại mẻ"
        >
          <option value="opening">Mẻ đầu ca</option>
          <option value="additional">Mẻ phát sinh</option>
        </select>
        <button
          type="button"
          className="wh-chip"
          onClick={() => {
            onInputs([...inputs, newProcessLine('input')])
            onOutputs([...outputs, newProcessLine('output')])
          }}
        >＋ Thêm mẻ</button>
      </div>

      <div className="wh-batchlist">
        {inputs.map((input, index) => {
          const output = outputs[index]
          const inputProduct = inputProducts.find((product) => product.id === input.productId) || inputProducts[0]
          const outputProduct = outputOptions(input.productId).find((product) => product.id === output?.productId)
            || outputOptions(input.productId)[0]
          const raw = Number(input.quantity || 0)
          const cook = Number(output?.quantity || 0)
          const lossRate = raw > 0 ? (raw - cook) / raw * 100 : 0
          const available = stock.find((line) => line.product.id === input.productId)?.expected || 0
          const requested = inputs
            .filter((line) => line.productId === input.productId)
            .reduce((sum, line) => sum + Number(line.quantity || 0), 0)
          return (
            <div className="wh-batch" key={input.id}>
              <div className="wh-batchhead">
                <strong>Mẻ {index + 1}</strong>
                {inputs.length > 1 && (
                  <button
                    type="button"
                    className="wh-chip small"
                    onClick={() => {
                      onInputs(inputs.filter((_, i) => i !== index))
                      onOutputs(outputs.filter((_, i) => i !== index))
                    }}
                    aria-label={`Xóa mẻ ${index + 1}`}
                  >×</button>
                )}
              </div>
              <div className="wh-batchrow">
                <label>Lấy ra
                  <select value={input.productId} onChange={(event) => updateInput(index, { productId: event.target.value })}>
                    {inputProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                  </select>
                </label>
                <span className="wh-input">
                  <input
                    inputMode="decimal"
                    value={input.quantity}
                    onChange={(event) => updateInput(index, { quantity: cleanNumber(event.target.value) })}
                    placeholder="0"
                    aria-label={`Số lượng nguyên liệu mẻ ${index + 1}`}
                  />
                  <b className="wh-unit">{inputProduct?.unit || 'kg'}</b>
                </span>
              </div>
              <small className={requested > available ? 'wh-rowhint insufficient' : 'wh-rowhint'}>
                Tồn {formatStockAmount(available, inputProduct?.unit || 'kg')} · mẻ dùng {formatNumber(requested)}
              </small>
              <div className="wh-batchrow">
                <label>Thành phẩm
                  <select value={output?.productId} onChange={(event) => updateOutput(index, { productId: event.target.value })}>
                    {outputOptions(input.productId).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                  </select>
                </label>
                <span className="wh-input">
                  <input
                    inputMode="decimal"
                    value={output?.quantity || ''}
                    onChange={(event) => updateOutput(index, { quantity: cleanNumber(event.target.value) })}
                    placeholder="0"
                    aria-label={`Khối lượng thành phẩm mẻ ${index + 1}`}
                  />
                  <b className="wh-unit">{outputProduct?.unit || 'kg'}</b>
                </span>
              </div>
              <small className={lossRate > 15 ? 'wh-rowhint insufficient' : 'wh-rowhint'}>
                Hao hụt {formatNumber(Math.max(0, raw - cook))} {inputProduct?.unit || 'kg'} · {Math.max(0, lossRate).toFixed(1)}%
              </small>
            </div>
          )
        })}
      </div>

      <input
        className="wh-notefield"
        value={note}
        onChange={(event) => onNote(event.target.value)}
        placeholder="Ghi chú mẻ (không bắt buộc)"
        aria-label="Ghi chú mẻ chế biến"
      />

      <div className="wh-savebar">
        <span className="wh-savebar-text">
          Vào {formatNumber(totalRaw)} · ra {formatNumber(totalCook)} · hao {Math.max(0, totalLoss).toFixed(1)}%
        </span>
        <button type="button" className="wh-save" onClick={onSave} disabled={saving}>
          {saving ? 'Đang lưu…' : '✓ Lưu mẻ'}
        </button>
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
  const batches = groupMovementDocuments(movements)
    .filter(([, rows]) => rows.some((item) => item.type === 'processing_out'))
  return (
    <section className="wh-block">
      <h2 className="wh-blocktitle">Mẻ đã chế biến hôm nay<i>{batches.length} mẻ</i></h2>
      {!batches.length && <p className="wh-empty">Chưa có mẻ nào hôm nay.</p>}
      <div className="wh-doclist">
        {batches.map(([id, rows], index) => {
          const inputs = rows.filter((item) => item.type === 'processing_out')
          const outputs = rows.filter((item) => item.type === 'processing_in')
          const loss = rows.find((item) => item.type === 'waste')
          const phase = rows[0]?.note.includes('[Đầu ca]') ? 'Đầu ca' : 'Phát sinh'
          return (
            <details className="wh-doc" key={id}>
              <summary>
                <span>
                  <strong>Mẻ #{batches.length - index} · {phase}</strong>
                  <small>{new Date(rows[0]?.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small>
                </span>
                <button
                  type="button"
                  className="wh-del"
                  disabled={saving}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onDelete(rows)
                  }}
                >Xóa</button>
              </summary>
              <div className="wh-docbody">
                {inputs.map((item) => {
                  const product = productById(item.productId)
                  return (
                    <div className="wh-tr" key={item.id}>
                      <span className="wh-name"><strong>{product?.name || item.productId}</strong><small>lấy từ kho</small></span>
                      <span className="wh-num">−{formatStockAmount(item.quantity, product?.unit || '')}</span>
                    </div>
                  )
                })}
                {outputs.map((item) => {
                  const product = productById(item.productId)
                  return (
                    <div className="wh-tr" key={item.id}>
                      <span className="wh-name"><strong>{product?.name || item.productId}</strong><small>thành phẩm</small></span>
                      <span className="wh-num strong">+{formatStockAmount(item.quantity, product?.unit || '')}</span>
                    </div>
                  )
                })}
                {loss && (
                  <div className="wh-tr">
                    <span className="wh-name"><strong>Hao hụt</strong><small>{loss.note}</small></span>
                    <span className="wh-num">{formatStockAmount(loss.quantity, productById(loss.productId)?.unit || '')}</span>
                  </div>
                )}
              </div>
            </details>
          )
        })}
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Kiểm kê — giữ nguyên phiếu giấy in/xuất ảnh (đây là chứng từ, không phải màn
   thao tác nhanh), chỉ đổi danh mục sang đúng hàng kho đang quản.
   ──────────────────────────────────────────────────────────────────────────── */

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
  const reportProducts = useMemo(() => getProducts().filter(isStockManagedProduct), [productTick])
  const [lines, setLines] = useState<InventoryCountFormLine[]>(() => defaultInventoryLines(stock))
  const [newProductId, setNewProductId] = useState('')
  const [saving, setSaving] = useState(false)
  const [exportingImage, setExportingImage] = useState(false)
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
    <section className="wh-entry">
      <h2 className="wh-blocktitle">Kiểm kê kho<i>{lines.length} dòng</i></h2>
      <p className="wh-hint">
        Đếm nguyên liệu và bao bì thật trong kho. Ô để trống = chưa kiểm; gõ 0 nghĩa là đã kiểm và hết sạch.
        Thành phẩm không nằm ở đây — thành phẩm chốt theo ca ở màn Bàn giao.
      </p>
      <div className="wh-toolbar">
        <label className="wh-datelabel">Ngày
          <input type="date" value={meta.reportDate} onChange={(e) => setMeta({ ...meta, reportDate: e.target.value })} />
        </label>
        <input
          className="wh-search"
          value={meta.reporter}
          onChange={(e) => setMeta({ ...meta, reporter: e.target.value })}
          placeholder="Người kiểm"
          aria-label="Người kiểm"
        />
      </div>
      <div className="wh-etable wh-counttable">
        <div className="wh-etr wh-th" aria-hidden="true">
          <span>Mặt hàng</span><span>Hệ thống</span><span>Kho đông</span><span>Kho phòng</span><span>Cần đặt</span>
        </div>
        {lines.map((line) => {
          const product = productById(line.productId) || stock.find((item) => item.product.id === line.productId)?.product
          if (!product) return null
          const expected = stock.find((item) => item.product.id === line.productId)?.expected || 0
          return (
            <div className="wh-etr" key={line.productId}>
              <span className="wh-name"><strong>{product.name}</strong><small>{product.sku} · {product.unit}</small></span>
              <span className="wh-num wh-have">{formatStockAmount(expected, product.unit)}</span>
              {/* Giữ nguyên chuỗi người dùng gõ: "0" phải hiện là "0" (hàng đã hết),
                  ô trống = chưa kiểm. Đừng quay lại pattern `value || ''` — nó nuốt số 0. */}
              <span className="wh-input">
                <input inputMode="decimal" placeholder="Chưa kiểm" value={line.freezerQty} onChange={(e) => updateLine(line.productId, { freezerQty: cleanNumber(e.target.value) })} aria-label={`Kho đông ${product.name}`} />
              </span>
              <span className="wh-input">
                <input inputMode="decimal" placeholder="Chưa kiểm" value={line.stockRoomQty} onChange={(e) => updateLine(line.productId, { stockRoomQty: cleanNumber(e.target.value) })} aria-label={`Kho phòng ${product.name}`} />
              </span>
              <span className="wh-input">
                <input inputMode="decimal" placeholder="0" value={line.orderNeeded} onChange={(e) => updateLine(line.productId, { orderNeeded: cleanNumber(e.target.value) })} aria-label={`Cần đặt ${product.name}`} />
                <button type="button" className="wh-chip small" onClick={() => removeReportLine(line.productId)} aria-label={`Bỏ dòng ${product.name}`}>×</button>
              </span>
            </div>
          )
        })}
        {!lines.length && <p className="wh-empty">Chưa có hàng nào đang tồn. Thêm dòng bên dưới nếu cần kiểm kê bổ sung.</p>}
      </div>
      <div className="wh-toolbar">
        <select className="wh-select" value={newProductId} onChange={(event) => setNewProductId(event.target.value)} disabled={!availableProducts.length} aria-label="Chọn mặt hàng thêm vào phiếu">
          <option value="">Thêm mặt hàng…</option>
          {availableProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        <button type="button" className="wh-chip" onClick={addReportLine} disabled={!availableProducts.length}>＋ Thêm dòng</button>
        <button type="button" className="wh-chip" onClick={() => void saveInventoryCountImage()} disabled={exportingImage}>
          {exportingImage ? 'Đang tạo ảnh…' : '▧ Ảnh phiếu'}
        </button>
      </div>
      <div className="wh-savebar">
        <span className="wh-savebar-text">{lines.filter(isCountedFormLine).length} mặt hàng đã kiểm</span>
        <button type="button" className="wh-save" onClick={save} disabled={saving}>
          {saving ? 'Đang lưu…' : '✓ Lưu phiếu kiểm kê'}
        </button>
      </div>
    </section>
    <InventoryCountPoster posterRef={posterRef} user={user} meta={meta} lines={lines} stock={stock} />
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
            <strong>{formatStockAmount(expected, product.unit)}</strong>
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

/* ──────────────────────────────────────────────────────────────────────────── */

const CATEGORY_LABELS = { raw: 'Nguyên liệu', packaging: 'Bao bì' } as const
const STOCK_STATE_LABELS = {
  out: 'Hết hàng',
  // Hàng rời còn ít hơn một quy cách đóng gói: KHÔNG được đọc là "đủ bán".
  'packing-residue': 'Còn dư, chưa đủ đóng gói',
  low: 'Sắp hết',
  good: 'Đủ dùng',
} as const

function stockPriority(line: ReturnType<typeof calculateStock>[number]) {
  if (stockNeedsAttention(line)) return 0
  if (line.product.category === 'raw') return 1
  return 2
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
 * Số lượng hiển thị ĐỦ 3 chữ số thập phân đúng như `stock_movements.quantity`.
 * Bản cũ `toFixed(2)` giấu mất phần lẻ thứ ba: tồn 5.123 kg hiện "5.12 kg", ca
 * trưởng xuất theo số nhìn thấy thì kho còn dư 0.003 kg. Đừng quay lại làm tròn
 * 2 số ở lớp hiển thị kho.
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

function formatDate(value: string) {
  const [year, month, day] = value.split('-')
  return day && month && year ? `${day}/${month}/${year}` : value
}

/**
 * Dòng nhập liệu của phiếu kiểm kê giữ CHUỖI người dùng gõ, không phải số:
 * chuỗi rỗng = "chưa kiểm", còn "0" = "đã kiểm, hàng hết sạch". Nếu lưu number
 * thì hai trạng thái này dính làm một và số 0 bị nuốt.
 */
type InventoryCountFormLine = {
  productId: string
  freezerQty: string
  stockRoomQty: string
  orderNeeded: string
  note: string
}
/** Chuỗi nhập → số lượng: rỗng/không hợp lệ = 0, không bao giờ âm. */
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
    .filter((line) => isStockManagedProduct(line.product) && line.expected > 0.0001)
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
    <div className="info-header"><div><span>GUSTINO · VẬN HÀNH KHO</span><h2>BÁO CÁO TỒN KHO</h2><p>Nguyên liệu và bao bì đang có trong kho</p></div><strong>{new Date(`${reportDate}T00:00:00`).toLocaleDateString('vi-VN')}</strong></div>
    <div className="info-identity">
      <div><span>CHI NHÁNH</span><strong>{configuredBranchName(user.branchId) || user.branchId}</strong></div>
      <div><span>NGƯỜI LẬP BÁO CÁO</span><strong>{user.name}</strong></div>
    </div>
    <div className="info-metrics"><div><span>Mặt hàng có tồn</span><strong>{stock.filter((line) => line.expected > 0.0001).length}</strong></div><div><span>Nhập trong ngày</span><strong>{totals.inbound}</strong></div><div><span>Xuất trong ngày</span><strong>{totals.outbound}</strong></div><div className={totals.low ? 'warning' : ''}><span>Cần chú ý</span><strong>{totals.low}</strong></div></div>
    <div className="info-table"><div className="head"><span>HÀNG HÓA</span><strong>TỒN HIỆN TẠI</strong></div>{stock.map((line, index) => <div key={line.product.id}><span><i>{index + 1}</i><b>{line.product.name}</b><small>{line.product.sku}</small></span><strong>{formatStockAmount(line.expected, line.product.unit)}</strong></div>)}</div>
    <footer><span>Ngày báo cáo: {new Date(`${reportDate}T00:00:00`).toLocaleDateString('vi-VN')}</span><span>GUSTINO · HỆ THỐNG VẬN HÀNH</span></footer>
  </div>
))
