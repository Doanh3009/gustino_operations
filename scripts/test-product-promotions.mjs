// KHUYẾN MÃI / GIẢM GIÁ SẢN PHẨM (13/08/2026).
//
// Bất biến sống còn: khuyến mãi chỉ quyết định giá TẠI THỜI ĐIỂM BÁN. Nếu lớp
// này lỡ áp vào các phép tính của quá khứ thì một chương trình chạy hôm nay sẽ
// viết lại doanh thu tháng trước — đúng cái lỗi mà bảng này sinh ra để chấm dứt
// (đợt sửa tay `sales_receipt_items` cho bánh hạt dẻ 06–13/08/2026).
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function loadModule(relativePath) {
  let source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  source = source.replace(/^import\s[^\n]+\n/gm, '')
  // `localDateKey` bị gỡ cùng dòng import — cấy lại bản tối giản.
  source = `function localDateKey(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0')
    return \`\${d.getFullYear()}-\${p(d.getMonth() + 1)}-\${p(d.getDate())}\`
  }\n${source}`
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

const promo = await loadModule('../src/lib/promotions.ts')
const { setActivePromotions, promotionalPriceFor, promotionCoversDate } = promo

const base = 36000
const chuongTrinh = {
  id: 'p1',
  productId: 'cake-box',
  branchId: undefined,
  name: 'Bánh hạt dẻ tháng 8',
  promoPrice: 29900,
  startsOn: '2026-08-06',
  endsOn: '2026-08-31',
  active: true,
  note: '',
}
setActivePromotions([chuongTrinh])

// ── 1. Trong kỳ thì áp giá KM, ngoài kỳ thì giá gốc ─────────────────────────
assert.equal(promotionalPriceFor('cake-box', base, { date: '2026-08-10' }).price, 29900)
assert.equal(promotionalPriceFor('cake-box', base, { date: '2026-08-06' }).price, 29900, 'Ngày bắt đầu phải nằm TRONG kỳ.')
assert.equal(promotionalPriceFor('cake-box', base, { date: '2026-08-31' }).price, 29900, 'Ngày kết thúc phải nằm TRONG kỳ.')
assert.equal(promotionalPriceFor('cake-box', base, { date: '2026-08-05' }).price, base, 'Trước kỳ = giá gốc.')
assert.equal(promotionalPriceFor('cake-box', base, { date: '2026-09-01' }).price, base, 'Sau kỳ = giá gốc.')
assert.equal(promotionalPriceFor('san-pham-khac', base, { date: '2026-08-10' }).price, base)

// ── 2. Tắt chương trình là giá về ngay ──────────────────────────────────────
setActivePromotions([{ ...chuongTrinh, active: false }])
assert.equal(promotionalPriceFor('cake-box', base, { date: '2026-08-10' }).price, base)
assert.equal(promotionCoversDate({ ...chuongTrinh, active: false }, '2026-08-10'), false)

// ── 3. Chương trình của ĐÚNG chi nhánh thắng chương trình toàn chuỗi ────────
setActivePromotions([
  chuongTrinh,
  { ...chuongTrinh, id: 'p2', branchId: 'lotte-vt', promoPrice: 25000 },
])
assert.equal(
  promotionalPriceFor('cake-box', base, { branchId: 'lotte-vt', date: '2026-08-10' }).price,
  25000,
  'Vũng Tàu phải nhận mức riêng của chi nhánh.',
)
assert.equal(
  promotionalPriceFor('cake-box', base, { branchId: 'gold-coast', date: '2026-08-10' }).price,
  29900,
  'Chi nhánh không có mức riêng thì dùng mức toàn chuỗi.',
)

// ── 4. Giảm theo phần trăm ──────────────────────────────────────────────────
setActivePromotions([{ ...chuongTrinh, promoPrice: undefined, discountPercent: 25 }])
assert.equal(promotionalPriceFor('cake-box', base, { date: '2026-08-10' }).price, 27000)

// ── 5. Cấu hình sai KHÔNG được làm tăng giá ─────────────────────────────────
setActivePromotions([{ ...chuongTrinh, promoPrice: 99000 }])
assert.equal(
  promotionalPriceFor('cake-box', base, { date: '2026-08-10' }).price,
  base,
  'Khuyến mãi đắt hơn giá gốc là cấu hình sai — phải giữ giá gốc, không tăng giá khách.',
)

// ── 6. BẤT BIẾN: không có ngày thì KHÔNG áp khuyến mãi ──────────────────────
// `productSaleValues` cũng dùng để tính lại doanh thu quá khứ (túi phát cho
// nhân viên, KPI, báo cáo). Mặc định phải là GIÁ GỐC, chỉ nơi biết chắc ngày
// nghiệp vụ mới được truyền vào.
const commission = await readFile(new URL('../src/lib/commission.ts', import.meta.url), 'utf8')
assert.match(
  commission,
  /const price = options\?\.date\s*\n\s*\? promotionalPriceFor/,
  'productSaleValues chỉ được áp khuyến mãi khi caller truyền ngày nghiệp vụ.',
)
assert.doesNotMatch(
  commission,
  /promotionalPriceFor\([^)]*date: localDateKey\(\)/,
  'Không được lấy mặc định "hôm nay" trong bộ tính doanh thu — sẽ viết lại lịch sử.',
)

// ── 7. POS phải truyền chi nhánh + ngày nghiệp vụ khi ghi hóa đơn ───────────
const sales = await readFile(new URL('../src/pages/SalesPage.tsx', import.meta.url), 'utf8')
assert.match(sales, /buildCartLines\(cart, \{ branchId: user\.branchId, date: selectedDate \}\)/)
assert.match(sales, /productSaleValues\(productId, quantity, pricing\)/)
assert.match(sales, /unitPrice: values\.price/, 'Giá ghi vào hóa đơn phải là giá đã áp khuyến mãi.')
assert.match(sales, /values\.discounted/, 'POS phải hiện giá gốc gạch ngang khi đang khuyến mãi.')

// ── 8. Migration: ràng buộc dữ liệu và phân quyền ───────────────────────────
const migration = await readFile(new URL('../supabase/migrations/20260813_product_promotions.sql', import.meta.url), 'utf8')
assert.match(migration, /product_promotions_one_kind/, 'Phải chặn cấu hình vừa có giá cố định vừa có phần trăm.')
assert.match(migration, /product_promotions_range_valid/, 'Phải chặn ngày kết thúc trước ngày bắt đầu.')
assert.match(migration, /for select to authenticated using \(true\)/, 'POS của nhân viên phải đọc được giá khuyến mãi.')
assert.match(migration, /\(public\.current_profile\(\)\)\.role = 'admin'/, 'Chỉ Admin được sửa giá.')

console.log('PRODUCT_PROMOTIONS_OK — giá đổi theo kỳ, hóa đơn cũ không bị đụng.')
