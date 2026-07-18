import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const DISPLAY_DELAY_MS = 280
const MINIMUM_VISIBLE_MS = 320
const USER_ACTIVITY_WINDOW_MS = 900
const LOADING_MASCOTS = [
  '/mascots/capy-loading-1.png',
  '/mascots/capy-loading-2.png',
  '/mascots/capy-loading-4.png',
] as const
const ACTIONABLE_SELECTOR = [
  'button',
  'a[href]',
  '[role="button"]',
  'summary',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="file"]',
  'select',
].join(',')

export function GlobalLoadingOverlay() {
  const [visible, setVisible] = useState(false)
  const tokenSequence = useRef(0)
  const activeTokens = useRef(new Set<number>())
  const showTimers = useRef(new Map<number, number>())
  const hideTimer = useRef<number | null>(null)
  const shownAt = useRef(0)
  const overlayShown = useRef(false)
  const activityWindowUntil = useRef(0)
  const mounted = useRef(true)

  const show = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    shownAt.current = Date.now()
    overlayShown.current = true
    setVisible(true)
  }, [])

  const begin = useCallback(() => {
    const token = ++tokenSequence.current
    activeTokens.current.add(token)
    if (overlayShown.current && hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    const timer = window.setTimeout(() => {
      showTimers.current.delete(token)
      if (activeTokens.current.has(token)) show()
    }, DISPLAY_DELAY_MS)
    showTimers.current.set(token, timer)
    return token
  }, [show])

  const end = useCallback((token: number) => {
    const showTimer = showTimers.current.get(token)
    if (showTimer !== undefined) {
      window.clearTimeout(showTimer)
      showTimers.current.delete(token)
    }
    activeTokens.current.delete(token)
    if (!mounted.current || activeTokens.current.size) return
    if (!overlayShown.current) return
    const remaining = Math.max(0, MINIMUM_VISIBLE_MS - (Date.now() - shownAt.current))
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null
      if (!activeTokens.current.size) {
        overlayShown.current = false
        setVisible(false)
      }
    }, remaining)
  }, [])

  useEffect(() => {
    mounted.current = true
    const originalFetch = window.fetch
    LOADING_MASCOTS.forEach((src) => {
      const image = new Image()
      image.src = src
    })

    const markUserActivity = () => {
      activityWindowUntil.current = performance.now() + USER_ACTIVITY_WINDOW_MS
    }

    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const control = event.target.closest<HTMLElement>(ACTIONABLE_SELECTOR)
      if (!control || control.dataset.loadingOverlay === 'off') return
      if ('disabled' in control && Boolean((control as HTMLButtonElement).disabled)) return
      if (control.getAttribute('aria-disabled') === 'true') return
      markUserActivity()
    }

    const onSubmit = (event: SubmitEvent) => {
      if (!(event.target instanceof HTMLFormElement)) return
      if (event.target.dataset.loadingOverlay === 'off') return
      markUserActivity()
    }

    const onChange = (event: Event) => {
      if (!(event.target instanceof Element)) return
      if (!event.target.matches('input[type="file"], select')) return
      if ((event.target as HTMLElement).dataset.loadingOverlay === 'off') return
      markUserActivity()
    }

    const trackedFetch: typeof window.fetch = (...args) => {
      const shouldTrack = performance.now() <= activityWindowUntil.current
      if (!shouldTrack) return originalFetch(...args)
      const token = begin()
      return originalFetch(...args).finally(() => end(token))
    }

    window.fetch = trackedFetch
    document.addEventListener('click', onClick, true)
    document.addEventListener('submit', onSubmit, true)
    document.addEventListener('change', onChange, true)

    return () => {
      mounted.current = false
      if (window.fetch === trackedFetch) window.fetch = originalFetch
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('submit', onSubmit, true)
      document.removeEventListener('change', onChange, true)
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
      showTimers.current.forEach((timer) => window.clearTimeout(timer))
      showTimers.current.clear()
      activeTokens.current.clear()
    }
  }, [begin, end])

  return <CapyLoadingWindow visible={visible} />
}

interface CapyLoadingWindowProps {
  label?: string
  visible?: boolean
  forced?: boolean
}

export function CapyLoadingWindow({ label = 'Capy đang xử lý…', visible = true, forced = false }: CapyLoadingWindowProps) {
  const shown = forced || visible
  const [mascotIndex, setMascotIndex] = useState(() => Math.floor(Math.random() * LOADING_MASCOTS.length))
  const wasShown = useRef(shown)

  useLayoutEffect(() => {
    if (shown && !wasShown.current) {
      setMascotIndex(Math.floor(Math.random() * LOADING_MASCOTS.length))
    }
    wasShown.current = shown
  }, [shown])

  return (
    <div
      className={`global-capy-loader${shown ? ' is-visible' : ''}${forced ? ' is-forced' : ''}`}
      aria-hidden={!shown}
    >
      <section className="global-capy-loader-window" role="status" aria-live="polite" aria-label={label}>
        <div className="global-capy-loader-stage" aria-hidden="true">
          <img
            key={mascotIndex}
            src={LOADING_MASCOTS[mascotIndex]}
            alt=""
            width="256"
            height="256"
            loading="eager"
            decoding="sync"
            fetchPriority="high"
          />
        </div>
        <strong>{label}</strong>
        <span>Chờ Capy một chút nhé</span>
        <i className="global-capy-loader-progress" aria-hidden="true" />
      </section>
    </div>
  )
}
