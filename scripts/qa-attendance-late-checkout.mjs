// QA giao diện: ca quên check-out đã quá hạn phải hiện thẻ KHAI BÙ dùng được, chứ
// không còn là ngõ cụt "Quá hạn check-out — gửi đơn chờ Admin" (BUG-113).
//
// Giới hạn: máy chủ LAN luôn đóng dấu giờ check-in bằng giờ máy chủ (chống khai
// khống), nên không dựng được bản ghi check-in lùi ngày để chạy trọn đường đóng ca
// thành công ở đây. Phép tính giờ khai bù được kiểm chứng riêng bằng dữ liệu thật
// trong scripts/test-attendance-late-checkout.mjs.
import { chromium } from 'playwright-core'
import { readdir } from 'node:fs/promises'

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
  const qaUserId = `qa-late-checkout-${Date.now()}`
  await context.addInitScript((userId) => {
    localStorage.setItem('gustino_user_v1', JSON.stringify({
      id: userId,
      name: 'Nhân viên QA bù',
      email: 'qa-late-checkout@gustino.local',
      role: 'staff',
      branchId: 'gold-coast',
      branchIds: ['gold-coast'],
      authToken: 'qa-staff-token',
    }))
    localStorage.removeItem('gustino_demo_user_v1')
  }, qaUserId)

  const page = await context.newPage()
  await page.goto(`${baseUrl}/#attendance`, { waitUntil: 'networkidle' })
  const headers = {
    'X-User-Id': qaUserId,
    'X-User-Role': 'staff',
    'X-User-Branch': 'gold-coast',
    'X-User-Branches': 'gold-coast',
  }

  // Ca của HÔM QUA 08:00–16:00: đã quá hạn tự check-out 6 tiếng từ lâu.
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const workDate = businessDate(yesterday)
  const registrationId = crypto.randomUUID()
  const created = await page.request.post(`${baseUrl}/api/attendance/registrations`, {
    headers,
    data: {
      id: registrationId,
      userId: qaUserId,
      userName: 'Nhân viên QA bù',
      branchId: 'gold-coast',
      workDate,
      startTime: '08:00',
      endTime: '16:00',
      status: 'approved',
      note: `QA BU ${Date.now()}`,
      createdAt: new Date().toISOString(),
    },
  })
  if (!created.ok()) throw new Error(`Không thể tạo ca QA: ${await created.text()}`)

  // Bản ghi đã check-in nhưng KHÔNG check-out — đúng tình huống thật trên production.
  const selfieName = (await readdir('data/attendance-selfies')).find((name) => /\.(png|jpe?g)$/i.test(name))
  if (!selfieName) throw new Error('Thiếu ảnh QA để tạo bản ghi chấm công.')
  const checkedIn = await page.request.post(`${baseUrl}/api/attendance/records`, {
    headers,
    data: {
      id: crypto.randomUUID(),
      userId: qaUserId,
      userName: 'Nhân viên QA bù',
      branchId: 'gold-coast',
      shiftRegistrationId: registrationId,
      checkInTime: `${workDate}T08:03:00.000+07:00`,
      selfieUrl: `/uploads/attendance-selfies/${selfieName}`,
      checkInLatitude: 10.7769,
      checkInLongitude: 106.7009,
      checkInAccuracy: 12,
      checkInAddress: 'QA address',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  })
  if (!checkedIn.ok()) throw new Error(`Không thể tạo bản ghi check-in QA: ${await checkedIn.text()}`)

  await page.reload({ waitUntil: 'networkidle' })
  await page.evaluate(() => { window.location.hash = '#attendance' })

  const overdueCard = page.locator('.shift-card.overdue-checkout').filter({ hasText: '08:00 – 16:00' })
  await overdueCard.waitFor({ timeout: 15000 })

  // Thẻ phải mời khai bù, KHÔNG được chỉ nói "quá hạn, gửi đơn đi".
  await overdueCard.getByRole('button', { name: 'Check-out bù' }).waitFor()
  await overdueCard.getByRole('button', { name: 'Về sau giờ tan ca → gửi đơn' }).waitFor()

  // Ô giờ phải mặc định đúng giờ tan ca và chặn trần ngay trên input.
  const timeInput = overdueCard.locator('.late-checkout-time input[type="time"]')
  const defaultValue = await timeInput.inputValue()
  if (defaultValue !== '16:00') throw new Error(`Giờ khai bù mặc định sai: ${defaultValue} (phải là 16:00).`)
  const maxValue = await timeInput.getAttribute('max')
  if (maxValue !== '16:00') throw new Error(`Ô giờ khai bù thiếu trần theo lịch: max=${maxValue}.`)

  // Khai quá giờ tan ca phải bị từ chối ngay trên giao diện thật, KHÔNG âm thầm ghi.
  await timeInput.fill('18:30')
  await overdueCard.getByRole('button', { name: 'Check-out bù' }).click()
  const feedback = page.locator('.feedback-bar')
  await feedback.waitFor({ timeout: 15000 })
  const message = await feedback.innerText()
  if (!/tối đa tới giờ tan ca theo lịch|sau giờ vào/.test(message)) {
    throw new Error(`Khai vượt giờ tan ca không bị chặn đúng cách: ${message}`)
  }

  // Và không được ghi gì vào bản ghi khi đã từ chối.
  const saved = await page.request.get(`${baseUrl}/api/attendance/records?userId=${encodeURIComponent(qaUserId)}`, { headers })
  const row = (await saved.json()).find((item) => item.shiftRegistrationId === registrationId)
  if (row?.checkOutTime) throw new Error('Đã từ chối giờ khai bù nhưng vẫn đóng ca.')

  console.log('ATTENDANCE_LATE_CHECKOUT_QA_OK')
} finally {
  await browser.close()
}

function businessDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
