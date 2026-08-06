/**
 * Hồi quy BUG-109: ca trưởng có lịch XUYÊN CA (một đăng ký 07:15-22:15 không
 * gắn khung ca) đủ điều kiện mở cả Ca 1 lẫn Ca 2, nên Ca 2 tự mở ngay khi Ca 1
 * vừa đóng. Trước khi sửa, màn Báo cáo lấy "ca mới nhất của mình" nên nhảy sang
 * Ca 2 và báo cáo Ca 1 không bao giờ được chốt/gửi Zalo.
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173'
const now = new Date()
const businessDate = localDateKey(now)
const branchId = `qa-cross-shift-${Date.now()}`
const leader = {
  id: `qa-cross-leader-${Date.now()}`,
  name: 'Ca truong xuyen ca QA',
  email: 'qa-cross-leader@gustino.local',
  role: 'shift_leader',
  branchId,
  branchIds: [branchId],
  authToken: 'qa-cross-leader-token',
}
const staff = {
  id: `qa-cross-staff-${Date.now()}`,
  name: 'Nhan vien QA',
  role: 'staff',
  branchId,
  branchIds: [branchId],
  authToken: 'qa-cross-staff-token',
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
  await page.getByText('Ca sáng đang mở', { exact: true }).waitFor()

  await seedSalesReceipt(page)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.handover-count-grid input').first().waitFor()
  await page.locator('.handover-count-grid input').first().fill('12')

  // Ngoài thực tế Ca 2 tự mở TRƯỚC khi màn Báo cáo kịp đọc sổ ca. Làm chậm lượt
  // đọc sổ ca để dựng đúng thứ tự đó một cách xác định.
  let delayLedgerRead = true
  await page.route(/\/api\/shift-ledger\/sessions\?/, async (route) => {
    if (route.request().method() === 'GET' && delayLedgerRead) {
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
    await route.continue()
  })
  const closeResponse = page.waitForResponse((response) => /\/api\/shift-ledger\/sessions\/.+\/close$/.test(response.url()))
  await page.getByRole('button', { name: 'Chốt & bàn giao ca' }).click()
  await closeResponse
  await openSecondSession(page)
  delayLedgerRead = false

  await page.locator('.report-page').waitFor()

  // Ca 2 đã mở cho chính ca trưởng đó, nhưng báo cáo Ca 1 vẫn phải được chốt
  // thì mới có cái để gửi vào nhóm Zalo.
  await waitForSessionSequences(page, [1, 2])
  await waitForShiftReport(page, 1)

  console.log('CROSS_SHIFT_HANDOVER_QA_OK')
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
  await createLeaderShift(page, 'Ca 1 QA', '07:15', '15:15')
  await createLeaderShift(page, 'Ca 2 QA', '14:15', '22:15')

  // Lịch xuyên ca: KHÔNG gắn shiftId, khung giờ phủ cả hai ca trưởng.
  const registration = {
    id: crypto.randomUUID(),
    userId: leader.id,
    userName: leader.name,
    branchId,
    workDate: businessDate,
    shiftId: null,
    startTime: '07:15',
    endTime: '22:15',
    status: 'approved',
    note: '[QA] Lich xuyen ca',
    createdAt: now.toISOString(),
  }
  const registrationResponse = await page.request.post(`${baseUrl}/api/attendance/registrations`, {
    headers,
    data: registration,
  })
  if (!registrationResponse.ok()) throw new Error(`Khong the tao ca QA: ${await registrationResponse.text()}`)

  const recordResponse = await page.request.post(`${baseUrl}/api/attendance/records`, {
    headers,
    data: {
      id: crypto.randomUUID(),
      shiftRegistrationId: registration.id,
      userId: leader.id,
      userName: leader.name,
      branchId,
      checkInTime: now.toISOString(),
    },
  })
  if (!recordResponse.ok()) throw new Error(`Khong the check-in QA: ${await recordResponse.text()}`)
}

async function openSecondSession(page) {
  const response = await page.request.post(`${baseUrl}/api/shift-ledger/sessions`, {
    headers: headersFor(leader),
    data: {
      id: crypto.randomUUID(),
      branchId,
      businessDate,
      sequence: 0,
      leaderId: leader.id,
      leaderName: leader.name,
      status: 'open',
      openingBalances: {},
      startedAt: new Date().toISOString(),
    },
  })
  if (!response.ok()) throw new Error(`Khong the mo Ca 2 QA: ${await response.text()}`)
}

async function createLeaderShift(page, name, startTime, endTime) {
  const response = await page.request.post(`${baseUrl}/api/attendance/shifts`, {
    headers: headersFor(leader),
    data: { branchId, name, startTime, endTime, employmentTypes: ['leader'] },
  })
  if (!response.ok()) throw new Error(`Khong the tao khung ca QA: ${await response.text()}`)
  return response.json()
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

async function waitForShiftReport(page, sequence) {
  let lastDetail = ''
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await page.request.get(`${baseUrl}/api/report-snapshots?branchId=${encodeURIComponent(branchId)}`)
    if (response.ok()) {
      const snapshots = await response.json()
      const sequences = Object.values(snapshots[0]?.payload?.shiftReports || {}).map((entry) => entry.sequence)
      lastDetail = JSON.stringify(sequences)
      if (sequences.includes(sequence)) return
    }
    await page.waitForTimeout(500)
  }
  assert.fail(`Bao cao Ca ${sequence} khong duoc chot khi ca truong lam xuyen ca: ${lastDetail}`)
}

async function waitForSessionSequences(page, expected) {
  let lastDetail = ''
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await page.request.get(`${baseUrl}/api/shift-ledger/sessions?branchId=${encodeURIComponent(branchId)}`, {
      headers: headersFor(leader),
    })
    if (response.ok()) {
      const sequences = (await response.json())
        .filter((session) => session.businessDate === businessDate)
        .map((session) => session.sequence)
        .sort((a, b) => a - b)
      lastDetail = JSON.stringify(sequences)
      if (lastDetail === JSON.stringify(expected)) return
    }
    await page.waitForTimeout(500)
  }
  assert.fail(`So ca khong dung ky vong ${JSON.stringify(expected)}: ${lastDetail}`)
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

function localDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
