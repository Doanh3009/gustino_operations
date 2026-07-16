import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const constants = await readFile(new URL('../src/lib/constants.ts', import.meta.url), 'utf8')
const products = await readFile(new URL('../src/lib/products.ts', import.meta.url), 'utf8')
const store = await readFile(new URL('../src/lib/store.ts', import.meta.url), 'utf8')
const inventory = await readFile(new URL('../src/pages/InventoryPage.tsx', import.meta.url), 'utf8')

const failures = []

if (!constants.includes('deletedProductsCache')) failures.push('Cache danh mục chưa giữ tombstone của SKU đã xóa.')
if (!constants.includes('!deletedProductsCache.has(product.id)')) failures.push('Danh mục mặc định chưa loại SKU có tombstone.')
if (!constants.includes('|| deletedProductsCache.get(productId)')) failures.push('Tra cứu lịch sử chưa giữ được tên/thông tin SKU đã xóa.')
if (!products.includes('rows.filter((product) => Boolean(product.deletedAt))')) failures.push('Luồng tải cloud chưa chuyển tombstone vào cache dùng chung.')
if (!products.includes('markConfiguredProductDeleted(deletedProduct)')) failures.push('Luồng xóa chưa ẩn SKU khỏi cache kho ngay sau khi lưu tombstone.')
if (!constants.includes('options.filter((option) => currentProductIds.has(option.productId))')) failures.push('Danh sách đóng gói vẫn có thể hiện SKU đã xóa.')
const inboundProductsBody = sourceBetween(constants, 'export function getInboundProducts()', '\n}\n\n// Nguyên liệu đưa vào chế biến')
if (inboundProductsBody.includes('baseConfiguredProducts()')) failures.push('Danh sách nhập kho vẫn có fallback làm SKU hệ thống đã xóa xuất hiện lại.')
if (!inventory.includes('.map((id) => finishedBulkProducts.find((product) => product.id === id))')) failures.push('Danh sách thành phẩm chế biến vẫn tra cứu cả SKU tombstone.')

const calculateStockBody = sourceBetween(
  store,
  'export function calculateStock(',
  '\nexport function saveInventoryReport',
)
if (
  calculateStockBody.includes('return getProducts().map(')
  && !constants.includes('!deletedProductsCache.has(product.id)')
) {
  failures.push(
    'calculateStock() dựng danh sách kho từ toàn bộ getProducts() mà không loại SKU inactive/deleted.',
  )
}

try {
  const transpiled = ts.transpileModule(constants, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`
  const catalog = await import(moduleUrl)
  const systemProduct = catalog.baseConfiguredProducts()[0]
  const tombstone = {
    ...systemProduct,
    active: false,
    deletedAt: '2026-07-16T00:00:00.000Z',
  }
  const packedProduct = catalog.baseConfiguredProducts().find((product) => product.id === 'chestnut-110')
  const packedTombstone = {
    ...packedProduct,
    active: false,
    deletedAt: '2026-07-16T00:00:00.000Z',
  }

  catalog.setConfiguredProductsCache([], [tombstone, packedTombstone])
  if (catalog.getProducts().some((product) => product.id === systemProduct.id)) {
    failures.push('SKU hệ thống có tombstone vẫn xuất hiện trong getProducts()/kho.')
  }
  if (catalog.productById(systemProduct.id)?.name !== systemProduct.name) {
    failures.push('SKU đã xóa không còn tra cứu được cho chứng từ/lịch sử cũ.')
  }
  if (catalog.getInboundProducts().some((product) => product.id === systemProduct.id)) {
    failures.push('SKU nguyên liệu đã xóa vẫn xuất hiện trong danh sách nhập/chế biến.')
  }
  const packingOptions = catalog.getPackingOptionsByOutput()
  if (Object.values(packingOptions).flat().some((option) => option.productId === packedProduct.id)) {
    failures.push('SKU đã xóa vẫn xuất hiện trong lựa chọn đóng gói.')
  }

  catalog.setConfiguredProductsCache([])
  if (catalog.getProducts().some((product) => product.id === systemProduct.id)) {
    failures.push('Một lần đồng bộ danh mục thông thường đã làm mất tombstone và khôi phục SKU.')
  }

  catalog.setConfiguredProductsCache([systemProduct, packedProduct])
  if (!catalog.getProducts().some((product) => product.id === systemProduct.id)) {
    failures.push('SKU không thể xuất hiện lại khi được cấu hình chủ động với cùng ID.')
  }
} catch (error) {
  failures.push(`Không chạy được fixture tombstone: ${error instanceof Error ? error.message : String(error)}`)
}

if (failures.length) {
  console.error(failures.map((item) => `FAIL: ${item}`).join('\n'))
  process.exit(1)
}

console.log('PRODUCT_DELETE_TOMBSTONE_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
