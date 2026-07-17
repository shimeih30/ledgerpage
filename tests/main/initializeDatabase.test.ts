import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../../src/main/db/initializeDatabase'
import { MIGRATIONS_TABLE_NAME } from '../../src/main/db/runMigrations'
import { createTempDir, isOutsideSourceTree, removeTempDir } from '../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')

describe('initializeDatabase', () => {
  let baseDir: string
  let migrationsDir: string

  beforeEach(() => {
    baseDir = createTempDir('ledgerpage-init-base')
    migrationsDir = createTempDir('ledgerpage-init-migrations')
  })

  afterEach(() => {
    removeTempDir(baseDir)
    removeTempDir(migrationsDir)
  })

  it('runs entirely in isolated temp locations, outside the source tree', () => {
    expect(isOutsideSourceTree(baseDir)).toBe(true)
    expect(isOutsideSourceTree(migrationsDir)).toBe(true)
  })

  it('creates the managed directories, the database file, and applies migrations on first launch', () => {
    const result = initializeDatabase(baseDir, REAL_MIGRATIONS_FOLDER)

    expect(existsSync(result.paths.database)).toBe(true)
    expect(existsSync(result.paths.backups)).toBe(true)
    expect(existsSync(result.paths.assets)).toBe(true)
    expect(existsSync(result.paths.logs)).toBe(true)
    expect(existsSync(result.paths.databaseFile)).toBe(true)

    const tables = result.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).toContain(MIGRATIONS_TABLE_NAME)

    result.db.close()
  })

  it('applies the required pragmas as part of initialization', () => {
    const result = initializeDatabase(baseDir, REAL_MIGRATIONS_FOLDER)

    expect(result.db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(result.db.pragma('foreign_keys', { simple: true })).toBe(1)

    result.db.close()
  })

  it('does not reapply migrations on a second startup against the same directories', () => {
    const first = initializeDatabase(baseDir, REAL_MIGRATIONS_FOLDER)
    const firstRows = first.db.prepare(`SELECT * FROM ${MIGRATIONS_TABLE_NAME}`).all()
    first.db.close()

    const second = initializeDatabase(baseDir, REAL_MIGRATIONS_FOLDER)
    const secondRows = second.db.prepare(`SELECT * FROM ${MIGRATIONS_TABLE_NAME}`).all()
    second.db.close()

    expect(secondRows).toEqual(firstRows)
  })

  it('throws and does not return a usable connection when migrations fail', () => {
    const brokenMigrationsDir = join(migrationsDir, 'broken')
    mkdirSync(join(brokenMigrationsDir, 'meta'), { recursive: true })
    writeFileSync(join(brokenMigrationsDir, '0000_broken.sql'), 'NOT VALID SQL AT ALL;')
    writeFileSync(
      join(brokenMigrationsDir, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [{ idx: 0, version: '6', when: Date.now(), tag: '0000_broken', breakpoints: true }]
      })
    )
    writeFileSync(join(brokenMigrationsDir, 'meta', '0000_snapshot.json'), JSON.stringify({}))

    expect(() => initializeDatabase(baseDir, brokenMigrationsDir)).toThrow()
  })

  it('still creates the managed directories even when migrations subsequently fail', () => {
    const brokenMigrationsDir = join(migrationsDir, 'broken-but-dirs-created')
    mkdirSync(join(brokenMigrationsDir, 'meta'), { recursive: true })
    writeFileSync(join(brokenMigrationsDir, '0000_broken.sql'), 'NOT VALID SQL AT ALL;')
    writeFileSync(
      join(brokenMigrationsDir, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [{ idx: 0, version: '6', when: Date.now(), tag: '0000_broken', breakpoints: true }]
      })
    )
    writeFileSync(join(brokenMigrationsDir, 'meta', '0000_snapshot.json'), JSON.stringify({}))

    expect(() => initializeDatabase(baseDir, brokenMigrationsDir)).toThrow()

    // Directory bootstrap happens before migrations run, and a failure
    // downstream should not silently undo directories that were already
    // correctly created.
    expect(existsSync(join(baseDir, 'database'))).toBe(true)
    expect(existsSync(join(baseDir, 'backups'))).toBe(true)
  })

  it('seeds reference data using the real project migrations folder', () => {
    const result = initializeDatabase(baseDir, REAL_MIGRATIONS_FOLDER)

    const currencyCount = (
      result.db.prepare('SELECT COUNT(*) as c FROM currencies').get() as { c: number }
    ).c
    expect(currencyCount).toBeGreaterThan(0)

    result.db.close()
  })

  it('does not reseed (duplicate) reference data on a second startup', () => {
    const first = initializeDatabase(baseDir, REAL_MIGRATIONS_FOLDER)
    const firstCount = (
      first.db.prepare('SELECT COUNT(*) as c FROM currencies').get() as { c: number }
    ).c
    first.db.close()

    const second = initializeDatabase(baseDir, REAL_MIGRATIONS_FOLDER)
    const secondCount = (
      second.db.prepare('SELECT COUNT(*) as c FROM currencies').get() as { c: number }
    ).c
    second.db.close()

    expect(secondCount).toBe(firstCount)
  })

  it('throws and does not return a usable connection when seeding fails', () => {
    // Migrations succeed (valid SQL), but the resulting currencies table
    // is missing columns seedReferenceData requires — isolating a
    // seed-stage failure from a migration-stage failure.
    const brokenSeedMigrationsDir = join(migrationsDir, 'broken-seed-schema')
    mkdirSync(join(brokenSeedMigrationsDir, 'meta'), { recursive: true })
    writeFileSync(
      join(brokenSeedMigrationsDir, '0000_incompatible.sql'),
      'CREATE TABLE currencies (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT, is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);'
    )
    writeFileSync(
      join(brokenSeedMigrationsDir, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [
          { idx: 0, version: '6', when: Date.now(), tag: '0000_incompatible', breakpoints: true }
        ]
      })
    )
    writeFileSync(join(brokenSeedMigrationsDir, 'meta', '0000_snapshot.json'), JSON.stringify({}))

    expect(() => initializeDatabase(baseDir, brokenSeedMigrationsDir)).toThrow()
  })

  it('leaves company and numbering_rules empty after a normal startup (Slice 5 adds no seeding)', () => {
    const result = initializeDatabase(baseDir, REAL_MIGRATIONS_FOLDER)

    const companyCount = (
      result.db.prepare('SELECT COUNT(*) as c FROM company').get() as { c: number }
    ).c
    const numberingCount = (
      result.db.prepare('SELECT COUNT(*) as c FROM numbering_rules').get() as { c: number }
    ).c

    expect(companyCount).toBe(0)
    expect(numberingCount).toBe(0)

    result.db.close()
  })

  it('leaves tax_codes and tax_rate_versions empty after a normal startup (Slice 6 adds no seeding)', () => {
    const result = initializeDatabase(baseDir, REAL_MIGRATIONS_FOLDER)

    const taxCodeCount = (
      result.db.prepare('SELECT COUNT(*) as c FROM tax_codes').get() as { c: number }
    ).c
    const rateVersionCount = (
      result.db.prepare('SELECT COUNT(*) as c FROM tax_rate_versions').get() as { c: number }
    ).c

    expect(taxCodeCount).toBe(0)
    expect(rateVersionCount).toBe(0)

    result.db.close()
  })
})
