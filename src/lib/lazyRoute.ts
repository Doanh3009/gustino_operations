import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

const LAZY_ROUTE_RELOAD_KEY = 'gustino:lazy-route-reload-attempted'
const CHUNK_RELOAD_KEY = 'gustino:chunk-reload-attempted'

export const STALE_CHUNK_MESSAGE = 'Hệ thống vừa có bản cập nhật mới nên tệp cũ không còn trên máy chủ. Vui lòng tải lại trang (Ctrl+F5) rồi bấm lại.'

export function isStaleChunkError(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error || '')
  return [
    'Failed to fetch dynamically imported module',
    'error loading dynamically imported module',
    'Importing a module script failed',
    'ChunkLoadError',
    'Loading chunk',
    'Unable to preload CSS',
  ].some((fragment) => message.toLocaleLowerCase().includes(fragment.toLocaleLowerCase()))
}

/**
 * Nạp chunk thư viện theo yêu cầu (exceljs, html2canvas...). Sau mỗi lần deploy, hash chunk đổi nên
 * tab đang mở của người dùng trỏ tới tệp đã bị xoá khỏi máy chủ; khi đó tự tải lại trang một lần để
 * lấy bundle mới thay vì báo lỗi kỹ thuật "Failed to fetch dynamically imported module".
 */
export async function importChunk<T>(importer: () => Promise<T>): Promise<T> {
  try {
    const loaded = await importer()
    try {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY)
    } catch {
      // Storage bị chặn thì bỏ qua: import thành công không cần cơ chế phục hồi.
    }
    return loaded
  } catch (error) {
    if (!isStaleChunkError(error)) throw error
    let alreadyReloaded = false
    try {
      alreadyReloaded = sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1'
      if (!alreadyReloaded) sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
    } catch {
      // Không ghi được cờ thì không tự tải lại, tránh lặp vô hạn.
      alreadyReloaded = true
    }
    if (!alreadyReloaded) {
      window.location.reload()
      return new Promise<T>(() => undefined)
    }
    throw new Error(STALE_CHUNK_MESSAGE)
  }
}

export function lazyWithReload<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const loaded = await importer()
      try {
        sessionStorage.removeItem(LAZY_ROUTE_RELOAD_KEY)
      } catch {
        // Storage can be unavailable in strict privacy modes; a successful import needs no recovery.
      }
      return loaded
    } catch (error) {
      if (isStaleChunkError(error)) {
        let alreadyReloaded = false
        try {
          alreadyReloaded = sessionStorage.getItem(LAZY_ROUTE_RELOAD_KEY) === '1'
          if (!alreadyReloaded) sessionStorage.setItem(LAZY_ROUTE_RELOAD_KEY, '1')
        } catch {
          // If storage is blocked, the error boundary remains the safe non-loop fallback.
          alreadyReloaded = true
        }
        if (!alreadyReloaded) {
          window.location.reload()
          return new Promise<{ default: T }>(() => undefined)
        }
      }
      throw error
    }
  })
}
