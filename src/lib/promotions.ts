import { isMissingTable, userHeaders } from './core'
import { localDateKey } from './dates'
import { shouldUseLanApi, supabase } from './supabase'
import type { AppUser } from '../types'

/**
 * CHƯƠNG TRÌNH KHUYẾN MÃI / GIẢM GIÁ SẢN PHẨM.
 *
 * Bảng `products` chỉ có MỘT cột `price`. Muốn hạ giá một món trong một giai
 * đoạn thì trước đây phải sửa thẳng cột đó (mất giá gốc) hoặc sửa tay
 * `sales_receipt_items` — đúng việc đã phải làm với bánh hạt dẻ 06–13/08/2026.
 * Đây là lớp ghi đè CÓ THỜI HẠN đặt trên giá gốc; hết chương trình là giá tự
 * quay về mức niêm yết, không ai phải nhớ đổi lại.
 *
 * **Bất biến sống còn: khuyến mãi chỉ quyết định giá TẠI THỜI ĐIỂM BÁN.**
 * Hóa đơn đã ghi giữ nguyên `unit_price` đã chốt. Vì vậy `promotionalPriceFor`
 * BẮT BUỘC nhận ngày nghiệp vụ, và mọi nơi tính lại số liệu quá khứ phải truyền
 * đúng ngày của giao dịch đó. Nếu để hàm này mặc định "hôm nay" rồi đem đi tính
 * doanh thu tháng trước thì một chương trình khuyến mãi hôm nay sẽ viết lại
 * lịch sử — đúng cái lỗi mà bảng này sinh ra để chấm dứt.
 */

export interface ProductPromotion {
  id: string
  productId: string
  /** Rỗng = áp dụng mọi chi nhánh. */
  branchId?: string
  name: string
  /** Giá bán cố định trong kỳ khuyến mãi. Loại trừ nhau với `discountPercent`. */
  promoPrice?: number
  /** Giảm theo phần trăm giá gốc. Loại trừ nhau với `promoPrice`. */
  discountPercent?: number
  startsOn: string
  /** Rỗng = chạy tới khi tắt bằng tay. */
  endsOn?: string
  active: boolean
  note: string
  updatedAt?: string
}

const SELECT = 'id, product_id, branch_id, name, promo_price, discount_percent, starts_on, ends_on, active, note, updated_at'

function rowFromDb(row: any): ProductPromotion {
  return {
    id: row.id,
    productId: row.product_id,
    branchId: row.branch_id || undefined,
    name: row.name || '',
    promoPrice: row.promo_price === null || row.promo_price === undefined ? undefined : Number(row.promo_price),
    discountPercent: row.discount_percent === null || row.discount_percent === undefined ? undefined : Number(row.discount_percent),
    startsOn: String(row.starts_on || '').slice(0, 10),
    endsOn: row.ends_on ? String(row.ends_on).slice(0, 10) : undefined,
    active: row.active !== false,
    note: row.note || '',
    updatedAt: row.updated_at || undefined,
  }
}

/* ── Registry dùng chung ──────────────────────────────────────────────────
 * Cùng mẫu với `branchKpiFormulas`: nạp một lần khi vào app, mọi màn đọc chung
 * một nguồn nên POS, menu và bảng giá không thể lệch nhau.
 */
let promotions: ProductPromotion[] = []

export function setActivePromotions(rows: ProductPromotion[]) {
  promotions = rows.slice()
}

export function listPromotions() {
  return promotions.slice()
}

/** Kỳ khuyến mãi có phủ ngày này không. */
export function promotionCoversDate(promotion: ProductPromotion, date: string) {
  if (!promotion.active) return false
  if (date < promotion.startsOn) return false
  if (promotion.endsOn && date > promotion.endsOn) return false
  return true
}

export interface PromotionalPrice {
  price: number
  /** Chương trình đang áp; rỗng = đang bán giá gốc. */
  promotion?: ProductPromotion
  /** Giá niêm yết trước khuyến mãi — để UI gạch ngang giá cũ. */
  basePrice: number
}

function priceFromPromotion(promotion: ProductPromotion, basePrice: number) {
  if (typeof promotion.promoPrice === 'number') return Math.max(0, Math.round(promotion.promoPrice))
  if (typeof promotion.discountPercent === 'number') {
    return Math.max(0, Math.round(basePrice * (100 - promotion.discountPercent) / 100))
  }
  return basePrice
}

/**
 * Giá bán thực tế của một SKU tại một chi nhánh vào một NGÀY cụ thể.
 *
 * Ưu tiên: chương trình của ĐÚNG chi nhánh thắng chương trình toàn chuỗi; trong
 * cùng mức đó, giá thấp hơn thắng (khách luôn được mức tốt nhất, và hai người
 * cùng cấu hình chồng nhau thì không ra kết quả ngẫu nhiên).
 */
