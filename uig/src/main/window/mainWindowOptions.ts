import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * Produces the BrowserWindow configuration for LedgerPage's main window.
 *
 * This is a pure function (type-only dependency on 'electron', no runtime
 * import) specifically so it can be unit tested without launching Electron.
 * Every security-relevant field here is explicit rather than left to
 * Electron's defaults, so a future accidental change is visible in a diff
 * and caught by the corresponding test.
 */
export function createMainWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1024,
    height: 768,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  }
}
