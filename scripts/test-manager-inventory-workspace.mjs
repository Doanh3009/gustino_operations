import { readFile } from 'node:fs/promises'

const [admin, styles] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

const failures = []
const inventorySection = sourceBetween(
  admin,
  "{/* ===== BÁO CÁO KHO ===== */}",
  "{/* ===== ĐẶT HÀNG ===== */}",
)

if (!admin.includes("const [inventoryDetailBranchId, setInventoryDetailBranchId] = useState('')")) {
  failures.push('Chi tiết kho chi nhánh chưa có trạng thái chọn ổn định do React quản lý.')
}
if (inventorySection.includes('<details className="loss-stock-item"')) {
  failures.push('Chi tiết SKU vẫn xổ dài ngay giữa danh sách và đẩy các chi nhánh còn lại khỏi màn hình.')
}
// 07/08/2026: bỏ lưới thẻ (`inventory-branch-grid`/`inventory-branch-card`) —
// mỗi chi nhánh là MỘT DÒNG, cùng luật "không dùng card" với màn Kho ca trưởng.
if (!inventorySection.includes('className="admin-stock-branches"') || !inventorySection.includes('className={`admin-stock-branch-row')) {
  failures.push('Các chi nhánh chưa được trình bày thành bảng dòng kho, dễ so sánh.')
}
if (inventorySection.includes('inventory-branch-card')) {
  failures.push('Thẻ chi nhánh dạng card đã bị gỡ — đừng dựng lại.')
}
// Bảng tồn của chi nhánh phải tìm được và lọc được, không bắt cuộn hết 30 SKU.
if (!inventorySection.includes('aria-label="Tìm mặt hàng trong kho chi nhánh"')
  || !inventorySection.includes('aria-label="Lọc trạng thái tồn"')) {
  failures.push('Bảng tồn chi nhánh thiếu ô tìm không dấu hoặc chip lọc trạng thái.')
}
if (!admin.includes('const inventoryStockLines = useMemo(') || !admin.includes('severity(a) - severity(b)')) {
  failures.push('Bảng tồn chưa xếp theo mức độ cần xử lý (hết → sắp hết → còn hàng).')
}
// Sổ phát sinh kho phải phân trang: một tháng là vài nghìn phiếu.
if (!inventorySection.includes('aria-label="Tìm trong sổ phát sinh kho"')
  || !inventorySection.includes('aria-label="Lọc loại phiếu kho"')
  || !inventorySection.includes('<Pagination')) {
  failures.push('Sổ phát sinh kho chưa có lọc loại phiếu, tìm kiếm và phân trang.')
}
// Đối chiếu ca mặc định chỉ hiện ca cần xem (đang mở hoặc lệch số).
if (!admin.includes('const inventoryShiftIssueRows =') || !inventorySection.includes('inventoryShiftVisibleRows.map')) {
  failures.push('Bảng đối chiếu ca chưa lọc sẵn về nhóm ca cần xem.')
}
if (!inventorySection.includes('aria-expanded={isSelected}') || !inventorySection.includes('aria-controls="inventory-branch-detail-panel"')) {
  failures.push('Nút mở chi tiết chi nhánh chưa công bố đúng trạng thái đóng/mở cho trình duyệt.')
}
if (!inventorySection.includes('id="inventory-branch-detail-panel"') || !inventorySection.includes('inventory-branch-detail-shell')) {
  failures.push('Chưa có bảng chi tiết riêng nằm sau toàn bộ danh sách chi nhánh.')
}
if (inventorySection.includes('Ngưỡng cảnh báo') || inventorySection.includes('inventory-stock-threshold')) {
  failures.push('Bảng tồn SKU vẫn còn cột ngưỡng cảnh báo mà chủ hệ thống yêu cầu bỏ.')
}
if (!inventorySection.includes('inventory-stock-status')) {
  failures.push('Bảng tồn SKU phải giữ trạng thái dễ đọc sau khi bỏ cột ngưỡng.')
}
if (admin.includes('inventorySalesDate')) {
  failures.push('Bảng xuất bán/bàn giao vẫn bị khóa vào một ngày riêng thay vì khoảng ngày báo cáo.')
}
if (!admin.includes("item.type === 'sale_out'") || !admin.includes('item.shiftDate >= from') || !admin.includes('item.shiftDate <= to')) {
  failures.push('Bảng xuất trong kỳ chưa lọc đúng movement sale_out trong khoảng Từ ngày–Đến ngày.')
}
if (!inventorySection.includes('Xuất bán và tồn bàn giao') || !inventorySection.includes('inventory-shift-reconciliation-table')) {
  failures.push('Màn kho chưa có bảng đối chiếu Out theo bàn giao và POS cho quản lý.')
}
if (!admin.includes('formatInventoryQuantity') || !admin.includes('summarizeInventoryQuantities')) {
  failures.push('Số kho chưa có định dạng kèm đơn vị và chưa tách tổng theo kg/cái.')
}
if (/formatNumber\((stockUnits|inbound|outbound)\)/.test(inventorySection)) {
  failures.push('Card chi nhánh vẫn hiển thị tổng số trộn nhiều đơn vị mà không có kg/cái.')
}
for (const sheetName of ['Tổng hợp kho', 'Đối chiếu ca', 'Xuất bán trong kỳ', 'Nhật ký kho', 'Tồn hiện tại', 'Phiếu kiểm kê']) {
  if (!admin.includes(`addWorksheet('${sheetName}')`)) failures.push(`Excel kho thiếu sheet ${sheetName}.`)
}
if (!inventorySection.includes('Hao hụt cần chú ý') || !inventorySection.includes('inventory-loss-panel')) {
  failures.push('Chi tiết chi nhánh chưa tách khu vực hao hụt cần chú ý.')
}

for (const selector of [
  '.inventory-branch-section',
  '.admin-stock-branches',
  '.admin-stock-branch-row',
  '.admin-stock-chips',
  '.admin-stock-search',
  '.inventory-branch-detail-shell',
  '.inventory-stock-table',
  '.inventory-loss-panel',
  '.inventory-shift-reconciliation',
  '.inventory-shift-reconciliation-table',
]) {
  if (!styles.includes(selector)) failures.push(`Thiếu CSS giao diện kho: ${selector}.`)
}
if (/^\.inventory-branch-card/m.test(styles)) {
  failures.push('CSS thẻ chi nhánh cũ phải được dọn cùng lúc với markup.')
}
if (!/@media \(max-width: 680px\)[\s\S]*\.admin-stock-branch-row \{ grid-template-columns: minmax\(0, 1fr\)/.test(styles)) {
  failures.push('Bảng chi nhánh chưa có khóa một cột an toàn trên điện thoại.')
}
if (!/@media \(max-width: 680px\)[\s\S]*\.inventory-stock-row/.test(styles)) {
  failures.push('Bảng SKU chưa có bố cục responsive riêng cho điện thoại.')
}

if (failures.length) {
  console.error(failures.map((item) => `FAIL: ${item}`).join('\n'))
  process.exit(1)
}

console.log('MANAGER_INVENTORY_WORKSPACE_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
