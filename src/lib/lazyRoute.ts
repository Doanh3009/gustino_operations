import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

const LAZY_ROUTE_RELOAD_KEY = 'gustino:lazy-route-reload-attempted'

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
