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
