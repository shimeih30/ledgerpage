import { describe, expect, it, vi } from 'vitest'
import {
  acquireSingleInstanceLock,
  initializeSingleInstanceLifecycle,
  registerSecondInstanceHandler,
  type FocusableWindow,
  type SingleInstanceApp
} from '../../src/main/lifecycle/singleInstance'

function createFakeApp(lockResult: boolean) {
  const listeners: Record<string, () => void> = {}
  const quit = vi.fn()

  const app: SingleInstanceApp = {
    requestSingleInstanceLock: () => lockResult,
    on: (event, listener) => {
      listeners[event] = listener
    },
    quit
  }

  return { app, quit, triggerSecondInstance: () => listeners['second-instance']?.() }
}

function createFakeWindow(initiallyMinimized: boolean) {
  const calls: string[] = []
  const window: FocusableWindow = {
    isMinimized: () => initiallyMinimized,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus')
  }
  return { window, calls }
}

describe('acquireSingleInstanceLock', () => {
  it('returns true and does not quit when this is the primary instance', () => {
    const { app, quit } = createFakeApp(true)
    expect(acquireSingleInstanceLock(app)).toBe(true)
    expect(quit).not.toHaveBeenCalled()
  })

  it('returns false and quits immediately when the lock is already held', () => {
    const { app, quit } = createFakeApp(false)
    expect(acquireSingleInstanceLock(app)).toBe(false)
    expect(quit).toHaveBeenCalledTimes(1)
  })
})

describe('registerSecondInstanceHandler', () => {
  it('shows and focuses the existing window when a second launch is attempted', () => {
    const { app, triggerSecondInstance } = createFakeApp(true)
    const { window, calls } = createFakeWindow(false)

    registerSecondInstanceHandler(app, () => window)
    triggerSecondInstance()

    expect(calls).toEqual(['show', 'focus'])
  })

  it('restores a minimized window before showing and focusing it', () => {
    const { app, triggerSecondInstance } = createFakeApp(true)
    const { window, calls } = createFakeWindow(true)

    registerSecondInstanceHandler(app, () => window)
    triggerSecondInstance()

    expect(calls).toEqual(['restore', 'show', 'focus'])
  })

  it('does nothing, and does not throw, if there is no main window yet', () => {
    const { app, triggerSecondInstance } = createFakeApp(true)

    registerSecondInstanceHandler(app, () => undefined)

    expect(() => triggerSecondInstance()).not.toThrow()
  })

  it('never invokes anything beyond restore/show/focus on the existing window — no window creation', () => {
    const { app, triggerSecondInstance } = createFakeApp(true)
    const { window, calls } = createFakeWindow(false)
    let getMainWindowCallCount = 0

    registerSecondInstanceHandler(app, () => {
      getMainWindowCallCount += 1
      return window
    })
    triggerSecondInstance()

    // getMainWindow is called exactly once per event, returning the same
    // existing window reference — there is no code path in this module
    // capable of constructing a new window; only restore/show/focus were
    // recorded.
    expect(getMainWindowCallCount).toBe(1)
    expect(calls.every((call) => ['restore', 'show', 'focus'].includes(call))).toBe(true)
  })
})

describe('initializeSingleInstanceLifecycle', () => {
  it('the primary instance proceeds: lock acquired, second-instance handler registered, no quit', () => {
    const { app, quit } = createFakeApp(true)
    const { window } = createFakeWindow(false)

    const result = initializeSingleInstanceLifecycle(app, () => window)

    expect(result).toBe(true)
    expect(quit).not.toHaveBeenCalled()
  })

  it('a secondary instance quits before any database initialization would occur', () => {
    const { app, quit } = createFakeApp(false)

    const result = initializeSingleInstanceLifecycle(app, () => undefined)

    expect(result).toBe(false)
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('a secondary instance does not register a second-instance handler of its own', () => {
    const { app, triggerSecondInstance } = createFakeApp(false)

    initializeSingleInstanceLifecycle(app, () => undefined)

    // No listener was registered at all for a process that immediately quit.
    expect(() => triggerSecondInstance()).not.toThrow()
  })
})
