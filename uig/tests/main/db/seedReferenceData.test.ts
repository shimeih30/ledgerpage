import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { currencySeedRows } from '../../../src/main/db/seedData/currencies'
import { unitOfMeasureSeedRows } from '../../../src/main/db/seedData/unitsOfMeasure'
import { paymentMethodSeedRows } from '../../../src/main/db/seedData/paymentMethods'
import { expenseCategorySeedRows } from '../../../src/main/db/seedData/expenseCategories'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')

function countRows(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c
}

describe('seedReferenceData', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-seed')
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

  it('inserts every seed row for each table on first run', () => {
    const db = migratedDb()
    seedReferenceData(db)

    expect(countRows(db, 'currencies')).toBe(currencySeedRows.length)
    expect(countRows(db, 'units_of_measure')).toBe(unitOfMeasureSeedRows.length)
    expect(countRows(db, 'payment_methods')).toBe(paymentMethodSeedRows.length)
    expect(countRows(db, 'expense_categories')).toBe(expenseCategorySeedRows.length)

    db.close()
  })

  it('uses the exact stable ids and codes from the seed definitions', () => {
    const db = migratedDb()
    seedReferenceData(db)

    const rows = db.prepare('SELECT id, code FROM currencies ORDER BY sort_order').all() as {
      id: string
      code: string
    }[]
    expect(rows).toEqual(currencySeedRows.map((r) => ({ id: r.id, code: r.code })))

    db.close()
  })

  it('seeds exactly USD, ZAR, BWP, CNY, ZWG', () => {
    const db = migratedDb()
    seedReferenceData(db)

    const codes = (
      db.prepare('SELECT code FROM currencies ORDER BY code').all() as { code: string }[]
    ).map((r) => r.code)
    expect(codes).toEqual(['BWP', 'CNY', 'USD', 'ZAR', 'ZWG'])

    db.close()
  })

  it('seeds currency_zwg with the confirmed Zimbabwe Gold details', () => {
    const db = migratedDb()
    seedReferenceData(db)

    const row = db.prepare('SELECT * FROM currencies WHERE id = ?').get('currency_zwg') as {
      code: string
      name: string
      symbol: string
      description: string
      is_active: number
      decimal_places: number
    }

    expect(row).toBeDefined()
    expect(row.code).toBe('ZWG')
    expect(row.name).toBe('Zimbabwe Gold')
    expect(row.symbol).toBe('ZiG')
    expect(row.description).toBe('Zimbabwe Gold local currency')
    expect(row.is_active).toBe(1)
    expect(row.decimal_places).toBe(2)

    db.close()
  })

  it('does not seed a ZWL currency row', () => {
    const db = migratedDb()
    seedReferenceData(db)

    const zwlRow = db.prepare('SELECT * FROM currencies WHERE code = ?').get('ZWL')
    expect(zwlRow).toBeUndefined()

    db.close()
  })

  it('does not duplicate currency_zwg when seeding runs twice', () => {
    const db = migratedDb()
    seedReferenceData(db)
    seedReferenceData(db)

    const count = (
      db.prepare('SELECT COUNT(*) as c FROM currencies WHERE id = ?').get('currency_zwg') as {
        c: number
      }
    ).c
    expect(count).toBe(1)

    db.close()
  })

  it('does not duplicate rows when seeding runs twice', () => {
    const db = migratedDb()
    seedReferenceData(db)
    seedReferenceData(db)

    expect(countRows(db, 'currencies')).toBe(currencySeedRows.length)
    expect(countRows(db, 'units_of_measure')).toBe(unitOfMeasureSeedRows.length)
    expect(countRows(db, 'payment_methods')).toBe(paymentMethodSeedRows.length)
    expect(countRows(db, 'expense_categories')).toBe(expenseCategorySeedRows.length)

    db.close()
  })

  it('does not overwrite a user-edited name on a subsequent run', () => {
    const db = migratedDb()
    seedReferenceData(db)

    db.prepare('UPDATE currencies SET name = ? WHERE id = ?').run(
      'My Custom Dollar Name',
      'currency_usd'
    )

    seedReferenceData(db)

    const row = db.prepare('SELECT name FROM currencies WHERE id = ?').get('currency_usd') as {
      name: string
    }
    expect(row.name).toBe('My Custom Dollar Name')

    db.close()
  })

  it('does not overwrite a user-edited sort_order on a subsequent run', () => {
    const db = migratedDb()
    seedReferenceData(db)

    db.prepare('UPDATE currencies SET sort_order = ? WHERE id = ?').run(999, 'currency_usd')

    seedReferenceData(db)

    const row = db
      .prepare('SELECT sort_order FROM currencies WHERE id = ?')
      .get('currency_usd') as {
      sort_order: number
    }
    expect(row.sort_order).toBe(999)

    db.close()
  })

  it('does not overwrite a user-edited description on a subsequent run', () => {
    const db = migratedDb()
    seedReferenceData(db)

    db.prepare('UPDATE units_of_measure SET description = ? WHERE id = ?').run(
      'Custom note about kilograms',
      'uom_kg'
    )

    seedReferenceData(db)

    const row = db
      .prepare('SELECT description FROM units_of_measure WHERE id = ?')
      .get('uom_kg') as {
      description: string
    }
    expect(row.description).toBe('Custom note about kilograms')

    db.close()
  })

  it('does not reactivate a deactivated row on a subsequent run', () => {
    const db = migratedDb()
    seedReferenceData(db)

    db.prepare('UPDATE currencies SET is_active = 0 WHERE id = ?').run('currency_usd')

    seedReferenceData(db)

    const row = db.prepare('SELECT is_active FROM currencies WHERE id = ?').get('currency_usd') as {
      is_active: number
    }
    expect(row.is_active).toBe(0)

    db.close()
  })

  it('runs inside a single transaction — a failure leaves no partial rows behind', () => {
    // Force a genuine SQL-level failure partway through the seeding
    // sequence by dropping a table seedReferenceData expects. currencies
    // is processed first; if the transaction is real, its inserts must
    // be rolled back too when a later table's insert fails.
    const db = migratedDb()
    db.exec('DROP TABLE units_of_measure')

    expect(() => seedReferenceData(db)).toThrow()

    expect(countRows(db, 'currencies')).toBe(0)

    db.close()
  })
})
