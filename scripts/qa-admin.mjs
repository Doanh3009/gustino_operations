import { chromium } from 'playwright-core'
import { unlink } from 'node:fs/promises'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5175'
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  await context.addInitScript(() => {
    localStorage.setItem('gustino_demo_user_v1', JSON.stringify({
      id: 'demo-manager',
      name: 'Quản lý Demo',
      email: 'quanly@gustino.vn',
      role: 'manager',
      branchId: 'gold-coast',
      branchIds: ['gold-coast', 'lotte-2310', 'lotte-vt'],
    }))
  })
  const page = await context.newPage()
  const errors = []
  const failedRequests = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.stack || error.message))
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()} (${request.failure()?.errorText || 'failed'})`))
  await page.goto(`${baseUrl}/#management`, { waitUntil: 'networkidle' })
  try {
    await page.getByRole('heading', { name: 'Quản lý GUSTINO' }).waitFor()
  } catch (error) {
    console.error('URL', page.url())
    console.error('BODY', (await page.locator('body').innerText()).slice(0, 1500))
    console.error('ERRORS', errors)
    throw error
  }
  await page.getByRole('heading', { name: 'Chấm công theo ngày, tháng' }).waitFor()
  await page.getByRole('heading', { name: 'Nhập, xuất, hao hụt và tồn kho trong kỳ' }).waitFor()
  await page.getByRole('heading', { name: 'Lịch sử báo cáo đã lưu' }).waitFor()
  await page.getByRole('heading', { name: 'Tạo và quản lý tài khoản nhân viên' }).waitFor()
  await page.getByRole('heading', { name: 'Tổng kết bán hàng theo nhân viên' }).waitFor()
  await page.getByText(/người đạt KPI/).waitFor()
  const commissionTable = page.locator('.commission-table')
  await commissionTable.getByText('Nhân viên Demo', { exact: true }).waitFor()
  await commissionTable.getByText('7', { exact: true }).waitFor()
  const attendanceExport = page.getByRole('button', { name: 'Xuất bảng công Excel' })
  if (await attendanceExport.isEnabled()) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      attendanceExport.click(),
    ])
    const exportPath = 'D:/gustino/qa-attendance-export.xlsx'
    await download.saveAs(exportPath)
    const ExcelJSModule = await import('exceljs')
    const ExcelJS = ExcelJSModule.default || ExcelJSModule
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(exportPath)
    const detailSheet = workbook.getWorksheet('Chi tiết chấm công')
    const summarySheet = workbook.getWorksheet('Tổng hợp')
    const commissionSheet = workbook.getWorksheet('KPI & Hoa hồng')
    if (!detailSheet || !summarySheet || !commissionSheet) throw new Error('File Excel thiếu sheet chi tiết, tổng hợp hoặc hoa hồng.')
    const headers = detailSheet.getRow(2).values.join('|')
    if (!headers.includes('Giờ vào') || !headers.includes('Giờ ra') || !headers.includes('Địa chỉ check-in')) {
      throw new Error('File Excel thiếu cột giờ vào/ra hoặc địa chỉ check-in.')
    }
    await unlink(exportPath)
  }
  const runtimeErrors = errors.filter((message) => !message.includes('Failed to load resource'))
  if (runtimeErrors.length) throw new Error(`Lỗi trình duyệt: ${runtimeErrors.join(' | ')}`)
  if (failedRequests.length) console.warn(`Yêu cầu mạng bị chặn trong môi trường QA: ${failedRequests.join(' | ')}`)
  console.log('MANAGEMENT_QA_OK')
} finally {
  await browser.close()
}
