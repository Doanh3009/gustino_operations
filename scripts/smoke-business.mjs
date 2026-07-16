import { chromium } from 'playwright-core'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173'
const edgePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const today = localDateKey()

const checks = []

async function step(id, title, fn) {
  const started = Date.now()
  try {
    await fn()
    checks.push({ id, title, ok: true, ms: Date.now() - started })
    console.log(`${id} OK - ${title}`)
  } catch (error) {
    checks.push({ id, title, ok: false, ms: Date.now() - started, error })
    console.error(`${id} FAIL - ${title}`)
    throw error
  }
}

const admin = await stepLogin('admin', '123456')

const seededReceipts = [
  {
    id: 'qa-receipt-001',
    code: 'HDQA-001',
    branchId: 'gold-coast',
    businessDate: today,
    sellerKey: 'demo-staff',
    sellerId: 'demo-staff',
    sellerName: 'Nhân viên Demo',
    paymentMethod: 'cash',
    totalQuantity: 3,
    totalAmount: 267000,
    lines: [
      {
        allocationId: 'qa-allocation-001',
        productId: 'chestnut-330',
        productName: 'Hạt dẻ rang 330g',
        quantity: 3,
        unitPrice: 89000,
        total: 267000,
      },
    ],
    createdAt: `${today}T10:15:00.000+07:00`,
    createdBy: 'demo-manager',
    createdByName: 'Quản lý Demo',
  },
]

const seededAudit = [
  {
    id: 'qa-audit-001',
    actorId: admin.id,
    actorName: admin.name,
    module: 'Smoke test',
    action: 'Seed data',
    detail: 'Business smoke test seeded dashboard receipt and audit entry.',
    createdAt: new Date().toISOString(),
  },
]

const browser = await chromium.launch({ headless: true, executablePath: edgePath })

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await seedSession(context, admin)
  const page = await context.newPage()
  const runtimeErrors = collectRuntimeErrors(page)

  await step('TC-DASH-001', 'Management dashboard syncs POS receipts into revenue and employee ranking', async () => {
    await page.goto(`${baseUrl}/#dashboard`, { waitUntil: 'networkidle' })
    await page.locator('.manager-dashboard-page').waitFor()
    await page.getByText('267.000đ').first().waitFor()
    await page.getByText('Nhân viên Demo').first().waitFor()
    await page.getByText('HDQA-001').waitFor({ timeout: 500 }).catch(() => null)
  })

  await step('TC-DASH-002', 'Branch click opens invoice drilldown', async () => {
    await page.locator('.branch-revenue-bars button').filter({ hasText: 'Gold Coast Nha Trang' }).first().click()
    const drilldown = page.locator('.receipt-drilldown-panel')
    await drilldown.getByText('HDQA-001').waitFor()
    await drilldown.getByText('Nhân viên Demo').waitFor()
  })

  await step('TC-DASH-003', 'Language toggle switches dashboard to English', async () => {
    await page.locator('.sidebar-lang-toggle').click()
    await page.getByRole('heading', { name: 'Management Dashboard' }).waitFor()
    await page.getByText('Branch receipts').or(page.getByText('BRANCH RECEIPTS')).first().waitFor()
  })

  await step('TC-AUDIT-001', 'Admin audit log renders action timeline', async () => {
    await page.goto(`${baseUrl}/#control`, { waitUntil: 'networkidle' })
    await page.locator('.control-page').waitFor()
    await page.getByRole('button', { name: /Audit Log/i }).click()
    const auditTimeline = page.locator('.audit-timeline')
    await auditTimeline.getByText('Smoke test · Seed data').waitFor()
    await auditTimeline.getByText('Business smoke test seeded').waitFor()
  })

  await step('TC-POS-001', 'POS page renders for admin without runtime errors', async () => {
    await page.goto(`${baseUrl}/#sales`, { waitUntil: 'networkidle' })
    await page.locator('.pos-page').waitFor()
    await page.getByText(/POS|Sales/i).first().waitFor()
  })

  await context.close()

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  })
  await seedSession(mobile, admin)
  const mobilePage = await mobile.newPage()
  collectRuntimeErrors(mobilePage, runtimeErrors)

  await step('TC-RESP-001', 'Mobile dashboard has no horizontal overflow', async () => {
    await mobilePage.goto(`${baseUrl}/#dashboard`, { waitUntil: 'networkidle' })
    await mobilePage.locator('.manager-dashboard-page').waitFor()
    const hasOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
    if (hasOverflow) throw new Error(`Mobile page overflows horizontally: ${await mobilePage.evaluate(() => document.documentElement.scrollWidth)}px`)
  })

  await mobile.close()

  const hardErrors = runtimeErrors.filter((message) =>
    !message.includes('Failed to load resource') &&
    !message.includes('net::ERR_ABORTED') &&
    !(
      message.includes('WebSocket connection to') &&
      message.includes('supabase.co/realtime') &&
      (
        message.includes('ERR_NETWORK_ACCESS_DENIED') ||
        message.includes('ERR_ADDRESS_UNREACHABLE') ||
        message.includes('ERR_INTERNET_DISCONNECTED')
      )
    ),
  )
  if (hardErrors.length) throw new Error(`Runtime browser errors: ${hardErrors.join(' | ')}`)

  console.log(`BUSINESS_SMOKE_OK ${checks.length} checks`)
} finally {
  await browser.close()
}

async function stepLogin(username, password) {
  let account
  await step('TC-LOGIN-001', 'Login API accepts seeded admin account', async () => {
    const response = await fetch(`${baseUrl}/api/attendance/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.error || `Login failed with ${response.status}`)
    if (payload.role !== 'admin') throw new Error(`Expected admin role, got ${payload.role}`)
    if (!payload.authToken) throw new Error('Login response did not include authToken')
    account = payload
  })
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
    branchId: account.branchId,
    branchIds: account.branchIds || ['gold-coast', 'lotte-2310', 'lotte-vt'],
    authToken: account.authToken,
    employmentType: account.employmentType,
    positionTitle: account.positionTitle,
  }
}

async function seedSession(context, user) {
  await context.addInitScript(({ user, receipts, audit }) => {
    localStorage.setItem('gustino_user_v1', JSON.stringify(user))
    localStorage.removeItem('gustino_demo_user_v1')
    localStorage.setItem('gustino_pos_receipts_v1', JSON.stringify(receipts))
    localStorage.setItem('gustino_audit_log_v1', JSON.stringify(audit))
    localStorage.setItem('gustino_lang', 'vi')
  }, { user, receipts: seededReceipts, audit: seededAudit })
}

function collectRuntimeErrors(page, bucket = []) {
  page.on('console', (message) => {
    if (message.type() === 'error') bucket.push(message.text())
  })
  page.on('pageerror', (error) => bucket.push(error.stack || error.message))
  return bucket
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
