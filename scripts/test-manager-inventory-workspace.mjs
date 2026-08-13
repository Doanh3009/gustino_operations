// Màn Kho trong trang Quản trị — hợp đồng sau redesign 13/08/2026 (§29–§59).
//
// Điều đổi: Kho không còn là một trang liệt kê chi nhánh rồi mới xổ SKU. Nó là
// ẢNH CHỤP TỒN TẠI MỘT NGÀY, danh sách SKU phẳng, bấm một SKU mở drawer đối
// chiếu. Đối soát ca, sổ phát sinh, hao hụt chi tiết và Excel KHÔNG bị xoá —
// chúng chuyển vào menu `•••` và các drawer tương ứng.
//
// Điều KHÔNG đổi (và test này khoá): mọi số lượng kèm đơn vị, hao hụt có danh
// sách dòng chi tiết, đối chiếu ca lọc sẵn ca cần xem, sổ phát sinh có tìm/lọc/
// phân trang, Excel đủ 7 sheet, và tất cả phải đọc được trên điện thoại.
import { readFile } from 'node:fs/promises'

const [admin, ui, styles] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/ui.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

const failures = []
const inventorySection = sourceBetween(admin, '{/* ===== KHO HÀNG =====', '{/* ===== ĐẶT HÀNG ===== */}')
// 13/08/2026 — không còn drawer. Chi tiết SKU bung ngay dưới dòng, còn đối
// soát ca / sổ phát sinh / hao hụt nằm thẳng trên trang trong khối gấp.
const skuInline = sourceBetween(admin, 'Mở NGAY TẠI DÒNG', '── HAO HỤT')
const wasteBlock = sourceBetween(admin, '── HAO HỤT', '<strong>Đối soát theo ca</strong>')
const shiftBlock = sourceBetween(admin, '<strong>Đối soát theo ca</strong>', '<strong>Sổ phát sinh kho</strong>')
const ledgerBlock = sourceBetween(admin, '<strong>Sổ phát sinh kho</strong>', '===== ĐẶT HÀNG =====')

if (!inventorySection) failures.push('Không tìm thấy khối màn Kho trong trang Quản trị.')

// ── Ngày là trọng tâm (§34) ─────────────────────────────────────────────────
if (!admin.includes('const [inventoryDate, setInventoryDate]')) {
  failures.push('Màn tồn kho phải làm việc trên MỘT ngày cụ thể.')
}
if (!inventorySection.includes("inventoryDate === todayKey ? 'Tồn hiện tại' : `Tồn cuối")) {
  failures.push('Ngày quá khứ phải đổi tên cột thành "Tồn cuối ngày", không được gọi là "Tồn hiện tại".')
}
if (!admin.includes('item.shiftDate <= inventoryDate')) {
  failures.push('Tồn cuối ngày phải tính bằng cách cắt sổ tới hết ngày đó, không phải lấy tồn hiện tại.')
}
if (admin.includes('inventorySalesDate')) {
  failures.push('Đối soát xuất bán vẫn bị khóa vào một ngày riêng thay vì khoảng ngày báo cáo.')
}

// ── Không lặp bộ lọc chi nhánh (§33) ────────────────────────────────────────
if ((admin.match(/<BranchSelector/g) || []).length !== 1) {
  failures.push('Chi nhánh chỉ được chọn đúng một lần ở thanh lọc đầu trang.')
}
if (!inventorySection.includes('{!branchId && <span>Chi nhánh</span>}')) {
  failures.push('Chỉ thêm cột Chi nhánh khi đang xem tất cả chi nhánh.')
}

// ── Summary nhỏ, không KPI card lớn (§35) ───────────────────────────────────
if (!inventorySection.includes('<SummaryLine') || !admin.includes('const inventoryDaySummary')) {
  failures.push('Kho phải dùng summary một dòng thay cho hàng KPI card.')
}
for (const label of ['mặt hàng', 'sắp hết', 'hết hàng', 'âm kho']) {
  if (!inventorySection.includes(label)) failures.push(`Summary kho thiếu chỉ số "${label}".`)
}

