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
if (!inventory.includes('const visibleOverviewStock = stock')) {
  failures.push('Màn tồn kho vẫn ẩn SKU dùng chung tại chi nhánh có tồn bằng 0.')
}
if (inventory.includes('stock.filter(isVisibleStockLine)')) {
  failures.push('SKU dùng chung vẫn bị lọc khỏi chi nhánh chỉ vì tồn hiện tại bằng 0.')
}
if (!products.includes("const PRODUCTS_CACHE_KEY = 'gustino:configured-products:v1'")) {
  failures.push('Danh mục cloud chưa có cache bền vững nên SKU tùy chỉnh có thể biến mất khi tải lại lúc mạng lỗi.')
}
if (!products.includes('setConfiguredProductsCache(persisted.products, persisted.deletedProducts)')) {
  failures.push('Fallback catalog chưa khôi phục đồng thời SKU hiện hành và tombstone.')
}
if (!products.includes('if (persisted?.products.length)')) {
  failures.push('Lỗi tải cloud chưa giữ lại bản catalog tốt gần nhất.')
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
