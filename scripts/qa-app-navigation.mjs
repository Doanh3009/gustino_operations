import { chromium } from 'playwright-core'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})

try {
  const context = await browser.newContext({ viewport: { width: 450, height: 815 } })
  await context.addInitScript(() => {
    localStorage.setItem('gustino_user_v1', JSON.stringify({
      id: 'demo-shift-leader',
      name: 'Ca trưởng Demo',
      email: 'catruong@gustino.vn',
      role: 'shift_leader',
      branchId: 'gold-coast',
      branchIds: ['gold-coast'],
      authToken: 'qa-leader-token',
    }))
    localStorage.removeItem('gustino_demo_user_v1')
  })
  const page = await context.newPage()

  // Trang Hôm nay của ca trưởng render được.
  await page.goto(`${baseUrl}/#today`, { waitUntil: 'networkidle' })
  await page.locator('.today-page').waitFor()

  // Chấm công render được (điều hướng qua bottom-nav/hash).
  await page.goto(`${baseUrl}/#attendance`, { waitUntil: 'networkidle' })
  await page.locator('.attendance-page').waitFor()

  // Bàn giao ca (phát / thu túi) render được.
  await page.goto(`${baseUrl}/#handover`, { waitUntil: 'networkidle' })
  await page.locator('.handover-page').waitFor()

  // Kho chỉ còn nghiệp vụ kho: KHÔNG được có luồng phát túi / chia hàng bán cũ.
  await page.goto(`${baseUrl}/#inventory`, { waitUntil: 'networkidle' })
  await page.locator('.inventory-page').waitFor()
  if (await page.getByText('Chia hàng bán', { exact: true }).count()) {
    throw new Error('Luồng chia hàng bán cũ vẫn còn trong Làm hàng.')
  }
  if (await page.getByRole('button', { name: /Phát túi nhân viên/ }).count()) {
    throw new Error('Nút "Phát túi nhân viên" đã bị gỡ khỏi Kho nhưng vẫn render.')
  }

  // Kho có đúng 4 chức năng: Tồn kho / Nhập hàng / Xuất bán / Kiểm kê.
  const crmButtons = page.locator('.inventory-crm-actions button')
  const crmCount = await crmButtons.count()
  if (crmCount !== 4) {
    throw new Error(`Kho phải có đúng 4 chức năng, đang có ${crmCount}.`)
  }
  for (const label of ['Tồn kho', 'Nhập hàng', 'Xuất bán', 'Kiểm kê']) {
    if (!(await page.locator('.inventory-crm-actions button', { hasText: label }).count())) {
      throw new Error(`Thiếu chức năng kho: ${label}.`)
    }
  }

  console.log('APP_NAVIGATION_QA_OK')
} finally {
  await browser.close()
}
