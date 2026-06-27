import { chromium } from 'playwright-core'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})

try {
  const context = await browser.newContext({ viewport: { width: 450, height: 815 } })
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

  await page.goto(`${baseUrl}/#today`, { waitUntil: 'networkidle' })
  await page.getByRole('link', { name: 'Mở chức năng chấm công' }).click()
  await page.locator('.attendance-page').waitFor()
  await page.getByRole('link', { name: 'Thoát ra màn hình chọn ứng dụng' }).click()
  await page.locator('.launcher-page').waitFor()

  await page.goto(`${baseUrl}/#today`, { waitUntil: 'networkidle' })
  await page.getByRole('link', { name: 'Thoát ra màn hình chọn ứng dụng' }).click()
  await page.locator('.launcher-page').waitFor()

  await page.goto(`${baseUrl}/#inventory`, { waitUntil: 'networkidle' })
  if (await page.getByText('Chia hàng bán', { exact: true }).count()) {
    throw new Error('Luồng chia hàng bán cũ vẫn còn trong Làm hàng.')
  }
  await page.getByRole('button', { name: /Phát túi nhân viên/ }).click()
  await page.locator('.handover-page').waitFor()
  await page.getByRole('heading', { name: 'Nhận ca, phát túi, bàn giao' }).waitFor()

  console.log('APP_NAVIGATION_QA_OK')
} finally {
  await browser.close()
}
