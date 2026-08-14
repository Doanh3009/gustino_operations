/**
 * ADMIN_ATTENTION_AND_WASTE — phản hồi chủ hệ thống 14/08/2026.
 *
 * Ba câu nói, ba hợp đồng phải giữ:
 *
 *  1. *"Phần cần xử lý bấm vào cũng có xử lý được đâu"* — mỗi dòng "Cần xử lý"
 *     phải mang theo TOẠ ĐỘ của chính nó (chi nhánh, ngày, SKU / phiên ca / kỳ
 *     hao hụt) và màn đích phải lọc + bung + cuộn tới đúng chỗ đó.
 *  2. *"Bảng hao hụt đang cho coi 1 loại 1 ngày hao hụt à, không coi được 1 danh
 *     sách tổng của ngày đó"* — mỗi kỳ hao hụt phải bung ra ĐỦ mặt hàng × chi
 *     nhánh, không phải chỉ mặt hàng hao nhiều nhất.
 *  3. *"Load hơi lâu"* — đổi section không được đọc lại nguồn đã có; realtime chỉ
 *     đọc lại đúng bảng vừa đổi.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const dashboard = await read('src/pages/admin/DashboardPage.tsx')
const adminPage = await read('src/pages/AdminPage.tsx')
const store = await read('src/lib/store.ts')

const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

/* ── 1. "Cần xử lý" bấm vào phải ra đúng chỗ ─────────────────────────────── */

