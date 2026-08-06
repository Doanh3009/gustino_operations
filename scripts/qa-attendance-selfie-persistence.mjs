// BUG-114: ảnh check-out vừa chụp bị xoá âm thầm khi màn chấm công tải lại, và nút
// Check-out tắt thì bấm KHÔNG phản hồi gì — nhân viên tưởng đã check-out xong rồi
// bỏ đi, hôm sau vào lại thấy "chưa check-out".
//
// Ba điều phải giữ:
//   1. Ảnh đã chụp sống sót qua nút "Tải lại".
//   2. Chưa có ảnh mà bấm Check-out thì phải NÓI RÕ thiếu ảnh, không im lặng.
//   3. Thông báo cũ ("Check-in thành công") không được nằm lại làm người ta hiểu nhầm.
import { chromium } from 'playwright-core'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: 10.7769, longitude: 106.7009 },
    permissions: ['geolocation'],
  })
  const uid = `qa-selfie-persist-${Date.now()}`
  await context.addInitScript((userId) => {
    localStorage.setItem('gustino_user_v1', JSON.stringify({
      id: userId, name: 'QA Giữ ảnh', email: 'qa-selfie@gustino.local', role: 'staff',
      branchId: 'gold-coast', branchIds: ['gold-coast'], authToken: 'qa-staff-token',
    }))
    localStorage.removeItem('gustino_demo_user_v1')
  }, uid)

  const page = await context.newPage()
  await page.goto(`${baseUrl}/#attendance`, { waitUntil: 'networkidle' })
  const headers = { 'X-User-Id': uid, 'X-User-Role': 'staff', 'X-User-Branch': 'gold-coast', 'X-User-Branches': 'gold-coast' }

  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const today = new Date()
  const marker = `QA GIU ANH ${Date.now()}`
  const created = await page.request.post(`${baseUrl}/api/attendance/registrations`, {
    headers,
    data: {
      id: crypto.randomUUID(), userId: uid, userName: 'QA Giữ ảnh', branchId: 'gold-coast',
      workDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
      startTime: hhmm(new Date(Date.now() - 15 * 60000)),
      endTime: hhmm(new Date(Date.now() + 25 * 60000)),
      status: 'approved', note: marker, createdAt: new Date().toISOString(),
    },
  })
  if (!created.ok()) throw new Error(`Không tạo được ca QA: ${await created.text()}`)

  await page.reload({ waitUntil: 'networkidle' })
  await page.evaluate(() => { window.location.hash = '#attendance' })

  const selfie = (await readdir('data/attendance-selfies')).find((n) => /\.(png|jpe?g)$/i.test(n))
  if (!selfie) throw new Error('Thiếu ảnh QA.')
  const selfiePath = join('data/attendance-selfies', selfie)

  const card = page.locator('.shift-card').filter({ hasText: marker })
  await card.waitFor({ timeout: 15000 })
  await card.locator('input[type="file"]').setInputFiles(selfiePath)
  await card.getByRole('button', { name: 'Check-in' }).click()
  await page.getByText(/Check-in thành công/).waitFor({ timeout: 30000 })

  const openCard = page.locator('.shift-card').filter({ hasText: marker })
  const checkoutButton = openCard.getByRole('button', { name: 'Check-out' })

  // (2)+(3) Chưa chụp ảnh mà bấm Check-out: phải nói rõ thiếu ảnh, và thông báo
  // "Check-in thành công" cũ phải biến mất chứ không nằm lại gây hiểu nhầm.
  await checkoutButton.click()
  await page.waitForTimeout(800)
  const missingPhotoMessage = await page.locator('.feedback-bar').innerText().catch(() => '')
  if (/Check-in thành công/.test(missingPhotoMessage)) {
    throw new Error('Bấm Check-out xong màn hình vẫn treo "Check-in thành công" — đúng cái làm nhân viên tưởng đã xong.')
  }
  if (!/Chưa có ảnh bàn giao/.test(missingPhotoMessage)) {
    throw new Error(`Bấm Check-out khi chưa có ảnh mà không báo gì rõ ràng: "${missingPhotoMessage}"`)
  }

  // (1) Ảnh đã chụp phải sống sót qua "Tải lại".
  await openCard.locator('.checkout-selfie-button input[type="file"]').setInputFiles(selfiePath)
  const labelBefore = await openCard.locator('.checkout-selfie-button').innerText()
  if (!/Chụp lại ảnh check-out/.test(labelBefore)) throw new Error(`Chụp ảnh check-out xong nhãn nút không đổi: "${labelBefore}"`)

  await page.locator('.attendance-reload-button').click()
  await page.waitForTimeout(2500)

  const afterCard = page.locator('.shift-card').filter({ hasText: marker })
  const labelAfter = await afterCard.locator('.checkout-selfie-button').innerText()
  if (!/Chụp lại ảnh check-out/.test(labelAfter)) {
    throw new Error(`"Tải lại" đã xoá mất ảnh check-out vừa chụp (nhãn nút quay về "${labelAfter}").`)
  }

  // Và ảnh giữ lại phải dùng được thật, không phải chỉ còn cái nhãn.
  await afterCard.getByRole('button', { name: 'Check-out' }).click()
  await page.getByText(/Check-out thành công/).waitFor({ timeout: 30000 })

  const saved = await page.request.get(`${baseUrl}/api/attendance/records?userId=${encodeURIComponent(uid)}`, { headers })
  const row = (await saved.json())[0]
  if (!row?.checkOutTime) throw new Error('Máy chủ chưa lưu giờ check-out.')
  if (!row?.checkOutSelfieUrl) throw new Error('Check-out thành công nhưng không có ảnh bàn giao.')

  console.log('ATTENDANCE_SELFIE_PERSISTENCE_QA_OK')
} finally {
  await browser.close()
}
