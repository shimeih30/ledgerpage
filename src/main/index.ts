import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { app, BrowserWindow, session } from 'electron'
import { createMainWindowOptions } from './window/mainWindowOptions'
import { attachWindowSecurity } from './security/attachWindowSecurity'
import { configureContentSecurityPolicy } from './security/configureContentSecurityPolicy'
import { validateDevServerUrl } from './security/devServerUrl'
import type { NavigationPolicyContext } from './security/navigationPolicy'
import { registerAppInfoHandler } from './ipc/registerAppInfoHandler'
import { registerSetupHandlers } from './ipc/registerSetupHandlers'
import { registerLoginHandlers } from './ipc/registerLoginHandlers'
import { registerUserManagementHandlers } from './ipc/registerUserManagementHandlers'
import { registerAuditHandlers } from './ipc/registerAuditHandlers'
import { registerProductHandlers } from './ipc/registerProductHandlers'
import { registerInventoryItemHandlers } from './ipc/registerInventoryItemHandlers'
import { registerSupplierHandlers } from './ipc/registerSupplierHandlers'
import { registerCustomerHandlers } from './ipc/registerCustomerHandlers'
import { registerInventoryLotHandlers } from './ipc/registerInventoryLotHandlers'
import { initializeDatabase } from './db/initializeDatabase'
import { resolveMigrationsFolder } from './db/resolveMigrationsFolder'
import { showStartupErrorAndQuit } from './startup/showStartupError'
import { initializeSingleInstanceLifecycle } from './lifecycle/singleInstance'
import { createFirstRunSetupService } from './setup/firstRunSetupService'
import { createSessionManager } from './auth/sessionManager'
import { createLoginService, type LoginService } from './users/loginService'
import { createUserManagementService } from './users/userManagementService'

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

// Set once created below, so before-quit can dispose its idle-lock timer
// cleanly. Never accessed before app.whenReady() resolves, same as db.
let loginService: LoginService | undefined

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

    // Drizzle-wrapped once here — every main-process service from
    // Slice 5 onward is written against AppDb/AppTransaction, never the
    // raw better-sqlite3 handle directly. The setup service owns its
    // own RecoveryCeremonyService instance and the one bounded piece of
    // pending-owner-id state described in firstRunSetupService.ts; both
    // live only in memory, for this process's lifetime, exactly like
    // every other in-memory Slice 7 service.
    const drizzleDb = drizzle<Record<string, never>>(db)
    const setupService = createFirstRunSetupService()
    registerSetupHandlers({ context: navigationContext, db: drizzleDb, setupService })

    // A single sessionManager instance, shared between loginService and
    // userManagementService — sessionManager is the actual holder of
    // session data (an in-memory Map, discarded on every restart, by
    // design); loginService additionally tracks *which* one session is
    // "the current one" (see loginService.ts's own doc comment), and
    // userManagementService needs the same instance so a successful
    // deactivation can invalidate every session belonging to that user,
    // not just whichever session loginService currently considers
    // active.
    const sessionManager = createSessionManager()
    loginService = createLoginService({ sessionManager })
    const userManagementService = createUserManagementService({ loginService, sessionManager })

    registerLoginHandlers({ context: navigationContext, db: drizzleDb, loginService })
    registerUserManagementHandlers({
      context: navigationContext,
      db: drizzleDb,
      userManagementService
    })
    // Reuses the exact loginService instance above — no second session
    // manager, no separate authorization path. audit:list's own
    // authorization (via requireAuthorizedCaller, inside
    // registerAuditHandlers.ts) is entirely independent of anything the
    // renderer supplies, including session.canViewAuditLog.
    registerAuditHandlers({ context: navigationContext, db: drizzleDb, loginService })
    // Same reuse posture as registerAuditHandlers above: products:*'s
    // own authorization (via requireAuthorizedCaller inside
    // registerProductHandlers.ts) never trusts anything the renderer
    // supplies, including session.canViewProducts/canManageProducts.
    registerProductHandlers({ context: navigationContext, db: drizzleDb, loginService })
    // Same reuse posture as the two handlers above: inventory-items:*'s
    // own authorization (via requireAuthorizedCaller inside
    // registerInventoryItemHandlers.ts) never trusts anything the
    // renderer supplies, including
    // session.canViewInventoryItems/canManageInventoryItems.
    registerInventoryItemHandlers({ context: navigationContext, db: drizzleDb, loginService })
    // Same reuse posture as the handlers above: suppliers:*'s own
    // authorization (via requireAuthorizedCaller inside
    // registerSupplierHandlers.ts) never trusts anything the renderer
    // supplies, including session.canViewSuppliers/canManageSuppliers.
    registerSupplierHandlers({ context: navigationContext, db: drizzleDb, loginService })
    // Same reuse posture as the handlers above: customers:*'s own
    // authorization (via requireAuthorizedCaller inside
    // registerCustomerHandlers.ts) never trusts anything the renderer
    // supplies, including session.canViewCustomers/canManageCustomers.
    registerCustomerHandlers({ context: navigationContext, db: drizzleDb, loginService })
    // Slice 15's own IPC surface is entirely read-only -- no mutation
    // channel exists here or anywhere else in this codebase for
    // createOpeningLot/recordAdjustment/reserveStock/
    // releaseReservation/reverseMovement/consumeStock/
    // setLotQuarantined/setLotActive.
    registerInventoryLotHandlers({ context: navigationContext, db: drizzleDb, loginService })

    // Idle-lock timer: started once here, for the app's lifetime, disposed
    // in before-quit below. Locks (never destroys) the current session
    // once idle past the threshold; sessionManager's own idleTimeoutMs
    // remains a separate, longer, untouched hard-expiry safety net.
    loginService.startIdleLockTimer(drizzleDb)

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
    loginService?.dispose()
    loginService = undefined
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
