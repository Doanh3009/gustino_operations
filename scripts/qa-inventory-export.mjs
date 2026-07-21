/**
 * QA file Excel báo cáo kho (BUG-108).
 *
 * Lỗi gốc: cột số lượng dùng mã định dạng `'0.####'`. Trong Excel, dấu chấm thập phân
 * của mã định dạng được in NGUYÊN VĂN còn `#` sau nó không in gì khi số không có phần
 * lẻ — nên 148 hiện thành "148." và 0 hiện thành "0." trên bảng TỔNG HỢP KHO.
 *
 * Script bấm đúng nút "Xuất Excel" của màn Báo cáo kho, tải file thật về rồi mở bằng
 * exceljs để kiểm tra: mọi cột số lượng phải là `General` (không có dấu chấm thừa) và
 * mọi giá trị số phải đã làm tròn 4 số lẻ.
 *
 * Chạy: QA_BASE_URL=http://127.0.0.1:5173 node scripts/qa-inventory-export.mjs
 */
import { chromium } from 'playwright-core'
import ExcelJS from 'exceljs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173'
const QUANTITY_SHEETS = ['Tổng hợp kho', 'Đối chiếu ca', 'Xuất kho để bán', 'Nhật ký kho', 'Tồn kho hiện tại', 'Phiếu kiểm kê']

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})
const downloadDir = await mkdtemp(join(tmpdir(), 'gustino-xlsx-'))

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true })
  await context.addInitScript(() => {
    localStorage.setItem('gustino_user_v1', JSON.stringify({
      id: 'qa-inventory-export-manager',
      name: 'QA Quản lý',
      email: 'qa-inventory-export@gustino.local',
      role: 'manager',
      branchId: 'gold-coast',
      branchIds: ['gold-coast', 'lotte-2310', 'lotte-vt'],
      authToken: 'qa-manager-token',
    }))
  })
  const page = await context.newPage()
  await page.goto(`${baseUrl}/#manager-inventory`, { waitUntil: 'networkidle' })
  await page.evaluate(() => { window.location.hash = '#manager-inventory' })
  await page.waitForSelector('.admin-report-section', { timeout: 20000 })
  await page.waitForTimeout(2500)

  const exportButton = page.locator('.admin-report-section .section-title button', { hasText: 'Xuất Excel' }).first()
  await exportButton.waitFor({ timeout: 15000 })
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    exportButton.click(),
  ])
  const filePath = join(downloadDir, download.suggestedFilename())
  await download.saveAs(filePath)
  console.log(`EXPORT_OK ${download.suggestedFilename()}`)

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  let checkedColumns = 0
  let checkedCells = 0
  const problems = []
  workbook.eachSheet((sheet) => {
    if (!QUANTITY_SHEETS.includes(sheet.name)) return
    // Hàng 1 là tiêu đề gộp do styleSheet chèn, hàng 2 là tên cột.
    const headerRow = sheet.getRow(2)
    headerRow.eachCell((headerCell, columnNumber) => {
      const header = String(headerCell.value || '')
      // Cột tiền/đếm dùng định dạng số nguyên `0` (không có dấu chấm) — không thuộc phạm vi kiểm tra.
      if (/Doanh thu|Số hóa đơn/i.test(header)) return
      if (!/Tồn|Nhập|Xuất|Hao hụt|Số lượng|Quy đổi|POS|Chênh lệch|Cần đặt|Tủ đông|Kho|Khối lượng/i.test(header)) return
      const column = sheet.getColumn(columnNumber)
      let sawNumber = false
      column.eachCell({ includeEmpty: false }, (cell, rowNumber) => {
        if (rowNumber <= 2) return
        if (typeof cell.value !== 'number') return
        sawNumber = true
        checkedCells += 1
        const rounded = Number(cell.value.toFixed(4))
        if (cell.value !== rounded) {
          problems.push(`${sheet.name} · ${header} · dòng ${rowNumber}: ${cell.value} chưa làm tròn 4 số lẻ`)
        }
        // Mã định dạng kết thúc bằng dấu chấm + toàn `#` sẽ in dấu chấm thừa với số nguyên.
        if (typeof cell.numFmt === 'string' && /\.#*$/.test(cell.numFmt)) {
          problems.push(`${sheet.name} · ${header}: mã định dạng "${cell.numFmt}" in dấu chấm thừa`)
        }
      })
      if (!sawNumber) return
      checkedColumns += 1
      const format = column.numFmt || 'General'
      if (format !== 'General') {
        problems.push(`${sheet.name} · ${header}: numFmt = "${format}" (phải là General)`)
      }
    })
  })

  if (!checkedColumns) throw new Error('Không tìm thấy cột số lượng nào có dữ liệu để kiểm tra — cần dữ liệu kho trong bộ lọc.')
  if (problems.length) {
    problems.slice(0, 10).forEach((problem) => console.log(`FAIL ${problem}`))
    throw new Error(`${problems.length} lỗi định dạng số trong file Excel kho`)
  }
  console.log(`FORMAT_OK ${checkedColumns} cột số lượng · ${checkedCells} ô số · không cột nào in dấu chấm thừa`)
  console.log('INVENTORY_EXPORT_QA_OK')
} finally {
  await browser.close()
  await rm(downloadDir, { recursive: true, force: true })
}
