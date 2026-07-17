import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import * as taxCodeService from '../../../src/main/db/taxCodeService'
import {
  createTaxCode,
  deactivateTaxCode,
  getTaxCodeByCode,
  getTaxCodeById,
  listTaxCodes,
  reactivateTaxCode,
  TaxCategoryImmutableError,
  TaxConfigurationError,
  updateTaxCode
} from '../../../src/main/db/taxCodeService'
import { createTaxRateVersion } from '../../../src/main/db/taxRateVersionService'
import { resolveTaxRate } from '../../../src/main/db/taxRateResolutionService'
import { TaxValidationError } from '../../../src/main/db/validation/taxValidation'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')

describe('taxCodeService', () => {
  let dir: string
  let dbPath: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    dir = createTempDir('ledgerpage-tax-code-service')
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

  describe('before a company exists', () => {
    it('createTaxCode returns a clear, documented error rather than a raw FK failure', () => {
      expect(() =>
        createTaxCode(db, { code: 'STD', name: 'Standard', category: 'standard' })
      ).toThrow(TaxConfigurationError)
    })
  })

  describe('once a company exists', () => {
    beforeEach(() => {
      createCompany(db, {
        name: 'Fixture Co',
        address: 'Addr',
        contactDetails: 'contact@example.com',
        currencyId: 'currency_usd'
      })
    })

    it('creates a tax code successfully', () => {
      const created = createTaxCode(db, {
        code: 'std15',
        name: 'Standard 15%',
        category: 'standard'
      })
      expect(created.code).toBe('STD15')
      expect(created.isActive).toBe(true)
    })

    it('rejects a whitespace-only code', () => {
      expect(() => createTaxCode(db, { code: '   ', name: 'X', category: 'standard' })).toThrow(
        TaxValidationError
      )
    })

    it('rejects a whitespace-only name', () => {
      expect(() => createTaxCode(db, { code: 'STD', name: '   ', category: 'standard' })).toThrow(
        TaxValidationError
      )
    })

    it('normalizes codes deterministically regardless of input casing/whitespace', () => {
      const a = createTaxCode(db, { code: '  std15  ', name: 'A', category: 'standard' })
      expect(a.code).toBe('STD15')

      const found1 = getTaxCodeByCode(db, 'std15')
      const found2 = getTaxCodeByCode(db, ' STD15 ')
      const found3 = getTaxCodeByCode(db, 'Std15')
      expect(found1?.id).toBe(a.id)
      expect(found2?.id).toBe(a.id)
      expect(found3?.id).toBe(a.id)
    })

    it('rejects a duplicate normalized code even with different original casing', () => {
      createTaxCode(db, { code: 'STD15', name: 'A', category: 'standard' })
      expect(() => createTaxCode(db, { code: 'std15', name: 'B', category: 'standard' })).toThrow(
        TaxConfigurationError
      )
    })

    it.each(['standard', 'zero_rated', 'exempt', 'other'] as const)(
      'accepts the approved category "%s"',
      (category) => {
        const created = createTaxCode(db, { code: `C_${category}`, name: 'X', category })
        expect(created.category).toBe(category)
      }
    )

    it('rejects an unsupported category', () => {
      expect(() =>
        // @ts-expect-error deliberately invalid category for the test
        createTaxCode(db, { code: 'BAD', name: 'X', category: 'luxury' })
      ).toThrow(TaxValidationError)
    })

    it('update preserves id and createdAt while advancing updatedAt', () => {
      const created = createTaxCode(
        db,
        { code: 'STD', name: 'Standard', category: 'standard' },
        new Date('2026-01-01T00:00:00.000Z')
      )
      const updated = db.transaction((tx) =>
        updateTaxCode(tx, created.id, { name: 'Renamed' }, new Date('2026-06-01T00:00:00.000Z'))
      )

      expect(updated.id).toBe(created.id)
      expect(updated.createdAt.getTime()).toBe(created.createdAt.getTime())
      expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime())
      expect(updated.name).toBe('Renamed')
    })

    it('deactivation does not delete the tax code or its rate history', () => {
      const created = createTaxCode(db, { code: 'STD', name: 'Standard', category: 'standard' })
      const deactivated = deactivateTaxCode(db, created.id)

      expect(deactivated.isActive).toBe(false)
      expect(getTaxCodeById(db, created.id)).toBeDefined()
      expect(listTaxCodes(db).map((c) => c.id)).toContain(created.id)
    })

    it('reactivation restores isActive to true', () => {
      const created = createTaxCode(db, { code: 'STD', name: 'Standard', category: 'standard' })
      deactivateTaxCode(db, created.id)
      const reactivated = reactivateTaxCode(db, created.id)
      expect(reactivated.isActive).toBe(true)
    })

    it('listTaxCodes returns only codes for the singleton company', () => {
      createTaxCode(db, { code: 'A', name: 'A', category: 'standard' })
      createTaxCode(db, { code: 'B', name: 'B', category: 'exempt' })
      expect(listTaxCodes(db)).toHaveLength(2)
    })

    describe('category immutability once rate versions exist', () => {
      it('category can change freely before the first rate version exists', () => {
        const created = createTaxCode(db, { code: 'STD', name: 'Standard', category: 'standard' })

        const updated = db.transaction((tx) =>
          updateTaxCode(tx, created.id, { category: 'exempt' })
        )

        expect(updated.category).toBe('exempt')
      })

      it('category change is rejected once one rate version exists', () => {
        const created = createTaxCode(db, { code: 'STD', name: 'Standard', category: 'standard' })
        db.transaction((tx) =>
          createTaxRateVersion(tx, {
            taxCodeId: created.id,
            ratePpm: 150000,
            effectiveFrom: '2026-01-01'
          })
        )

        expect(() =>
          db.transaction((tx) => updateTaxCode(tx, created.id, { category: 'zero_rated' }))
        ).toThrow(TaxCategoryImmutableError)
      })

      it('changing to the same category remains allowed even after rate versions exist', () => {
        const created = createTaxCode(db, { code: 'STD', name: 'Standard', category: 'standard' })
        db.transaction((tx) =>
          createTaxRateVersion(tx, {
            taxCodeId: created.id,
            ratePpm: 150000,
            effectiveFrom: '2026-01-01'
          })
        )

        const updated = db.transaction((tx) =>
          updateTaxCode(tx, created.id, { category: 'standard' })
        )

        expect(updated.category).toBe('standard')
      })

      it('a rejected category change leaves every field unchanged', () => {
        const created = createTaxCode(db, {
          code: 'STD',
          name: 'Standard',
          category: 'standard',
          description: 'Original description'
        })
        db.transaction((tx) =>
          createTaxRateVersion(tx, {
            taxCodeId: created.id,
            ratePpm: 150000,
            effectiveFrom: '2026-01-01'
          })
        )

        expect(() =>
          db.transaction((tx) => updateTaxCode(tx, created.id, { category: 'zero_rated' }))
        ).toThrow(TaxCategoryImmutableError)

        const after = getTaxCodeById(db, created.id)
        expect(after).toEqual(created)
      })

      it('name and description remain editable after rate history exists', () => {
        const created = createTaxCode(db, { code: 'STD', name: 'Standard', category: 'standard' })
        db.transaction((tx) =>
          createTaxRateVersion(tx, {
            taxCodeId: created.id,
            ratePpm: 150000,
            effectiveFrom: '2026-01-01'
          })
        )

        const updated = db.transaction((tx) =>
          updateTaxCode(tx, created.id, { name: 'Standard Rate', description: 'Updated' })
        )

        expect(updated.name).toBe('Standard Rate')
        expect(updated.description).toBe('Updated')
        expect(updated.category).toBe('standard')
      })

      it('historical resolution is unaffected by a permitted metadata-only edit', () => {
        const created = createTaxCode(db, { code: 'STD', name: 'Standard', category: 'standard' })
        db.transaction((tx) =>
          createTaxRateVersion(tx, {
            taxCodeId: created.id,
            ratePpm: 150000,
            effectiveFrom: '2026-01-01'
          })
        )

        const before = resolveTaxRate(db, { taxCodeId: created.id }, '2026-06-01')

        db.transaction((tx) => updateTaxCode(tx, created.id, { name: 'Renamed', description: 'x' }))

        const after = resolveTaxRate(db, { taxCodeId: created.id }, '2026-06-01')
        expect(after).toEqual(before)
      })
    })
  })

  it('no exported function accepts an arbitrary company id', () => {
    const exportedFunctionNames = Object.keys(taxCodeService).filter((key) => {
      const value = (taxCodeService as Record<string, unknown>)[key]
      return (
        typeof value === 'function' && !/^class\s/.test(Function.prototype.toString.call(value))
      )
    })

    expect(exportedFunctionNames.sort()).toEqual(
      [
        'createTaxCode',
        'deactivateTaxCode',
        'getTaxCodeByCode',
        'getTaxCodeById',
        'listTaxCodes',
        'reactivateTaxCode',
        'updateTaxCode'
      ].sort()
    )
  })
})
