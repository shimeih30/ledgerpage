import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const REFERENCE_TABLES = ['currencies', 'units_of_measure', 'payment_methods', 'expense_categories']
const SHARED_COLUMNS = [
  'id',
  'code',
  'name',
  'description',
  'is_active',
  'sort_order',
  'created_at',
  'updated_at'
]

describe('reference-data schema (real migrations folder)', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-schema')
    dbPath = join(dir, 'ledgerpage.db')
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  function migratedDb() {
    const db = createDatabaseConnection(dbPath)
    runMigrations(db, REAL_MIGRATIONS_FOLDER)
    return db
  }

  it('creates all four reference-data tables', () => {
    const db = migratedDb()
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(REFERENCE_TABLES))
    db.close()
  })

  it('currencies has the shared columns plus symbol and decimal_places', () => {
    const db = migratedDb()
    const columns = db.prepare('PRAGMA table_info(currencies)').all() as { name: string }[]
    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining([...SHARED_COLUMNS, 'symbol', 'decimal_places'])
    )
    db.close()
  })

  it('units_of_measure has the shared columns plus category and decimal_places', () => {
    const db = migratedDb()
    const columns = db.prepare('PRAGMA table_info(units_of_measure)').all() as { name: string }[]
    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining([...SHARED_COLUMNS, 'category', 'decimal_places'])
    )
    db.close()
  })

  it.each(['payment_methods', 'expense_categories'])(
    '%s has exactly the shared columns',
    (table) => {
      const db = migratedDb()
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      expect(columns.map((c) => c.name).sort()).toEqual([...SHARED_COLUMNS].sort())
      db.close()
    }
  )

  it.each(REFERENCE_TABLES)('id is the primary key on %s', (table) => {
    const db = migratedDb()
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string
      pk: number
    }[]
    const idColumn = columns.find((c) => c.name === 'id')
    expect(idColumn?.pk).toBe(1)
    db.close()
  })

  it.each(REFERENCE_TABLES)('code has a unique index on %s', (table) => {
    const db = migratedDb()
    const indexes = db.prepare(`PRAGMA index_list(${table})`).all() as {
      name: string
      unique: number
    }[]
    expect(indexes.some((i) => i.unique === 1)).toBe(true)
    db.close()
  })

  it.each(REFERENCE_TABLES)('rejects a duplicate code on %s', (table) => {
    const db = migratedDb()
    const now = Date.now()
    const insert =
      table === 'units_of_measure'
        ? db.prepare(
            `INSERT INTO ${table} (id, code, name, created_at, updated_at, category) VALUES (?, ?, ?, ?, ?, ?)`
          )
        : db.prepare(
            `INSERT INTO ${table} (id, code, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
          )
    const params = (id: string, code: string, name: string): unknown[] =>
      table === 'units_of_measure'
        ? [id, code, name, now, now, 'count']
        : [id, code, name, now, now]

    insert.run(...params('row_a', 'DUPLICATE_CODE', 'Row A'))
    expect(() => insert.run(...params('row_b', 'DUPLICATE_CODE', 'Row B'))).toThrow()
    db.close()
  })

  it.each(REFERENCE_TABLES)('rejects a missing required code on %s', (table) => {
    const db = migratedDb()
    const now = Date.now()
    expect(() =>
      db
        .prepare(`INSERT INTO ${table} (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .run('row_a', 'Row A', now, now)
    ).toThrow()
    db.close()
  })

  it.each(REFERENCE_TABLES)('rejects a missing required name on %s', (table) => {
    const db = migratedDb()
    const now = Date.now()
    expect(() =>
      db
        .prepare(`INSERT INTO ${table} (id, code, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .run('row_a', 'CODE_A', now, now)
    ).toThrow()
    db.close()
  })

  it('migrates successfully starting from an empty (Slice 3 style) migration set', () => {
    // Simulate a database that had already gone through Slice 3's
    // migrations (an empty migrations folder — schema_migrations table
    // only), then upgrade it with the real Slice 4 migrations folder.
    const emptyMigrationsDir = join(dir, 'empty-migrations')
    mkdirSync(join(emptyMigrationsDir, 'meta'), { recursive: true })
    writeFileSync(
      join(emptyMigrationsDir, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', dialect: 'sqlite', entries: [] })
    )

    const db = createDatabaseConnection(dbPath)
    runMigrations(db, emptyMigrationsDir)

    // At this point, only schema_migrations exists — matching Slice 3.
    let tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    expect(tables.map((t) => t.name)).toEqual(['schema_migrations'])

    // Now upgrade with the real Slice 4 migrations.
    runMigrations(db, REAL_MIGRATIONS_FOLDER)

    tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(REFERENCE_TABLES))

    db.close()
  })

  it('foreign_keys remains enabled after migrating in the reference-data tables', () => {
    const db = migratedDb()
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    db.close()
  })
})
