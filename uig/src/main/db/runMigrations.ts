import type Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

/**
 * The single authoritative migration-history table name, used instead of
 * Drizzle's own default tracking-table name so the schema stays aligned
 * with the approved architecture's naming (schema_migrations).
 */
export const MIGRATIONS_TABLE_NAME = 'schema_migrations'

/**
 * Applies every pending forward-only migration in `migrationsFolder`
 * against `db`, recording progress in the `schema_migrations` table.
 * Migrations already recorded there are not reapplied — safe to call on
 * every startup.
 *
 * There is deliberately no rollback/down-migration mechanism: correction
 * of an applied migration is a new forward migration, per the approved
 * architecture (Decision: forward-only migrations, no automatic
 * production schema synchronization).
 *
 * Throws if a migration fails to apply (e.g. invalid SQL, a broken
 * migrations folder) — the caller (initializeDatabase) is responsible for
 * treating that as a startup failure rather than continuing silently.
 */
export function runMigrations(db: Database.Database, migrationsFolder: string): void {
  const orm = drizzle(db)
  migrate(orm, { migrationsFolder, migrationsTable: MIGRATIONS_TABLE_NAME })
}
