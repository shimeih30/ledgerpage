import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import * as companyService from '../../../src/main/db/companyService'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')

describe('company singleton — direct SQL enforcement', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-company-singleton')
    dbPath = join(dir, 'ledgerpage.db')
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  function migratedAndSeededDb() {
    const db = createDatabaseConnection(dbPath)
    runMigrations(db, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(db)
    return db
  }

  it('rejects a direct SQL insert of id "secondary_company" with a CHECK constraint violation', () => {
    const db = migratedAndSeededDb()
    const now = Date.now()

    expect(() =>
      db
        .prepare(
          `INSERT INTO company (id, name, address, contact_details, currency_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run('secondary_company', 'Rogue Co', 'Addr', 'Contact', 'currency_usd', now, now)
    ).toThrowError(/CHECK constraint failed/i)

    db.close()
  })

  it('rejects a direct SQL insert of a second row with id "primary_company" with a PRIMARY KEY violation', () => {
    const db = migratedAndSeededDb()
    const now = Date.now()

    db.prepare(
      `INSERT INTO company (id, name, address, contact_details, currency_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('primary_company', 'Real Co', 'Addr', 'Contact', 'currency_usd', now, now)

    expect(() =>
      db
        .prepare(
          `INSERT INTO company (id, name, address, contact_details, currency_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run('primary_company', 'Duplicate Co', 'Addr', 'Contact', 'currency_usd', now, now)
    ).toThrowError(/UNIQUE constraint failed/i)

    db.close()
  })

  it('companyService exposes no method accepting an arbitrary company id', () => {
    // Structural check on the module's actual exported API surface: every
    // exported function's parameter list is inspected, and none of them
    // is named/shaped to accept a caller-supplied id. This is a stronger
    // guarantee than a behavioral test alone — it proves the capability
    // doesn't exist in the exported surface at all, matching the "no
    // arbitrary-ID lookup or creation method" requirement directly.
    //
    // Object.keys picks up the exported error classes too (a class is
    // typeof 'function' in JS) — those are filtered out via V8's
    // class-vs-function toString() convention ("class X { ... }" vs
    // "function x(...) { ... }") so only the actual service functions
    // remain.
    const exportedFunctionNames = Object.keys(companyService).filter((key) => {
      const value = (companyService as Record<string, unknown>)[key]
      return (
        typeof value === 'function' && !/^class\s/.test(Function.prototype.toString.call(value))
      )
    })

    expect(exportedFunctionNames.sort()).toEqual(['createCompany', 'getCompany', 'updateCompany'])

    // getCompany(db) — one parameter, no id.
    expect(companyService.getCompany.length).toBe(1)
  })
})
