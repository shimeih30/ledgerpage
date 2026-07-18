import type Database from 'better-sqlite3'
import {
  ensureAppDataDirectories,
  resolveAppDataPaths,
  type AppDataPaths
} from '../paths/appDataPaths'
import { createDatabaseConnection } from './connection'
import { runMigrations } from './runMigrations'
import { seedReferenceData } from './seedReferenceData'
import { seedRoles } from './seedRoles'

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
 * 5. Seed reference data (idempotent — inserts only rows that don't
 *    already exist, never overwrites existing ones).
 * 6. Seed the four fixed roles (same idempotent pattern). No user,
 *    user_role, recovery-credential, or login-event rows are ever
 *    seeded — those require a real company and a real first-run flow
 *    (Slice 8).
 *
 * Throws on any failure — directory creation, connection, migration, or
 * seeding — rather than returning a partial or unusable result. The
 * caller (main/index.ts) is expected to treat a thrown error here as a
 * startup failure: log it, show a minimal safe error state, and never
 * open the normal application window.
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
    seedReferenceData(db)
    seedRoles(db)
  } catch (error) {
    // A partially-migrated or partially-seeded connection must not be
    // handed back as if startup succeeded.
    db.close()
    throw error
  }

  return { db, paths }
}
