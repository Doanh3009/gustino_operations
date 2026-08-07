/**
 * MẶT HÀNG NÀO ĐƯỢC COI LÀ "HÀNG TỒN KHO" — quyết định vận hành 07/08/2026.
 *
 * Bối cảnh (chủ quán): thành phẩm liên tục âm, cuối ngày hủy hàng thì không ai
 * ghi nhận, và thành phẩm vốn KHÔNG để dồn qua nhiều ngày — mỗi ngày chỉ quan
 * tâm "hôm nay chế biến bao nhiêu, còn lại bao nhiêu". Vì vậy con số tồn cộng
 * dồn của thành phẩm là con số vô nghĩa: nó chỉ tích lũy sai số cho tới khi âm.
 *
 * Quyết định: **màn Kho không hiển thị thành phẩm nữa.** POS vẫn trừ kho y như
 * cũ (`sale_out` vẫn được ghi, công thức món không đổi) — chỉ là ca trưởng không
 * còn thấy và không còn phải quản con số đó. Thành phẩm được nhìn theo NGÀY ở
 * khối "Chế biến hôm nay" (`summarizeFinishedToday`) và được chốt theo CA ở màn
 * Bàn giao.
 *
 * Kèm theo là bản vá cho khiếu nại "đã ẩn món trong menu bán mà kho vẫn hiện":
 * `calculateStock` giữ lại mọi SKU từng có phiếu kho (`byProduct.has`) nên món đã
 * tắt vẫn nằm trong bảng tồn; và `isMenuProduct` lọc theo `price > 0` nên món bị
 * ẩn bằng cách xóa giá lại rơi ngược vào nhóm "hàng kho". Ở đây lọc thẳng theo
 * `active` + `category`, không phụ thuộc giá.
 *
 * Hàm thuần, không React — để test được bằng số.
 */

import { isWarehouseProduct } from './constants'
import type { Product, StockMovement } from '../types'

/** Nửa đơn vị cuối của `stock_movements.quantity` — dưới mức này coi như 0. */
export const WAREHOUSE_EPSILON = 0.0005

type ScopeProduct = Pick<Product, 'category' | 'unit'> & { price?: number; active?: boolean }

/**
 * Thành phẩm = hàng dùng trong ngày, không phải hàng tồn kho.
 * Vẫn bị POS trừ, chỉ không hiển thị ở màn Kho.
 */
export function isDailyFinishedProduct(product: ScopeProduct) {
  return product.category === 'finished'
}

/**
 * Mặt hàng thực sự thuộc kho: còn bật, không phải món menu, không phải thành phẩm.
 * Thực tế chỉ còn nguyên liệu (`raw`) và bao bì (`packaging`) — đúng những thứ
 * để dành được qua ngày và cần đặt hàng lại.
 */
export function isStockManagedProduct(product: ScopeProduct) {
  if (product.active === false) return false
  if (!isWarehouseProduct(product)) return false
  if (isDailyFinishedProduct(product)) return false
  return true
}

interface StockLineLike {
  product: ScopeProduct & { id: string }
  expected: number
}

/**
 * Chia bảng tồn thành phần HIỆN và phần ĐÃ ẨN nhưng còn số dư.
 *
 * Phần ẩn không bị vứt đi: màn *Sửa tồn* phải mở được nó ra, nếu không thì đúng
 * vào cái bẫy đã sinh ra lỗi kho âm — mặt hàng biến mất khỏi màn nhập liệu là
 * mất luôn đường sửa (§50 CODEMAP).
 */
export function splitWarehouseLines<T extends StockLineLike>(lines: T[]) {
  const managed: T[] = []
  const hidden: T[] = []
  lines.forEach((line) => {
    if (isStockManagedProduct(line.product)) managed.push(line)
    else if (Math.abs(line.expected) > WAREHOUSE_EPSILON) hidden.push(line)
  })
  return { managed, hidden }
}

export interface FinishedDayRow {
  productId: string
  /** Chế biến ra trong ngày (`processing_in`) + nhập thẳng (`inbound`). */
  made: number
  /** Bán ra trong ngày: POS tự trừ và phiếu xuất tay đều tính. */
  sold: number
  /** Hao hụt / hủy ghi trong ngày. */
  wasted: number
  /** Đóng gói lấy ra khỏi hàng rời (`packing_out`). */
  packed: number
  /** made − sold − wasted − packed. Chỉ trong PHẠM VI NGÀY, không cộng dồn. */
  left: number
}

/**
 * Thành phẩm nhìn theo NGÀY, không cộng dồn.
 *
 * Đây là con số duy nhất chủ quán nói là có ý nghĩa: hôm nay chế biến bao nhiêu,
 * bán bao nhiêu, còn lại bao nhiêu. Cố tình KHÔNG mang số dư hôm trước sang, nên
 * số âm tích lũy trong sổ không làm hỏng bảng này.
 */
export function summarizeFinishedToday(
  movements: Array<Pick<StockMovement, 'productId' | 'type' | 'quantity' | 'shiftDate'>>,
  dateKey: string,
): FinishedDayRow[] {
  const byProduct = new Map<string, FinishedDayRow>()
  const rowFor = (productId: string) => {
    const existing = byProduct.get(productId)
    if (existing) return existing
    const created: FinishedDayRow = { productId, made: 0, sold: 0, wasted: 0, packed: 0, left: 0 }
    byProduct.set(productId, created)
    return created
  }
  movements.forEach((item) => {
    if (item.shiftDate !== dateKey) return
    const quantity = Number(item.quantity) || 0
    if (item.type === 'processing_in' || item.type === 'inbound') rowFor(item.productId).made += quantity
    else if (item.type === 'sale_out') rowFor(item.productId).sold += quantity
    else if (item.type === 'waste') rowFor(item.productId).wasted += quantity
    else if (item.type === 'packing_out') rowFor(item.productId).packed += quantity
  })
  return Array.from(byProduct.values())
    .map((row) => ({ ...row, left: row.made - row.sold - row.wasted - row.packed }))
    .filter((row) => Math.abs(row.made) > WAREHOUSE_EPSILON
      || Math.abs(row.sold) > WAREHOUSE_EPSILON
      || Math.abs(row.wasted) > WAREHOUSE_EPSILON
      || Math.abs(row.packed) > WAREHOUSE_EPSILON)
}
