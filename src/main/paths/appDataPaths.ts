import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The managed subdirectories under LedgerPage's application-data root.
 * Only `database` is used functionally in this slice — `backups`,
 * `assets`, and `logs` are created now so later milestones (backup
 * service, logo assets, log files) don't need to invent directory
 * bootstrapping again, but nothing writes into them yet.
 */
export interface AppDataPaths {
  root: string
  database: string
  databaseFile: string
  backups: string
  assets: string
  logs: string
}

const DATABASE_FILE_NAME = 'ledgerpage.db'

/**
 * Computes the managed directory layout under a given base directory.
 *
 * Pure — does not touch the filesystem and does not know about Electron.
 * In production, `baseDir` is `app.getPath('userData')`; in tests, it is
 * an isolated temporary directory. Never resolves anywhere inside the
 * source tree or application installation directory.
 */
export function resolveAppDataPaths(baseDir: string): AppDataPaths {
  const database = join(baseDir, 'database')

  return {
    root: baseDir,
    database,
    databaseFile: join(database, DATABASE_FILE_NAME),
    backups: join(baseDir, 'backups'),
    assets: join(baseDir, 'assets'),
    logs: join(baseDir, 'logs')
  }
}

/**
 * Creates every managed directory (idempotently) if it does not already
 * exist. Safe to call on every startup.
 */
export function ensureAppDataDirectories(paths: AppDataPaths): void {
  mkdirSync(paths.database, { recursive: true })
  mkdirSync(paths.backups, { recursive: true })
  mkdirSync(paths.assets, { recursive: true })
  mkdirSync(paths.logs, { recursive: true })
}
