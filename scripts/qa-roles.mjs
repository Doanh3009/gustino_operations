import { chromium } from 'playwright-core'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4173'
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})

async function contextFor(user) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.addInitScript((account) => {
    localStorage.setItem('gustino_demo_user_v1', JSON.stringify(account))
  }, user)
  return context
}

try {
  const staffContext = await contextFor({
    id: 'demo-staff',
    name: 'Nhân viên Demo',
    email: 'nhanvien@gustino.vn',
    role: 'staff',
    branchId: 'gold-coast',
    branchIds: ['gold-coast'],
  })
  const staffPage = await staffContext.newPage()
  await staffPage.goto(`${baseUrl}/#launcher`, { waitUntil: 'networkidle' })
  await staffPage.getByRole('button', { name: /Chấm công/ }).waitFor()
  if (await staffPage.getByRole('button', { name: /Vận hành cửa hàng/ }).count()) {
    throw new Error('Nhân viên vẫn nhìn thấy ứng dụng vận hành.')
  }
  if (await staffPage.getByRole('button', { name: /Tổng hợp quản lý/ }).count()) {
    throw new Error('Nhân viên vẫn nhìn thấy màn hình tổng hợp quản lý.')
  }
  await staffPage.goto(`${baseUrl}/#management`, { waitUntil: 'networkidle' })
  await staffPage.locator('.attendance-page').waitFor()
  await staffContext.close()

  const leaderContext = await contextFor({
    id: 'demo-shift-leader',
    name: 'Ca trưởng Demo',
    email: 'catruong@gustino.vn',
    role: 'shift_leader',
    branchId: 'gold-coast',
    branchIds: ['gold-coast'],
  })
  const leaderPage = await leaderContext.newPage()
  await leaderPage.goto(`${baseUrl}/#launcher`, { waitUntil: 'networkidle' })
  await leaderPage.getByRole('button', { name: /Vận hành cửa hàng/ }).waitFor()
  if (await leaderPage.getByRole('button', { name: /Tổng hợp quản lý/ }).count()) {
    throw new Error('Ca trưởng nhìn thấy màn hình tổng hợp quản lý.')
  }
  await leaderPage.goto(`${baseUrl}/#inventory`, { waitUntil: 'networkidle' })
  await leaderPage.getByLabel('Chọn ngày').waitFor()
  await leaderPage.getByText(/Tồn kho hôm nay/).waitFor()
  await leaderPage.getByRole('alert').filter({ hasText: /Kho gần hết/ }).waitFor()
  await leaderContext.close()

  const managerContext = await contextFor({
    id: 'demo-manager',
    name: 'Quản lý Demo',
    email: 'quanly@gustino.vn',
    role: 'manager',
    branchId: 'gold-coast',
    branchIds: ['gold-coast', 'lotte-2310', 'lotte-vt'],
  })
  const managerPage = await managerContext.newPage()
  await managerPage.goto(`${baseUrl}/#launcher`, { waitUntil: 'networkidle' })
  if (await managerPage.getByRole('button', { name: /Vận hành cửa hàng/ }).count()) {
    throw new Error('Quản lý vẫn nhìn thấy quy trình vận hành của ca trưởng.')
  }
  await managerPage.getByRole('button', { name: /Tổng hợp quản lý/ }).click()
  await managerPage.getByRole('heading', { name: 'Quản lý GUSTINO' }).waitFor()
  await managerPage.getByRole('heading', { name: 'Chấm công theo ngày, tháng' }).waitFor()
  await managerPage.getByRole('heading', { name: 'Nhập, xuất, hao hụt và tồn kho trong kỳ' }).waitFor()
  await managerPage.getByRole('heading', { name: 'Lịch sử báo cáo đã lưu' }).waitFor()
  await managerPage.getByRole('heading', { name: 'Tạo và quản lý tài khoản nhân viên' }).waitFor()
  if (await managerPage.getByText('Doanh thu', { exact: true }).count()) {
    throw new Error('Màn hình Quản lý vẫn còn khối bán hàng/doanh thu.')
  }
  await managerPage.goto(`${baseUrl}/#today`, { waitUntil: 'networkidle' })
  await managerPage.locator('.launcher-page').waitFor()
  await managerContext.close()

  console.log('ROLE_ACCESS_QA_OK')
} finally {
  await browser.close()
}
