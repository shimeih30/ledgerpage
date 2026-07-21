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
import type { AuditActor } from '../../../src/main/audit/auditService'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const SYSTEM_ACTOR: AuditActor = { type: 'system' }

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
        createTaxCode(db, { code: 'STD', name: 'Standard', category: 'standard' }, SYSTEM_ACTOR)
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
      const created = createTaxCode(
        db,
        {
          code: 'std15',
          name: 'Standard 15%',
          category: 'standard'
        },
        SYSTEM_ACTOR
      )
      expect(created.code).toBe('STD15')
      expect(created.isActive).toBe(true)
    })

    it('rejects a whitespace-only code', () => {
      expect(() =>
        createTaxCode(db, { code: '   ', name: 'X', category: 'standard' }, SYSTEM_ACTOR)
      ).toThrow(TaxValidationError)
    })

    it('rejects a whitespace-only name', () => {
      expect(() =>
        createTaxCode(db, { code: 'STD', name: '   ', category: 'standard' }, SYSTEM_ACTOR)
      ).toThrow(TaxValidationError)
    })

    it('normalizes codes deterministically regardless of input casing/whitespace', () => {
      const a = createTaxCode(
        db,
        { code: '  std15  ', name: 'A', category: 'standard' },
        SYSTEM_ACTOR
      )
      expect(a.code).toBe('STD15')

      const found1 = getTaxCodeByCode(db, 'std15')
      const found2 = getTaxCodeByCode(db, ' STD15 ')
      const found3 = getTaxCodeByCode(db, 'Std15')
      expect(found1?.id).toBe(a.id)
      expect(found2?.id).toBe(a.id)
      expect(found3?.id).toBe(a.id)
    })

    it('rejects a duplicate normalized code even with different original casing', () => {
      createTaxCode(db, { code: 'STD15', name: 'A', category: 'standard' }, SYSTEM_ACTOR)
      expect(() =>
        createTaxCode(db, { code: 'std15', name: 'B', category: 'standard' }, SYSTEM_ACTOR)
      ).toThrow(TaxConfigurationError)
    })

    it.each(['standard', 'zero_rated', 'exempt', 'other'] as const)(
      'accepts the approved category "%s"',
      (category) => {
        const created = createTaxCode(
          db,
          { code: `C_${category}`, name: 'X', category },
          SYSTEM_ACTOR
        )
        expect(created.category).toBe(category)
      }
    )

    it('rejects an unsupported category', () => {
      expect(() =>
        // @ts-expect-error deliberately invalid category for the test
        createTaxCode(db, { code: 'BAD', name: 'X', category: 'luxury' }, SYSTEM_ACTOR)
      ).toThrow(TaxValidationError)
    })

    it('update preserves id and createdAt while advancing updatedAt', () => {
      const created = createTaxCode(
        db,
        { code: 'STD', name: 'Standard', category: 'standard' },
        SYSTEM_ACTOR,
        new Date('2026-01-01T00:00:00.000Z')
      )
      const updated = db.transaction((tx) =>
        updateTaxCode(
          tx,
          created.id,
          { name: 'Renamed' },
          SYSTEM_ACTOR,
          new Date('2026-06-01T00:00:00.000Z')
        )
      )

      expect(updated.id).toBe(created.id)
      expect(updated.createdAt.getTime()).toBe(created.createdAt.getTime())
      expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime())
      expect(updated.name).toBe('Renamed')
    })

    it('deactivation does not delete the tax code or its rate history', () => {
      const created = createTaxCode(
        db,
        { code: 'STD', name: 'Standard', category: 'standard' },
        SYSTEM_ACTOR
      )
      const deactivated = deactivateTaxCode(db, created.id, SYSTEM_ACTOR)

      expect(deactivated.isActive).toBe(false)
      expect(getTaxCodeById(db, created.id)).toBeDefined()
      expect(listTaxCodes(db).map((c) => c.id)).toContain(created.id)
    })

    it('reactivation restores isActive to true', () => {
      const created = createTaxCode(
        db,
        { code: 'STD', name: 'Standard', category: 'standard' },
        SYSTEM_ACTOR
      )
      deactivateTaxCode(db, created.id, SYSTEM_ACTOR)
      const reactivated = reactivateTaxCode(db, created.id, SYSTEM_ACTOR)
      expect(reactivated.isActive).toBe(true)
    })

    it('listTaxCodes returns only codes for the singleton company', () => {
      createTaxCode(db, { code: 'A', name: 'A', category: 'standard' }, SYSTEM_ACTOR)
      createTaxCode(db, { code: 'B', name: 'B', category: 'exempt' }, SYSTEM_ACTOR)
      expect(listTaxCodes(db)).toHaveLength(2)
    })

    describe('category immutability once rate versions exist', () => {
      it('category can change freely before the first rate version exists', () => {
        const created = createTaxCode(
          db,
          { code: 'STD', name: 'Standard', category: 'standard' },
          SYSTEM_ACTOR
        )

        const updated = db.transaction((tx) =>
          updateTaxCode(tx, created.id, { category: 'exempt' }, SYSTEM_ACTOR)
        )

        expect(updated.category).toBe('exempt')
      })

      it('category change is rejected once one rate version exists', () => {
        const created = createTaxCode(
          db,
          { code: 'STD', name: 'Standard', category: 'standard' },
          SYSTEM_ACTOR
        )
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: created.id,
              ratePpm: 150000,
              effectiveFrom: '2026-01-01'
            },
            SYSTEM_ACTOR
          )
        )

        expect(() =>
          db.transaction((tx) =>
            updateTaxCode(tx, created.id, { category: 'zero_rated' }, SYSTEM_ACTOR)
          )
        ).toThrow(TaxCategoryImmutableError)
      })

      it('changing to the same category remains allowed even after rate versions exist', () => {
        const created = createTaxCode(
          db,
          { code: 'STD', name: 'Standard', category: 'standard' },
          SYSTEM_ACTOR
        )
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: created.id,
              ratePpm: 150000,
              effectiveFrom: '2026-01-01'
            },
            SYSTEM_ACTOR
          )
        )

        const updated = db.transaction((tx) =>
          updateTaxCode(tx, created.id, { category: 'standard' }, SYSTEM_ACTOR)
        )

        expect(updated.category).toBe('standard')
      })

      it('a rejected category change leaves every field unchanged', () => {
        const created = createTaxCode(
          db,
          {
            code: 'STD',
            name: 'Standard',
            category: 'standard',
            description: 'Original description'
          },
          SYSTEM_ACTOR
        )
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: created.id,
              ratePpm: 150000,
              effectiveFrom: '2026-01-01'
            },
            SYSTEM_ACTOR
          )
        )

        expect(() =>
          db.transaction((tx) =>
            updateTaxCode(tx, created.id, { category: 'zero_rated' }, SYSTEM_ACTOR)
          )
        ).toThrow(TaxCategoryImmutableError)

        const after = getTaxCodeById(db, created.id)
        expect(after).toEqual(created)
      })

      it('name and description remain editable after rate history exists', () => {
        const created = createTaxCode(
          db,
          { code: 'STD', name: 'Standard', category: 'standard' },
          SYSTEM_ACTOR
        )
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: created.id,
              ratePpm: 150000,
              effectiveFrom: '2026-01-01'
            },
            SYSTEM_ACTOR
          )
        )

        const updated = db.transaction((tx) =>
          updateTaxCode(
            tx,
            created.id,
            { name: 'Standard Rate', description: 'Updated' },
            SYSTEM_ACTOR
          )
        )

        expect(updated.name).toBe('Standard Rate')
        expect(updated.description).toBe('Updated')
        expect(updated.category).toBe('standard')
      })

      it('historical resolution is unaffected by a permitted metadata-only edit', () => {
        const created = createTaxCode(
          db,
          { code: 'STD', name: 'Standard', category: 'standard' },
          SYSTEM_ACTOR
        )
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: created.id,
              ratePpm: 150000,
              effectiveFrom: '2026-01-01'
            },
            SYSTEM_ACTOR
          )
        )

        const before = resolveTaxRate(db, { taxCodeId: created.id }, '2026-06-01')

        db.transaction((tx) =>
          updateTaxCode(tx, created.id, { name: 'Renamed', description: 'x' }, SYSTEM_ACTOR)
        )

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

  describe('Slice 10: every mutation produces exactly one matching audit row', () => {
    beforeEach(() => {
      createCompany(db, {
        name: 'Fixture Co',
        address: 'Addr',
        contactDetails: 'contact@example.com',
        currencyId: 'currency_usd'
      })
    })

    function auditRowsFor(entityId: string): { action: string; changedFields: string | null }[] {
      return rawDb
        .prepare(
          'SELECT action, changed_fields as changedFields FROM audit_log_entries WHERE entity_id = ? ORDER BY rowid'
        )
        .all(entityId) as { action: string; changedFields: string | null }[]
    }

    it('createTaxCode produces exactly one create row with null->value fields', () => {
      const created = createTaxCode(
        db,
        { code: 'STD', name: 'Standard', category: 'standard' },
        SYSTEM_ACTOR
      )
      const rows = auditRowsFor(created.id)
      expect(rows).toHaveLength(1)
      expect(rows[0].action).toBe('create')
      const changed = JSON.parse(rows[0].changedFields as string)
      expect(changed.code).toEqual({ old: null, new: 'STD' })
    })

    it('updateTaxCode produces exactly one update row with only the changed field', () => {
      const created = createTaxCode(
        db,
        { code: 'STD', name: 'Standard', category: 'standard' },
        SYSTEM_ACTOR
      )
      db.transaction((tx) => updateTaxCode(tx, created.id, { name: 'Renamed' }, SYSTEM_ACTOR))

      const rows = auditRowsFor(created.id)
      expect(rows).toHaveLength(2) // create + update
      const updateRow = rows.find((r) => r.action === 'update')
      expect(updateRow).toBeDefined()
      const changed = JSON.parse(updateRow!.changedFields as string)
      expect(changed).toEqual({ name: { old: 'Standard', new: 'Renamed' } })
    })

    it('deactivateTaxCode/reactivateTaxCode each produce exactly one row with the isActive transition', () => {
      const created = createTaxCode(
        db,
        { code: 'STD', name: 'Standard', category: 'standard' },
        SYSTEM_ACTOR
      )
      deactivateTaxCode(db, created.id, SYSTEM_ACTOR)
      reactivateTaxCode(db, created.id, SYSTEM_ACTOR)

      const rows = auditRowsFor(created.id)
      expect(rows.map((r) => r.action)).toEqual(['create', 'deactivate', 'reactivate'])
      expect(JSON.parse(rows[1].changedFields as string)).toEqual({
        isActive: { old: true, new: false }
      })
      expect(JSON.parse(rows[2].changedFields as string)).toEqual({
        isActive: { old: false, new: true }
      })
    })

    it('a rejected duplicate-code creation produces zero audit rows', () => {
      createTaxCode(db, { code: 'STD15', name: 'A', category: 'standard' }, SYSTEM_ACTOR)
      const beforeCount = rawDb.prepare('SELECT COUNT(*) as c FROM audit_log_entries').get() as {
        c: number
      }

      expect(() =>
        createTaxCode(db, { code: 'std15', name: 'B', category: 'standard' }, SYSTEM_ACTOR)
      ).toThrow(TaxConfigurationError)

      const afterCount = rawDb.prepare('SELECT COUNT(*) as c FROM audit_log_entries').get() as {
        c: number
      }
      expect(afterCount.c).toBe(beforeCount.c)
    })

    it('a rejected category-immutability update produces zero new audit rows', () => {
      const created = createTaxCode(
        db,
        { code: 'STD', name: 'Standard', category: 'standard' },
        SYSTEM_ACTOR
      )
      db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          { taxCodeId: created.id, ratePpm: 150000, effectiveFrom: '2026-01-01' },
          SYSTEM_ACTOR
        )
      )
      const beforeCount = rawDb.prepare('SELECT COUNT(*) as c FROM audit_log_entries').get() as {
        c: number
      }

      expect(() =>
        db.transaction((tx) =>
          updateTaxCode(tx, created.id, { category: 'zero_rated' }, SYSTEM_ACTOR)
        )
      ).toThrow(TaxCategoryImmutableError)

      const afterCount = rawDb.prepare('SELECT COUNT(*) as c FROM audit_log_entries').get() as {
        c: number
      }
      expect(afterCount.c).toBe(beforeCount.c)
    })
  })
})
