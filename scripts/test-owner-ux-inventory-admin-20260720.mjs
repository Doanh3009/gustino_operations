import fs from 'node:fs'

const inventory = fs.readFileSync('src/pages/InventoryPage.tsx', 'utf8')
// 05/08/2026: phần tính toán nhập/xuất/sửa tồn tách sang lib để test được số học.
const entryLib = fs.readFileSync('src/lib/inventoryEntry.ts', 'utf8')
const store = fs.readFileSync('src/lib/store.ts', 'utf8')
const shell = fs.readFileSync('src/components/AppShell.tsx', 'utf8')
const admin = fs.readFileSync('src/pages/AdminPage.tsx', 'utf8')
const styles = fs.readFileSync('src/styles.css', 'utf8')

const checks = [
  ['manual warehouse issue remains confirmable when it exceeds displayed stock', inventory.includes('Tồn kho chưa đủ cho phiếu xuất:') && inventory.includes('Vẫn tiếp tục lập phiếu?') && inventory.includes('{ allowInsufficientStock }')],
  ['known approved inventory override avoids a failing RPC request', store.includes('if (options?.allowInsufficientStock)') && store.includes('await insertStockRowsDirect(rows)')],
  ['sub-kilogram stock defaults outbound entry to grams', entryLib.includes('export function defaultEntryUnit') && entryLib.includes("Number(available) > 0 && Number(available) < 1 ? 'g' : 'kg'")],
  ['packing residue is not labelled ready to sell', inventory.includes("'packing-residue'") && inventory.includes('Còn dư, chưa đủ đóng gói') && inventory.includes('PACKING_OPTIONS_BY_OUTPUT')],
  // 05/08/2026: món trong menu bán không còn là một NHÓM của bảng tồn — POS ghi
  // hóa đơn chứ không ghi movement, nên `calculateStock` loại hẳn chúng ra thay
  // vì hiển thị một nhóm luôn rỗng.
  // 07/08/2026: thành phẩm cũng bị gỡ khỏi bảng tồn theo quyết định của chủ quán
  // (thành phẩm dùng trong ngày, không để dồn qua nhiều ngày). Bảng tồn chỉ còn
  // NGUYÊN LIỆU + BAO BÌ; POS vẫn trừ kho thành phẩm y như cũ.
  ['stock screen shows raw + packaging only, menu items and finished goods filtered out', inventory.includes("type StockDisplayCategory = 'all' | 'raw' | 'packaging'") && !inventory.includes("| 'sale'") && store.includes('isWarehouseProduct(product) || byProduct.has(product.id)')],
  ['mobile header no longer renders Gustino logo', !shell.includes('<span className="mh-logo"><img src="/gustino-logo.jpg" alt="GUSTINO" /></span>')],
  ['employee sales uses daily revenue aggregation', admin.includes('const employeeDailyRevenue = buildEmployeeDailyRevenueRows(employeeReceipts)') && admin.includes('Doanh thu theo ngày')],
  ['employee daily revenue has an informative chart and table', admin.includes('admin-employee-daily-revenue-chart') && admin.includes('admin-employee-daily-revenue-table')],
  ['KPI screen explains formula and keeps day-filtered detail', admin.includes('Cách đọc KPI') && admin.includes('Mỗi dòng bên dưới là một nhân viên trong một ngày')],
  ['Admin purchasing is read-only and exports Excel', admin.includes('Admin chỉ theo dõi, lọc và xuất danh sách; không đặt hàng hoặc đổi trạng thái đơn tại màn này.') && admin.includes('exportSupplyReportExcel')],
  ['responsive hardening prevents common flex/grid/table overflow', styles.includes('/* Owner UX overflow hardening 2026-07-20 */') && styles.includes('min-width: 0;') && styles.includes('overflow-wrap: anywhere;')],
  ['competition classification remains visible at tablet widths', styles.includes('.competition-classification-table {') && styles.includes('overflow-x: auto;') && styles.includes('.competition-classification-table.with-reward .competition-classification-row')],
]

const failed = checks.filter(([, ok]) => !ok)
if (failed.length) {
  for (const [label] of failed) console.error(`FAIL: ${label}`)
  process.exit(1)
}

console.log('OWNER_UX_INVENTORY_ADMIN_20260720_OK')
