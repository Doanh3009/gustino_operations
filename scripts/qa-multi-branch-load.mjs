import { chromium } from 'playwright-core'

// QA tải đồng thời: 3 nhà hàng × ~10 nhân viên đăng nhập & mở app CÙNG LÚC.
// Mục tiêu: bắt lỗi trắng trang / crash realtime khi nhiều client mount song song
// (đúng lớp bug §23), và xác nhận mỗi vai trò rơi đúng trang mặc định.

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173'
const branches = ['gold-coast', 'lotte-2310', 'lotte-vt']

const canUseManagement = (r) => ['admin', 'manager'].includes(r)
const canUseOperations = (r) => r === 'shift_leader'
function defaultPage(role) {
  if (role === 'kitchen') return 'kitchen'
  if (role === 'staff') return 'sales'
  if (canUseManagement(role)) return 'dashboard'
  if (canUseOperations(role)) return 'today'
  return 'attendance'
}

// 30 tài khoản: 2 manager + 1 admin (đa chi nhánh) + mỗi chi nhánh 9 người vận hành.
const users = []
users.push({ id: 'load-admin', role: 'admin', name: 'Admin Tải', branchId: branches[0], branchIds: branches })
users.push({ id: 'load-manager-1', role: 'manager', name: 'Quản lý Tải 1', branchId: branches[0], branchIds: branches })
users.push({ id: 'load-manager-2', role: 'manager', name: 'Quản lý Tải 2', branchId: branches[1], branchIds: branches })
for (const branch of branches) {
  users.push({ id: `load-${branch}-leader-1`, role: 'shift_leader', name: `Ca trưởng ${branch} 1`, branchId: branch, branchIds: [branch] })
  users.push({ id: `load-${branch}-leader-2`, role: 'shift_leader', name: `Ca trưởng ${branch} 2`, branchId: branch, branchIds: [branch] })
  users.push({ id: `load-${branch}-kitchen`, role: 'kitchen', name: `Bếp ${branch}`, branchId: branch, branchIds: [branch] })
  for (let i = 1; i <= 6; i++) {
    users.push({ id: `load-${branch}-staff-${i}`, role: 'staff', name: `NV ${branch} ${i}`, branchId: branch, branchIds: [branch] })
  }
}

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})

const failures = []

async function runUser(account) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } })
  await context.addInitScript((user) => {
    localStorage.setItem('gustino_user_v1', JSON.stringify({ ...user, email: `${user.id}@gustino.vn`, authToken: `qa-${user.id}-token` }))
    localStorage.removeItem('gustino_demo_user_v1')
  }, account)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()) })
  try {
    const expected = defaultPage(account.role)
    await page.goto(`${baseUrl}/#launcher`, { waitUntil: 'networkidle' })
    let actual = ''
    try {
      await page.waitForFunction((exp) => window.location.hash.replace('#', '') === exp, expected, { timeout: 8000 })
      actual = expected
    } catch {
      actual = await page.evaluate(() => window.location.hash.replace('#', ''))
    }
    // Giữ phiên mở thêm để realtime subscribe thực sự chạy song song.
    await page.waitForTimeout(1500)
    const bodyLen = (await page.evaluate(() => document.body.innerText.length)) || 0
    if (actual !== expected) failures.push(`${account.id} (${account.role}): landing ${actual || '(rỗng)'} != ${expected}`)
    else if (bodyLen < 5) failures.push(`${account.id} (${account.role}): TRẮNG TRANG ở ${expected}`)
    else if (errors.length) failures.push(`${account.id} (${account.role}): runtime -> ${errors.slice(0, 2).join(' | ')}`)
  } catch (e) {
    failures.push(`${account.id} (${account.role}): ngoại lệ -> ${e.message}`)
  } finally {
    await context.close()
  }
}

try {
  console.log(`Mở đồng thời ${users.length} phiên trên ${branches.length} chi nhánh...`)
  await Promise.all(users.map(runUser))
  if (failures.length) {
    console.error(`MULTI_BRANCH_LOAD_FAILURES (${failures.length}/${users.length}):`)
    failures.forEach((f) => console.error('  - ' + f))
    throw new Error(`${failures.length} phiên lỗi khi tải đồng thời`)
  }
  console.log(`MULTI_BRANCH_LOAD_QA_OK (${users.length} phiên đồng thời, không crash/trắng trang)`)
} finally {
  await browser.close()
}
