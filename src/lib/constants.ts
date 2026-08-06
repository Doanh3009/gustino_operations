import type { Branch, Product } from '../types'

export const BRANCHES: Branch[] = [
  { id: 'gold-coast', name: 'Gold Coast Nha Trang' },
  { id: 'lotte-2310', name: 'Lotte Mart 23/10' },
  { id: 'lotte-vt', name: 'Lotte Mart Vũng Tàu' },
]

export const PRODUCTS: Product[] = [
  { id: 'chestnut-roasted-bulk', sku: 'NL-HD-RANG', name: 'Hạt dẻ rang', unit: 'kg', category: 'raw', lowStock: 10, weightKg: 1, countsForYield: true, inboundUnit: 'túi', inboundPackKg: 2 },
  { id: 'chestnut-snow', sku: 'NL-HD-TUYET', name: 'Hạt dẻ tuyết', unit: 'kg', category: 'raw', lowStock: 10, weightKg: 1, countsForYield: true, inboundUnit: 'túi', inboundPackKg: 2 },
  { id: 'chestnut-fresh', sku: 'NL-HD-TUOI', name: 'Hạt dẻ tươi', unit: 'kg', category: 'raw', lowStock: 20, weightKg: 1, countsForYield: true, inboundUnit: 'túi', inboundPackKg: 5 },
  { id: 'chestnut-pre', sku: 'NL-HD-SC', name: 'Hạt dẻ sơ chế', unit: 'kg', category: 'raw', lowStock: 8, weightKg: 1, countsForYield: true },
  { id: 'potato-honey', sku: 'NL-KL-MAT', name: 'Khoai lang mật', unit: 'kg', category: 'raw', lowStock: 10, weightKg: 1, countsForYield: true },
  { id: 'sugar', sku: 'NL-DUONG', name: 'Đường', unit: 'kg', category: 'raw', lowStock: 5, countsForYield: false },
  { id: 'bag-110', sku: 'BB-110', name: 'Bao bì 110g', unit: 'cái', category: 'packaging', lowStock: 100, countsForYield: false },
  { id: 'bag-330', sku: 'BB-330', name: 'Bao bì 330g', unit: 'cái', category: 'packaging', lowStock: 50, countsForYield: false },
  { id: 'bag-500', sku: 'BB-500', name: 'Bao bì 500g', unit: 'cái', category: 'packaging', lowStock: 50, countsForYield: false },
  { id: 'chestnut-cooked-kg', sku: 'BC-HD-CHIN', name: 'Thành phẩm hạt dẻ rang', unit: 'kg', category: 'finished', lowStock: 0, weightKg: 1, countsForYield: true },
  { id: 'chestnut-snow-finished', sku: 'BC-HD-TUYET', name: 'Thành phẩm hạt dẻ tuyết', unit: 'kg', category: 'finished', lowStock: 0, weightKg: 1, countsForYield: true },
  { id: 'chestnut-grilled-finished', sku: 'BC-HD-NUONG', name: 'Thành phẩm hạt dẻ nướng', unit: 'kg', category: 'finished', lowStock: 0, weightKg: 1, countsForYield: true },
  { id: 'potato-cooked-kg', sku: 'BC-KL-CHIN', name: 'Khoai lang chín chưa chia túi', unit: 'kg', category: 'finished', lowStock: 0, weightKg: 1, countsForYield: true },
  { id: 'chestnut-110', sku: 'TP-HD-110', name: 'Hạt dẻ rang 110g', unit: 'túi', category: 'finished', lowStock: 20, weightKg: 0.11, countsForYield: true },
  { id: 'chestnut-330', sku: 'TP-HD-330', name: 'Hạt dẻ rang 330g', unit: 'túi', category: 'finished', lowStock: 12, weightKg: 0.33, countsForYield: true },
  { id: 'chestnut-500', sku: 'TP-HD-500', name: 'Hạt dẻ rang 500g', unit: 'túi', category: 'finished', lowStock: 10, weightKg: 0.5, countsForYield: true },
  { id: 'chestnut-1kg', sku: 'TP-HD-1KG', name: 'Hạt dẻ rang 1kg', unit: 'túi', category: 'finished', lowStock: 5, weightKg: 1, countsForYield: true },
  { id: 'snow-110', sku: 'TP-TUYET-110', name: 'Hạt dẻ tuyết 110g', unit: 'túi', category: 'finished', lowStock: 5, weightKg: 0.11, countsForYield: true },
  { id: 'snow-330', sku: 'TP-TUYET-330', name: 'Hạt dẻ tuyết 330g', unit: 'túi', category: 'finished', lowStock: 5, weightKg: 0.33, countsForYield: true },
  { id: 'snow-500', sku: 'TP-TUYET-500', name: 'Hạt dẻ tuyết 500g', unit: 'túi', category: 'finished', lowStock: 5, weightKg: 0.5, countsForYield: true },
  { id: 'snow-1kg', sku: 'TP-TUYET-1KG', name: 'Hạt dẻ tuyết 1kg', unit: 'túi', category: 'finished', lowStock: 3, weightKg: 1, countsForYield: true },
  { id: 'grilled-110', sku: 'TP-NUONG-110', name: 'Hạt dẻ nướng 110g', unit: 'túi', category: 'finished', lowStock: 5, weightKg: 0.11, countsForYield: true },
  { id: 'grilled-330', sku: 'TP-NUONG-330', name: 'Hạt dẻ nướng 330g', unit: 'túi', category: 'finished', lowStock: 5, weightKg: 0.33, countsForYield: true },
  { id: 'grilled-500', sku: 'TP-NUONG-500', name: 'Hạt dẻ nướng 500g', unit: 'túi', category: 'finished', lowStock: 5, weightKg: 0.5, countsForYield: true },
  { id: 'grilled-1kg', sku: 'TP-NUONG-1KG', name: 'Hạt dẻ nướng 1kg', unit: 'túi', category: 'finished', lowStock: 3, weightKg: 1, countsForYield: true },
  { id: 'potato-500', sku: 'TP-KL-500', name: 'Khoai lang mật 500g', unit: 'túi', category: 'finished', lowStock: 10, weightKg: 0.5, countsForYield: true },
  { id: 'potato-1kg', sku: 'TP-KL-1KG', name: 'Khoai lang mật 1kg', unit: 'túi', category: 'finished', lowStock: 5, weightKg: 1, countsForYield: true },
  { id: 'cake-raw', sku: 'NL-BANH', name: 'Bánh hạt dẻ', unit: 'cái', category: 'raw', lowStock: 20, inboundUnit: 'túi', inboundPackQuantity: 20 },
  { id: 'cake-ready', sku: 'BC-BANH', name: 'Bánh hạt dẻ thành phẩm', unit: 'cái', category: 'finished', lowStock: 0 },
  { id: 'cake-box', sku: 'TP-BANH-HOP4', name: 'Bánh hạt dẻ hộp 4 cái', unit: 'hộp', category: 'finished', lowStock: 5 },
  { id: 'chestnut-milk', sku: 'TP-SUA-HD', name: 'Sữa hạt dẻ', unit: 'chai', category: 'finished', lowStock: 6 },
  { id: 'pepper-bun', sku: 'TP-TIEU-LB', name: 'Tiêu long bao', unit: 'phần', category: 'finished', lowStock: 6 },
  { id: 'dumpling', sku: 'TP-SUI-CAO', name: 'Sủi cảo', unit: 'phần', category: 'finished', lowStock: 6 },
]

