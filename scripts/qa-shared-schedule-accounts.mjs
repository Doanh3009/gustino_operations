import { chromium } from 'playwright-core'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5175'
const accountApi = process.env.QA_ACCOUNT_API || 'http://127.0.0.1:5187/api/attendance'
const adminLogin = await fetch(`${accountApi}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@gustino.vn', password: '123456' }),
})
if (!adminLogin.ok) throw new Error(`Đăng nhập Admin QA thất bại: ${await adminLogin.text()}`)
const admin = await adminLogin.json()
const adminHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${admin.authToken}`,
}

const createResponse = await fetch(`${accountApi}/employees`, {
  method: 'POST',
  headers: adminHeaders,
  body: JSON.stringify({
    name: 'Nhân viên QA Account',
    username: 'qaaccount',
    email: 'qa.account@gustino.test',
    branchId: 'gold-coast',
    role: 'staff',
    temporaryPassword: 'StartQA789',
  }),
})
if (!createResponse.ok) throw new Error(`Tạo account thất bại: ${await createResponse.text()}`)
const employee = await createResponse.json()

const firstLogin = await fetch(`${accountApi}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: employee.email, password: 'StartQA789' }),
})
if (!firstLogin.ok) throw new Error('Account mới không đăng nhập được.')

const resetResponse = await fetch(`${accountApi}/employees/${employee.id}/password`, {
  method: 'PATCH',
  headers: adminHeaders,
  body: JSON.stringify({ temporaryPassword: 'ResetQA456' }),
})
if (!resetResponse.ok) throw new Error(`Đặt lại mật khẩu thất bại: ${await resetResponse.text()}`)

const oldPasswordLogin = await fetch(`${accountApi}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: employee.email, password: 'StartQA789' }),
})
if (oldPasswordLogin.ok) throw new Error('Mật khẩu cũ vẫn đăng nhập được sau khi đặt lại.')

const newPasswordLogin = await fetch(`${accountApi}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: employee.email, password: 'ResetQA456' }),
})
if (!newPasswordLogin.ok) throw new Error('Mật khẩu mới không đăng nhập được.')

const deleteResponse = await fetch(`${accountApi}/employees/${employee.id}`, {
  method: 'DELETE',
  headers: adminHeaders,
})
if (!deleteResponse.ok) throw new Error(`Xóa account thất bại: ${await deleteResponse.text()}`)

const deletedLogin = await fetch(`${accountApi}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: employee.email, password: 'ResetQA456' }),
})
if (deletedLogin.ok) throw new Error('Account đã xóa vẫn đăng nhập được.')

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})

try {
  // Staff mở tab "Đăng ký tuần": bảng lịch DỌC (schedule-vboard, mục 14 CODEMAP)
  // phải render — bảng ma trận cuộn ngang cũ đã bị thay thế.
  const staffContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await staffContext.addInitScript(() => {
    localStorage.setItem('gustino_user_v1', JSON.stringify({
      id: 'qa-attendance-user',
      name: 'Nhân viên QA',
      email: 'qa-attendance@gustino.local',
      role: 'staff',
      branchId: 'gold-coast',
      branchIds: ['gold-coast'],
      authToken: 'qa-staff-token',
    }))
    localStorage.removeItem('gustino_demo_user_v1')
  })
  const staffPage = await staffContext.newPage()
  await staffPage.goto(`${baseUrl}/#attendance`, { waitUntil: 'networkidle' })
  await staffPage.getByRole('button', { name: 'Đăng ký tuần' }).click()
  await staffPage.getByRole('heading', { name: 'Đăng ký ca trong tuần' }).waitFor()
  await staffPage.locator('.schedule-vboard').waitFor()
  if (await staffPage.locator('.weekly-schedule-matrix').count()) {
    throw new Error('Bảng ma trận cuộn ngang cũ vẫn còn render.')
  }
  await staffContext.close()

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await adminContext.addInitScript(() => {
    localStorage.setItem('gustino_user_v1', JSON.stringify({
      id: 'demo-admin',
      name: 'Admin hệ thống',
      email: 'admin@gustino.vn',
      role: 'admin',
      branchId: 'gold-coast',
      branchIds: ['gold-coast', 'lotte-2310', 'lotte-vt'],
      authToken: 'qa-admin-token',
    }))
    localStorage.removeItem('gustino_demo_user_v1')
  })
  const adminPage = await adminContext.newPage()
  await adminPage.goto(`${baseUrl}/#admin-accounts`, { waitUntil: 'networkidle' })
  await adminPage.getByRole('heading', { name: 'Tạo và quản lý tài khoản nhân viên' }).waitFor()
  await adminPage.getByLabel('Họ tên').waitFor()
  await adminPage.getByLabel('Tên đăng nhập').waitFor()
  await adminPage.getByText(/Admin hệ thống tự đặt mật khẩu/).waitFor()
  await adminContext.close()

  console.log('SHARED_SCHEDULE_ACCOUNTS_QA_OK')
} finally {
  await browser.close()
}

function weekStartKey(date = new Date()) {
  const start = new Date(date)
  const day = start.getDay()
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
  return [
    start.getFullYear(),
    String(start.getMonth() + 1).padStart(2, '0'),
    String(start.getDate()).padStart(2, '0'),
  ].join('-')
}
