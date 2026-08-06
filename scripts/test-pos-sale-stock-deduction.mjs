// BUG-115: bán hàng trên POS phải trừ kho theo công thức đã gán cho món.
//
// Trước bản vá, Control Center bắt admin gán công thức "để hệ thống trừ tồn kho khi
// bán" nhưng không có chỗ nào dùng: hóa đơn chỉ ghi doanh thu, tồn thành phẩm đứng im
// tới lúc kiểm đếm cuối ca. Test này khoá cả ba mặt của bản vá:
//   1. Logic bung công thức → lượng trừ theo SKU (dùng đúng hàm sản phẩm đang chạy).
//   2. RPC Supabase ghi phiếu trong cùng transaction với hóa đơn, và xóa hóa đơn thì
//      trả kho lại.
//   3. Đường LAN cũng ghi/gỡ phiếu tương đương, còn doanh thu KHÔNG đọc lại nhóm phiếu
//      này (đọc cả hóa đơn lẫn phiếu là cộng đôi).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  getSaleProductsWithoutRecipe,
  hasMenuRecipe,
  isPosGeneratedSaleMovement,
  posStockDeductionByProduct,
  setConfiguredProductsCache,
} from '../src/lib/constants.ts'

// --- 1. Bung công thức của món thành lượng trừ theo SKU ---
const products = [
  { id: 'chestnut-cooked-kg', sku: 'BC-HD-CHIN', name: 'Thành phẩm hạt dẻ rang', unit: 'kg', category: 'finished', lowStock: 0, price: 0, active: true, source: 'system' },
  { id: 'bag-330', sku: 'BB-330', name: 'Bao bì 330g', unit: 'cái', category: 'packaging', lowStock: 0, price: 0, active: true, source: 'system' },
  {
    id: 'chestnut-330', sku: 'TP-HD-330', name: 'Hạt dẻ rang 330g', unit: 'túi', category: 'finished',
    lowStock: 0, price: 89000, active: true, source: 'custom',
    recipe: [
      { productId: 'chestnut-cooked-kg', quantity: 0.33, role: 'source' },
      { productId: 'bag-330', quantity: 1, role: 'packaging' },
    ],
  },
  {
    id: 'chestnut-110', sku: 'TP-HD-110', name: 'Hạt dẻ rang 110g', unit: 'túi', category: 'finished',
    lowStock: 0, price: 33000, active: true, source: 'custom',
    recipe: [{ productId: 'chestnut-cooked-kg', quantity: 0.11, role: 'source' }],
  },
  // Món chủ quán chọn: chưa gán công thức thì VẪN bán được, chỉ là không trừ kho.
  {
    id: 'combo-moi', sku: 'TP-COMBO', name: 'Combo mới chưa gán', unit: 'phần', category: 'finished',
    lowStock: 0, price: 50000, active: true, source: 'custom',
  },
]
setConfiguredProductsCache(products, [])

const deduction = posStockDeductionByProduct([
  { productId: 'chestnut-330', quantity: 2 },
  { productId: 'chestnut-110', quantity: 3 },
  { productId: 'combo-moi', quantity: 4 },
])
assert.equal(
  deduction.get('chestnut-cooked-kg'),
  0.99,
  'Hai SKU cùng trừ một mẻ phải cộng dồn: 2×0,33 + 3×0,11 = 0,99 kg.',
)
assert.equal(deduction.get('bag-330'), 2, 'Bao bì phải trừ theo số túi bán ra.')
assert.equal(deduction.has('combo-moi'), false, 'Món chưa gán công thức không được tự trừ chính nó.')
assert.equal(deduction.size, 2, 'Chỉ những SKU có trong công thức mới được trừ.')

assert.equal(hasMenuRecipe(products[2]), true)
// Danh sách này còn gồm các SKU mẫu hardcode (chưa từng được cấu hình trên cloud);
// điều bắt buộc là món đã gán KHÔNG lọt vào, còn món chưa gán thì PHẢI lọt vào.
const missingRecipeIds = getSaleProductsWithoutRecipe().map((product) => product.id)
assert.ok(
  missingRecipeIds.includes('combo-moi'),
  'Món đang bán mà chưa gán công thức phải lộ ra cho admin bổ sung.',
)
assert.ok(
  !missingRecipeIds.includes('chestnut-330') && !missingRecipeIds.includes('chestnut-110'),
  'Món đã gán công thức không được báo là thiếu.',
)

// Doanh thu chỉ được đọc hóa đơn; phiếu kho do POS sinh là bản sao, đọc thêm là cộng đôi.
assert.equal(
  isPosGeneratedSaleMovement({ type: 'sale_out', note: '[POS HD2407-003] Trừ kho theo công thức món' }),
  true,
)
assert.equal(
  isPosGeneratedSaleMovement({ type: 'sale_out', note: '[Phiếu xuất kho] Ca trưởng lập tay' }),
  false,
  'Phiếu xuất kho ca trưởng tự lập vẫn phải được doanh thu đọc như trước.',
)

// --- 2. RPC Supabase: ghi phiếu cùng transaction, xóa hóa đơn thì trả kho ---
const migration = fs.readFileSync('supabase/migrations/20260724_pos_sale_deducts_stock.sql', 'utf8')
assert.match(migration, /create or replace function public\.post_pos_receipt_stock/, 'Thiếu hàm sinh phiếu kho từ hóa đơn.')
assert.match(
  migration,
  /v_stock_rows := public\.post_pos_receipt_stock\(v_id\);/,
  'RPC bán hàng chưa gọi phần trừ kho, hóa đơn sẽ lại không kéo theo phiếu kho.',
)
assert.match(
  migration,
  /delete from public\.stock_movements\s+where document_id = p_receipt_id\s+and movement_type = 'sale_out';/,
  'Xóa hóa đơn phải gỡ đúng nhóm phiếu kho của hóa đơn đó.',
)
assert.match(
  migration,
  /if exists \(\s*select 1 from public\.stock_movements\s+where document_id = p_receipt_id and movement_type = 'sale_out'/,
  'Thiếu chốt chặn ghi đôi khi hàm được gọi lại.',
)
assert.match(migration, /jsonb_typeof\(menu\.recipe\) = 'array'/, 'Công thức hỏng/null phải được bỏ qua thay vì làm vỡ hóa đơn.')
assert.doesNotMatch(
  migration,
  /raise exception[^;]*(ton kho|tồn kho|khong du|không đủ)/i,
  'Kho không được phép chặn bán hàng.',
)

// --- 3. Đường LAN ghi và gỡ phiếu tương đương ---
const lan = fs.readFileSync('scripts/lan-server.mjs', 'utf8')
assert.match(lan, /Array\.isArray\(receipt\.stockMovements\)/, 'LAN chưa nhận phiếu kho kèm hóa đơn.')
assert.match(
  lan,
  /item\.documentId === receiptId && item\.type === 'sale_out'/,
  'LAN xóa hóa đơn mà không trả lại kho.',
)
const receiptsLib = fs.readFileSync('src/lib/salesReceipts.ts', 'utf8')
assert.match(receiptsLib, /stockMovements: buildPosStockMovements\(user, receipt\)/, 'Client LAN chưa gửi kèm phiếu kho.')
const revenue = fs.readFileSync('src/lib/revenue.ts', 'utf8')
assert.match(
  revenue,
  /item\.type === 'sale_out' && !isPosGeneratedSaleMovement\(item\)/,
  'Doanh thu vẫn đọc phiếu kho do POS sinh → cộng đôi số lượng bán.',
)

console.log('POS_SALE_STOCK_DEDUCTION_OK')
