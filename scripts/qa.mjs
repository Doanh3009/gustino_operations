import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.login-card .primary-button').click()
  await page.locator('.home-page').waitFor()

  // Một phiếu nhập gồm hai sản phẩm.
  await page.locator('.feature-card.inventory-card').click()
  await page.locator('.workflow-tabs button').nth(1).click()
  if (await page.locator('.voucher-table tbody tr').first().locator('select option').count() !== 5) {
    throw new Error('Phiếu nhập phải chỉ có 5 nguyên vật liệu.')
  }
  await page.locator('.voucher-table tbody tr').nth(0).locator('input').nth(0).fill('20')
  await page.locator('.voucher-table tbody tr').nth(0).getByText('= 40 kg').waitFor()
  await page.locator('.voucher-footer > button').click()
  const secondRow = page.locator('.voucher-table tbody tr').nth(1)
  await secondRow.locator('select').selectOption('potato-honey')
  await secondRow.locator('input').nth(0).fill('12')
  await page.locator('.voucher-footer > button').click()
  const thirdRow = page.locator('.voucher-table tbody tr').nth(2)
  await thirdRow.locator('select').selectOption('chestnut-fresh')
  await thirdRow.locator('input').nth(0).fill('10')
  await page.locator('.voucher-footer .primary-button').click()
  await page.getByText(/Đã lưu phiếu nhập gồm 3 sản phẩm/).waitFor()

  // Mẻ chế biến.
  await page.locator('.workflow-tabs button').nth(2).click()
  const batchCard = page.locator('.mobile-batch-card').first()
  await batchCard.locator('select').nth(0).selectOption('chestnut-snow')
  if (await batchCard.locator('select').nth(1).locator('option').count() !== 2) throw new Error('Hạt dẻ tuyết phải tạo được 2 thành phẩm.')
  await batchCard.locator('select').nth(1).selectOption('chestnut-grilled-finished')
  await batchCard.locator('select').nth(0).selectOption('chestnut-fresh')
  await batchCard.locator('.mobile-number-field input').nth(0).fill('100')
  await batchCard.getByText(/Mẻ dùng 100/).waitFor()
  await batchCard.locator('.mobile-number-field input').nth(1).fill('6')
  await page.getByRole('button', { name: /Hoàn tất chế biến và chia túi/ }).click()
  await page.getByText(/Không đủ tồn Hạt dẻ tươi/).waitFor()
  await batchCard.locator('.mobile-number-field input').nth(0).fill('10')
  await batchCard.locator('.mobile-number-field input').nth(1).fill('6.6')
  await batchCard.locator('.packing-grid input').nth(0).fill('30')
  await batchCard.locator('.packing-grid input').nth(1).fill('10')
  await page.getByRole('button', { name: /Thêm mẻ/ }).click()
  const secondBatch = page.locator('.mobile-batch-card').nth(1)
  await secondBatch.locator('select').nth(0).selectOption('potato-honey')
  await secondBatch.locator('.mobile-number-field input').nth(0).fill('2')
  await secondBatch.locator('.mobile-number-field input').nth(1).fill('1.5')
  await page.getByRole('button', { name: /Hoàn tất chế biến và chia túi/ }).click()
  await page.getByText(/Đã lưu 2 mẻ rang đầu ca/).waitFor()
  await page.screenshot({ path: 'qa-processing-desktop.png', fullPage: true })

  // Phiếu kiểm kê theo mẫu giấy.
  await page.locator('.workflow-tabs button').nth(4).click()
  const countRow = page.locator('.inventory-paper-table tbody tr').first()
  await countRow.locator('input').nth(0).fill('1')
  await countRow.locator('input').nth(1).fill('2')
  await countRow.locator('input').nth(2).fill('5')
  await page.getByRole('button', { name: /Lưu phiếu kiểm kê/ }).click()
  await page.getByText(/Đã lưu phiếu kiểm kê/).waitFor()
  await page.screenshot({ path: 'qa-inventory-report-desktop.png', fullPage: true })

  // Báo cáo ca được lưu làm dữ liệu doanh thu cho dashboard nhà hàng.
  await page.locator('.sidebar .nav-item').nth(2).click()
  const frame = page.frameLocator('iframe')
  await frame.getByText('HẠT DẺ ÔNG LÝ').first().waitFor()
  await frame.getByText('TỰ ĐỘNG TỪ KHO').first().waitFor()
  await frame.locator('#batch-body tr').nth(1).waitFor()
  await frame.getByText('6.6 Kg chín').waitFor()
  if (await frame.locator('#calc-s-kg').inputValue() !== '30') throw new Error('Số túi 110g phải tự đồng bộ.')
  if (await frame.locator('#calc-m-kg').inputValue() !== '10') throw new Error('Số túi 330g phải tự đồng bộ.')
  await page.screenshot({ path: 'qa-report-autofill-desktop.png', fullPage: false })
  await frame.getByRole('button', { name: /THÊM PG VÀO CA/ }).click()
  await page.getByRole('button', { name: /Chốt & lưu báo cáo/ }).click()
  await page.getByText(/Đã chốt và lưu báo cáo/).waitFor()

  // Dashboard nhà hàng.
  await page.locator('.sidebar .nav-item').nth(1).click()
  await page.locator('.restaurant-page').waitFor()
  await page.screenshot({ path: 'qa-restaurant-desktop.png', fullPage: true })

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  })
  await mobile.addInitScript(() => {
    localStorage.setItem('gustino_demo_user_v1', JSON.stringify({
      id: 'demo-shift-leader',
      name: 'Ca trưởng Demo',
      email: 'catruong@gustino.vn',
      role: 'shift_leader',
      branchId: 'gold-coast',
    }))
  })
  const mobilePage = await mobile.newPage()
  await mobilePage.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
  await mobilePage.locator('.mobile-nav button').nth(1).click()
  await mobilePage.locator('.restaurant-page').waitFor()
  await mobilePage.screenshot({ path: 'qa-restaurant-mobile.png', fullPage: true })
  await mobilePage.locator('.mobile-nav button').nth(3).click()
  await mobilePage.locator('.workflow-tabs button').nth(1).click()
  await mobilePage.screenshot({ path: 'qa-voucher-mobile.png', fullPage: true })
  await mobilePage.locator('.workflow-tabs button').nth(2).click()
  await mobilePage.screenshot({ path: 'qa-processing-mobile.png', fullPage: true })
  await mobile.close()

  console.log('QA_OK')
} finally {
  await browser.close()
}
