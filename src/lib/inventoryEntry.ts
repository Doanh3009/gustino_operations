import type { Product } from '../types'

/**
 * Lớp tính toán cho màn NHẬP / XUẤT / SỬA TỒN kho.
 *
 * Vì sao tách riêng khỏi `InventoryPage.tsx`: đây là phần dễ sai nhất của kho
 * (làm tròn, đổi đơn vị, số dư lẻ) nên phải là hàm thuần để test được bằng
 * `scripts/test-inventory-entry-redesign.mjs`.
 *
 * BỐI CẢNH LỖI CŨ (ca trưởng báo 05/08/2026): kho sai số, ca trưởng xuất hết ra
 * để nhập lại nhưng màn hình chỉ hiện 2 chữ số thập phân (5.123 kg hiện "5.12 kg").
 * Gõ đúng số nhìn thấy thì kho còn dư 0.003 kg → phải xuất đi xuất lại nhiều lần.
 * Cách chữa: (1) hiển thị đủ 3 chữ số như DB lưu, (2) nút "Xuất hết" lấy đúng số
 * tồn thật, (3) tự khớp về 0 khi số gõ chỉ lệch mức làm tròn, (4) có chức năng
 * "Sửa tồn" đặt thẳng số đúng thay vì phải xuất rồi nhập lại.
 */

/** `stock_movements.quantity` là numeric(14,3) → mọi số lượng đều là bội của 0,001. */
export const QUANTITY_DECIMALS = 3
/** Nhỏ hơn nửa đơn vị cuối cùng của DB thì coi như bằng 0 (không phải "còn dư"). */
export const STOCK_EPSILON = 0.0005
/** Gõ lệch trong khoảng này so với tồn thật ⇒ hiểu là "xuất hết" (5 g / 0,005 đơn vị). */
export const OUTBOUND_SNAP_TOLERANCE = 0.005

export type EntryUnit = 'kg' | 'g'

export interface QuantityEntry {
  quantity: string
  unit?: EntryUnit
  note?: string
}

export interface StockAvailability {
  product: Product
  available: number
}

export function roundQuantity(value: number, decimals = QUANTITY_DECIMALS): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export function isZeroQuantity(value: number): boolean {
  return Math.abs(value) < STOCK_EPSILON
}

export function hasStock(value: number): boolean {
  return value > STOCK_EPSILON
}

/**
 * Hiển thị ĐỦ 3 chữ số thập phân như DB lưu, cắt số 0 thừa, theo cách viết số
 * của tiếng Việt: 5.123 → "5,123", 1234.5 → "1.234,5", 5 → "5".
 *
 * Dấu phẩy là bắt buộc, không phải chuyện thẩm mỹ: bản đầu của màn kho mới trả
 * `String(Number(...))` nên tồn 5,123 kg hiện ra "5.123 kg" — người Việt đọc
 * thành năm nghìn một trăm hai mươi ba, trong khi các màn còn lại của app vẫn
 * hiện "5,12 kg". Cùng một con số mà mỗi màn một kiểu ⇒ chủ quán thấy đúng như
 * kho không đồng bộ. Mọi nơi hiển thị số lượng kho phải dùng chung hàm này.
 */
export function formatQuantity(value: number): string {
  const rounded = roundQuantity(value)
  const safe = isZeroQuantity(rounded) ? 0 : rounded
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: QUANTITY_DECIMALS,
  }).format(safe)
}

/**
 * Số để ĐỔ VÀO Ô NHẬP (nút "Xuất hết", "Đúng tồn"): phải là dạng máy đọc được
 * — không nhóm hàng nghìn, dấu chấm thập phân — vì chuỗi này quay lại
 * `parseQuantityInput`. Dùng `formatQuantity` ở đây thì "1.234,5" sẽ bị
 * `sanitizeQuantityInput` bóp thành "1.2345".
 */
export function quantityInputValue(value: number): string {
  const rounded = roundQuantity(value)
  const safe = isZeroQuantity(rounded) ? 0 : rounded
  return String(Number(safe.toFixed(QUANTITY_DECIMALS)))
}

