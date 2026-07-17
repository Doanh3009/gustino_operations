import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [main, app, loader, shell, today, styles] = await Promise.all([
  readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/GlobalLoadingOverlay.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/TodayPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

const loadingAssets = [1, 2, 4].map((number) => `/mascots/capy-loading-${number}.png`)
for (const asset of [...loadingAssets, '/mascots/capy-attendance-camera.png']) {
  const png = await readFile(new URL(`../public${asset}`, import.meta.url))
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${asset} phải là PNG hợp lệ`)
  assert.equal(png.readUInt32BE(16), 256, `${asset} phải rộng 256px`)
  assert.equal(png.readUInt32BE(20), 256, `${asset} phải cao 256px`)
  assert.equal(png[25], 6, `${asset} phải có kênh alpha RGBA`)
}

assert.match(main, /<GlobalLoadingOverlay\s*\/>/, 'Overlay dùng chung phải được mount ở root')
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
for (const asset of loadingAssets) {
  assert.match(html, new RegExp(`<link[^>]+rel="preload"[^>]+href="${asset.replaceAll('/', '\\/')}"[^>]+fetchpriority="high"`), `${asset} phải được preload ưu tiên cao trước khi React chạy`)
}
assert.match(loader, /Math\.random\(\) \* LOADING_MASCOTS\.length/, 'Mỗi lần loading phải chọn mascot ngẫu nhiên')
for (const asset of loadingAssets) assert.ok(loader.includes(`'${asset}'`), `Thiếu loading asset ${asset}`)
assert.ok(!loader.includes("'/mascots/capy-loading-3.png'"), 'Không được dùng hình số 3 cho loading')
assert.match(loader, /performance\.now\(\) <= activityWindowUntil\.current/, 'Chỉ request gắn với thao tác người dùng mới được giữ overlay')
assert.match(loader, /window\.fetch = trackedFetch/, 'Request từ thao tác người dùng phải được theo dõi tới khi hoàn tất')
assert.match(loader, /useLayoutEffect\(\(\) => \{/, 'Mascot ngẫu nhiên phải được chọn trước khi browser paint overlay')
assert.match(loader, /decoding="sync"/, 'Ảnh loading phải decode đồng bộ để không xuất hiện sau cửa sổ')
assert.match(app, /<CapyLoadingWindow forced label="Đang mở màn hình…"\s*\/>/, 'Lazy route phải dùng cửa sổ Capy loading')
assert.match(shell, /attendance-popup-capybara[^>]+capy-attendance-camera\.png/, 'Popup check-in/check-out phải dùng Capy cầm máy ảnh')
assert.match(today, /attendance-capybara[^>]+capy-attendance-camera\.png/, 'Thẻ nhắc Hôm nay phải dùng Capy cầm máy ảnh')
assert.match(styles, /\.global-capy-loader\s*\{[\s\S]*?position:\s*fixed/, 'Loading phải là cửa sổ cố định giữa màn hình')
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/, 'Loading phải tôn trọng reduced motion')

console.log('CAPYBARA_LOADING_UI_OK')
