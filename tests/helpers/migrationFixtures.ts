import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface JournalEntry {
  idx: number
  version: string
  when: number
  tag: string
  breakpoints: boolean
}

interface Journal {
  version: string
  dialect: string
  entries: JournalEntry[]
}

/**
 * Builds a truncated copy of the real migrations/ folder containing
 * only the first `migrationCount` migrations (by journal idx) — used to
 * simulate "an existing database created before a later slice's
 * migration existed," for upgrade-path tests.
 *
 * Copies only what runMigrations (via Drizzle's own migrate()) actually
 * reads at runtime: the journal and the .sql files. meta/*_snapshot.json
 * is drizzle-kit's own generation-time artifact — never read by
 * migrate() itself (verified directly against runMigrations.ts's own
 * implementation before relying on this) — so it's deliberately not
 * copied here.
 */
export function buildTruncatedMigrationsFolder(
  realMigrationsFolder: string,
  destDir: string,
  migrationCount: number
): void {
  const journalPath = join(realMigrationsFolder, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as Journal

  const truncatedEntries = journal.entries.filter((entry) => entry.idx < migrationCount)

  const destMetaDir = join(destDir, 'meta')
  mkdirSync(destMetaDir, { recursive: true })
  writeFileSync(
    join(destMetaDir, '_journal.json'),
    JSON.stringify({ ...journal, entries: truncatedEntries }, null, 2)
  )

  for (const entry of truncatedEntries) {
    const sqlFileName = `${entry.tag}.sql`
    copyFileSync(join(realMigrationsFolder, sqlFileName), join(destDir, sqlFileName))
  }
}
