import type Database from 'better-sqlite3'
import {
  ensureAppDataDirectories,
  resolveAppDataPaths,
  type AppDataPaths
} from '../paths/appDataPaths'
import { createDatabaseConnection } from './connection'
import { runMigrations } from './runMigrations'

export interface InitializeDatabaseResult {
  db: Database.Database
  paths: AppDataPaths
}

/**
 * Runs the full startup database bootstrap:
 *
 * 1. Compute the managed application-data directory layout.
 * 2. Create those directories if missing.
 * 3. Open (or create) the SQLite database with the required pragmas.
 * 4. Apply any pending forward-only migrations.
 *
 * Throws on any failure — directory creation, connection, or migration —
 * rather than returning a partial or unusable result. The caller
 * (main/index.ts) is expected to treat a thrown error here as a startup
 * failure: log it, show a minimal safe error state, and never open the
 * normal application window.
 */
export function initializeDatabase(
  baseDir: string,
  migrationsFolder: string
): InitializeDatabaseResult {
  const paths = resolveAppDataPaths(baseDir)
  ensureAppDataDirectories(paths)

  const db = createDatabaseConnection(paths.databaseFile)

  try {
    runMigrations(db, migrationsFolder)
  } catch (error) {
    // A partially-migrated connection must not be handed back as if
    // startup succeeded.
    db.close()
    throw error
  }

  return { db, paths }
}
