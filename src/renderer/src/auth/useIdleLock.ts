import { useEffect } from 'react'

const DEFAULT_THROTTLE_MS = 10_000

/**
 * Attaches lightweight activity listeners (mouse movement, key
 * presses, clicks) and calls touchSession() on the main process at
 * most once per `throttleMs`, regardless of how often the underlying
 * DOM events fire. This is the renderer half of "main-process idle
 * locking must become visible in the renderer" — the main process
 * only ever sees activity through this throttled touch, and
 * getSessionState (the separate poll in AuthenticatedApp) never calls
 * this or anything like it, so merely checking session state can
 * never itself reset the idle clock.
 */
export function useIdleLock(enabled: boolean, throttleMs = DEFAULT_THROTTLE_MS): void {
  useEffect(() => {
    if (!enabled) {
      return
    }

    let lastTouchAt = 0

    function handleActivity(): void {
      const now = Date.now()
      if (now - lastTouchAt < throttleMs) {
        return
      }
      lastTouchAt = now
      void window.ledgerpage.touchSession()
    }

    window.addEventListener('mousemove', handleActivity)
    window.addEventListener('keydown', handleActivity)
    window.addEventListener('click', handleActivity)

    return () => {
      window.removeEventListener('mousemove', handleActivity)
      window.removeEventListener('keydown', handleActivity)
      window.removeEventListener('click', handleActivity)
    }
  }, [enabled, throttleMs])
}
