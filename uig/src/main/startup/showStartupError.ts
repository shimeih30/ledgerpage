import { dialog } from 'electron'

/**
 * Shows a minimal, safe failure state when the app cannot start (e.g. the
 * database failed to initialize or migrate) and then quits.
 *
 * Deliberately uses a native OS dialog rather than a rendered HTML window:
 * it needs no renderer bundle, no preload, no CSP considerations, and no
 * web content at all — the smallest possible surface for a state the app
 * must be able to reach even when its own infrastructure is broken. This
 * is not a recovery interface; there is nothing to retry or configure
 * here, only a clear signal that startup failed.
 *
 * The real error is logged to the main-process console for diagnosis
 * (visible in a terminal or dev tooling), but never shown to the person
 * using the app — no raw SQL, file paths, or stack traces in the dialog.
 */
export function showStartupErrorAndQuit(app: Electron.App, error: unknown): void {
  console.error('LedgerPage failed to start:', error)

  dialog.showErrorBox(
    'LedgerPage failed to start',
    'LedgerPage could not initialize its local database and cannot continue. ' +
      'Please restart the application. If this keeps happening, check that ' +
      'LedgerPage has permission to read and write its application data folder.'
  )

  app.quit()
}
