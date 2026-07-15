import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, session } from 'electron'
import { createMainWindowOptions } from './window/mainWindowOptions'
import { attachWindowSecurity } from './security/attachWindowSecurity'
import { configureContentSecurityPolicy } from './security/configureContentSecurityPolicy'
import { validateDevServerUrl } from './security/devServerUrl'
import type { NavigationPolicyContext } from './security/navigationPolicy'
import { registerAppInfoHandler } from './ipc/registerAppInfoHandler'

const rendererEntryPath = join(__dirname, '../renderer/index.html')
const rendererEntryFileUrl = pathToFileURL(rendererEntryPath).href

// The dev server URL is never trusted directly: validateDevServerUrl fails
// closed on packaged builds, remote hosts, non-http protocols, embedded
// credentials, and malformed values. Everything below uses only this
// validated result — never process.env.ELECTRON_RENDERER_URL directly.
const devServerUrl = validateDevServerUrl(process.env.ELECTRON_RENDERER_URL, app.isPackaged)

// The single approved navigation/IPC-sender target: the dev server origin
// in development, or the exact renderer entry file in production. Shared
// by CSP construction, navigation allow-listing, and IPC sender checks so
// they can never independently drift apart.
const navigationContext: NavigationPolicyContext = devServerUrl
  ? { devServerOrigin: devServerUrl.origin }
  : { productionEntryFileUrl: rendererEntryFileUrl }

function createMainWindow(): void {
  const preloadPath = join(__dirname, '../preload/index.js')
  const mainWindow = new BrowserWindow(createMainWindowOptions(preloadPath))

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl.url.href)
  } else {
    void mainWindow.loadFile(rendererEntryPath)
  }
}

void app.whenReady().then(() => {
  configureContentSecurityPolicy(session.defaultSession, devServerUrl?.origin)
  registerAppInfoHandler(navigationContext)

  // Applied globally (not just to the main window) so any future webContents
  // — including ones this slice doesn't yet know about — inherits the same
  // navigation and new-window restrictions by default.
  app.on('web-contents-created', (_event, contents) => {
    attachWindowSecurity(contents, navigationContext)
  })

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
