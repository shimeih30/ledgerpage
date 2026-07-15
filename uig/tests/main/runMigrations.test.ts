import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../src/main/db/connection'
import { MIGRATIONS_TABLE_NAME, runMigrations } from '../../src/main/db/runMigrations'
import { createTempDir, isOutsideSourceTree, removeTempDir } from '../helpers/tempDir'

/**
 * Writes a minimal, disposable, test-only migration set (one migration
 * creating a table that exists nowhere in the real application schema).
 * This is intentionally separate from the project's real migrations/
 * folder — Slice 3 defines no business tables, so real migration content
 * is not exercised here; this fixture proves the mechanism itself works.
 */
function writeTestOnlyMigration(migrationsDir: string): void {
  const metaDir = join(migrationsDir, 'meta')
  mkdirSync(metaDir, { recursive: true })

  writeFileSync(
    join(migrationsDir, '0000_test_only_marker.sql'),
    'CREATE TABLE test_only_marker (id INTEGER PRIMARY KEY);'
  )
  writeFileSync(
    join(metaDir, '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: [
        { idx: 0, version: '6', when: Date.now(), tag: '0000_test_only_marker', breakpoints: true }
      ]
    })
  )
  writeFileSync(join(metaDir, '0000_snapshot.json'), JSON.stringify({}))
}

describe('runMigrations', () => {
  let dir: string
  let dbPath: string
  let migrationsDir: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-migrations')
    dbPath = join(dir, 'ledgerpage.db')
    migrationsDir = join(dir, 'migrations')
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  it('uses schema_migrations as the authoritative tracking table name', () => {
    expect(MIGRATIONS_TABLE_NAME).toBe('schema_migrations')
  })

  it('runs in an isolated temp location, outside the source tree', () => {
    expect(isOutsideSourceTree(migrationsDir)).toBe(true)
  })

  it('creates the schema_migrations tracking table even with zero pending migrations', () => {
    mkdirSync(join(migrationsDir, 'meta'), { recursive: true })
    writeFileSync(
      join(migrationsDir, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', dialect: 'sqlite', entries: [] })
    )

    const db = createDatabaseConnection(dbPath)
    runMigrations(db, migrationsDir)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    expect(tables.map((t) => t.name)).toContain('schema_migrations')
    db.close()
  })

  it('applies a pending migration exactly once', () => {
    writeTestOnlyMigration(migrationsDir)

    const db = createDatabaseConnection(dbPath)
    runMigrations(db, migrationsDir)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    expect(tables.map((t) => t.name)).toContain('test_only_marker')

    const rows = db.prepare(`SELECT * FROM ${MIGRATIONS_TABLE_NAME}`).all()
    expect(rows).toHaveLength(1)

    db.close()
  })

  it('does not reapply an already-applied migration on a second run', () => {
    writeTestOnlyMigration(migrationsDir)

    const db = createDatabaseConnection(dbPath)
    runMigrations(db, migrationsDir)
    const rowsAfterFirst = db.prepare(`SELECT * FROM ${MIGRATIONS_TABLE_NAME}`).all()

    expect(() => runMigrations(db, migrationsDir)).not.toThrow()
    const rowsAfterSecond = db.prepare(`SELECT * FROM ${MIGRATIONS_TABLE_NAME}`).all()

    expect(rowsAfterSecond).toHaveLength(rowsAfterFirst.length)
    expect(rowsAfterSecond).toEqual(rowsAfterFirst)

    db.close()
  })

  it('throws when a migration contains invalid SQL, rather than silently continuing', () => {
    const metaDir = join(migrationsDir, 'meta')
    mkdirSync(metaDir, { recursive: true })
    writeFileSync(join(migrationsDir, '0000_broken.sql'), 'THIS IS NOT VALID SQL;')
    writeFileSync(
      join(metaDir, '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [{ idx: 0, version: '6', when: Date.now(), tag: '0000_broken', breakpoints: true }]
      })
    )
    writeFileSync(join(metaDir, '0000_snapshot.json'), JSON.stringify({}))

    const db = createDatabaseConnection(dbPath)
    expect(() => runMigrations(db, migrationsDir)).toThrow()
    db.close()
  })
})
