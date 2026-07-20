import { chromium } from 'playwright-core'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})

async function contextFor(user) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.addInitScript((account) => {
    localStorage.setItem('gustino_user_v1', JSON.stringify(account))
    localStorage.removeItem('gustino_demo_user_v1')
  }, user)
  return context
}

async function assertRedirect(user, route, expectedSelector, label) {
  const context = await contextFor(user)
  const page = await context.newPage()
  await page.goto(`${baseUrl}/#${route}`, { waitUntil: 'networkidle' })
  await page.locator(expectedSelector).waitFor()
  await context.close()
  console.log(`ROLE_OK ${user.role} ${route} -> ${label}`)
}

try {
  const staff = {
    id: 'demo-staff',
    name: 'Nhân viên Demo',
    email: 'nhanvien@gustino.vn',
    role: 'staff',
    branchId: 'gold-coast',
    branchIds: ['gold-coast'],
    authToken: 'qa-staff-token',
  }
  await assertRedirect(staff, 'sales', '.pos-page', 'sales')
  await assertRedirect(staff, 'my-records', '.my-records-page', 'my records')
  await assertRedirect(staff, 'management', '.pos-page', 'sales fallback')
  await assertRedirect(staff, 'dashboard', '.pos-page', 'dashboard denied')

  const leader = {
    id: 'demo-shift-leader',
    name: 'Ca trưởng Demo',
    email: 'catruong@gustino.vn',
    role: 'shift_leader',
    branchId: 'gold-coast',
    branchIds: ['gold-coast'],
    authToken: 'qa-leader-token',
  }
  await assertRedirect(leader, 'today', '.today-page', 'today')
  await assertRedirect(leader, 'inventory', '.inventory-page', 'inventory')
  await assertRedirect(leader, 'sales', '.pos-page', 'sales')
  await assertRedirect(leader, 'my-records', '.my-records-page', 'my records')
  await assertRedirect(leader, 'dashboard', '.today-page', 'dashboard denied')

  const manager = {
    id: 'demo-manager',
    name: 'Quản lý Demo',
    email: 'quanly@gustino.vn',
    role: 'manager',
    branchId: 'gold-coast',
    branchIds: ['gold-coast', 'lotte-2310', 'lotte-vt'],
    authToken: 'qa-manager-token',
  }
  await assertRedirect(manager, 'dashboard', '.manager-dashboard-page', 'dashboard')
  await assertRedirect(manager, 'report-archive', '.report-archive-page', 'daily report archive')
  await assertRedirect(manager, 'today', '.manager-dashboard-page', 'operations denied')
  await assertRedirect(manager, 'control', '.manager-dashboard-page', 'admin denied')

  const admin = {
    id: 'demo-admin',
    name: 'Admin hệ thống',
    email: 'admin@gustino.vn',
    role: 'admin',
    branchId: 'gold-coast',
    branchIds: ['gold-coast', 'lotte-2310', 'lotte-vt'],
    authToken: 'qa-admin-token',
  }
  await assertRedirect(admin, 'dashboard', '.admin-page', 'admin workspace')
  await assertRedirect(admin, 'control', '.control-page', 'control center')

  console.log('ROLE_ACCESS_QA_OK')
} finally {
  await browser.close()
}
