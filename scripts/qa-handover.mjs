import { chromium } from 'playwright-core'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173'
const now = new Date()
const businessDate = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
].join('-')

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.addInitScript(() => {
    localStorage.setItem('gustino_demo_user_v1', JSON.stringify({
      id: 'demo-shift-leader',
      name: 'Ca trưởng Demo',
      email: 'catruong@gustino.vn',
      role: 'shift_leader',
      branchId: 'gold-coast',
      branchIds: ['gold-coast'],
    }))
  })
  const page = await context.newPage()
  await page.goto(`${baseUrl}/#handover`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Trở lại' }).click()
  await page.locator('.today-page').waitFor()
  await page.goto(`${baseUrl}/#handover`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Thoát chức năng/ }).waitFor()

  await page.request.post(`${baseUrl}/api/movements`, {
    data: {
      id: crypto.randomUUID(),
      documentId: crypto.randomUUID(),
      branchId: 'gold-coast',
      productId: 'chestnut-110',
      type: 'adjustment',
      quantity: 30,
      shiftDate: businessDate,
      note: '[QA] Tạo tồn kiểm thử bàn giao',
      createdBy: 'demo-shift-leader',
      createdAt: new Date().toISOString(),
    },
  })
  await page.reload({ waitUntil: 'networkidle' })

  await page.getByRole('button', { name: 'Nhận ca', exact: true }).click()
  await page.getByText('Ca 1 đang mở').waitFor()

  const issueForm = page.locator('.handover-issue-form')
  const availableText = await issueForm.locator('.issue-availability strong').textContent()
  const availableQuantity = Number(String(availableText).replace(/[^\d.]/g, ''))
  if (!availableQuantity || availableQuantity < 30) throw new Error('Tồn khả dụng chưa đồng bộ với lượng nhập.')
  if (!String(await issueForm.getByLabel('Loại túi').locator('option:checked').textContent()).includes('còn')) {
    throw new Error('Loại túi chưa hiển thị số lượng khả dụng.')
  }
  if (Number(await issueForm.getByLabel('Số lượng').getAttribute('max')) !== availableQuantity) {
    throw new Error('Ô số lượng chưa giới hạn theo tồn khả dụng.')
  }
  await issueForm.getByLabel('Nhân viên').selectOption('demo-staff')
  await issueForm.getByLabel('Loại túi').selectOption('chestnut-110')
  await issueForm.getByLabel('Số lượng').fill('10')
  await issueForm.getByRole('button', { name: 'Xác nhận phát túi' }).click()

  const employeeA = page.locator('.handover-employee-list article').filter({ hasText: 'Nhân viên Demo' })
  await employeeA.getByLabel('Trả lại').fill('2')
  await employeeA.getByLabel('Hỏng/mất').fill('1')
  await employeeA.getByRole('button', { name: 'Thu & tính bán' }).click()
  await employeeA.getByText('Bán').waitFor()

  await issueForm.getByLabel('Nhân viên').selectOption('demo-shift-leader')
  await issueForm.getByLabel('Số lượng').fill('5')
  await issueForm.getByRole('button', { name: 'Xác nhận phát túi' }).click()
  await page.getByText(/Hệ thống sẽ chuyển nguyên trạng sang ca sau/).waitFor()
  await page.getByRole('button', { name: 'Chốt & bàn giao ca' }).click()
  await page.getByText(/Đã chốt Ca 1/).waitFor()

  await page.getByRole('button', { name: 'Nhận ca', exact: true }).click()
  await page.getByText('Ca 2 đang mở').waitFor()
  const employeeB = page.locator('.handover-employee-list article').filter({ hasText: 'Ca trưởng Demo' })
  await employeeB.getByText('Chuyển từ ca trước').waitFor()
  await employeeB.getByLabel('Trả lại').fill('1')
  await employeeB.getByLabel('Hỏng/mất').fill('0')
  await employeeB.getByRole('button', { name: 'Thu & tính bán' }).click()
  await employeeB.getByText('Bán').waitFor()
  await page.getByRole('button', { name: 'Chốt & bàn giao ca' }).click()
  await page.getByText(/Đã chốt Ca 2/).waitFor()
  await page.getByText('Các ca đã bàn giao').waitFor()

  await page.getByRole('button', { name: /Cuối ca|Báo cáo cuối ca/ }).click()
  const summary = page.locator('.report-bag-summary')
  await summary.getByText('2 ca đã bàn giao').waitFor()
  await summary.getByText('11', { exact: true }).waitFor()

  await page.goto(`${baseUrl}/#handover`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Thoát chức năng/ }).click()
  await page.locator('.launcher-page').waitFor()

  console.log('HANDOVER_QA_OK')
} finally {
  await browser.close()
}