export type ConfiguredProduct = Product & {
  active: boolean
  source: 'system' | 'custom'
  price: number
  deletedAt?: string
}

let configuredProductsCache: ConfiguredProduct[] | null = null
let deletedProductsCache = new Map<string, ConfiguredProduct>()

export function setConfiguredProductsCache(
  products: ConfiguredProduct[],
  deletedProducts?: ConfiguredProduct[],
) {
  configuredProductsCache = products
  if (deletedProducts) {
    deletedProductsCache = new Map(
      deletedProducts
        .filter((product) => Boolean(product.deletedAt))
        .map((product) => [product.id, product]),
    )
  }
  products.forEach((product) => {
    if (!product.deletedAt) deletedProductsCache.delete(product.id)
  })
}

export function markConfiguredProductDeleted(product: ConfiguredProduct) {
  configuredProductsCache = configuredProductsCache?.filter((item) => item.id !== product.id) ?? null
  deletedProductsCache.set(product.id, product)
}

function safeReadProducts(): ConfiguredProduct[] | null {
  return configuredProductsCache
}

export function baseConfiguredProducts(): ConfiguredProduct[] {
  return PRODUCTS.map((product) => ({
    ...product,
    price: defaultProductSalePrice(product.id),
    active: true,
    source: 'system' as const,
    deletedAt: undefined,
  }))
}

