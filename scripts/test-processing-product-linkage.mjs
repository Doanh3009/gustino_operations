import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const [constants, inventory, products] = await Promise.all([
  readFile(new URL('../src/lib/constants.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/InventoryPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/products.ts', import.meta.url), 'utf8'),
])

const failures = []
if (!constants.includes('export function getProcessingOutputOptions')) {
  failures.push('Danh mục chưa có một hàm liên kết đầu vào → thành phẩm dùng chung cho mẻ chế biến.')
}
if (!inventory.includes('getProcessingOutputOptions(inputId)')) {
  failures.push('Màn mẻ rang vẫn tự lọc thành phẩm theo kg và có thể làm mất thành phẩm theo cái như bánh hạt dẻ.')
}
if (inventory.includes('.map((id) => finishedBulkProducts.find((product) => product.id === id))')) {
  failures.push('Mapping thành phẩm vẫn bị tra cứu chỉ trong danh sách đơn vị kg.')
}
// 07/08/2026: màn Kho viết lại, biến đổi tên thành `warehouseStock` (= bảng tồn
// sau khi lọc thành phẩm/món menu bằng `splitWarehouseLines`). Yêu cầu KHÔNG đổi:
// danh mục SKU dùng chung toàn công ty, chi nhánh đang có tồn 0 vẫn phải thấy dòng.
if (!inventory.includes('splitWarehouseLines(stock)') || /warehouseStock\.filter\(\(line\) => line\.expected > 0/.test(inventory)) {
  failures.push('Màn tồn kho vẫn ẩn SKU dùng chung tại chi nhánh có tồn bằng 0.')
}
if (inventory.includes('stock.filter(isVisibleStockLine)')) {
  failures.push('SKU dùng chung vẫn bị lọc khỏi chi nhánh chỉ vì tồn hiện tại bằng 0.')
}
// 07/08/2026 — chủ quán: "không có dữ liệu nào được phép lưu trong local".
// Danh mục SKU (tên, giá, nhóm hàng, công thức) TRƯỚC ĐÂY được ghi xuống
// localStorage và sống qua nhiều ngày không hết hạn: admin sửa giá / tắt món
// trên một máy thì máy khác vẫn đọc bản cũ. Nay chỉ giữ trong bộ nhớ phiên.
if (products.includes('localStorage.setItem')) {
  failures.push('Danh mục SKU không được ghi xuống localStorage — cloud là nguồn sự thật duy nhất.')
}
if (!products.includes("const PRODUCTS_CACHE_KEY = 'gustino:configured-products:v1'")
  || !products.includes('localStorage.removeItem(PRODUCTS_CACHE_KEY)')) {
  failures.push('Phải dọn bản cache danh mục cũ còn sót trên máy người dùng.')
}
if (products.includes('return persisted.products')) {
  failures.push('Lỗi tải cloud không được âm thầm rơi về danh mục cũ trong máy — phải báo lỗi.')
}

try {
  const transpiled = ts.transpileModule(constants, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const catalog = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`)
  catalog.setConfiguredProductsCache(catalog.baseConfiguredProducts())
  const cakeOutputs = catalog.getProcessingOutputOptions?.('cake-raw') || []
  assert.deepEqual(cakeOutputs.map((product) => product.id), ['cake-ready'])
  assert.equal(cakeOutputs[0]?.unit, 'cái')
  assert.equal(cakeOutputs[0]?.name, 'Bánh hạt dẻ thành phẩm')

  const cakeReady = catalog.baseConfiguredProducts().find((product) => product.id === 'cake-ready')
  const customCakeReady = {
    ...cakeReady,
    id: 'custom-tp-banh',
    sku: 'TP-BANH',
    name: 'Thành phẩm bánh hạt dẻ',
    price: 0,
  }
  catalog.setConfiguredProductsCache(
    [customCakeReady],
    [{ ...cakeReady, active: false, deletedAt: '2026-07-18T00:00:00.000Z' }],
  )
  const replacementOutputs = catalog.getProcessingOutputOptions?.('cake-raw') || []
  assert.equal(replacementOutputs.some((product) => product.id === 'cake-ready'), false)
  assert.equal(replacementOutputs[0]?.id, 'custom-tp-banh')
} catch (error) {
  failures.push(`Fixture liên kết bánh hạt dẻ chưa chạy đúng: ${error instanceof Error ? error.message : String(error)}`)
}

if (failures.length) {
  console.error(failures.map((item) => `FAIL: ${item}`).join('\n'))
  process.exit(1)
}

console.log('PROCESSING_PRODUCT_LINKAGE_OK')