// ── Tìm + lọc + xếp theo mức độ cần xử lý (§36) ─────────────────────────────
if (!inventorySection.includes('<SearchInput') || !inventorySection.includes('<FilterChips')) {
  failures.push('Bảng tồn thiếu ô tìm không dấu hoặc chip lọc nhóm mặt hàng.')
}
if (!admin.includes('const inventoryVisibleLines = useMemo(') || !admin.includes('severity(a) - severity(b)')) {
  failures.push('Bảng tồn chưa xếp theo mức độ cần xử lý (âm → hết → sắp hết → đủ dùng).')
}
if (!inventorySection.includes('Âm kho') || !inventorySection.includes('Hết hàng') || !inventorySection.includes('Sắp hết')) {
  failures.push('Trạng thái tồn phải nói rõ bằng CHỮ, không chỉ bằng màu (§85).')
}

// ── Lớp 2: drawer đối chiếu SKU (§39) ───────────────────────────────────────
if (!admin.includes('const [inventorySkuDetail, setInventorySkuDetail]') || !skuInline) {
  failures.push('Bấm một SKU phải bung chi tiết NGAY TẠI DÒNG, giải thích vì sao tồn ra con số đó.')
}
if (admin.includes('Drawer của màn Kho')) {
  failures.push('Kho không được quay lại kiểu mở panel bên phải — chủ hệ thống đã bác.')
}
for (const row of ['Tồn đầu ngày', 'Nhập kho', 'Thành phẩm tạo ra', 'Bán hàng', 'Hao hụt', 'Điều chỉnh (kiểm kê)']) {
  if (!skuInline.includes(row)) failures.push(`Bảng đối chiếu trong ngày thiếu dòng "${row}".`)
}
if (!skuInline.includes('Biến động trong ngày')) {
  failures.push('Drawer SKU thiếu timeline biến động trong ngày.')
}
if (!admin.includes('const inventorySkuCheckpoint') || !skuInline.includes('kiểm kê đã xác nhận')) {
  failures.push('Thiếu cảnh báo checkpoint kiểm kê cho ngày quá khứ (§50).')
}
if (!admin.includes("item.type === 'waste' && item.sourceProductId")) {
  failures.push('Hao hụt chế biến bị trừ tồn hai lần — phải loại khỏi phép cộng đối chiếu.')
}

// ── Lớp 4: báo cáo/audit chuyển vào `•••`, KHÔNG bị xoá (§32, §57, §58) ─────
for (const item of ['Xuất Excel', 'Xuất hao hụt', 'Đối soát theo ca', 'Sổ phát sinh kho', 'Hao hụt']) {
  if (!inventorySection.includes(item)) failures.push(`Màn kho thiếu mục "${item}".`)
}
if (!inventorySection.includes('canOpenAdminConsole(user.role)')) {
  failures.push('Sổ phát sinh đầy đủ phải giữ đúng ranh giới quyền cũ (Admin/SUP MT).')
}
if (!ledgerBlock.includes('label="Tìm trong sổ phát sinh kho"')
  || !ledgerBlock.includes('aria-label="Lọc loại phiếu kho"')
  || !ledgerBlock.includes('<Pagination')) {
  failures.push('Sổ phát sinh kho chưa có lọc loại phiếu, tìm kiếm và phân trang.')
}
if (!admin.includes('const inventoryShiftIssueRows =') || !shiftBlock.includes('inventoryShiftVisibleRows.map')) {
  failures.push('Bảng đối chiếu ca chưa lọc sẵn về nhóm ca cần xem.')
}
if (!shiftBlock.includes('Out chính thức = Tồn đầu + Nhập thêm − Tồn bàn giao − Hao hụt')) {
  failures.push('Đối soát ca phải nói rõ công thức Out chính thức và vai trò đối chiếu của POS.')
}
if (!wasteBlock.includes('inventoryWasteDetailRows.map')) {
  failures.push('Chi tiết hao hụt theo từng dòng đã biến mất.')
}

