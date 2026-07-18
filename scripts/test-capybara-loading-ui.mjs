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

assert.doesNotMatch(main, /<GlobalLoadingOverlay\s*\/>/, 'Không mount bộ chặn fetch toàn cục vì polling/realtime sau click có thể tạo loading giả')
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
for (const asset of loadingAssets) {
  assert.match(html, new RegExp(`<link[^>]+rel="preload"[^>]+href="${asset.replaceAll('/', '\\/')}"[^>]+fetchpriority="high"`), `${asset} phải được preload ưu tiên cao trước khi React chạy`)
}
assert.match(loader, /Math\.random\(\) \* LOADING_MASCOTS\.length/, 'Mỗi lần loading phải chọn mascot ngẫu nhiên')
for (const asset of loadingAssets) assert.ok(loader.includes(`'${asset}'`), `Thiếu loading asset ${asset}`)
assert.ok(!loader.includes("'/mascots/capy-loading-3.png'"), 'Không được dùng hình số 3 cho loading')
assert.match(loader, /performance\.now\(\) <= activityWindowUntil\.current/, 'Chỉ request gắn với thao tác người dùng mới được giữ overlay')
assert.match(loader, /window\.fetch = trackedFetch/, 'Component cũ vẫn giữ cơ chế theo dõi nếu cần tái sử dụng có chủ đích')
assert.match(loader, /const DISPLAY_DELAY_MS = [2-9]\d\d/, 'Request nhanh phải có khoảng trì hoãn trước khi hiện loading để tránh nhấp nháy')
assert.doesNotMatch(loader, /const MINIMUM_VISIBLE_MS = 700/, 'Loading không được tiếp tục ép mọi thao tác đứng tối thiểu 700 ms')
const markUserActivityBody = loader.slice(loader.indexOf('const markUserActivity'), loader.indexOf('const onClick'))
assert.doesNotMatch(markUserActivityBody, /pulse\(/, 'Click/select/file chỉ được đánh dấu ngữ cảnh; không được tự bật loading khi chưa có request chậm')
assert.match(loader, /useLayoutEffect\(\(\) => \{/, 'Mascot ngẫu nhiên phải được chọn trước khi browser paint overlay')
assert.match(loader, /decoding="sync"/, 'Ảnh loading phải decode đồng bộ để không xuất hiện sau cửa sổ')
assert.match(app, /function PageLoadFallback\(\{ label = 'Đang mở màn hình…'/, 'Lazy route phải giữ nhãn Capy loading mặc định')
assert.match(app, /<CapyLoadingWindow forced label=\{label\}\s*\/>/, 'Lazy route phải dùng cửa sổ Capy loading')
assert.match(shell, /attendance-popup-capybara[^>]+capy-attendance-camera\.png/, 'Popup check-in/check-out phải dùng Capy cầm máy ảnh')
assert.match(today, /attendance-capybara[^>]+capy-attendance-camera\.png/, 'Thẻ nhắc Hôm nay phải dùng Capy cầm máy ảnh')
assert.match(styles, /\.global-capy-loader\s*\{[\s\S]*?position:\s*fixed/, 'Loading phải là cửa sổ cố định giữa màn hình')
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/, 'Loading phải tôn trọng reduced motion')

console.log('CAPYBARA_LOADING_UI_OK')
