// Hoạt động POS trên trang Tổng quan (§19).
//
// Bản cũ đổ 30 bill gần nhất ra thẳng màn Tổng quan. Sau redesign, Tổng quan chỉ
// giữ 5 hoạt động gần nhất + lối "Xem tất cả giao dịch"; danh sách đầy đủ nằm ở
// drawer của màn Doanh thu. Khả năng đối chiếu một bill KHÔNG mất — vẫn đủ mã,
// giờ, chi nhánh, người bán, số lượng và số tiền.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [admin, dashboard] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/admin/DashboardPage.tsx', import.meta.url), 'utf8'),
])

// Tổng quan phải tải và realtime theo nguồn bill POS đang dùng cho doanh thu.
assert.match(admin, /overview:[\s\S]*'receipts'/)
assert.match(admin, /section === 'overview'[\s\S]*'sales_receipts'/)

// Danh sách giao dịch đầy đủ vẫn tuân theo khoảng ngày + chi nhánh đang chọn,
// mới nhất đứng trước, và có phân trang thay vì render tất cả (§78).
assert.match(admin, /const overviewBillRows = useMemo/)
assert.match(admin, /receipt\.businessDate >= from/)
assert.match(admin, /receipt\.businessDate <= to/)
assert.match(admin, /!branchId \|\| receipt\.branchId === branchId/)
assert.match(admin, /b\.createdAt\.localeCompare\(a\.createdAt\)/)
assert.match(admin, /Xem giao dịch \(\$\{overviewBillRows\.length\}\)/)
assert.match(admin, /revenueTransactionsRows\.map/)
assert.match(admin, /const revenueTransactionsPageSize = 50/)

// Tổng quan nhận đúng nguồn hóa đơn đã lọc chi nhánh và tự cắt còn 5 dòng.
assert.match(admin, /receipts=\{salesReceipts\.filter\(\(receipt\) => !branchId \|\| receipt\.branchId === branchId\)\}/)
assert.match(dashboard, /import type \{ SalesReceipt \}/)
assert.match(dashboard, /receipts: SalesReceipt\[\]/)
assert.match(dashboard, /const recentBills = useMemo/)
assert.match(dashboard, /\.slice\(0, 5\)/)
assert.match(dashboard, /Xem tất cả giao dịch/)

// Thẻ hoạt động vẫn hiển thị các trường vận hành cần để đối chiếu một bill.
assert.match(dashboard, /receipt\.code/)
assert.match(dashboard, /receipt\.sellerName/)
assert.match(dashboard, /receipt\.totalAmount/)
assert.match(dashboard, /receipt\.createdAt/)
assert.match(dashboard, /Không có giao dịch/)
// Bảng đầy đủ trong drawer mới là nơi hiện số lượng sản phẩm từng hóa đơn.
assert.match(admin, /receipt\.totalQuantity\)\} sản phẩm/)

console.log('ADMIN_OVERVIEW_BILL_HISTORY_OK')
