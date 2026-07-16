import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { currencySeedRows } from '../../../src/main/db/seedData/currencies'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')

describe('company and numbering_rules schema (real migrations folder)', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-slice5-schema')
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

  it('creates the company table', () => {
    const db = migratedDb()
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    expect(tables.map((t) => t.name)).toContain('company')
    db.close()
  })

  it('creates the numbering_rules table', () => {
    const db = migratedDb()
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    expect(tables.map((t) => t.name)).toContain('numbering_rules')
    db.close()
  })

  it('runs successfully against a fresh (empty) database', () => {
    expect(() => migratedDb()).not.toThrow()
  })

  it('upgrades an existing Slice 4 database (0000 and 0001 both applied from the real folder)', () => {
    // runMigrations is idempotent and only applies whatever hasn't been
    // recorded yet in schema_migrations — running it against the real
    // migrations folder, which contains both the Slice 4 and Slice 5
    // migrations, exercises exactly the upgrade path a real Slice 4
    // installation would go through.
    const db = createDatabaseConnection(dbPath)
    runMigrations(db, REAL_MIGRATIONS_FOLDER)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    const names = tables.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'currencies',
        'units_of_measure',
        'payment_methods',
        'expense_categories',
        'company',
        'numbering_rules'
      ])
    )
    db.close()
  })

  it('preserves existing Slice 4 reference data when the Slice 5 migration is applied', () => {
    const db = createDatabaseConnection(dbPath)
    runMigrations(db, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(db)

    const count = (db.prepare('SELECT COUNT(*) as c FROM currencies').get() as { c: number }).c
    expect(count).toBe(currencySeedRows.length)

    db.close()
  })

  it('leaves both new tables empty immediately after migrations run', () => {
    const db = migratedDb()
    const companyCount = (db.prepare('SELECT COUNT(*) as c FROM company').get() as { c: number }).c
    const numberingCount = (
      db.prepare('SELECT COUNT(*) as c FROM numbering_rules').get() as { c: number }
    ).c
    expect(companyCount).toBe(0)
    expect(numberingCount).toBe(0)
    db.close()
  })

  it('leaves both new tables empty even after Slice 4 reference-data seeding runs', () => {
    const db = migratedDb()
    seedReferenceData(db)

    const companyCount = (db.prepare('SELECT COUNT(*) as c FROM company').get() as { c: number }).c
    const numberingCount = (
      db.prepare('SELECT COUNT(*) as c FROM numbering_rules').get() as { c: number }
    ).c
    expect(companyCount).toBe(0)
    expect(numberingCount).toBe(0)

    db.close()
  })

  it('keeps foreign_keys enabled after migrating in the new tables', () => {
    const db = migratedDb()
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    db.close()
  })

  it('company has the expected columns', () => {
    const db = migratedDb()
    const columns = db.prepare('PRAGMA table_info(company)').all() as { name: string }[]
    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'trading_name',
        'address',
        'contact_details',
        'currency_id',
        'vat_registered',
        'logo_asset_path',
        'created_at',
        'updated_at'
      ])
    )
    db.close()
  })

  it('numbering_rules has the expected columns', () => {
    const db = migratedDb()
    const columns = db.prepare('PRAGMA table_info(numbering_rules)').all() as { name: string }[]
    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'company_id',
        'document_type_key',
        'prefix',
        'padding_length',
        'reset_behavior',
        'current_sequence_value',
        'current_sequence_year',
        'created_at',
        'updated_at'
      ])
    )
    db.close()
  })

  it('does not modify the already-approved Slice 4 migration file', () => {
    const slice4Sql = readFileSync(
      join(REAL_MIGRATIONS_FOLDER, '0000_reference_data_tables.sql'),
      'utf-8'
    )
    expect(slice4Sql).toContain('CREATE TABLE `currencies`')
    expect(slice4Sql).not.toContain('company')
  })
})
