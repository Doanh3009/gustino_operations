import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [sales, styles] = await Promise.all([
  readFile(new URL('../src/pages/SalesPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

// Ba màn mobile thật, không đưa phần chú thích ngoài mockup vào ứng dụng.
assert.match(sales, /type MobilePosView = 'menu' \| 'bill' \| 'history'/)
assert.match(sales, /mobile-pos-\$\{mobileView\}/)
assert.match(sales, /MENU BÁN NHANH/)
assert.match(sales, /Hóa đơn mới/)
assert.match(sales, /Lịch sử hóa đơn/)
assert.match(sales, /setMobileView\('bill'\)/)
assert.match(sales, /setMobileView\('history'\)/)
assert.match(sales, /pos-mobile-menu-button[\s\S]{0,260}mh-menu-toggle/)
assert.match(sales, /pos-mobile-menu-button[\s\S]{0,300}event\.stopPropagation\(\)[\s\S]{0,180}mh-menu-toggle/)

// Tìm kiếm/lọc phải hoạt động bằng state và dữ liệu thật, không phải nút trang trí.
assert.match(sales, /value=\{productSearch\}/)
assert.match(sales, /setProductSearch/)
assert.match(sales, /value=\{productFilter\}/)
assert.match(sales, /filteredSellerMenuProducts/)
assert.match(sales, /value=\{receiptSearch\}/)
assert.match(sales, /filteredVisibleReceipts/)

// Thanh giỏ và nút bán vẫn gọi đúng handler nghiệp vụ hiện có.
assert.match(sales, /className="pos-mobile-cart-bar"/)
assert.match(sales, /className="checkout-button"[\s\S]{0,220}onClick=\{\(\) => void checkout\(\)\}/)
assert.match(sales, /className="bill-line-remove"[\s\S]{0,220}setLineQuantity\(line\.productId, 0\)/)
assert.match(sales, /className="pos-product-main"[\s\S]{0,180}onClick=\{\(\) => addProductToCart\(product\.id, 1\)\}/)
assert.doesNotMatch(sales, /pos-product-thumb|bill-line-thumb|productGlyph/)
assert.doesNotMatch(sales, /pos-product-quick|Bán không giới hạn|>\+1<|>\+2<|>\+3</)
assert.doesNotMatch(sales, /Nút lớn, dễ bấm|Tối ưu 1 tay|Bố cục dễ đọc|An toàn, rõ ràng/)
assert.match(sales, /displayName\[0\]\.toLocaleUpperCase\('vi'\)/)
assert.match(sales, /\{shortProductName\(product\.name\)\}/)
assert.match(sales, /\{shortProductName\(line\.productName\)\}/)
assert.match(sales, /toLocaleString\('vi-VN'\)\} đ`/)
assert.doesNotMatch(sales, /toLocaleString\('vi-VN'\)\}d`/)

assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.pos-mobile-viewbar\s*\{/)
assert.match(styles, /\.pos-mobile-cart-bar\s*\{[\s\S]*position:\s*fixed/)
assert.match(styles, /\.mobile-pos-menu \.pos-bill-panel/)
assert.match(styles, /\.mobile-pos-bill \.receipt-history/)
assert.match(styles, /\.mobile-pos-history \.pos-bill-panel > :not\(\.receipt-history\)/)
assert.match(styles, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/)
assert.match(styles, /\.receipt-modal-backdrop\s*\{\s*align-items:\s*end/)
assert.match(styles, /\.pos-workspace \.mobile-header\s*\{\s*display:\s*none\s*!important/)
assert.match(styles, /\.pos-workspace \.mobile-pos-bill > \.pos-topbar[\s\S]{0,320}\.pos-workspace \.mobile-pos-bill > \.pos-summary-strip[\s\S]{0,180}display:\s*none\s*!important/)
assert.match(styles, /\.pos-workspace \.pos-product-grid\s*\{[\s\S]{0,180}grid-template-columns:\s*minmax\(0, 1fr\)\s*!important/)
assert.match(styles, /@media \(max-width: 380px\)/)
assert.match(styles, /\.pos-workspace \.bill-lines article > \.bill-line-index\s*\{\s*grid-area:\s*index/)
assert.match(styles, /grid-template-areas:\s*"index info qty remove"\s*"index info total remove"/)
assert.match(styles, /\.pos-workspace \.bill-lines\s*\{\s*min-height:\s*0/)

console.log('SALES_MOBILE_THREE_VIEW_OK')