export function getProducts(): ConfiguredProduct[] {
  const base = baseConfiguredProducts().filter((product) => !deletedProductsCache.has(product.id))
  const saved = safeReadProducts()
  if (!saved?.length) return base
  const byId = new Map(base.map((product) => [product.id, product]))
  saved.forEach((product) => {
    if (product.deletedAt || deletedProductsCache.has(product.id)) {
      byId.delete(product.id)
      return
    }
    const fallback = byId.get(product.id)
    byId.set(product.id, {
      ...fallback,
      ...product,
      active: product.active !== false,
      price: Number(product.price || fallback?.price || 0),
      lowStock: Number(product.lowStock ?? fallback?.lowStock ?? 0),
      source: product.source || fallback?.source || 'custom',
    })
  })
  return Array.from(byId.values())
}

export function productById(productId: string) {
  return getProducts().find((product) => product.id === productId)
    || deletedProductsCache.get(productId)
}

// Phiếu xuất kho do chính hóa đơn POS sinh ra (RPC `post_pos_receipt_stock` /
// LAN `POST /api/sales-receipts`). Ghi chú bắt đầu bằng tiền tố này để phân biệt
// với phiếu xuất kho ca trưởng tự lập. Doanh thu KHÔNG được đọc lại nhóm phiếu
// này: hóa đơn mới là nguồn sự thật, đọc cả hai là cộng đôi.
export const POS_STOCK_NOTE_PREFIX = '[POS '

export function isPosGeneratedSaleMovement(movement: { type: string; note?: string }) {
  return movement.type === 'sale_out' && (movement.note || '').startsWith(POS_STOCK_NOTE_PREFIX)
}

/** Món menu đã gán công thức thì bán ra mới trừ được kho. */
export function menuRecipeLines(product: Pick<Product, 'recipe'>) {
  return (product.recipe || []).filter((line) => line.productId && Number(line.quantity) > 0)
}

export function hasMenuRecipe(product: Pick<Product, 'recipe'>) {
  return menuRecipeLines(product).length > 0
}

/** Món đang bán trên POS nhưng chưa gán công thức → bán ra không trừ kho được. */
export function getSaleProductsWithoutRecipe(): ConfiguredProduct[] {
  return getSaleProducts().filter((product) => !hasMenuRecipe(product))
}

/**
 * Lượng kho phải trừ cho một hóa đơn POS: bung công thức của từng món rồi gom theo SKU.
 * Món chưa gán công thức không đóng góp gì (vẫn bán được, chỉ là không trừ được kho).
 * Đây là bản đối chiếu của RPC `post_pos_receipt_stock` phía Supabase.
 */
export function posStockDeductionByProduct(lines: Array<{ productId: string; quantity: number }>) {
  const byProduct = new Map<string, number>()
  lines.forEach((line) => {
    const menuProduct = productById(line.productId)
    if (!menuProduct) return
    menuRecipeLines(menuProduct).forEach((component) => {
      const quantity = Number(component.quantity) * Number(line.quantity)
      if (!Number.isFinite(quantity) || quantity <= 0) return
      const total = (byProduct.get(component.productId) || 0) + quantity
      byProduct.set(component.productId, Math.round(total * 10000) / 10000)
    })
  })
  return byProduct
}

// Món trong menu bán = thành phẩm đóng gói sẵn, có giá, bán theo túi/hộp/phần (không phải kg rời).
export function isMenuProduct(product: Pick<Product, 'category' | 'unit'> & { price?: number }) {
  return product.category === 'finished'
    && product.unit !== 'kg'
    && Number(product.price || 0) > 0
}

