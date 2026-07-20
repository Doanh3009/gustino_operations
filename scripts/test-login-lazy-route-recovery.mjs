import { readFile } from 'node:fs/promises'

const [app, lazyRoute, boundary] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/lazyRoute.ts', import.meta.url), 'utf8').catch(() => ''),
  readFile(new URL('../src/components/LazyRouteErrorBoundary.tsx', import.meta.url), 'utf8').catch(() => ''),
])

const failures = []

if (!app.includes('lazyWithReload(')) failures.push('Các trang lazy chưa dùng cơ chế phục hồi chunk cũ sau deploy.')
if (!lazyRoute.includes('isStaleChunkError')) failures.push('Chưa giới hạn auto reload cho lỗi tải dynamic chunk.')
if (!lazyRoute.includes('sessionStorage.getItem') || !lazyRoute.includes('sessionStorage.setItem')) {
  failures.push('Chưa có chốt chỉ auto reload đúng một lần.')
}
if (!lazyRoute.includes('window.location.reload()')) failures.push('Chunk cũ 404 chưa tự tải lại bundle mới.')
if (!lazyRoute.includes('sessionStorage.removeItem')) failures.push('Dấu reload chưa được xóa sau khi chunk tải thành công.')
if (!boundary.includes('getDerivedStateFromError')) failures.push('Trang lazy chưa có error boundary chống màn hình trắng.')
if (!boundary.includes('Không mở được màn hình này')) failures.push('Error boundary chưa hiển thị hướng phục hồi cho người dùng.')
if (!boundary.includes('window.location.reload()')) failures.push('Màn hình lỗi chưa có nút tải lại thủ công.')
if (!app.includes('<LazyRouteErrorBoundary key={page}>')) failures.push('App chưa bọc route lazy bằng error boundary reset theo trang.')
if (app.includes('if (!canAccessPage(user, page)) return null')) failures.push('Chuyển route theo role vẫn có thể render trắng bằng return null.')
if (!app.includes('<RouteLoadSettled />')) failures.push('Route lazy tải xong chưa xóa dấu watchdog phục hồi.')
if (!app.includes("const ROUTE_LOAD_WATCHDOG_KEY = 'gustino:route-load-watchdog'")) failures.push('Thiếu watchdog cho import bị treo sau đăng nhập.')
if (!/PageLoadFallback[\s\S]*window\.setTimeout[\s\S]*window\.location\.reload\(\)/.test(app)) {
  failures.push('Fallback sau đăng nhập chưa tự phục hồi khi dynamic import bị treo.')
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}

console.log('LOGIN_LAZY_ROUTE_RECOVERY_OK')
