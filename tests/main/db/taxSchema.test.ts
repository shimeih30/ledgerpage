import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { currencySeedRows } from '../../../src/main/db/seedData/currencies'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')

describe('tax_codes and tax_rate_versions schema (real migrations folder)', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-slice6-schema')
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

  function seedCompanyAndCurrency(db: ReturnType<typeof migratedDb>) {
    seedReferenceData(db)
    const now = Date.now()
    db.prepare(
      "INSERT INTO company (id, name, address, contact_details, currency_id, created_at, updated_at) VALUES ('primary_company','Fixture Co','Addr','Contact','currency_usd',?,?)"
    ).run(now, now)
  }

  it('creates the tax_codes table', () => {
    const db = migratedDb()
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    expect(tables.map((t) => t.name)).toContain('tax_codes')
    db.close()
  })

  it('creates the tax_rate_versions table', () => {
    const db = migratedDb()
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    expect(tables.map((t) => t.name)).toContain('tax_rate_versions')
    db.close()
  })

  it('tax_codes has the expected columns', () => {
    const db = migratedDb()
    const columns = db.prepare('PRAGMA table_info(tax_codes)').all() as { name: string }[]
    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'company_id',
        'code',
        'name',
        'category',
        'description',
        'is_active',
        'created_at',
        'updated_at'
      ])
    )
    db.close()
  })

  it('tax_rate_versions has the expected columns', () => {
    const db = migratedDb()
    const columns = db.prepare('PRAGMA table_info(tax_rate_versions)').all() as { name: string }[]
    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'tax_code_id',
        'rate_ppm',
        'effective_from',
        'effective_to',
        'created_at',
        'updated_at'
      ])
    )
    db.close()
  })

  it('tax_codes.company_id has a foreign key to company(id)', () => {
    const db = migratedDb()
    const fks = db.prepare('PRAGMA foreign_key_list(tax_codes)').all() as {
      table: string
      from: string
      to: string
    }[]
    expect(
      fks.some((fk) => fk.table === 'company' && fk.from === 'company_id' && fk.to === 'id')
    ).toBe(true)
    db.close()
  })

  it('tax_rate_versions.tax_code_id has a foreign key to tax_codes(id)', () => {
    const db = migratedDb()
    const fks = db.prepare('PRAGMA foreign_key_list(tax_rate_versions)').all() as {
      table: string
      from: string
      to: string
    }[]
    expect(
      fks.some((fk) => fk.table === 'tax_codes' && fk.from === 'tax_code_id' && fk.to === 'id')
    ).toBe(true)
    db.close()
  })

  it('rejects two tax codes with the same company_id and code', () => {
    const db = migratedDb()
    seedCompanyAndCurrency(db)
    const now = Date.now()

    db.prepare(
      "INSERT INTO tax_codes (id, company_id, code, name, category, created_at, updated_at) VALUES ('tc1','primary_company','STD','Standard','standard',?,?)"
    ).run(now, now)

    expect(() =>
      db
        .prepare(
          "INSERT INTO tax_codes (id, company_id, code, name, category, created_at, updated_at) VALUES ('tc2','primary_company','STD','Standard 2','standard',?,?)"
        )
        .run(now, now)
    ).toThrow(/UNIQUE constraint failed/i)

    db.close()
  })

  it('rejects an unapproved tax code category', () => {
    const db = migratedDb()
    seedCompanyAndCurrency(db)
    const now = Date.now()

    expect(() =>
      db
        .prepare(
          "INSERT INTO tax_codes (id, company_id, code, name, category, created_at, updated_at) VALUES ('tc1','primary_company','X','X','luxury',?,?)"
        )
        .run(now, now)
    ).toThrow(/CHECK constraint failed/i)

    db.close()
  })

  it('rejects a negative rate_ppm', () => {
    const db = migratedDb()
    seedCompanyAndCurrency(db)
    const now = Date.now()
    db.prepare(
      "INSERT INTO tax_codes (id, company_id, code, name, category, created_at, updated_at) VALUES ('tc1','primary_company','STD','Standard','standard',?,?)"
    ).run(now, now)

    expect(() =>
      db
        .prepare(
          "INSERT INTO tax_rate_versions (id, tax_code_id, rate_ppm, effective_from, created_at, updated_at) VALUES ('rv1','tc1',-1,'2026-01-01',?,?)"
        )
        .run(now, now)
    ).toThrow(/CHECK constraint failed/i)

    db.close()
  })

  it('rejects effective_to before effective_from at the database level', () => {
    const db = migratedDb()
    seedCompanyAndCurrency(db)
    const now = Date.now()
    db.prepare(
      "INSERT INTO tax_codes (id, company_id, code, name, category, created_at, updated_at) VALUES ('tc1','primary_company','STD','Standard','standard',?,?)"
    ).run(now, now)

    expect(() =>
      db
        .prepare(
          "INSERT INTO tax_rate_versions (id, tax_code_id, rate_ppm, effective_from, effective_to, created_at, updated_at) VALUES ('rv1','tc1',150000,'2026-06-01','2026-01-01',?,?)"
        )
        .run(now, now)
    ).toThrow(/CHECK constraint failed/i)

    db.close()
  })

  it('runs successfully against a fresh (empty) database', () => {
    expect(() => migratedDb()).not.toThrow()
  })

  it('upgrades an existing Slice 5 database (0000, 0001, 0002 all applied from the real folder)', () => {
    const db = createDatabaseConnection(dbPath)
    runMigrations(db, REAL_MIGRATIONS_FOLDER)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'currencies',
        'units_of_measure',
        'payment_methods',
        'expense_categories',
        'company',
        'numbering_rules',
        'tax_codes',
        'tax_rate_versions'
      ])
    )
    db.close()
  })

  it('preserves existing Slice 4 reference data when the Slice 6 migration is applied', () => {
    const db = createDatabaseConnection(dbPath)
    runMigrations(db, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(db)

    const count = (db.prepare('SELECT COUNT(*) as c FROM currencies').get() as { c: number }).c
    expect(count).toBe(currencySeedRows.length)

    db.close()
  })

  it('leaves both tax tables empty immediately after migrations run', () => {
    const db = migratedDb()
    const taxCodeCount = (db.prepare('SELECT COUNT(*) as c FROM tax_codes').get() as { c: number })
      .c
    const rateVersionCount = (
      db.prepare('SELECT COUNT(*) as c FROM tax_rate_versions').get() as { c: number }
    ).c
    expect(taxCodeCount).toBe(0)
    expect(rateVersionCount).toBe(0)
    db.close()
  })

  it('leaves both tax tables empty even after Slice 4 reference-data seeding runs', () => {
    const db = migratedDb()
    seedReferenceData(db)

    const taxCodeCount = (db.prepare('SELECT COUNT(*) as c FROM tax_codes').get() as { c: number })
      .c
    const rateVersionCount = (
      db.prepare('SELECT COUNT(*) as c FROM tax_rate_versions').get() as { c: number }
    ).c
    expect(taxCodeCount).toBe(0)
    expect(rateVersionCount).toBe(0)

    db.close()
  })

  it('keeps foreign_keys enabled after migrating in the new tables', () => {
    const db = migratedDb()
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    db.close()
  })

  it('does not modify migrations 0000 or 0001', () => {
    const slice4Sql = readFileSync(
      join(REAL_MIGRATIONS_FOLDER, '0000_reference_data_tables.sql'),
      'utf-8'
    )
    const slice5Sql = readFileSync(
      join(REAL_MIGRATIONS_FOLDER, '0001_company_and_numbering_rules.sql'),
      'utf-8'
    )
    expect(slice4Sql).toContain('CREATE TABLE `currencies`')
    expect(slice4Sql).not.toContain('tax_codes')
    expect(slice5Sql).toContain('CREATE TABLE `company`')
    expect(slice5Sql).not.toContain('tax_codes')
  })
})