/** Hàng cân ký dưới 1 kg đọc bằng gram cho dễ hình dung: 0.123 kg → "123 g". */
export function formatStockAmount(value: number, unit: string): string {
  const rounded = isZeroQuantity(value) ? 0 : roundQuantity(value)
  if (unit === 'kg') {
    if (rounded !== 0 && Math.abs(rounded) < 1) return `${formatQuantity(rounded * 1000)} g`
    return `${formatQuantity(rounded)} kg`
  }
  return `${formatQuantity(rounded)} ${unit}`.trim()
}

/**
 * Lọc ký tự khi gõ: chỉ số và MỘT dấu thập phân. Dấu phẩy → dấu chấm
 * ("5,123" = "5.123"), tránh chuỗi hỏng kiểu "1.2.3" mà `Number()` trả NaN.
 */
export function sanitizeQuantityInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.,]/g, '').replace(/,/g, '.')
  const [head, ...rest] = cleaned.split('.')
  return rest.length ? `${head}.${rest.join('')}` : head
}

/** Ô có nội dung = người dùng ĐÃ nhập (kể cả "0" nghĩa là hết sạch). Ô trống = chưa nhập. */
export function hasQuantityInput(raw?: string | null): boolean {
  return String(raw ?? '').trim() !== ''
}

