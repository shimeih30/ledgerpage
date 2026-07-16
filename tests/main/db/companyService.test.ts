import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import {
  CompanyNotFoundError,
  CompanySingletonError,
  createCompany,
  getCompany,
  updateCompany
} from '../../../src/main/db/companyService'
import { CompanyValidationError } from '../../../src/main/db/validation/companyValidation'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')

const VALID_INPUT = {
  name: 'Farmer Ben Holdings',
  address: '1 Main Street',
  contactDetails: 'owner@example.com',
  currencyId: 'currency_usd'
}

describe('companyService', () => {
  let dir: string
  let dbPath: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    dir = createTempDir('ledgerpage-company-service')
    dbPath = join(dir, 'ledgerpage.db')
    rawDb = createDatabaseConnection(dbPath)
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    db = drizzle<Record<string, never>>(rawDb)
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  it('returns undefined when reading before the company has been created', () => {
    expect(getCompany(db)).toBeUndefined()
  })

  it('creates the singleton company successfully', () => {
    const created = createCompany(db, VALID_INPUT)
    expect(created.id).toBe('primary_company')
    expect(created.name).toBe('Farmer Ben Holdings')
    expect(created.vatRegistered).toBe(false)
    expect(created.tradingName).toBeNull()
    expect(created.logoAssetPath).toBeNull()
  })

  it('reading after creation returns the created company', () => {
    createCompany(db, VALID_INPUT)
    const fetched = getCompany(db)
    expect(fetched?.name).toBe('Farmer Ben Holdings')
  })

  it('rejects creating the company a second time', () => {
    createCompany(db, VALID_INPUT)
    expect(() => createCompany(db, VALID_INPUT)).toThrow(CompanySingletonError)
  })

  it('rejects creation with an empty name after trimming', () => {
    expect(() => createCompany(db, { ...VALID_INPUT, name: '   ' })).toThrow(CompanyValidationError)
  })

  it('rejects creation with an empty address after trimming', () => {
    expect(() => createCompany(db, { ...VALID_INPUT, address: '' })).toThrow(CompanyValidationError)
  })

  it('rejects creation with an empty contactDetails after trimming', () => {
    expect(() => createCompany(db, { ...VALID_INPUT, contactDetails: '  ' })).toThrow(
      CompanyValidationError
    )
  })

  it('rejects creation with a currencyId that does not exist', () => {
    expect(() =>
      createCompany(db, { ...VALID_INPUT, currencyId: 'currency_does_not_exist' })
    ).toThrow(CompanyValidationError)
  })

  it('rejects an absolute logo asset path', () => {
    expect(() => createCompany(db, { ...VALID_INPUT, logoAssetPath: '/etc/passwd' })).toThrow(
      CompanyValidationError
    )
  })

  it('rejects a Windows-style absolute logo asset path', () => {
    expect(() =>
      createCompany(db, { ...VALID_INPUT, logoAssetPath: 'C:\\Windows\\system.ini' })
    ).toThrow(CompanyValidationError)
  })

  it('rejects a path-traversing logo asset path', () => {
    expect(() => createCompany(db, { ...VALID_INPUT, logoAssetPath: '../../etc/passwd' })).toThrow(
      CompanyValidationError
    )
  })

  it('accepts a valid managed relative logo asset path', () => {
    const created = createCompany(db, { ...VALID_INPUT, logoAssetPath: 'logo.png' })
    expect(created.logoAssetPath).toBe('logo.png')
  })

  it('rejects updating a company that does not exist yet', () => {
    expect(() => updateCompany(db, { name: 'New Name' })).toThrow(CompanyNotFoundError)
  })

  it('updates preserve id and createdAt', () => {
    const created = createCompany(db, VALID_INPUT)
    const updated = updateCompany(db, { name: 'Renamed Co' })

    expect(updated.id).toBe(created.id)
    expect(updated.createdAt.getTime()).toBe(created.createdAt.getTime())
    expect(updated.name).toBe('Renamed Co')
  })

  it('update advances updatedAt', () => {
    const created = createCompany(db, VALID_INPUT, new Date('2026-01-01T00:00:00.000Z'))
    const updated = updateCompany(db, { name: 'Renamed Co' }, new Date('2026-06-01T00:00:00.000Z'))

    expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime())
  })

  it('update only changes the fields provided, leaving others untouched', () => {
    createCompany(db, { ...VALID_INPUT, tradingName: 'Original Trading Name' })
    const updated = updateCompany(db, { name: 'New Name Only' })

    expect(updated.name).toBe('New Name Only')
    expect(updated.tradingName).toBe('Original Trading Name')
    expect(updated.address).toBe(VALID_INPUT.address)
  })

  it('update rejects an invalid new currencyId', () => {
    createCompany(db, VALID_INPUT)
    expect(() => updateCompany(db, { currencyId: 'currency_does_not_exist' })).toThrow(
      CompanyValidationError
    )
  })

  it('update rejects an absolute logo asset path', () => {
    createCompany(db, VALID_INPUT)
    expect(() => updateCompany(db, { logoAssetPath: '/absolute/path.png' })).toThrow(
      CompanyValidationError
    )
  })

  it('update can clear a previously-set logo asset path back to null', () => {
    createCompany(db, { ...VALID_INPUT, logoAssetPath: 'logo.png' })
    const updated = updateCompany(db, { logoAssetPath: null })
    expect(updated.logoAssetPath).toBeNull()
  })
})
