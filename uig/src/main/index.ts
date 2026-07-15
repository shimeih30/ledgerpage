import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type Database from 'better-sqlite3'
import { app, BrowserWindow, session } from 'electron'
import { createMainWindowOptions } from './window/mainWindowOptions'
import { attachWindowSecurity } from './security/attachWindowSecurity'
import { configureContentSecurityPolicy } from './security/configureContentSecurityPolicy'
import { validateDevServerUrl } from './security/devServerUrl'
import type { NavigationPolicyContext } from './security/navigationPolicy'
import { registerAppInfoHandler } from './ipc/registerAppInfoHandler'
import { initializeDatabase } from './db/initializeDatabase'
import { resolveMigrationsFolder } from './db/resolveMigrationsFolder'
import { showStartupErrorAndQuit } from './startup/showStartupError'
import { initializeSingleInstanceLifecycle } from './lifecycle/singleInstance'

// The compiled main output is an ES module, where the CommonJS globals
// __dirname/__filename do not exist. import.meta.dirname is the stable
// ESM equivalent (Node 20.11+/22.x). Relying on a bundler to shim
// __dirname automatically proved fragile — it worked in a smaller bundle
// and silently broke once drizzle-orm's larger dependency graph changed
// how the bundler handled CommonJS interop elsewhere in the file.
const mainDirname = import.meta.dirname

const rendererEntryPath = join(mainDirname, '../renderer/index.html')
const rendererEntryFileUrl = pathToFileURL(rendererEntryPath).href
const migrationsFolder = resolveMigrationsFolder(mainDirname)

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

// Set once database initialization succeeds, so it can be closed cleanly
// on quit. Never accessed before app.whenReady() resolves.
let db: Database.Database | undefined

// Tracks the single main window, so the second-instance handler can bring
// it to the foreground without creating a new one, and so it can never
// point at a destroyed window (cleared on 'closed' below).
let mainWindow: BrowserWindow | undefined

function createMainWindow(): void {
  const preloadPath = join(mainDirname, '../preload/index.js')
  const window = new BrowserWindow(createMainWindowOptions(preloadPath))
  mainWindow = window

  window.once('ready-to-show', () => {
    window.show()
  })

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = undefined
    }
  })

  if (devServerUrl) {
    void window.loadURL(devServerUrl.url.href)
  } else {
    void window.loadFile(rendererEntryPath)
  }
}

// Enforces a single running LedgerPage process — only one process may own
// and open the MVP database at a time. Must run before database
// initialization: if this is a secondary instance, requestSingleInstanceLock
// has already called app.quit(), and startup must stop immediately without
// touching SQLite or opening a window.
const isPrimaryInstance = initializeSingleInstanceLifecycle(app, () => mainWindow)

if (isPrimaryInstance) {
  void app.whenReady().then(() => {
    // Database initialization gates everything else. If it fails, the app
    // must not silently continue as if startup succeeded, and the normal
    // window must never open.
    try {
      const result = initializeDatabase(app.getPath('userData'), migrationsFolder)
      db = result.db
      console.log('LedgerPage database ready at', result.paths.databaseFile)
    } catch (error) {
      showStartupErrorAndQuit(app, error)
      return
    }

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

  app.on('before-quit', () => {
    // Closes the managed connection cleanly on shutdown. This is not a
    // guarantee that WAL/SHM files are folded back into the main database
    // file or removed — deliberate checkpoint behavior belongs to the
    // later backup milestone.
    db?.close()
    db = undefined
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