check(/export interface OverviewFocus/.test(dashboard), 'Thieu kieu OverviewFocus mo ta toa do cua viec can xu ly.')
check(
  /onOpenSection: \(\s*section: [^)]*\s*focus\?: OverviewFocus,?\s*\) => void/.test(dashboard),
  'onOpenSection phai nhan them toa do focus, khong chi doi section.',
)
// Âm kho / hết hàng: phải mở sẵn đúng SKU tại đúng chi nhánh.
check(
  /onOpenSection\('inventory', \{[\s\S]{0,220}sku: \{ branchId: line\.branchId, productId: line\.product\.id \}/.test(dashboard),
  'Dong am kho / het hang chua mo san dung SKU o man Kho.',
)
// Ca chưa bàn giao: phải mở sẵn khối đối soát ca của đúng ngày đó.
check(
  /onOpenSection\('inventory', \{[\s\S]{0,200}shiftSessionId: shift\.sessionId/.test(dashboard),
  'Dong "Ca N chua ban giao" chua dan sang khoi doi soat ca cua chinh ca do.',
)
check(
  /date: shift\.businessDate/.test(dashboard),
  'Dong ca chua ban giao phai keo ky ve dung ngay cua ca, neu khong bang doi soat se rong.',
)
// Chấm công: đúng người, đúng ngày, đúng chi nhánh.
check(
  /onOpenSection\('attendance', \{[\s\S]{0,200}employeeName: issue\.employeeName/.test(dashboard),
  'Dong cham cong tu dong chua dan toi dung nhan vien can ra soat.',
)
check(
  !/onAction: \(\) => onOpenSection\('inventory'\)/.test(dashboard),
  'Van con dong "Can xu ly" doi section tay khong — phai kem toa do.',
)

check(/function openSectionWithFocus/.test(adminPage), 'Trang Quan tri thieu cua vao openSectionWithFocus.')
check(
  /openSectionWithFocus[\s\S]{0,1800}setBranchId\(focus\.branchId\)/.test(adminPage),
  'openSectionWithFocus chua ep bo loc chi nhanh ve dung noi phat sinh.',
)
check(
  /focus\.date < from \|\| focus\.date > to/.test(adminPage),
  'Ngay can soi nam ngoai ky dang loc thi phai keo ky ve — neu khong man dich mo ra rong.',
)
check(
  /setInventorySkuDetail\(focus\?\.sku \|\| null\)/.test(adminPage),
  'Chua bung san khoi doi chieu cua dung SKU vua bam.',
)
check(
  /if \(focus\?\.shiftSessionId\) setInventoryShiftFoldOpen\(true\)/.test(adminPage),
  'Khoi "Doi soat theo ca" chua tu mo khi bam tu Tong quan.',
)
check(/setWasteOpenKey\(focus\?\.wasteKey \|\| ''\)/.test(adminPage), 'Chua bung san dung ky hao hut vua bam.')
check(
  /id="admin-inventory-shift-recon"/.test(adminPage) && /id="admin-inventory-waste"/.test(adminPage),
  'Thieu neo de cuon toi dung khoi sau khi doi section.',
)
check(/scrollIntoView/.test(adminPage), 'Doi section xong phai cuon toi khoi dich.')
// Khối gấp phải CÓ ĐIỀU KHIỂN, nếu không `setInventoryShiftFoldOpen` chỉ là biến chết.
check(
  /<details[\s\S]{0,120}open=\{inventoryShiftFoldOpen\}/.test(adminPage),
  'Khoi doi soat ca phai la details co dieu khien thi moi mo san duoc.',
)

/* ── 2. Hao hụt: một kỳ = danh sách đầy đủ ───────────────────────────────── */

check(
  /lines: Map<string, WasteLine>/.test(adminPage),
  'Moi ky hao hut phai gom du mat hang × chi nhanh, khong chi giu mat hang top.',
)
check(
  /row\.lines\.map\(\(line\) => \(/.test(adminPage),
  'Bang hao hut chua ve danh sach day du cua ky dang mo.',
)
check(
  !/topProduct/.test(adminPage),
  'Van con hien MOT mat hang dai dien cho ca ky — dung yeu cau la danh sach tong.',
)
check(
  /productCount/.test(adminPage) && /branchCount/.test(adminPage),
  'Dong tong cua ky phai noi ro bao nhieu mat hang / bao nhieu chi nhanh.',
)
check(
  /onClick=\{\(\) => setWasteOpenKey\(open \? '' : row\.key\)\}/.test(adminPage),
  'Dong ky hao hut phai bam duoc de bung danh sach.',
)

/* ── 3. Load: chỉ đọc lại thứ đã cũ ──────────────────────────────────────── */

check(
  /loadedSignatureRef/.test(adminPage),
  'Thieu chu ky lan doc gan nhat — doi section se doc lai toan bo nguon nhu cu.',
)
check(
  /refresh\(true, \{ reuseLoaded: true \}\)/.test(adminPage),
  'Luot tai khi doi section/ky phai dung lai du lieu da co.',
)
check(
  /if \(!pending\.length\) return/.test(adminPage),
  'Khong con gi phai doc thi phai thoat ngay, khong duoc bat man hinh loading.',
)
check(
  /results\.forEach\(\(\[key, value\]\) => \{[\s\S]{0,160}apply\[key\]\(value\)/.test(adminPage),
  'Chi duoc set dung nguon vua doc — set ca 13 nguon se ghi de bang du lieu cu cua closure.',
)
check(
  /MANAGEMENT_TABLE_DATA_KEYS/.test(adminPage),
  'Realtime phai biet bang nao lam cu nguon nao de khong tai lai ca section.',
)
check(
  /stock_movements: \['movements'\]/.test(adminPage) && /sales_receipts: \['receipts'\]/.test(adminPage),
  'Ban do bang → nguon du lieu thieu hai bang nang nhat.',
)
check(
  /void refresh\(false, \{ only \}\)/.test(adminPage),
  'Realtime van goi tai lai toan bo thay vi chi phan lien quan.',
)
check(
  /REALTIME_REFRESH_DEBOUNCE_MS = 3000/.test(adminPage),
  'Thieu chong doi su kien realtime: gio cao diem moi hoa don la mot luot tai.',
)
check(
  /MANAGEMENT_POLL_INTERVAL_MS = 120000/.test(adminPage),
  'Nhip nen phai ha xuong 2 phut — no chi la luoi an toan, realtime moi la duong chinh.',
)
check(
  !/window\.setInterval\(refreshWhenActive, 30000\)/.test(adminPage),
  'Van con nhip nen 30 giay doc lai du 13 nguon.',
)
// Hai nguồn JSON nặng phải cắt theo kỳ ngay ở lượt đọc.
check(
  /fetchInventoryReports\(id, user, \{ from: receiptFrom, to: receiptTo \}\)/.test(adminPage),
  'Phieu kiem ke phai doc theo ky, khong keo tron lich su ve roi loc o client.',
)
check(
  /fetchReportSnapshots\(id, user, \{ from: receiptFrom, to: receiptTo \}\)/.test(adminPage),
  'Ban luu bao cao phai doc theo ky — payload la JSON to nhat cua man nay.',
)
check(
  /filters: \{ from\?: string; to\?: string \} = \{\}[\s\S]{0,900}gte\('report_date', filters\.from\)/.test(store),
  'fetchInventoryReports chua ho tro loc theo report_date.',
)

assert.deepEqual(failures, [], `\n${failures.join('\n')}`)
console.log('ADMIN_ATTENTION_AND_WASTE_OK')
