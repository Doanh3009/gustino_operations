import { chromium } from 'playwright-core'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  await context.addInitScript(() => {
    // authToken bắt buộc: không có thì app coi là phiên Supabase và tự sign-out
    // vì profile demo không tồn tại trên DB thật (chống tài khoản bị khóa).
    localStorage.setItem('gustino_user_v1', JSON.stringify({
      id: 'demo-manager',
      name: 'Quản lý Demo',
      email: 'quanly@gustino.vn',
      role: 'manager',
      branchId: 'gold-coast',
      branchIds: ['gold-coast', 'lotte-2310', 'lotte-vt'],
      authToken: 'qa-manager-token',
    }))
    localStorage.removeItem('gustino_demo_user_v1')
  })
  const page = await context.newPage()
  const errors = []
  const failedRequests = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.stack || error.message))
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()} (${request.failure()?.errorText || 'failed'})`))

  // `#management` nay CHỈ dành cho admin (`canAccessPage`), quản lý vào sẽ bị đẩy
  // về `#dashboard` nên script cũ luôn timeout. Doanh thu của quản lý nằm ở
  // `#manager-revenue` (cùng ManagementPage, section 'revenue').
  await page.goto(`${baseUrl}/#manager-revenue`, { waitUntil: 'networkidle' })
  try {
    await page.getByText('BIỂU ĐỒ DOANH THU').first().waitFor()
    await page.getByText('DOANH THU THEO NGÀY').first().waitFor()
  } catch (error) {
    console.error('URL', page.url())
    console.error('BODY', (await page.locator('body').innerText()).slice(0, 1500))
    console.error('ERRORS', errors)
    throw error
  }

  // §28: manager KHÔNG xem bảng công/lương. Kiểm tra section Kho (manager xem được):
  // card hao hụt–tồn kho theo chi nhánh + sổ kho thu gọn theo ngày + nút xuất Excel.
  await page.goto(`${baseUrl}/#manager-inventory`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: /Nhập, xuất, hao hụt và tồn kho/ }).waitFor()
  await page.getByRole('button', { name: /Xuất Excel|Đang xuất/ }).first().waitFor()

  // Dashboard doanh thu của quản lý phải render chart mà không crash.
  await page.goto(`${baseUrl}/#dashboard`, { waitUntil: 'networkidle' })
  await page.locator('.manager-dashboard-page').waitFor()

  const runtimeErrors = errors.filter((message) => !message.includes('Failed to load resource'))
  if (runtimeErrors.length) throw new Error(`Lỗi trình duyệt: ${runtimeErrors.join(' | ')}`)
  if (failedRequests.length) console.warn(`Yêu cầu mạng bị chặn trong môi trường QA: ${failedRequests.join(' | ')}`)
  console.log('MANAGEMENT_QA_OK')
} finally {
  await browser.close()
}