/** Chuỗi → số: rỗng/không hợp lệ = 0, không bao giờ âm. */
export function parseQuantityInput(raw?: string | null): number {
  const text = String(raw ?? '').trim().replace(/,/g, '.')
  if (!text) return 0
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** Quy cách đóng gói khi nhập: 1 bao = N kg, hoặc 1 thùng = N cái. */
export function inboundPackSize(product: Pick<Product, 'inboundPackKg' | 'inboundPackQuantity'>): number | undefined {
  return product.inboundPackKg ?? product.inboundPackQuantity
}

/** Đơn vị người dùng gõ vào (bao/thùng nếu có quy cách, còn lại là đơn vị kho). */
export function inboundEntryUnit(product: Pick<Product, 'unit' | 'inboundUnit' | 'inboundPackKg' | 'inboundPackQuantity'>): string {
  return inboundPackSize(product) ? (product.inboundUnit || product.unit) : product.unit
}

/** Hàng cân ký còn dưới 1 kg thì mặc định gõ theo gram — số nhỏ dễ gõ sai dấu chấm. */
export function defaultEntryUnit(product: Pick<Product, 'unit'> | undefined, available: number | undefined): EntryUnit | undefined {
  if (product?.unit !== 'kg') return undefined
  return Number(available) > 0 && Number(available) < 1 ? 'g' : 'kg'
}

/**
 * Số người dùng gõ → số lưu vào sổ kho (đơn vị chuẩn của SKU).
 * `usePackSize` chỉ bật ở phiếu NHẬP: nhập 2 bao × 25 kg = 50 kg.
 */
export function convertEntryToStockQuantity(
  product: Pick<Product, 'unit' | 'inboundUnit' | 'inboundPackKg' | 'inboundPackQuantity'>,
  entry: QuantityEntry,
  options?: { usePackSize?: boolean },
): { quantity: number; conversionNote: string } {
  const entered = parseQuantityInput(entry.quantity)
  const packSize = options?.usePackSize ? inboundPackSize(product) : undefined
  if (packSize) {
    const quantity = roundQuantity(entered * packSize)
    return {
      quantity,
      conversionNote: entered > 0
        ? `${formatQuantity(entered)} ${product.inboundUnit || product.unit} × ${formatQuantity(packSize)} ${product.unit} = ${formatQuantity(quantity)} ${product.unit}`
        : '',
    }
  }
  if (product.unit === 'kg' && entry.unit === 'g') {
    const quantity = roundQuantity(entered / 1000)
    return {
      quantity,
      conversionNote: entered > 0 ? `${formatQuantity(entered)} g = ${formatQuantity(quantity)} kg` : '',
    }
  }
  return { quantity: roundQuantity(entered), conversionNote: '' }
}

export interface OutboundPlanLine {
  product: Product
  /** Số thực sự ghi vào sổ kho (đã khớp về tồn thật nếu chỉ lệch mức làm tròn). */
  quantity: number
  /** Số quy đổi từ ô nhập, trước khi khớp. */
  requested: number
  available: number
  remaining: number
  /** true = đã tự khớp để tồn về đúng 0 (hoặc chặn không cho âm vì lỗi làm tròn). */
  snapped: boolean
  note: string
}

export interface OutboundPlan {
  lines: OutboundPlanLine[]
  /** Dòng thiếu tồn thật sự (vượt quá mức làm tròn) — UI phải hỏi lại người dùng. */
  shortages: Array<{ product: Product; requested: number; available: number }>
  snappedCount: number
}

/**
 * Lập phiếu xuất từ các ô đã nhập.
 *
 * Quy tắc chống "xuất mãi không hết": nếu số gõ chỉ lệch tồn thật trong khoảng
 * ±0,005 thì ghi ĐÚNG bằng tồn thật ⇒ tồn về 0 tuyệt đối, không còn số dư lẻ,
 * và cũng không rơi vào cảnh báo "không đủ tồn" chỉ vì gõ thừa vài gram.
 */
export function planOutbound(
  availability: StockAvailability[],
  entries: Record<string, QuantityEntry>,
): OutboundPlan {
  const lines: OutboundPlanLine[] = []
  const shortages: OutboundPlan['shortages'] = []
  availability.forEach(({ product, available }) => {
    const entry = entries[product.id]
    if (!entry || !hasQuantityInput(entry.quantity)) return
    const { quantity: requested } = convertEntryToStockQuantity(product, entry)
    if (requested <= 0) return
    const availableRounded = roundQuantity(available)
    const diff = availableRounded - requested
    const snapped = Math.abs(diff) <= OUTBOUND_SNAP_TOLERANCE && !isZeroQuantity(availableRounded)
    const quantity = snapped ? availableRounded : requested
    if (!snapped && requested > availableRounded) {
      shortages.push({ product, requested, available: availableRounded })
    }
    lines.push({
      product,
      quantity,
      requested,
      available: availableRounded,
      remaining: roundQuantity(availableRounded - quantity),
      snapped: snapped && Math.abs(diff) > STOCK_EPSILON,
      note: entry.note?.trim() || '',
    })
  })
  return { lines, shortages, snappedCount: lines.filter((line) => line.snapped).length }
}

export interface StockResetLine {
  product: Product
  /** Tồn đúng mà người dùng khai. */
  target: number
  /** Tồn hệ thống đang tính ra. */
  current: number
  delta: number
  note: string
}

/**
 * Lập phiếu SỬA TỒN: ghi thẳng số đúng thay vì phải xuất hết rồi nhập lại.
 * Ghi bằng movement `count` — trong `calculateStock`, kiểm kê là MỐC RESET nên
 * tồn sau đó = số khai + phát sinh sau, đúng bản chất "đặt lại tồn kho".
 */
export function planStockReset(
  availability: StockAvailability[],
  entries: Record<string, QuantityEntry>,
): StockResetLine[] {
  const lines: StockResetLine[] = []
  availability.forEach(({ product, available }) => {
    const entry = entries[product.id]
    if (!entry || !hasQuantityInput(entry.quantity)) return
    const { quantity: target } = convertEntryToStockQuantity(product, entry)
    const current = roundQuantity(available)
    const delta = roundQuantity(target - current)
    if (isZeroQuantity(delta)) return
    lines.push({ product, target, current, delta, note: entry.note?.trim() || '' })
  })
  return lines
}

/** Bỏ dấu tiếng Việt để ô tìm kiếm gõ "hat de" vẫn ra "Hạt dẻ". */
export function searchKey(value: string): string {
  // Dải ký tự trong `replace` là các dấu thanh/dấu mũ (U+0300–U+036F) mà NFD tách ra.
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
}

export function matchesProductQuery(product: Pick<Product, 'name' | 'sku'>, query: string): boolean {
  const needle = searchKey(query)
  if (!needle) return true
  return searchKey(`${product.name} ${product.sku}`).includes(needle)
}
