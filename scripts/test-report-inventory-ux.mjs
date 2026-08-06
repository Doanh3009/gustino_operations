import { readFile } from 'node:fs/promises'

const report = await readFile(new URL('../src/pages/ReportPage.tsx', import.meta.url), 'utf8')
const inventory = await readFile(new URL('../src/pages/InventoryPage.tsx', import.meta.url), 'utf8')
// Số học kho (làm tròn, đổi kg/g, khớp về 0) nằm ở lib từ 05/08/2026.
const entryLib = await readFile(new URL('../src/lib/inventoryEntry.ts', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

const failures = []
if (!report.includes("type ReportScope = 'day' | 'shift-1' | 'shift-2'")) failures.push('Báo cáo chưa có bộ lọc Tổng ngày/Ca 1/Ca 2.')
if (!report.includes('hasSalesActivity')) failures.push('Bảng xếp hạng vẫn có thể tạo dòng chỉ vì đăng ký ca dù không bán hàng.')
if (/row\.checkedIn\s*\?\s*`\$\{formatNumber\(row\.workHours\)\} giờ`/.test(report)) failures.push('Bảng xếp hạng vẫn hiển thị giờ làm/giờ đăng ký.')
if (!styles.includes('.rp-poster.rp-dense .rp-racers { grid-template-columns: 1fr; }')) failures.push('Poster mobile chưa ép bảng đông nhân viên về một cột, có nguy cơ tràn ngang.')
if (/smart-stock-list[\s\S]*?<span><i style=/.test(inventory)) failures.push('Danh sách kho vẫn còn thanh mức độ.')
if (!inventory.includes('const formatStockQuantity = formatStockAmount') || !entryLib.includes('export function isZeroQuantity')) failures.push('Hiển thị tồn chưa chuẩn hóa âm 0 và số thập phân kg/g.')
// Tồn kho phải hiện ĐỦ 3 chữ số như DB lưu — cắt còn 2 số là tái hiện lỗi "xuất mãi không hết".
if (!entryLib.includes('QUANTITY_DECIMALS = 3') || !entryLib.includes('toFixed(QUANTITY_DECIMALS)')) failures.push('Hiển thị tồn kho đang cắt bớt số lẻ so với sổ kho.')
if (!inventory.includes("unit: event.target.value as EntryUnit") || !entryLib.includes("export type EntryUnit = 'kg' | 'g'")) failures.push('Phiếu kho chưa cho chọn nhập kg hoặc gram.')
if (!inventory.includes('<th>Tồn hiện tại</th>')) failures.push('Phiếu kiểm kê chưa có cột tồn hiện tại đủ rõ để chụp/lưu làm báo cáo.')
if (!inventory.includes('saveInventoryCountImage') || !inventory.includes('Lưu / chia sẻ ảnh')) failures.push('Phiếu kiểm kê chưa có thao tác lưu/chia sẻ chính phiếu dưới dạng ảnh.')
if (!/const stock = useMemo\(\(\) => calculateStock\(movements\), \[movements, productTick\]\)/.test(inventory)) failures.push('Tồn kho chưa tính lại khi danh mục SKU cloud thay đổi.')
const countForm = sourceBetween(inventory, 'function InventoryReportForm(', '\nfunction InventoryCountPoster(')
if (!countForm.includes('getProducts().filter(isInventoryReportProduct)')) failures.push('Phiếu kiểm kê vẫn giới hạn vào danh mục hardcode, có thể bỏ sót SKU admin cấu hình.')
if (!countForm.includes('productById(line.productId)')) failures.push('Phiếu kiểm kê có thể lỗi hoặc hiện sai tên khi dòng tồn dùng SKU admin cấu hình.')
if (!countForm.includes('productTick')) failures.push('Phiếu kiểm kê chưa nhận tín hiệu danh mục SKU mới để bổ sung hàng đang tồn.')
const defaultCountLines = sourceBetween(inventory, 'function defaultInventoryLines(', '\nconst InventoryInfographic')
if (!defaultCountLines.includes('line.expected > 0.0001')) failures.push('Phiếu kiểm kê vẫn có thể tự liệt kê dòng không còn hàng thay vì chỉ hàng đang tồn trong kho.')

if (failures.length) {
  console.error(failures.map((item) => `FAIL: ${item}`).join('\n'))
  process.exit(1)
}
console.log('REPORT_INVENTORY_UX_OK')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  return start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
}
