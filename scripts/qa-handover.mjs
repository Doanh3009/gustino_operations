import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173'
const now = new Date()
const businessDate = localDateKey(now)
const branchId = `qa-handover-${Date.now()}`
const firstLeader = {
  id: `qa-leader-1-${Date.now()}`,
  name: 'Ca truong 1 QA',
  email: 'qa-leader-1@gustino.local',
  role: 'shift_leader',
  branchId,
  branchIds: [branchId],
  authToken: 'qa-leader-1-token',
}
const secondLeader = {
  id: `qa-leader-2-${Date.now()}`,
  name: 'Ca truong 2 QA',
  email: 'qa-leader-2@gustino.local',
  role: 'shift_leader',
  branchId,
  branchIds: [branchId],
  authToken: 'qa-leader-2-token',
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
  const firstContext = await authenticatedContext(firstLeader)
  const firstPage = await firstContext.newPage()
  await firstPage.goto(`${baseUrl}/#handover`, { waitUntil: 'networkidle' })

  await seedShiftPrerequisites(firstPage)
  await firstPage.reload({ waitUntil: 'networkidle' })
  await firstPage.locator('.handover-page').waitFor()
  await firstPage.locator('.handover-shift-chip.open').waitFor()
  await firstPage.getByText('Ca sáng đang mở', { exact: true }).waitFor()

  await seedSalesReceipt(firstPage)
  await firstPage.reload({ waitUntil: 'networkidle' })
  await firstPage.locator('.handover-count-grid input').first().waitFor()
  await firstPage.locator('.handover-count-grid input').first().fill('12')
  // Từ 2026-07-25 nút bàn giao mở BƯỚC XÁC NHẬN (chống bấm nhầm) — phải bấm
  // tiếp "Đồng ý..." trong panel .handover-close-confirm mới thật sự chốt.
  await firstPage.getByRole('button', { name: 'Chốt & bàn giao ca' }).click()
  await firstPage.getByRole('button', { name: 'Đồng ý, bàn giao ca' }).click()
  await firstPage.locator('.report-page').waitFor()
  await waitForFinalizedSnapshot(firstPage, [1], 'open')

  // Ca trưởng Ca 1 is still checked in. Returning to handover must not let
  // that account create Ca 2; only the scheduled Ca 2 leader may do so.
  await firstPage.goto(`${baseUrl}/#handover`, { waitUntil: 'networkidle' })
  await firstPage.getByText('Đang chờ đúng ca trưởng theo lịch', { exact: true }).waitFor()
  await assertSessionLeaders(firstPage, [firstLeader.id])

  const secondContext = await authenticatedContext(secondLeader)
  const secondPage = await secondContext.newPage()
  await secondPage.goto(`${baseUrl}/#handover`, { waitUntil: 'networkidle' })
  await secondPage.locator('.handover-shift-chip.open').waitFor()
  await secondPage.getByText('Ca tối đang mở', { exact: true }).waitFor()
  await assertSessionLeaders(secondPage, [firstLeader.id, secondLeader.id])

  await secondPage.locator('.handover-count-grid input').first().waitFor()
  await secondPage.getByRole('button', { name: 'Chốt & bàn giao ca' }).click()
  // Ca tối: nút xác nhận cảnh báo chốt ngày + tự gửi báo cáo.
  await secondPage.getByRole('button', { name: 'Đồng ý, chốt ngày & gửi báo cáo' }).click()
  await secondPage.locator('.report-page').waitFor()
  await waitForFinalizedSnapshot(secondPage, [1, 2], 'closed')

  console.log('HANDOVER_QA_OK')
} finally {
  await browser.close()
}

async function authenticatedContext(account) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.addInitScript((currentAccount) => {
    localStorage.setItem('gustino_user_v1', JSON.stringify(currentAccount))
    localStorage.removeItem('gustino_demo_user_v1')
    localStorage.setItem('gustino_lang', 'vi')
  }, account)
  return context
}

async function seedShiftPrerequisites(page) {
  const headers = headersFor(firstLeader)
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
      createdBy: firstLeader.id,
      createdAt: now.toISOString(),
    },
  })
  const ca1 = await createLeaderShift(page, 'Ca 1 QA', '07:15', '15:15')
  const ca2 = await createLeaderShift(page, 'Ca 2 QA', '14:15', '22:15')
  const registrations = [
    [buildRegistration(firstLeader, ca1), firstLeader],
    [buildRegistration(secondLeader, ca2), secondLeader],
    [buildRegistration(staff, ca1), staff],
  ]
  for (const [registration, registrant] of registrations) {
    const response = await page.request.post(`${baseUrl}/api/attendance/registrations`, {
      headers: headersFor(registrant),
      data: registration,
    })
    if (!response.ok()) throw new Error(`Khong the tao ca QA: ${await response.text()}`)
  }
  for (const [registration, leader] of registrations.slice(0, 2)) {
    const response = await page.request.post(`${baseUrl}/api/attendance/records`, {
      headers: headersFor(leader),
      data: {
        id: crypto.randomUUID(),
        shiftRegistrationId: registration.id,
        userId: leader.id,
        userName: leader.name,
        branchId,
        checkInTime: now.toISOString(),
      },
    })
    if (!response.ok()) throw new Error(`Khong the check-in QA: ${await response.text()}`)
  }
}

async function createLeaderShift(page, name, startTime, endTime) {
  const response = await page.request.post(`${baseUrl}/api/attendance/shifts`, {
    headers: headersFor(firstLeader),
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

function buildRegistration(user, shift) {
  return {
    id: crypto.randomUUID(),
    userId: user.id,
    userName: user.name,
    branchId,
    workDate: businessDate,
    shiftId: shift.id,
    startTime: shift.startTime,
    endTime: shift.endTime,
    status: 'approved',
    note: '[QA] Ca kiem thu ban giao',
    createdAt: now.toISOString(),
  }
}

async function assertSessionLeaders(page, leaderIds) {
  const response = await page.request.get(`${baseUrl}/api/shift-ledger/sessions?branchId=${encodeURIComponent(branchId)}`, {
    headers: headersFor(firstLeader),
  })
  if (!response.ok()) throw new Error(`Khong doc duoc so ca QA: ${await response.text()}`)
  const sessions = await response.json()
  assert.deepEqual(sessions
    .filter((session) => session.businessDate === businessDate)
    .sort((left, right) => left.sequence - right.sequence)
    .map((session) => session.leaderId), leaderIds)
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

async function waitForFinalizedSnapshot(page, expectedSequences, expectedDayStatus) {
  let lastDetail = ''
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const snapshotResponse = await page.request.get(`${baseUrl}/api/report-snapshots?branchId=${encodeURIComponent(branchId)}`)
    if (snapshotResponse.ok()) {
      const snapshots = await snapshotResponse.json()
      const sequences = Object.values(snapshots[0]?.payload?.shiftReports || {})
        .map((entry) => entry.sequence)
        .sort((a, b) => a - b)
      const dayResponse = await page.request.get(`${baseUrl}/api/operation-day?branchId=${encodeURIComponent(branchId)}&date=${encodeURIComponent(businessDate)}`)
      const day = dayResponse.ok() ? await dayResponse.json() : null
      lastDetail = `shift=${JSON.stringify(sequences)}, day=${day?.status || 'missing'}`
      if (JSON.stringify(sequences) === JSON.stringify(expectedSequences) && day?.status === expectedDayStatus) return
    }
    await page.waitForTimeout(500)
  }
  assert.fail(`Không chốt được snapshot tự động đúng trạng thái: ${lastDetail}`)
}