export function promotionalPriceFor(
  productId: string,
  basePrice: number,
  options: { branchId?: string; date?: string } = {},
): PromotionalPrice {
  const date = options.date || localDateKey()
  const candidates = promotions
    .filter((item) => item.productId === productId)
    .filter((item) => !item.branchId || item.branchId === options.branchId)
    .filter((item) => promotionCoversDate(item, date))
  if (!candidates.length) return { price: basePrice, basePrice }

  const branchSpecific = candidates.filter((item) => item.branchId)
  const pool = branchSpecific.length ? branchSpecific : candidates
  const best = pool
    .map((promotion) => ({ promotion, price: priceFromPromotion(promotion, basePrice) }))
    .sort((left, right) => left.price - right.price)[0]

  // Khuyến mãi mà đắt hơn giá gốc là cấu hình sai — không được để nó làm tăng giá.
  if (best.price >= basePrice) return { price: basePrice, basePrice }
  return { price: best.price, promotion: best.promotion, basePrice }
}

/* ── Đọc / ghi ────────────────────────────────────────────────────────────── */

export async function fetchProductPromotions(user: AppUser): Promise<ProductPromotion[]> {
  if (shouldUseLanApi(user)) {
    const response = await fetch('/api/product-promotions', { headers: userHeaders(user) })
    if (!response.ok) return []
    return response.json()
  }
  if (!supabase) return []
  const { data, error } = await supabase
    .from('product_promotions')
    .select(SELECT)
    .order('starts_on', { ascending: false })
  if (error) {
    // Môi trường chưa apply migration thì chạy tiếp bằng giá gốc, KHÔNG chặn app.
    if (isMissingTable(error)) return []
    throw new Error(error.message)
  }
  return (data || []).map(rowFromDb)
}

export async function loadProductPromotions(user: AppUser) {
  const rows = await fetchProductPromotions(user).catch(() => [] as ProductPromotion[])
  setActivePromotions(rows)
  return rows
}

/** Nghe realtime để đổi giá ở Control Center là POS ngoài quầy đổi theo ngay. */
export function subscribeProductPromotions(user: AppUser, onChange: () => void) {
  if (!supabase || user.authToken) return () => undefined
  const channel = supabase
    .channel(`product-promotions:${user.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'product_promotions' }, () => onChange())
    .subscribe()
  return () => { void supabase!.removeChannel(channel) }
}

function assertAdmin(user: AppUser) {
  if (user.role !== 'admin') throw new Error('Chỉ Admin được tạo hoặc sửa chương trình khuyến mãi.')
}

function validate(row: ProductPromotion) {
  if (!row.productId) throw new Error('Chưa chọn sản phẩm khuyến mãi.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.startsOn)) throw new Error('Ngày bắt đầu không hợp lệ.')
  if (row.endsOn && row.endsOn < row.startsOn) throw new Error('Ngày kết thúc phải sau ngày bắt đầu.')
  const hasPrice = typeof row.promoPrice === 'number' && Number.isFinite(row.promoPrice)
  const hasPercent = typeof row.discountPercent === 'number' && Number.isFinite(row.discountPercent)
  if (hasPrice === hasPercent) {
    throw new Error('Chọn đúng một cách giảm: giá cố định HOẶC giảm theo phần trăm.')
  }
  if (hasPercent && (row.discountPercent! <= 0 || row.discountPercent! > 100)) {
    throw new Error('Phần trăm giảm phải nằm trong khoảng 1–100.')
  }
  if (hasPrice && row.promoPrice! < 0) throw new Error('Giá khuyến mãi không được âm.')
}

export async function saveProductPromotion(user: AppUser, row: ProductPromotion) {
  assertAdmin(user)
  validate(row)
  const payload = {
    id: row.id || undefined,
    product_id: row.productId,
    branch_id: row.branchId || null,
    name: (row.name || '').slice(0, 200),
    promo_price: typeof row.promoPrice === 'number' ? Math.round(row.promoPrice) : null,
    discount_percent: typeof row.discountPercent === 'number' ? row.discountPercent : null,
    starts_on: row.startsOn,
    ends_on: row.endsOn || null,
    active: row.active !== false,
    note: (row.note || '').slice(0, 500),
    created_by: user.id,
    updated_at: new Date().toISOString(),
  }
  if (shouldUseLanApi(user)) {
    const response = await fetch('/api/product-promotions', {
      method: 'PUT',
      headers: userHeaders(user),
      body: JSON.stringify(payload),
    })
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Không lưu được khuyến mãi.')
    return response.json() as Promise<ProductPromotion>
  }
  if (!supabase) throw new Error('Không có kết nối Supabase để lưu khuyến mãi.')
  const { data, error } = await supabase
    .from('product_promotions')
    .upsert(payload as never)
    .select(SELECT)
    .single()
  if (error) {
    if (isMissingTable(error)) {
      throw new Error('Chưa có bảng product_promotions. Cần apply migration 20260813_product_promotions.sql trước.')
    }
    throw new Error(error.message)
  }
  return rowFromDb(data)
}

export async function deleteProductPromotion(user: AppUser, id: string) {
  assertAdmin(user)
  if (shouldUseLanApi(user)) {
    const response = await fetch(`/api/product-promotions?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: userHeaders(user),
    })
    if (!response.ok) throw new Error('Không xóa được khuyến mãi.')
    return
  }
  if (!supabase) throw new Error('Không có kết nối Supabase để xóa khuyến mãi.')
  const { error } = await supabase.from('product_promotions').delete().eq('id', id)
  if (error && !isMissingTable(error)) throw new Error(error.message)
}