// ── Màn chính không đổ dữ liệu thô (§56) ────────────────────────────────────
// Hao hụt: yêu cầu trực tiếp của chủ hệ thống — xem theo ngày/tháng/năm kèm biểu đồ.
for (const [needle, message] of [
  ['const [wasteGrouping', 'Thiếu chế độ xem hao hụt theo ngày/tháng/năm.'],
  ['inventoryWasteSeries', 'Thiếu chuỗi dữ liệu hao hụt theo kỳ.'],
  ['<BarChart', 'Hao hụt phải có biểu đồ, không chỉ bảng số.'],
]) {
  if (!admin.includes(needle)) failures.push(message)
}
if (!admin.includes("row.unit === 'kg'")) {
  failures.push('Biểu đồ hao hụt phải tách theo đơn vị — cộng lẫn kg với cái/túi là con số vô nghĩa (§54).')
}
for (const id of ["{ id: 'day', label: 'Ngày' }", "{ id: 'month', label: 'Tháng' }", "{ id: 'year', label: 'Năm' }"]) {
  if (!wasteBlock.includes(id)) failures.push(`Hao hụt thiếu chế độ xem ${id}.`)
}

// ── Các hợp đồng số liệu cũ giữ nguyên ──────────────────────────────────────
if (!admin.includes("item.type === 'sale_out'") || !admin.includes('item.shiftDate >= from') || !admin.includes('item.shiftDate <= to')) {
  failures.push('Bảng xuất trong kỳ chưa lọc đúng movement sale_out trong khoảng Từ ngày–Đến ngày.')
}
if (!admin.includes('formatInventoryQuantity') || !admin.includes('summarizeInventoryQuantities')) {
  failures.push('Số kho chưa có định dạng kèm đơn vị và chưa tách tổng theo kg/cái.')
}
for (const sheetName of ['Tổng hợp kho', 'Danh sách hao hụt', 'Đối chiếu ca', 'Xuất bán trong kỳ', 'Nhật ký kho', 'Tồn hiện tại', 'Phiếu kiểm kê']) {
  if (!admin.includes(`addWorksheet('${sheetName}')`)) failures.push(`Excel kho thiếu sheet ${sheetName}.`)
}
if (!admin.includes('buildWasteDetailRows') || !admin.includes('inventoryWasteDetailRows')) {
  failures.push('Hao hụt kho chưa có danh sách dòng chi tiết riêng, đang còn nguy cơ tính bình quân.')
}
if (!admin.includes('exportInventoryLoss') || !admin.includes('danh-sach-hao-hut')) {
  failures.push('Chưa có nút/file Excel riêng cho danh sách hao hụt cụ thể.')
}

// ── Không quay lại kiểu card, và phải chạy được trên điện thoại ─────────────
if (inventorySection.includes('inventory-branch-card') || inventorySection.includes('className="section-card')) {
  failures.push('Màn kho không được quay lại dạng thẻ (card).')
}
for (const selector of ['.gt-list__row', '.gt-inline-detail', '.gt-fold', '.gt-recon', '.gt-timeline', '.gt-badge']) {
  if (!ui.includes(selector)) failures.push(`Thiếu CSS design system: ${selector}.`)
}
if (!/@media \(max-width: 900px\)[\s\S]*\.gt-list__head \{ display: none/.test(ui)) {
  failures.push('Bảng ngang chưa được chuyển thành dòng dọc trên điện thoại (§38, §72).')
}
if (!/@media \(max-width: 900px\)[\s\S]*\.gt-inline-detail__grid \{ grid-template-columns: minmax\(0, 1fr\)/.test(ui)) {
  failures.push('Khối chi tiết bung tại dòng chưa xếp một cột trên điện thoại.')
}
if (!styles.includes("@import './ui.css'")) {
  failures.push('Design system chưa được nạp vào bảng style chính.')
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
