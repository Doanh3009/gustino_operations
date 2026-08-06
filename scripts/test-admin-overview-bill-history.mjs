import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [admin, dashboard] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/admin/DashboardPage.tsx', import.meta.url), 'utf8'),
])

// Tổng quan phải tải và realtime theo nguồn bill POS đang dùng cho doanh thu.
assert.match(admin, /overview:[\s\S]*'receipts'/)
assert.match(admin, /section === 'overview'[\s\S]*'sales_receipts'/)

// Bill trên Tổng quan phải tuân theo đúng khoảng ngày và chi nhánh đang chọn,
// đồng thời mới nhất đứng trước để đây thực sự là "lịch sử gần đây".
assert.match(admin, /const overviewBillRows = useMemo/)
assert.match(admin, /receipt\.businessDate >= from/)
assert.match(admin, /receipt\.businessDate <= to/)
assert.match(admin, /!branchId \|\| receipt\.branchId === branchId/)
assert.match(admin, /b\.createdAt\.localeCompare\(a\.createdAt\)/)
assert.match(admin, /recentBills=\{overviewBillRows\}/)

// Thẻ lịch sử hiển thị các trường vận hành cần để đối chiếu một bill.
assert.match(dashboard, /import type \{ SalesReceipt \}/)
assert.match(dashboard, /recentBills: SalesReceipt\[\]/)
assert.match(dashboard, />Lịch sử bill gần đây</)
assert.match(dashboard, /receipt\.code/)
assert.match(dashboard, /receipt\.sellerName/)
assert.match(dashboard, /receipt\.totalQuantity/)
assert.match(dashboard, /receipt\.totalAmount/)
assert.match(dashboard, /receipt\.createdAt/)
assert.match(dashboard, /Chưa có bill trong khoảng đang chọn/)
assert.doesNotMatch(dashboard, /archiveRows|Phiếu kiểm kê|Chưa có hoạt động trong khoảng đang chọn/)

console.log('ADMIN_OVERVIEW_BILL_HISTORY_OK')
