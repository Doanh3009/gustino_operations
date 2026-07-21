import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173'
const edgePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const artifactDir = 'artifacts/mobile-audit-fix-shifts'
const issues = []
const screenshots = []

await mkdir(artifactDir, { recursive: true })

async function loginAdmin() {
  return loginUser('admin', '123456')
}

async function loginUser(username, password) {
  const response = await fetch(`${baseUrl}/api/attendance/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Login failed with ${response.status}`)
  return payload
}

async function setBrowserSession(page, user) {
  // Chờ app boot xong mới ghi user: lúc boot với storage rỗng, callback
  // supabase.auth.getSession sẽ dọn key user (state null) — ghi sớm sẽ bị xóa mất.
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.evaluate((nextUser) => {
    localStorage.setItem('gustino_user_v1', JSON.stringify(nextUser))
    localStorage.removeItem('gustino_demo_user_v1')
    localStorage.setItem('gustino_lang', 'vi')
  }, user)
  await page.reload({ waitUntil: 'domcontentloaded' })
}

async function pickFreeShiftWindow(user) {
  const response = await fetch(`${baseUrl}/api/attendance/shifts`, {
    headers: authHeaders(user),
  })
  const shifts = response.ok ? await response.json().catch(() => []) : []
  const used = new Set((Array.isArray(shifts) ? shifts : [])
    .filter((shift) => shift.branchId === user.branchId)
    .map((shift) => `${shift.startTime}-${shift.endTime}`))
  for (let hour = 5; hour <= 22; hour += 1) {
    for (let minute = 0; minute < 60; minute += 5) {
      const startTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      const endHour = hour + 1 > 23 ? 23 : hour + 1
      const endTime = `${String(endHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      if (!used.has(`${startTime}-${endTime}`)) return { startTime, endTime }
    }
  }
  throw new Error('No free shift window left for QA')
}

function authHeaders(user) {
  return {
    'Content-Type': 'application/json',
    'X-User-Id': user.id,
    'X-User-Role': user.role,
    'X-User-Branch': user.branchId,
    'X-User-Branches': (user.branchIds || [user.branchId]).join(','),
    ...(user.authToken ? { Authorization: `Bearer ${user.authToken}` } : {}),
  }
}

async function checkScheduleCellBusiness(user) {
  const headers = authHeaders(user)
  const date = '2099-12-30'
  const shiftsResponse = await fetch(`${baseUrl}/api/attendance/shifts`, { headers })
  const shifts = shiftsResponse.ok ? await shiftsResponse.json().catch(() => []) : []
  const shift = shifts.find((item) => item.branchId === user.branchId)
  if (!shift) throw new Error('No configured shift found for schedule-cell business check')

  const putCell = async (payload) => {
    const response = await fetch(`${baseUrl}/api/attendance/registrations/cell`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        userId: user.id,
        userName: user.name,
        branchId: user.branchId,
        workDate: date,
        employmentType: user.employmentType,
        positionTitle: user.positionTitle,
        ...payload,
      }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.error || `Cell update failed with ${response.status}`)
    return data
  }

  await putCell({
    shiftId: shift.id,
    startTime: shift.startTime,
    endTime: shift.endTime,
  })

  const extra = {
    id: `qa-extra-${Date.now()}`,
    userId: user.id,
    userName: user.name,
    branchId: user.branchId,
    workDate: date,
    startTime: '05:10',
    endTime: '06:10',
    status: 'approved',
    note: 'Ca tang ca',
    createdAt: new Date().toISOString(),
  }
  const extraResponse = await fetch(`${baseUrl}/api/attendance/registrations`, {
    method: 'POST',
    headers,
    body: JSON.stringify(extra),
  })
  if (!extraResponse.ok && extraResponse.status !== 409) {
    const data = await extraResponse.json().catch(() => null)
    throw new Error(data?.error || `Extra shift seed failed with ${extraResponse.status}`)
  }

  await putCell({
    startTime: '06:20',
    endTime: '07:20',
    note: 'Ca tuy chinh',
  })
  let registrations = await fetch(`${baseUrl}/api/attendance/registrations?from=${date}&to=${date}`, { headers }).then((r) => r.json())
  const hasExtraAfterCustom = registrations.some((item) => item.userId === user.id && item.workDate === date && item.note === 'Ca tang ca')
  const hasCustom = registrations.some((item) => item.userId === user.id && item.workDate === date && item.startTime === '06:20' && item.endTime === '07:20')
  if (!hasExtraAfterCustom || !hasCustom) throw new Error('Custom cell update did not preserve extra shift or create custom shift')

  await putCell({})
  registrations = await fetch(`${baseUrl}/api/attendance/registrations?from=${date}&to=${date}`, { headers }).then((r) => r.json())
  const hasExtraAfterOff = registrations.some((item) => item.userId === user.id && item.workDate === date && item.note === 'Ca tang ca')
  const hasCustomAfterOff = registrations.some((item) => item.userId === user.id && item.workDate === date && item.startTime === '06:20' && item.endTime === '07:20')
  if (!hasExtraAfterOff || hasCustomAfterOff) throw new Error('OFF did not preserve extra shift while removing main custom shift')
}

async function checkNoDocumentOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }))
  if (metrics.doc > metrics.innerWidth + 2 || metrics.body > metrics.innerWidth + 2) {
    issues.push(`${label}: horizontal overflow doc=${metrics.doc} body=${metrics.body} viewport=${metrics.innerWidth}`)
  }
}

const browser = await chromium.launch({ headless: true, executablePath: edgePath })

try {
  const admin = await loginAdmin()
  const shiftLeader = {
    id: 'demo-shift-leader',
    name: 'Ca truong Demo',
    email: 'catruong@gustino.vn',
    role: 'shift_leader',
    branchId: 'gold-coast',
    branchIds: ['gold-coast'],
    authToken: admin.authToken,
    employmentType: 'leader',
    positionTitle: 'Ca truong',
  }
  await checkScheduleCellBusiness(admin)
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => issues.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource|ERR_ABORTED|ERR_NETWORK_ACCESS_DENIED|supabase\.co\/realtime/.test(message.text())) {
      issues.push(`console: ${message.text()}`)
    }
  })

  // `canAccessPage`: 'dashboard' CHỈ manager, 'sales' chỉ shift_leader/staff/cashier.
  // Dùng admin cho hai route này thì app đẩy về trang mặc định của admin nên
  // selector không bao giờ xuất hiện — phải đi đúng vai.
  const manager = {
    id: 'demo-manager',
    name: 'Quan ly Demo',
    email: 'quanly@gustino.vn',
    role: 'manager',
    branchId: 'gold-coast',
    branchIds: ['gold-coast', 'lotte-2310', 'lotte-vt'],
    authToken: admin.authToken,
    employmentType: 'leader',
    positionTitle: 'Quan ly',
  }
  const routes = [
    ['dashboard', '.manager-dashboard-page', manager],
    ['attendance', '.attendance-page', admin],
    ['today', '.today-page', shiftLeader],
    ['handover', '.handover-page', shiftLeader],
    ['inventory', '.inventory-page', shiftLeader],
    ['sales', '.pos-page', shiftLeader],
  ]

  for (const [hash, selector, routeUser] of routes) {
    await setBrowserSession(page, routeUser)
    await page.goto(`${baseUrl}/?qaRole=${encodeURIComponent(routeUser.role)}#${hash}`, { waitUntil: 'networkidle' })
    await page.locator(selector).first().waitFor({ timeout: 15000 }).catch(async () => {
      const pageInfo = await page.evaluate(() => ({
        url: location.href,
        hash: location.hash,
        pages: Array.from(document.querySelectorAll('.page')).map((item) => item.className).join('|'),
        text: document.body.innerText.slice(0, 120),
        user: localStorage.getItem('gustino_user_v1'),
      })).catch(() => null)
      issues.push(`${hash}: expected selector ${selector} not found (${JSON.stringify(pageInfo)})`)
    })
    await checkNoDocumentOverflow(page, hash)
    const path = `${artifactDir}/${hash}.png`
    await page.screenshot({ path, fullPage: true })
    screenshots.push(path)
  }

  await setBrowserSession(page, admin)
  await page.goto(`${baseUrl}/#attendance`, { waitUntil: 'networkidle' })
  await page.locator('.attendance-page').waitFor()
  // Tab mặc định của manager/admin là "Bảng công"; bảng lịch nằm ở tab "Bảng lịch".
  await page.getByRole('button', { name: 'Bảng lịch', exact: true }).click()
  await page.locator('.schedule-vboard').waitFor({ timeout: 15000 })

  const firstEditableSelect = page.locator('.schedule-vcard.me .schedule-vday.editable select').first()
  await firstEditableSelect.waitFor({ timeout: 15000 })
  await firstEditableSelect.selectOption('__custom')
  const customGrid = page.locator('.schedule-vcard.me .schedule-custom-time-grid').first()
  await customGrid.waitFor({ timeout: 5000 })
  await customGrid.locator('input[type="time"]').nth(0).fill('09:15')
  await customGrid.locator('input[type="time"]').nth(1).fill('17:15')
  await customGrid.locator('button').click()
  await page.locator('.feedback-bar').filter({ hasText: /cap nhat gio lam|cập nhật giờ làm/i }).waitFor({ timeout: 15000 }).catch(async () => {
    const feedback = await page.locator('.feedback-bar').innerText().catch(() => '')
    issues.push(`attendance: custom time save feedback not found (${feedback})`)
  })
  await checkNoDocumentOverflow(page, 'attendance-after-custom-time')
  const customPath = `${artifactDir}/attendance-custom-time.png`
  await page.screenshot({ path: customPath, fullPage: true })
  screenshots.push(customPath)

  await page.locator('.schedule-setup-button').click()
  await page.locator('.schedule-setup-panel').waitFor()

  const stamp = String(Date.now()).slice(-5)
  const shiftName = `QA ca ${stamp}`
  const { startTime, endTime } = await pickFreeShiftWindow(admin)
  const form = page.locator('.schedule-setup-panel form')
  await form.locator('input').nth(0).fill(shiftName)
  await form.locator('input[type="time"]').nth(0).fill(startTime)
  await form.locator('input[type="time"]').nth(1).fill(endTime)
  await form.locator('button').click()

  const shiftChip = page.locator('.schedule-shift-manager span').filter({ hasText: shiftName })
  await shiftChip.waitFor({ timeout: 15000 }).catch(async (error) => {
    const feedback = await page.locator('.feedback-bar').innerText().catch(() => '')
    const setupText = await page.locator('.schedule-setup-panel').innerText().catch(() => '')
    throw new Error(`${error.message}\nFeedback: ${feedback}\nSetup: ${setupText.slice(0, 1200)}`)
  })
  await checkNoDocumentOverflow(page, 'attendance-after-add-shift')
  const addPath = `${artifactDir}/attendance-add-shift.png`
  await page.screenshot({ path: addPath, fullPage: true })
  screenshots.push(addPath)

  await shiftChip.locator('button').click()
  await shiftChip.waitFor({ state: 'detached', timeout: 15000 }).catch(async () => {
    if (await shiftChip.count()) issues.push('attendance: shift chip still visible after delete')
  })
  await checkNoDocumentOverflow(page, 'attendance-after-delete-shift')
  const deletePath = `${artifactDir}/attendance-delete-shift.png`
  await page.screenshot({ path: deletePath, fullPage: true })
  screenshots.push(deletePath)

  await context.close()
} finally {
  await browser.close()
}

if (issues.length) {
  console.error('MOBILE_SHIFT_AUDIT_ISSUES')
  for (const issue of issues) console.error(issue)
  process.exit(1)
}

console.log('MOBILE_SHIFT_AUDIT_OK')
console.log(screenshots.join('\n'))
