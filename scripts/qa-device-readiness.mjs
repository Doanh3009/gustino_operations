/**
 * QA thẻ "Kiểm tra thiết bị" ở màn chấm công (BUG-107).
 *
 * Mô phỏng đúng thiết bị gây lỗi thật: Samsung SM-A235F chạy WebView trong Zalo
 * (user agent lấy từ auth.sessions của tài khoản Cao Bảo Trân), rồi kiểm tra:
 *   1. Chrome bình thường  → chỉ hiện dải trạng thái gọn, KHÔNG chặn.
 *   2. WebView trong app   → hiện cảnh báo chặn + nút mở trình duyệt hệ thống.
 *   3. Quyền vị trí bị chặn → hiện hướng dẫn bật lại quyền.
 * Mọi kịch bản đều kiểm tra không tràn ngang ở khổ 390px.
 *
 * Chạy: QA_BASE_URL=http://127.0.0.1:5173 node scripts/qa-device-readiness.mjs
 */
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173'
const artifactDir = 'artifacts/device-readiness'

const CHROME_ANDROID_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36'
const ZALO_WEBVIEW_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A235F Build/UP1A.231005.007;) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36'

await mkdir(artifactDir, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})

function fail(message) {
  throw new Error(message)
}

async function openAttendance({ userAgent, denyPermission = false }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent,
    geolocation: { latitude: 12.2481968, longitude: 109.1952713 },
    permissions: denyPermission ? [] : ['geolocation'],
  })
  const userId = `qa-devchk-${Date.now()}`
  await context.addInitScript((input) => {
    localStorage.setItem('gustino_user_v1', JSON.stringify({
      id: input.userId,
      name: 'Nhân viên QA thiết bị',
      email: 'qa-devchk@gustino.local',
      role: 'staff',
      branchId: 'gold-coast',
      branchIds: ['gold-coast'],
      authToken: 'qa-staff-token',
    }))
    localStorage.removeItem('gustino_demo_user_v1')
    if (input.denyPermission && navigator.permissions) {
      // Playwright không có trạng thái "denied" thật; ép Permissions API trả denied.
      navigator.permissions.query = async () => ({ state: 'denied', onchange: null })
    }
  }, { userId, denyPermission })
  const page = await context.newPage()
  await page.goto(`${baseUrl}/#attendance`, { waitUntil: 'networkidle' })
  await page.evaluate(() => { window.location.hash = '#attendance' })
  await page.waitForSelector('.devchk', { timeout: 15000 })
  return { context, page }
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    widest: Array.from(document.querySelectorAll('.devchk, .devchk *'))
      .map((node) => Math.round(node.getBoundingClientRect().right))
      .reduce((max, right) => Math.max(max, right), 0),
    viewport: window.innerWidth,
  }))
  if (overflow.doc > 1) fail(`${label}: trang tràn ngang ${overflow.doc}px`)
  if (overflow.widest > overflow.viewport + 1) fail(`${label}: thẻ kiểm tra thiết bị vượt viewport (${overflow.widest} > ${overflow.viewport})`)
}

try {
  // 1) Chrome Android bình thường: không được chặn, chỉ là dải trạng thái thu gọn.
  {
    const { context, page } = await openAttendance({ userAgent: CHROME_ANDROID_UA })
    if (await page.locator('.devchk-alert').count()) fail('Chrome: không được hiện cảnh báo chặn')
    await page.locator('.devchk-ok .devchk-summary').waitFor()
    await page.locator('.devchk-summary').click()
    await page.locator('.devchk-body').waitFor()
    await page.locator('.devchk-facts').waitFor()
    const browserFact = await page.locator('.devchk-facts dd').first().innerText()
    if (!/Chrome/i.test(browserFact)) fail(`Chrome: nhận diện trình duyệt sai (${browserFact})`)
    await assertNoHorizontalOverflow(page, 'Chrome')
    await page.screenshot({ path: `${artifactDir}/chrome-ready.png`, fullPage: false })
    console.log('DEVCHK_OK chrome -> dải trạng thái gọn, không chặn')
    await context.close()
  }

  // 2) WebView trong Zalo trên Samsung SM-A235F: phải chặn và chỉ đúng nguyên nhân.
  {
    const { context, page } = await openAttendance({ userAgent: ZALO_WEBVIEW_UA })
    const alert = page.locator('.devchk-alert')
    await alert.waitFor()
    // UA thật của WebView Zalo KHÔNG chứa chữ "Zalo" (xem auth.sessions), nên app
    // chỉ có thể nói "ứng dụng khác" — vẫn chặn đúng và chỉ đúng cách xử lý.
    const title = await alert.locator('strong').first().innerText()
    if (!/mở app trong .*không chấm công được/i.test(title)) fail(`WebView: tiêu đề sai (${title})`)
    await alert.getByRole('button', { name: 'Mở bằng trình duyệt điện thoại' }).waitFor()
    await alert.getByRole('button', { name: 'Sao chép link app' }).waitFor()
    const model = await page.locator('.devchk-facts dd').nth(1).innerText()
    if (!/SM-A235F/i.test(model)) fail(`WebView: chưa nhận ra dòng máy (${model})`)
    await assertNoHorizontalOverflow(page, 'WebView')
    await page.screenshot({ path: `${artifactDir}/zalo-webview-blocked.png`, fullPage: false })
    console.log('DEVCHK_OK zalo-webview -> cảnh báo chặn + nút mở trình duyệt')
    await context.close()
  }

  // 2b) WebView có khai tên app trong UA thì phải gọi đúng tên đó.
  {
    const { context, page } = await openAttendance({ userAgent: `${ZALO_WEBVIEW_UA} Zalo` })
    const title = await page.locator('.devchk-alert strong').first().innerText()
    if (!/trong Zalo/i.test(title)) fail(`WebView có tên app: chưa gọi tên Zalo (${title})`)
    console.log('DEVCHK_OK zalo-named -> gọi đúng tên app chủ')
    await context.close()
  }

  // 3) Quyền vị trí bị chặn trên trình duyệt thật.
  {
    const { context, page } = await openAttendance({ userAgent: CHROME_ANDROID_UA, denyPermission: true })
    const alert = page.locator('.devchk-alert')
    await alert.waitFor()
    const title = await alert.locator('strong').first().innerText()
    if (!/Quyền vị trí/i.test(title)) fail(`Denied: tiêu đề sai (${title})`)
    await alert.getByRole('button', { name: 'Thử lại quyền vị trí' }).waitFor()
    await assertNoHorizontalOverflow(page, 'Denied')
    await page.screenshot({ path: `${artifactDir}/location-denied.png`, fullPage: false })
    console.log('DEVCHK_OK location-denied -> hướng dẫn bật lại quyền')
    await context.close()
  }

  console.log('DEVICE_READINESS_QA_OK')
} finally {
  await browser.close()
}
