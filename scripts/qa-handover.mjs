import { chromium } from 'playwright-core'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173'
const now = new Date()
const businessDate = localDateKey(now)
const branchId = `qa-handover-${Date.now()}`
const leader = {
  id: `qa-leader-${Date.now()}`,
  name: 'Ca truong QA',
  email: 'qa-leader@gustino.local',
  role: 'shift_leader',
  branchId,
  branchIds: [branchId],
  authToken: 'qa-leader-token',
}
const staff = {
  id: `qa-staff-${Date.now()}`,
  name: 'Nhan vien QA',
  role: 'staff',
  branchId,
  branchIds: [branchId],
  authToken: 'qa-staff-token',
}

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.addInitScript((account) => {
    localStorage.setItem('gustino_user_v1', JSON.stringify(account))
    localStorage.removeItem('gustino_demo_user_v1')
    localStorage.setItem('gustino_lang', 'vi')
  }, leader)
  const page = await context.newPage()
  await page.goto(`${baseUrl}/#handover`, { waitUntil: 'networkidle' })

  await seedShiftPrerequisites(page)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.handover-page').waitFor()
  await page.locator('.handover-shift-chip.open').waitFor()
  await page.getByText('Ca sáng đang mở', { exact: true }).waitFor()

  await seedSalesReceipt(page)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.handover-page').waitFor()
  const staffSales = page.locator('.allocation-group').filter({ hasText: staff.name })
  await staffSales.waitFor()
  await staffSales.locator('.allocation-main').getByText(/3/).first().waitFor()

  const firstCountInput = page.locator('.handover-count-grid input').first()
  await firstCountInput.fill('12')
  await page.getByRole('button', { name: 'Chốt & bàn giao ca' }).click()
  await page.locator('.report-page').waitFor()

  await page.goto(`${baseUrl}/#handover`, { waitUntil: 'networkidle' })
  await page.locator('.handover-page').waitFor()
  await page.locator('.handover-shift-chip.open').waitFor()
  await page.getByText('Ca tối đang mở', { exact: true }).waitFor()
  await page.locator('.handover-count-grid input').first().waitFor()

  await page.getByRole('button', { name: 'Chốt & bàn giao ca' }).click()
  await page.locator('.report-page').waitFor()

  console.log('HANDOVER_QA_OK')
} finally {
  await browser.close()
}

async function seedShiftPrerequisites(page) {
  const headers = headersFor(leader)
  await page.request.post(`${baseUrl}/api/movements`, {
    headers,
    data: {
      id: crypto.randomUUID(),
      documentId: crypto.randomUUID(),
      branchId,
      productId: 'chestnut-cooked-kg',
      type: 'adjustment',
      quantity: 12,
      shiftDate: businessDate,
      note: '[QA] Thanh pham dau ca',
      createdBy: leader.id,
      createdAt: now.toISOString(),
    },
  })
  const leaderRegistration = buildRegistration(leader.id, leader.name)
  const staffRegistration = buildRegistration(staff.id, staff.name)
  for (const [registration, registrant] of [
    [leaderRegistration, leader],
    [staffRegistration, staff],
  ]) {
    const response = await page.request.post(`${baseUrl}/api/attendance/registrations`, {
      headers: headersFor(registrant),
      data: registration,
    })
    if (!response.ok()) throw new Error(`Khong the tao ca QA: ${await response.text()}`)
  }
  const recordResponse = await page.request.post(`${baseUrl}/api/attendance/records`, {
    headers,
    data: {
      id: crypto.randomUUID(),
      shiftRegistrationId: leaderRegistration.id,
      userId: leader.id,
      userName: leader.name,
      branchId,
      checkInTime: now.toISOString(),
    },
  })
  if (!recordResponse.ok()) throw new Error(`Khong the check-in QA: ${await recordResponse.text()}`)
}

async function seedSalesReceipt(page) {
  const response = await page.request.post(`${baseUrl}/api/sales-receipts`, {
    headers: headersFor(staff),
    data: {
      id: crypto.randomUUID(),
      code: `HDQA-${Date.now()}`,
      branchId,
      businessDate,
      sellerKey: staff.id,
      sellerId: staff.id,
      sellerName: staff.name,
      paymentMethod: 'cash',
      totalQuantity: 3,
      totalAmount: 90000,
      lines: [{
        productId: 'chestnut-110',
        productName: 'Hat de rang 110g',
        quantity: 3,
        unitPrice: 30000,
        total: 90000,
      }],
      createdAt: new Date().toISOString(),
      createdBy: staff.id,
      createdByName: staff.name,
    },
  })
  if (!response.ok()) throw new Error(`Khong the tao hoa don POS QA: ${await response.text()}`)
}

function buildRegistration(userId, userName) {
  return {
    id: crypto.randomUUID(),
    userId,
    userName,
    branchId,
    workDate: businessDate,
    startTime: hhmm(new Date(now.getTime() - 30 * 60000)),
    endTime: hhmm(new Date(now.getTime() + 6 * 3600000)),
    status: 'approved',
    note: '[QA] Ca kiem thu ban giao',
    createdAt: now.toISOString(),
  }
}

function headersFor(user) {
  return {
    'X-User-Id': user.id,
    'X-User-Role': user.role,
    'X-User-Branch': user.branchId,
    'X-User-Branches': (user.branchIds || [user.branchId]).join(','),
    ...(user.authToken ? { Authorization: `Bearer ${user.authToken}` } : {}),
  }
}

function hhmm(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function localDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
