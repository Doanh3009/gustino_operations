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
  await context.addInitScript(() => {
    localStorage.setItem('gustino_demo_user_v1', JSON.stringify({
      id: 'qa-attendance-user',
      name: 'Nhân viên QA',
      email: 'qa-attendance@gustino.local',
      role: 'staff',
      branchId: 'gold-coast',
      branchIds: ['gold-coast'],
    }))
  })

  const page = await context.newPage()
  await page.goto(`${baseUrl}/#attendance`, { waitUntil: 'networkidle' })
  const marker = `QA ${Date.now()}`
  const minute = String(Math.floor(Date.now() / 1000) % 60).padStart(2, '0')
  const registration = {
    id: crypto.randomUUID(),
    userId: 'qa-attendance-user',
    userName: 'Nhân viên QA',
    branchId: 'gold-coast',
    workDate: businessDate(),
    startTime: `03:${minute}`,
    endTime: `04:${minute}`,
    status: 'approved',
    note: marker,
    createdAt: new Date().toISOString(),
  }
  const response = await page.request.post(`${baseUrl}/api/attendance/registrations`, {
    headers: {
      'X-User-Id': 'qa-attendance-user',
      'X-User-Role': 'staff',
      'X-User-Branch': 'gold-coast',
      'X-User-Branches': 'gold-coast',
    },
    data: registration,
  })
  if (!response.ok()) throw new Error(`Không thể tạo ca QA: ${await response.text()}`)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Chấm công', exact: true }).click()
  const shiftCard = page.locator('.shift-card').filter({ hasText: marker })
  await shiftCard.getByText('Đã đăng ký').waitFor()

  const selfieName = (await readdir('data/attendance-selfies')).find((name) => /\.(png|jpe?g)$/i.test(name))
  if (!selfieName) throw new Error('Thiếu ảnh QA để kiểm tra đóng dấu chấm công.')
  await shiftCard.locator('input[type="file"]').setInputFiles(join('data/attendance-selfies', selfieName))
  await shiftCard.getByRole('button', { name: 'Check-in' }).click()
  try {
    await page.getByText(/Check-in thành công/).waitFor()
  } catch (error) {
    console.error('ATTENDANCE_BODY', (await page.locator('body').innerText()).slice(0, 2000))
    throw error
  }

  const checkedInCard = page.locator('.shift-card').filter({ hasText: marker })
  await checkedInCard.getByRole('button', { name: 'Check-out' }).click()
  await page.getByText(/Check-out thành công/).waitFor()
  await checkedInCard.getByText(/Ra:/).waitFor()

  console.log('ATTENDANCE_QA_OK')
} finally {
  await browser.close()
}

function businessDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