// KHO chỉ quản lý nguyên vật liệu, bao bì và thành phẩm chế biến (hàng bàn giao giữa các ca).
// Từ khi bỏ chia túi (§34 CODEMAP), món trong menu KHÔNG đi qua kho nữa: POS bán thẳng bằng
// hóa đơn, không sinh stock movement; tồn thành phẩm chốt bằng kiểm kê hàng rời cuối ca.
// Vì vậy mọi màn hình kho phải lọc bỏ món menu, nếu không danh sách tồn đầy SKU luôn bằng 0.
export function isWarehouseProduct(product: Pick<Product, 'category' | 'unit'> & { price?: number }) {
  return !isMenuProduct(product)
}

export function getWarehouseProducts(): ConfiguredProduct[] {
  return getProducts().filter((product) => isWarehouseProduct(product))
}

// Menu POS của nhân viên = đúng những gì admin cấu hình ở Control Center:
// thành phẩm đang bật (active), bán theo đơn vị đóng gói (không phải kg rời) và có giá > 0.
// Admin bật/tắt món hoặc đổi giá là menu nhân viên đổi theo (một nguồn sự thật).
export function getSaleProducts() {
  return getProducts()
    .filter((product) => product.active !== false && isMenuProduct(product))
}

export function configuredProductPrice(productId: string, fallback = 0) {
  return Number(productById(productId)?.price || fallback || 0)
}

export function getPackingOptionsByOutput() {
  const currentProducts = getProducts().filter((product) => product.active !== false)
  const currentProductIds = new Set(currentProducts.map((product) => product.id))
  const merged: Record<string, PackingOption[]> = Object.fromEntries(
    Object.entries(PACKING_OPTIONS_BY_OUTPUT)
      .filter(([outputId]) => currentProductIds.has(outputId))
      .map(([outputId, options]) => [
        outputId,
        options.filter((option) => currentProductIds.has(option.productId)),
      ]),
  )
  currentProducts
    .filter((product) => product.source === 'custom' && product.active !== false && product.recipe?.length)
    .forEach((product) => {
      const source = product.recipe?.find((line) => line.role === 'source' && line.quantity > 0)
      if (!source || !currentProductIds.has(source.productId)) return
      const options = merged[source.productId] || []
      if (!options.some((option) => option.productId === product.id)) {
        options.push({
          productId: product.id,
          label: product.name,
          sourceQuantity: source.quantity,
        })
      }
      merged[source.productId] = options
    })
  return merged
}

export function defaultProductSalePrice(productId: string) {
  if (productId.includes('110')) return 30000
  if (productId.includes('330')) return 80000
  if (productId.includes('500')) return 120000
  if (productId.includes('1kg')) return 220000
  if (productId === 'cake-box') return 36000
  return 0
}

export const INBOUND_PRODUCT_IDS = [
  'chestnut-roasted-bulk',
  'chestnut-snow',
  'chestnut-fresh',
  'potato-honey',
  'cake-raw',
] as const

export const INBOUND_PRODUCTS = PRODUCTS.filter((product) =>
  INBOUND_PRODUCT_IDS.includes(product.id as typeof INBOUND_PRODUCT_IDS[number]),
)

export const PROCESS_INPUT_PRODUCTS = INBOUND_PRODUCTS

// Dropdown "nhập kho" của ca trưởng lấy TỪ SKU nguyên liệu do admin cấu hình (không hardcode nữa).
// Admin thêm/ẩn/sửa một SKU category 'raw' ở Control Center → phản ánh ngay vào đây.
export function getInboundProducts(): ConfiguredProduct[] {
  return getProducts().filter((product) => product.active !== false && product.category === 'raw')
}

// Nguyên liệu đưa vào chế biến = cùng tập nguyên liệu cấu hình.
export function getProcessInputProducts(): ConfiguredProduct[] {
  return getInboundProducts()
}

// Thành phẩm rời (kg) có thể chọn khi chia mẻ — do admin cấu hình qua SKU category 'finished'.
export function getFinishedBulkProducts(): ConfiguredProduct[] {
  return getProducts().filter((product) =>
    product.active !== false && product.category === 'finished' && product.unit === 'kg',
  )
}

export const PROCESS_OUTPUT_BY_INPUT: Record<string, string> = {
  'chestnut-snow': 'chestnut-snow-finished',
  'chestnut-roasted-bulk': 'chestnut-cooked-kg',
  'chestnut-fresh': 'chestnut-cooked-kg',
  'potato-honey': 'potato-honey',
  'cake-raw': 'cake-ready',
}

