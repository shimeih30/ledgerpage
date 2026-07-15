import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../../src/main/db/initializeDatabase'
import { MIGRATIONS_TABLE_NAME } from '../../src/main/db/runMigrations'
import { createTempDir, isOutsideSourceTree, removeTempDir } from '../helpers/tempDir'

function writeEmptyMigrationsFolder(migrationsDir: string): void {
  mkdirSync(join(migrationsDir, 'meta'), { recursive: true })
  writeFileSync(
    join(migrationsDir, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'sqlite', entries: [] })
  )
}

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
    writeEmptyMigrationsFolder(migrationsDir)

    const result = initializeDatabase(baseDir, migrationsDir)

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
    writeEmptyMigrationsFolder(migrationsDir)

    const result = initializeDatabase(baseDir, migrationsDir)

    expect(result.db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(result.db.pragma('foreign_keys', { simple: true })).toBe(1)

    result.db.close()
  })

  it('does not reapply migrations on a second startup against the same directories', () => {
    writeEmptyMigrationsFolder(migrationsDir)

    const first = initializeDatabase(baseDir, migrationsDir)
    const firstRows = first.db.prepare(`SELECT * FROM ${MIGRATIONS_TABLE_NAME}`).all()
    first.db.close()

    const second = initializeDatabase(baseDir, migrationsDir)
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
})
