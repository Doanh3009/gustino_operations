import { chromium } from 'playwright-core'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5175'
const accountApi = process.env.QA_ACCOUNT_API || 'http://127.0.0.1:5187/api/attendance'
const managerLogin = await fetch(`${accountApi}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'quanly@gustino.vn', password: '123456' }),
})
if (!managerLogin.ok) throw new Error(`Đăng nhập Quản lý QA thất bại: ${await managerLogin.text()}`)
const manager = await managerLogin.json()
const managerHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${manager.authToken}`,
}

const createResponse = await fetch(`${accountApi}/employees`, {
  method: 'POST',
  headers: managerHeaders,
  body: JSON.stringify({
    name: 'Nhân viên QA Account',
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
  headers: managerHeaders,
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
  headers: managerHeaders,
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
  const staffContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await staffContext.addInitScript(() => {
    localStorage.setItem('gustino_demo_user_v1', JSON.stringify({
      id: 'demo-staff',
      name: 'Nhân viên Demo',
      email: 'nhanvien@gustino.vn',
      role: 'staff',
      branchId: 'gold-coast',
      branchIds: ['gold-coast'],
    }))
  })
  const staffPage = await staffContext.newPage()
  await staffPage.goto(`${baseUrl}/#attendance`, { waitUntil: 'networkidle' })
  await staffPage.getByRole('button', { name: 'Bảng lịch tuần' }).click()
  await staffPage.getByLabel('Tuần bắt đầu').fill(weekStartKey())
  await staffPage.getByRole('heading', { name: 'Ai đã đăng ký ca nào?' }).waitFor()
  await staffPage.locator('.weekly-schedule-matrix').waitFor()
  await staffPage.getByRole('button', { name: /Nhân viên Demo · Tôi/ }).click()
  const todayLabel = new Date().toLocaleDateString('vi-VN')
  const ownCell = staffPage.getByLabel(`Nhân viên Demo ${todayLabel}`)
  await ownCell.selectOption({ label: '10:00-15:00' })
  await staffPage.waitForTimeout(300)
  if (await ownCell.inputValue() === '') throw new Error('Dropdown lịch không lưu ca đã chọn.')
  await staffContext.close()

  const managerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await managerContext.addInitScript(() => {
    localStorage.setItem('gustino_demo_user_v1', JSON.stringify({
      id: 'demo-manager',
      name: 'Quản lý Demo',
      email: 'quanly@gustino.vn',
      role: 'manager',
      branchId: 'gold-coast',
      branchIds: ['gold-coast', 'lotte-2310', 'lotte-vt'],
    }))
  })
  const managerPage = await managerContext.newPage()
  await managerPage.goto(`${baseUrl}/#management`, { waitUntil: 'networkidle' })
  await managerPage.getByRole('heading', { name: 'Tạo và quản lý tài khoản nhân viên' }).waitFor()
  await managerPage.getByLabel('Họ tên').waitFor()
  await managerPage.getByLabel('Email đăng nhập').waitFor()
  await managerPage.getByText(/Mật khẩu được mã hóa/).waitFor()
  await managerContext.close()

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