export function getProcessingOutput(inputProductId: string) {
  return PRODUCTS.find((product) => product.id === PROCESS_OUTPUT_BY_INPUT[inputProductId])
}

export const PROCESS_OUTPUT_OPTIONS_BY_INPUT: Record<string, string[]> = {
  'chestnut-snow': ['chestnut-snow-finished', 'chestnut-grilled-finished'],
  'chestnut-roasted-bulk': ['chestnut-cooked-kg'],
  'chestnut-fresh': ['chestnut-cooked-kg'],
  'potato-honey': ['potato-cooked-kg'],
  'cake-raw': ['cake-ready'],
}

/**
 * Thành phẩm của mẻ chế biến phải tra từ danh mục cloud hiện hành, không chỉ
 * từ nhóm kg. Nhờ vậy mapping theo cái (bánh hạt dẻ) vẫn hoạt động; nếu SKU
 * hệ thống đã được tombstone, SKU kho tương thích do Admin tạo vẫn có thể chọn.
 */
export function getProcessingOutputOptions(inputProductId: string): ConfiguredProduct[] {
  const currentProducts = getProducts().filter((product) =>
    product.active !== false && product.category === 'finished',
  )
  const currentById = new Map(currentProducts.map((product) => [product.id, product]))
  const mapped = (PROCESS_OUTPUT_OPTIONS_BY_INPUT[inputProductId] || [])
    .map((id) => currentById.get(id))
    .filter(Boolean) as ConfiguredProduct[]
  if (mapped.length) return mapped

  const input = productById(inputProductId)
  const warehouseFinished = currentProducts.filter((product) =>
    product.unit === 'kg' || Number(product.price || 0) <= 0,
  )
  const sameUnit = input
    ? warehouseFinished.filter((product) => product.unit === input.unit)
    : []
  return sameUnit.length ? sameUnit : warehouseFinished
}

export interface PackingOption {
  productId: string
  label: string
  sourceQuantity: number
}

export const PACKING_OPTIONS_BY_OUTPUT: Record<string, PackingOption[]> = {
  'chestnut-cooked-kg': [
    { productId: 'chestnut-110', label: '110g', sourceQuantity: 0.11 },
    { productId: 'chestnut-330', label: '330g', sourceQuantity: 0.33 },
    { productId: 'chestnut-500', label: '500g', sourceQuantity: 0.5 },
    { productId: 'chestnut-1kg', label: '1kg', sourceQuantity: 1 },
  ],
  'chestnut-snow-finished': [
    { productId: 'snow-110', label: '110g', sourceQuantity: 0.11 },
    { productId: 'snow-330', label: '330g', sourceQuantity: 0.33 },
    { productId: 'snow-500', label: '500g', sourceQuantity: 0.5 },
    { productId: 'snow-1kg', label: '1kg', sourceQuantity: 1 },
  ],
  'chestnut-grilled-finished': [
    { productId: 'grilled-110', label: '110g', sourceQuantity: 0.11 },
    { productId: 'grilled-330', label: '330g', sourceQuantity: 0.33 },
    { productId: 'grilled-500', label: '500g', sourceQuantity: 0.5 },
    { productId: 'grilled-1kg', label: '1kg', sourceQuantity: 1 },
  ],
  'potato-cooked-kg': [
    { productId: 'potato-500', label: '500g', sourceQuantity: 0.5 },
    { productId: 'potato-1kg', label: '1kg', sourceQuantity: 1 },
  ],
  'cake-ready': [
    { productId: 'cake-box', label: 'Hộp 4 cái', sourceQuantity: 4 },
  ],
}

export const MOVEMENT_LABELS = {
  opening: 'Tồn đầu',
  inbound: 'Nhập kho',
  processing_out: 'Xuất chế biến',
  processing_in: 'Thành phẩm',
  packing_out: 'Xuất đóng gói',
  packing_in: 'Nhập thành phẩm đóng gói',
  sale_out: 'Xuất bán',
  waste: 'Hao hụt / hủy',
  adjustment: 'Điều chỉnh',
  count: 'Kiểm kê thực tế',
} as const
