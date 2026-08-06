// Admin KHÔNG phải người đặt hàng. Admin chỉ quản lý danh sách đơn từ các chi nhánh:
// có bộ lọc (chi nhánh + khoảng ngày dùng chung của trang Quản trị, thêm tab trạng thái)
// và xuất được Excel. Kịch bản này khóa lại hợp đồng đó ở mức mã nguồn.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [admin, shell, app, orders] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/OrdersPage.tsx', import.meta.url), 'utf8'),
])

// 1. Sidebar admin phải trỏ mục "Đơn hàng" vào mục quản trị, KHÔNG vào trang lập phiếu.
const adminNav = sourceBetween(shell, 'const ADMIN_NAV', '\n]')
assert.ok(adminNav, 'Không tìm thấy ADMIN_NAV trong AppShell.')
assert.match(
  adminNav,
  /\{\s*id:\s*'management',\s*section:\s*'requests',[^}]*label:\s*'Đơn hàng'/,
  'Sidebar admin phải trỏ "Đơn hàng" vào mục requests của trang Quản trị.',
)
assert.doesNotMatch(
  adminNav,
  /\{\s*id:\s*'orders'/,
  'Sidebar admin không được trỏ thẳng vào trang lập phiếu đặt hàng của chi nhánh.',
)

// 2. Admin bị chặn vào trang đặt hàng của chi nhánh.
const ordersGuard = sourceBetween(app, "if (page === 'orders')", '\n')
assert.ok(ordersGuard, 'Không tìm thấy điều kiện phân quyền cho trang orders.')
assert.match(
  ordersGuard,
  /user\.role\s*!==\s*'admin'/,
  'Admin vẫn vào được trang lập phiếu đặt hàng của chi nhánh.',
)

// 3. Mục đặt hàng của admin là chỉ đọc: không có nút gửi/đổi trạng thái/xóa đơn.
const requestsSection = sourceBetween(
  admin,
  '{/* ===== ĐẶT HÀNG ===== */}',
  '{/* ===== NHÂN SỰ ===== */}',
)
assert.ok(requestsSection, 'Không tìm thấy mục ĐẶT HÀNG trong trang Quản trị.')
assert.match(requestsSection, /admin-readonly-note/, 'Mục đặt hàng của admin thiếu ghi chú chỉ đọc.')
for (const forbidden of ['updateSupplyRequestStatus', 'deleteSupplyRequest', 'createSupplyRequest']) {
  assert.ok(
    !requestsSection.includes(forbidden),
    `Mục đặt hàng của admin không được gọi ${forbidden} — admin chỉ theo dõi và xuất danh sách.`,
  )
}

// 4. Danh sách hiển thị phải dùng ĐÚNG tập đã lọc, không phải danh sách thô.
assert.match(
  requestsSection,
  /supplyRequestsByBranch\.map/,
  'Danh sách đơn của admin phải gom theo chi nhánh từ tập đã lọc.',
)
assert.ok(
  !/\{supplyRequests\.map\(/.test(requestsSection),
  'Danh sách đơn của admin đang render tập thô, bỏ qua bộ lọc chi nhánh/ngày/trạng thái.',
)
assert.match(
  requestsSection,
  /!filteredSupplyRequests\.length/,
  'Trạng thái rỗng phải bám theo tập đã lọc.',
)

// 5. Tab lọc trạng thái phải hiển thị và bám vào supplyStatusCounts.
assert.match(requestsSection, /SUPPLY_STATUS_TABS\.map/, 'Thiếu tab lọc trạng thái đơn.')
assert.match(requestsSection, /setSupplyStatusFilter\(tab\.id\)/, 'Tab trạng thái chưa đổi được bộ lọc.')
assert.match(requestsSection, /supplyStatusCounts\[tab\.id\]/, 'Tab trạng thái chưa hiển thị số đơn.')
for (const status of ['all', 'pending', 'acknowledged', 'fulfilled', 'cancelled']) {
  assert.match(
    admin,
    new RegExp(`id:\\s*'${status}'`),
    `Thiếu tab trạng thái "${status}".`,
  )
}

// 6. Nút xuất Excel phải lấy đúng tập đang lọc (khớp với cái admin nhìn thấy).
assert.match(requestsSection, /exportSupplyReportExcel/, 'Mục đặt hàng của admin thiếu nút xuất Excel.')
assert.match(
  requestsSection,
  /filteredSupplyRequests\.length\s*\?\s*''/,
  'Nút Excel phải chặn theo tập đã lọc, không theo tập thô.',
)

// 7. Trang đặt hàng của chi nhánh vẫn giữ nguyên khả năng lập phiếu cho ca trưởng.
assert.match(orders, /createSupplyRequests/, 'Ca trưởng phải còn gửi được yêu cầu đặt hàng.')
assert.ok(
  !/user\.role\s*===\s*'admin'/.test(orders),
  'Trang đặt hàng của chi nhánh không nên còn nhánh riêng cho admin.',
)

console.log('ADMIN_ORDERS_READONLY_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  if (start < 0) return ''
  const end = source.indexOf(endMarker, start + startMarker.length)
  return source.slice(start, end >= 0 ? end + endMarker.length : undefined)
}
