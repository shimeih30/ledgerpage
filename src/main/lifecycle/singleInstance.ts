/**
 * The minimal slice of Electron.App this module needs for single-instance
 * handling. A real Electron App satisfies this structurally, so no cast is
 * needed at the call site, and tests can pass a plain fake instead of
 * launching Electron.
 */
export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean
  on(event: 'second-instance', listener: () => void): void
  quit(): void
}

/**
 * The minimal slice of Electron.BrowserWindow this module needs to bring
 * an existing window to the foreground.
 */
export interface FocusableWindow {
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

/**
 * Acquires Electron's single-instance lock so only one LedgerPage process
 * may own and open the database at a time.
 *
 * Returns true if this process is the primary instance and should proceed
 * with normal startup. Returns false if another instance already holds
 * the lock — in that case app.quit() is called before returning, and the
 * caller must stop immediately: no database initialization, no window.
 */
export function acquireSingleInstanceLock(app: SingleInstanceApp): boolean {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return false
  }
  return true
}

/**
 * Registers the handler invoked when a second launch attempt occurs while
 * this instance already holds the lock. Brings the existing main window
 * to the foreground — restoring it first if minimized — and never
 * creates a new window or a new database connection. `getMainWindow` is
 * a function rather than a captured value so it always reflects the
 * current window reference, including the case where no window exists
 * yet (e.g. a second launch arriving before startup finished), in which
 * case this is a no-op.
 */
export function registerSecondInstanceHandler(
  app: SingleInstanceApp,
  getMainWindow: () => FocusableWindow | undefined
): void {
  app.on('second-instance', () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) {
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    mainWindow.show()
    mainWindow.focus()
  })
}

/**
 * Ties lock acquisition and second-instance handling together. Call this
 * once, as early as possible in startup, before database initialization.
 *
 * Returns true if the caller should proceed with normal startup (database
 * init, window creation). Returns false if this process already quit as
 * a secondary instance — the caller must not initialize the database or
 * open a window.
 */
export function initializeSingleInstanceLifecycle(
  app: SingleInstanceApp,
  getMainWindow: () => FocusableWindow | undefined
): boolean {
  const isPrimaryInstance = acquireSingleInstanceLock(app)
  if (isPrimaryInstance) {
    registerSecondInstanceHandler(app, getMainWindow)
  }
  return isPrimaryInstance
}
