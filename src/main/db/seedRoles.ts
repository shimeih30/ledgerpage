import type Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { roles } from './schema'
import { roleSeedRows } from './seedData/roles'

/**
 * Seeds the four fixed roles. Called after migrations and reference-data
 * seeding, before the app is considered ready to open its window.
 *
 * Idempotent: every insert targets the stable row `id` with
 * onConflictDoNothing, so an existing row (including one a future admin
 * screen has since edited) is left completely untouched — the same
 * pattern seedReferenceData.ts already established for Slice 4's
 * reference-data tables. There is no upsert/update path here by design.
 *
 * Runs inside a single transaction: a validation or insert failure
 * partway through leaves no partial seed data behind, and propagates to
 * the caller (initializeDatabase), which is expected to close the
 * connection and treat this as a startup failure.
 *
 * No user rows, user_role assignments, recovery credentials, or login
 * events are seeded here or anywhere else in this slice.
 */
export function seedRoles(db: Database.Database): void {
  const orm = drizzle(db)

  orm.transaction((tx) => {
    const now = new Date()

    for (const row of roleSeedRows) {
      tx.insert(roles)
        .values({
          id: row.id,
          code: row.code,
          name: row.name,
          description: row.description,
          isSystem: true,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoNothing({ target: roles.id })
        .run()
    }
  })
}
