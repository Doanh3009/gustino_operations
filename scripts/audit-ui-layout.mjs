// Bộ soát giao diện: tìm chỗ tràn ngang, chữ bị cắt, và các thẻ trong cùng một
// lưới nhưng cao thấp khác nhau. Chạy trên mọi trang × mọi vai trò × 2 khổ màn.
import { chromium } from 'playwright-core'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
})

const account = (role, extra = {}) => ({
  id: `audit-${role}`,
  name: `Audit ${role}`,
  email: `${role}@gustino.vn`,
  role,
  branchId: 'gold-coast',
  branchIds: ['gold-coast'],
  // Có token = đi đường LAN `/api/*`, không cần phiên Supabase thật để soát layout.
  authToken: `audit-${role}-token`,
  ...extra,
})

const TARGETS = [
  { role: 'shift_leader', pages: ['today', 'inventory', 'handover', 'orders', 'attendance', 'sales', 'report', 'my-records'] },
  { role: 'admin', pages: ['management', 'dashboard', 'control', 'admin-accounts'] },
  { role: 'manager', pages: ['dashboard', 'management'] },
  { role: 'staff', pages: ['sales', 'attendance', 'my-records'] },
  { role: 'kitchen', pages: ['kitchen'] },
]
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
]

const AUDIT = () => {
  const out = { pageOverflow: null, clipped: [], unevenGrids: [], tinyTap: [] }
  const de = document.documentElement
  if (de.scrollWidth > de.clientWidth + 1) {
    out.pageOverflow = { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth }
  }
  const describe = (el) => {
    const cls = String(el.className || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.')
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`
  }
  const all = Array.from(document.querySelectorAll('body *'))
  // Dải cuộn ngang CỐ Ý (tab kho, danh sách nhân viên POS) không phải lỗi: phần
  // tử tràn ra nhưng người dùng vuốt được. Chỉ tính là lỗi khi không có tổ tiên
  // nào cuộn ngang được — lúc đó chữ/nút bị cắt thật.
  const insideScroller = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const s = getComputedStyle(node)
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') return true
    }
    return false
  }
  // 1. Phần tử tràn khỏi khung nhìn theo chiều ngang.
  for (const el of all) {
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) continue
    if (rect.right > de.clientWidth + 2) {
      const style = getComputedStyle(el)
      if (style.position === 'fixed' || style.position === 'absolute') continue
      if (insideScroller(el)) continue
      out.clipped.push({ sel: describe(el), right: Math.round(rect.right), vw: de.clientWidth, text: (el.textContent || '').trim().slice(0, 48) })
    }
  }
  // 2. Thẻ cùng một lưới nhưng chiều cao lệch nhau.
  // Chỉ soi lưới ở chế độ căn mặc định (`stretch`) — ĐÓ mới là nơi các thẻ phải
  // cao bằng nhau. `start`/`center`/`baseline` là tác giả cố ý cho ô ôm sát nội
  // dung (bố cục nội dung + cột phụ, thanh công cụ), chênh cao không phải lỗi.
  const grids = all.filter((el) => {
    const s = getComputedStyle(el)
    if (s.display !== 'grid' || el.children.length < 2) return false
    return s.alignItems === 'normal' || s.alignItems === 'stretch'
  })
  for (const grid of grids) {
    const kids = Array.from(grid.children).filter((k) => {
      const r = k.getBoundingClientRect()
      return r.height > 0 && r.width > 0
    })
    if (kids.length < 2) continue
    const rows = new Map()
    for (const k of kids) {
      const r = k.getBoundingClientRect()
      const key = Math.round(r.top)
      if (!rows.has(key)) rows.set(key, [])
      rows.get(key).push(Math.round(r.height))
    }
    for (const [, heights] of rows) {
      if (heights.length < 2) continue
      const min = Math.min(...heights)
      const max = Math.max(...heights)
      if (max - min > 12) {
        out.unevenGrids.push({ sel: describe(grid), min, max, count: heights.length })
        break
      }
    }
  }
  // 3. Nút bấm quá nhỏ để chạm trên điện thoại.
  if (de.clientWidth <= 480) {
    for (const el of document.querySelectorAll('button, .selfie-button, select')) {
      const r = el.getBoundingClientRect()
      if (r.height > 0 && r.height < 32) {
        out.tinyTap.push({ sel: describe(el), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 32) })
      }
    }
  }
  return out
}

const findings = []
for (const target of TARGETS) {
  const user = account(target.role)
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    await context.addInitScript((acc) => {
      localStorage.setItem('gustino_user_v1', JSON.stringify(acc))
      localStorage.removeItem('gustino_demo_user_v1')
    }, user)
    const page = await context.newPage()
    for (const route of target.pages) {
      try {
        // Đổi mỗi hash thì trình duyệt KHÔNG tải lại trang — SPA sẽ giữ nguyên màn
        // cũ và bộ soát đo nhầm trang. Về about:blank để ép tải mới từng route.
        await page.goto('about:blank')
        // Hash là tên trần (`#today`), KHÔNG có dấu gạch chéo — `#/today` không khớp
        // `pageFromHash()` nên app rơi về trang mặc định và bộ soát đo nhầm màn.
        await page.goto(`${baseUrl}/#${route}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
        await page.waitForTimeout(1600)
        const result = await page.evaluate(AUDIT)
        const label = `${target.role}/${route}@${vp.name}`
        const nodes = await page.evaluate(() => document.querySelectorAll('body *').length)
        if (nodes < 40) findings.push({ label, kind: 'EMPTY_PAGE', detail: { nodes } })
        if (result.pageOverflow) findings.push({ label, kind: 'PAGE_OVERFLOW', detail: result.pageOverflow })
        const clippedTop = result.clipped.slice(0, 4)
        for (const c of clippedTop) findings.push({ label, kind: 'OVERFLOW_X', detail: c })
        for (const g of result.unevenGrids.slice(0, 4)) findings.push({ label, kind: 'UNEVEN_CARDS', detail: g })
        for (const t of result.tinyTap.slice(0, 4)) findings.push({ label, kind: 'TINY_TAP', detail: t })
      } catch (error) {
        findings.push({ label: `${target.role}/${route}@${vp.name}`, kind: 'ERROR', detail: String(error).slice(0, 120) })
      }
    }
    await context.close()
  }
}
await browser.close()

const byKind = {}
for (const f of findings) {
  byKind[f.kind] = byKind[f.kind] || []
  byKind[f.kind].push(f)
}
for (const kind of Object.keys(byKind)) {
  console.log(`\n===== ${kind} (${byKind[kind].length}) =====`)
  for (const f of byKind[kind]) console.log(` ${f.label} :: ${JSON.stringify(f.detail)}`)
}
console.log(`\nTOTAL ${findings.length}`)
