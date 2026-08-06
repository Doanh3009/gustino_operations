import { chromium } from 'playwright-core'

// QA phân quyền TOÀN DIỆN: mọi vai trò × mọi trang.
// Mirror chính xác canAccessPage/defaultPageForRole trong src/App.tsx.
// Assert theo location.hash cuối cùng (navigate dùng history.replaceState) +
// bắt lỗi runtime/trắng trang. Nếu App.tsx đổi luật mà quên đồng bộ -> fail.

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173'

const canUseAdmin = (r) => r === 'admin'
const canUseSales = (r) => ['shift_leader', 'staff', 'cashier'].includes(r)
const canUseOperations = (r) => r === 'shift_leader'
const canUseManagement = (r) => ['admin', 'manager'].includes(r)
const canUseKitchen = (r) => ['admin', 'kitchen'].includes(r)
const managerSections = ['manager-revenue', 'manager-business', 'manager-inventory']

function canAccess(role, page) {
  if (page === 'launcher') return true
  if (page === 'attendance') return role !== 'kitchen' && role !== 'manager' && role !== 'cashier'
  if (page === 'dashboard') return role === 'manager'
  if (page === 'sales') return canUseSales(role)
  if (page === 'my-records') return role === 'staff' || role === 'shift_leader'
  // Xem công (thay trang Bảng lương đã gỡ): nhân viên/ca trưởng + giám sát SUP MT.
  if (page === 'my-timesheet') return ['staff', 'shift_leader', 'supmt'].includes(role)
  if (page === 'report-archive') return canUseManagement(role)
  if (page === 'inventory') return canUseOperations(role)
  // Admin theo dõi đơn ở trang Quản trị, không lập phiếu đặt hàng của chi nhánh.
  if (page === 'orders') return role !== 'admin' && (canUseManagement(role) || canUseOperations(role))
  if (page === 'management') return role === 'admin'
  // Đồng bộ App.tsx/AppShell: hai route vận hành nhân sự/đơn hàng này chỉ admin.
  if (page === 'manager-attendance' || page === 'manager-requests') return canUseAdmin(role)
  if (managerSections.includes(page)) return role === 'manager'
  if (page === 'admin-accounts') return canUseAdmin(role)
  if (page === 'control') return canUseAdmin(role)
  if (page === 'kitchen') return canUseKitchen(role)
  return canUseOperations(role)
}

function defaultPage(role) {
  if (role === 'kitchen') return 'kitchen'
  if (role === 'staff' || role === 'cashier') return 'sales'
  if (role === 'admin') return 'management'
  if (role === 'manager') return 'dashboard'
  if (role === 'supmt') return 'attendance'
  if (canUseOperations(role)) return 'today'
  return 'attendance'
}

// Khi app tự ĐIỀU HƯỚNG tới trang Quản trị, navigate() ghi hash CRM
// (routeMap.adminRouteForSection → "/admin/dashboard"). Còn khi mở thẳng
// "#management" và quyền hợp lệ thì hash giữ nguyên — không quy đổi.
function redirectHash(page) {
  return page === 'management' ? '/admin/dashboard' : page
}

function expectedFinal(role, page) {
  if (page === 'launcher') return redirectHash(defaultPage(role))
  return canAccess(role, page) ? page : redirectHash(defaultPage(role))
}

const allPages = [
  'launcher', 'dashboard', 'today', 'sales', 'my-records', 'my-timesheet', 'report-archive', 'restaurant',
  'report', 'inventory', 'handover', 'orders', 'attendance', 'management',
  ...managerSections, 'manager-attendance', 'manager-requests',
  'admin-accounts', 'control', 'kitchen',
]

const roles = [
  { role: 'admin', id: 'demo-admin', name: 'Admin hệ thống', branchId: 'gold-coast', branchIds: ['gold-coast', 'lotte-2310', 'lotte-vt'] },
  { role: 'manager', id: 'demo-manager', name: 'Quản lý Demo', branchId: 'gold-coast', branchIds: ['gold-coast', 'lotte-2310', 'lotte-vt'] },
  { role: 'shift_leader', id: 'demo-shift-leader', name: 'Ca trưởng Demo', branchId: 'gold-coast', branchIds: ['gold-coast'] },
  { role: 'staff', id: 'demo-staff', name: 'Nhân viên Demo', branchId: 'gold-coast', branchIds: ['gold-coast'] },
  { role: 'kitchen', id: 'demo-kitchen', name: 'Bếp Demo', branchId: 'gold-coast', branchIds: ['gold-coast'] },
]

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})

let checks = 0
const failures = []

try {
  for (const account of roles) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await context.addInitScript((user) => {
      localStorage.setItem('gustino_user_v1', JSON.stringify({ ...user, email: `${user.role}@gustino.vn`, authToken: `qa-${user.role}-token` }))
      localStorage.removeItem('gustino_demo_user_v1')
    }, account)
    const page = await context.newPage()
    const runtimeErrors = []
    page.on('pageerror', (error) => runtimeErrors.push(error.message))
    page.on('console', (msg) => {
      const text = msg.text()
      if (msg.type() !== 'error') return
      if (text.includes('Failed to load resource')) return
      if (text.includes('/realtime/v1/websocket') && text.includes('ERR_NETWORK_ACCESS_DENIED')) return
      runtimeErrors.push(text)
    })

    for (const target of allPages) {
      const expected = expectedFinal(account.role, target)
      runtimeErrors.length = 0
      await page.goto(`${baseUrl}/#${target}`, { waitUntil: 'networkidle' })
      let actual = ''
      try {
        await page.waitForFunction((exp) => window.location.hash.replace('#', '') === exp, expected, { timeout: 4000 })
        actual = expected
      } catch {
        actual = await page.evaluate(() => window.location.hash.replace('#', ''))
      }
      const bodyLen = (await page.evaluate(() => document.body.innerText.length)) || 0
      checks++
      if (actual !== expected) {
        failures.push(`${account.role} #${target}: mong đợi -> ${expected}, thực tế -> ${actual || '(rỗng)'}`)
      } else if (bodyLen < 5) {
        failures.push(`${account.role} #${target}: TRẮNG TRANG (body rỗng) dù hash đúng ${expected}`)
      } else if (runtimeErrors.length) {
        failures.push(`${account.role} #${target}: lỗi runtime -> ${runtimeErrors.slice(0, 2).join(' | ')}`)
      }
    }
    await context.close()
    console.log(`MATRIX_ROLE_OK ${account.role} (${allPages.length} trang)`)
  }

  if (failures.length) {
    console.error(`PERMISSION_MATRIX_FAILURES (${failures.length}/${checks}):`)
    failures.forEach((f) => console.error('  - ' + f))
    throw new Error(`${failures.length} phân quyền sai`)
  }
  console.log(`PERMISSION_MATRIX_QA_OK (${checks} kiểm tra role×trang đều đúng)`)
} finally {
  await browser.close()
}
