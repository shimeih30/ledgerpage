import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import { createTaxCode, type TaxCode } from '../../../src/main/db/taxCodeService'
import {
  createTaxRateVersion,
  listTaxRateVersions,
  TaxRateOverlapError,
  TaxRateVersionError,
  updateTaxRateVersion
} from '../../../src/main/db/taxRateVersionService'
import { ppmFromPercent, TaxValidationError } from '../../../src/main/db/validation/taxValidation'
import type { AuditActor } from '../../../src/main/audit/auditService'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const SYSTEM_ACTOR: AuditActor = { type: 'system' }

describe('taxRateVersionService', () => {
  let dir: string
  let dbPath: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let standardCode: TaxCode
  let zeroRatedCode: TaxCode
  let exemptCode: TaxCode

  beforeEach(() => {
    dir = createTempDir('ledgerpage-tax-rate-version')
    dbPath = join(dir, 'ledgerpage.db')
    rawDb = createDatabaseConnection(dbPath)
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    db = drizzle<Record<string, never>>(rawDb)

    createCompany(db, {
      name: 'Fixture Co',
      address: 'Addr',
      contactDetails: 'contact@example.com',
      currencyId: 'currency_usd'
    })

    standardCode = createTaxCode(
      db,
      { code: 'STD', name: 'Standard', category: 'standard' },
      SYSTEM_ACTOR
    )
    zeroRatedCode = createTaxCode(
      db,
      { code: 'ZERO', name: 'Zero Rated', category: 'zero_rated' },
      SYSTEM_ACTOR
    )
    exemptCode = createTaxCode(db, { code: 'EX', name: 'Exempt', category: 'exempt' }, SYSTEM_ACTOR)
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  describe('PPM conversion', () => {
    it('15% has the exact approved parts-per-million representation', () => {
      expect(ppmFromPercent(15)).toBe(150000)
    })

    it('converts a rate with decimal precision exactly', () => {
      expect(ppmFromPercent(14.975)).toBe(149750)
    })

    it('a version created with ppmFromPercent(15) round-trips exactly through storage', () => {
      const version = db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          {
            taxCodeId: standardCode.id,
            ratePpm: ppmFromPercent(15),
            effectiveFrom: '2026-01-01'
          },
          SYSTEM_ACTOR
        )
      )
      expect(version.ratePpm).toBe(150000)
    })
  })

  describe('category-dependent rate requirements', () => {
    it('zero_rated resolves without requiring a numeric rate', () => {
      const version = db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          { taxCodeId: zeroRatedCode.id, effectiveFrom: '2026-01-01' },
          SYSTEM_ACTOR
        )
      )
      expect(version.ratePpm).toBeNull()
    })

    it('exempt resolves without requiring a numeric rate', () => {
      const version = db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          { taxCodeId: exemptCode.id, effectiveFrom: '2026-01-01' },
          SYSTEM_ACTOR
        )
      )
      expect(version.ratePpm).toBeNull()
    })

    it('standard (rate-bearing) requires rate_ppm', () => {
      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            { taxCodeId: standardCode.id, effectiveFrom: '2026-01-01' },
            SYSTEM_ACTOR
          )
        )
      ).toThrow(TaxValidationError)
    })

    it('other (rate-bearing) requires rate_ppm', () => {
      const otherCode = createTaxCode(
        db,
        { code: 'OTH', name: 'Other', category: 'other' },
        SYSTEM_ACTOR
      )
      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            { taxCodeId: otherCode.id, effectiveFrom: '2026-01-01' },
            SYSTEM_ACTOR
          )
        )
      ).toThrow(TaxValidationError)
    })
  })

  describe('rate bounds', () => {
    it('rejects a negative rate', () => {
      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: standardCode.id,
              ratePpm: -1,
              effectiveFrom: '2026-01-01'
            },
            SYSTEM_ACTOR
          )
        )
      ).toThrow(TaxValidationError)
    })

    it('rejects an excessive rate above the documented maximum', () => {
      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: standardCode.id,
              ratePpm: 6000000,
              effectiveFrom: '2026-01-01'
            },
            SYSTEM_ACTOR
          )
        )
      ).toThrow(TaxValidationError)
    })
  })

  describe('date validation', () => {
    it('rejects an invalid calendar date (Feb 30)', () => {
      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: standardCode.id,
              ratePpm: 150000,
              effectiveFrom: '2026-02-30'
            },
            SYSTEM_ACTOR
          )
        )
      ).toThrow(TaxValidationError)
    })

    it('rejects effectiveTo before effectiveFrom', () => {
      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: standardCode.id,
              ratePpm: 150000,
              effectiveFrom: '2026-06-01',
              effectiveTo: '2026-01-01'
            },
            SYSTEM_ACTOR
          )
        )
      ).toThrow(TaxValidationError)
    })

    it('allows an open-ended version (no effectiveTo)', () => {
      const version = db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          {
            taxCodeId: standardCode.id,
            ratePpm: 150000,
            effectiveFrom: '2026-01-01'
          },
          SYSTEM_ACTOR
        )
      )
      expect(version.effectiveTo).toBeNull()
    })
  })

  describe('overlap prevention', () => {
    it('allows adjacent, non-overlapping ranges (one ends the day before the next starts)', () => {
      db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          {
            taxCodeId: standardCode.id,
            ratePpm: 150000,
            effectiveFrom: '2026-01-01',
            effectiveTo: '2026-06-30'
          },
          SYSTEM_ACTOR
        )
      )
      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: standardCode.id,
              ratePpm: 160000,
              effectiveFrom: '2026-07-01'
            },
            SYSTEM_ACTOR
          )
        )
      ).not.toThrow()
    })

    it('rejects two ranges sharing their boundary date (both endpoints inclusive)', () => {
      db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          {
            taxCodeId: standardCode.id,
            ratePpm: 150000,
            effectiveFrom: '2026-01-01',
            effectiveTo: '2026-06-30'
          },
          SYSTEM_ACTOR
        )
      )
      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: standardCode.id,
              ratePpm: 160000,
              effectiveFrom: '2026-06-30'
            },
            SYSTEM_ACTOR
          )
        )
      ).toThrow(TaxRateOverlapError)
    })

    it('rejects a partial overlap', () => {
      db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          {
            taxCodeId: standardCode.id,
            ratePpm: 150000,
            effectiveFrom: '2026-01-01',
            effectiveTo: '2026-06-30'
          },
          SYSTEM_ACTOR
        )
      )
      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: standardCode.id,
              ratePpm: 160000,
              effectiveFrom: '2026-04-01',
              effectiveTo: '2026-09-30'
            },
            SYSTEM_ACTOR
          )
        )
      ).toThrow(TaxRateOverlapError)
    })

    it('rejects one range fully containing another', () => {
      db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          {
            taxCodeId: standardCode.id,
            ratePpm: 150000,
            effectiveFrom: '2026-03-01',
            effectiveTo: '2026-06-30'
          },
          SYSTEM_ACTOR
        )
      )
      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: standardCode.id,
              ratePpm: 160000,
              effectiveFrom: '2026-01-01',
              effectiveTo: '2026-12-31'
            },
            SYSTEM_ACTOR
          )
        )
      ).toThrow(TaxRateOverlapError)
    })

    it('rejects an identical range', () => {
      db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          {
            taxCodeId: standardCode.id,
            ratePpm: 150000,
            effectiveFrom: '2026-01-01',
            effectiveTo: '2026-06-30'
          },
          SYSTEM_ACTOR
        )
      )
      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: standardCode.id,
              ratePpm: 150000,
              effectiveFrom: '2026-01-01',
              effectiveTo: '2026-06-30'
            },
            SYSTEM_ACTOR
          )
        )
      ).toThrow(TaxRateOverlapError)
    })

    it('rejects a new open-ended range overlapping an existing open-ended range', () => {
      db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          {
            taxCodeId: standardCode.id,
            ratePpm: 150000,
            effectiveFrom: '2026-01-01'
          },
          SYSTEM_ACTOR
        )
      )
      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: standardCode.id,
              ratePpm: 160000,
              effectiveFrom: '2026-06-01'
            },
            SYSTEM_ACTOR
          )
        )
      ).toThrow(TaxRateOverlapError)
    })

    it('does not overlap across different tax codes', () => {
      db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          {
            taxCodeId: standardCode.id,
            ratePpm: 150000,
            effectiveFrom: '2026-01-01',
            effectiveTo: '2026-06-30'
          },
          SYSTEM_ACTOR
        )
      )
      const otherCode = createTaxCode(
        db,
        { code: 'OTH', name: 'Other', category: 'other' },
        SYSTEM_ACTOR
      )
      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: otherCode.id,
              ratePpm: 160000,
              effectiveFrom: '2026-01-01',
              effectiveTo: '2026-06-30'
            },
            SYSTEM_ACTOR
          )
        )
      ).not.toThrow()
    })

    it('updating a version does not falsely overlap itself', () => {
      const version = db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          {
            taxCodeId: standardCode.id,
            ratePpm: 150000,
            effectiveFrom: '2026-01-01',
            effectiveTo: '2026-06-30'
          },
          SYSTEM_ACTOR
        )
      )

      expect(() =>
        db.transaction((tx) =>
          updateTaxRateVersion(tx, version.id, { ratePpm: 175000 }, SYSTEM_ACTOR)
        )
      ).not.toThrow()
    })

    it('updating a version into overlap with a different version is still rejected', () => {
      db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          {
            taxCodeId: standardCode.id,
            ratePpm: 150000,
            effectiveFrom: '2026-01-01',
            effectiveTo: '2026-06-30'
          },
          SYSTEM_ACTOR
        )
      )
      const second = db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          {
            taxCodeId: standardCode.id,
            ratePpm: 160000,
            effectiveFrom: '2026-07-01'
          },
          SYSTEM_ACTOR
        )
      )

      expect(() =>
        db.transaction((tx) =>
          updateTaxRateVersion(tx, second.id, { effectiveFrom: '2026-06-30' }, SYSTEM_ACTOR)
        )
      ).toThrow(TaxRateOverlapError)
    })
  })

  describe('transaction atomicity', () => {
    it('a rejected overlap leaves no new row behind (rollback)', () => {
      db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          {
            taxCodeId: standardCode.id,
            ratePpm: 150000,
            effectiveFrom: '2026-01-01',
            effectiveTo: '2026-06-30'
          },
          SYSTEM_ACTOR
        )
      )

      expect(() =>
        db.transaction((tx) => {
          createTaxRateVersion(
            tx,
            {
              taxCodeId: standardCode.id,
              ratePpm: 999999,
              effectiveFrom: '2026-03-01',
              effectiveTo: '2026-04-01'
            },
            SYSTEM_ACTOR
          )
        })
      ).toThrow(TaxRateOverlapError)

      const versions = db.transaction((tx) => listTaxRateVersions(tx, standardCode.id))
      expect(versions).toHaveLength(1)
    })

    it('a caller transaction that throws after a successful creation rolls the creation back too', () => {
      expect(() =>
        db.transaction((tx) => {
          createTaxRateVersion(
            tx,
            {
              taxCodeId: standardCode.id,
              ratePpm: 150000,
              effectiveFrom: '2026-01-01'
            },
            SYSTEM_ACTOR
          )
          throw new Error('simulated failure elsewhere in the caller transaction')
        })
      ).toThrow('simulated failure elsewhere in the caller transaction')

      const versions = db.transaction((tx) => listTaxRateVersions(tx, standardCode.id))
      expect(versions).toHaveLength(0)
    })

    it('a successful transaction persists the created version', () => {
      db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          {
            taxCodeId: standardCode.id,
            ratePpm: 150000,
            effectiveFrom: '2026-01-01'
          },
          SYSTEM_ACTOR
        )
      )
      const versions = db.transaction((tx) => listTaxRateVersions(tx, standardCode.id))
      expect(versions).toHaveLength(1)
    })
  })

  it('rejects creating a version for a nonexistent tax code', () => {
    expect(() =>
      db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          {
            taxCodeId: 'tax_code_does_not_exist',
            ratePpm: 150000,
            effectiveFrom: '2026-01-01'
          },
          SYSTEM_ACTOR
        )
      )
    ).toThrow(TaxRateVersionError)
  })

  describe('canonical zero-category rate storage (null is canonical for zero_rated/exempt)', () => {
    it('creation rejects a supplied non-zero rate for zero_rated', () => {
      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: zeroRatedCode.id,
              ratePpm: 50000,
              effectiveFrom: '2026-01-01'
            },
            SYSTEM_ACTOR
          )
        )
      ).toThrow(TaxValidationError)
    })

    it('creation rejects a supplied non-zero rate for exempt', () => {
      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: exemptCode.id,
              ratePpm: 1,
              effectiveFrom: '2026-01-01'
            },
            SYSTEM_ACTOR
          )
        )
      ).toThrow(TaxValidationError)
    })

    it('creation normalizes an explicitly supplied 0 to the canonical null for zero_rated', () => {
      const version = db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          {
            taxCodeId: zeroRatedCode.id,
            ratePpm: 0,
            effectiveFrom: '2026-01-01'
          },
          SYSTEM_ACTOR
        )
      )
      expect(version.ratePpm).toBeNull()
    })

    it('update rejects a supplied non-zero rate for zero_rated', () => {
      const version = db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          { taxCodeId: zeroRatedCode.id, effectiveFrom: '2026-01-01' },
          SYSTEM_ACTOR
        )
      )
      expect(() =>
        db.transaction((tx) =>
          updateTaxRateVersion(tx, version.id, { ratePpm: 25000 }, SYSTEM_ACTOR)
        )
      ).toThrow(TaxValidationError)
    })

    it('update normalizes an explicitly supplied 0 to the canonical null for exempt', () => {
      const version = db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          { taxCodeId: exemptCode.id, effectiveFrom: '2026-01-01' },
          SYSTEM_ACTOR
        )
      )
      const updated = db.transaction((tx) =>
        updateTaxRateVersion(tx, version.id, { ratePpm: 0 }, SYSTEM_ACTOR)
      )
      expect(updated.ratePpm).toBeNull()
    })

    it('standard/other cannot be left null through creation', () => {
      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            {
              taxCodeId: standardCode.id,
              ratePpm: null,
              effectiveFrom: '2026-01-01'
            },
            SYSTEM_ACTOR
          )
        )
      ).toThrow(TaxValidationError)
    })

    it('an update that never touches ratePpm still revalidates the final value against category, catching pre-existing corruption', () => {
      // Bypass the service to construct a standard-category version that
      // is already corrupted (null rate_ppm) — the only way to reach
      // this state, since the service itself now refuses to create or
      // update into it. Confirms updateTaxRateVersion's revalidation
      // (see the fix's doc comment) catches this even when the update
      // input never mentions ratePpm at all.
      const now = new Date()
      rawDb
        .prepare(
          'INSERT INTO tax_rate_versions (id, tax_code_id, rate_ppm, effective_from, effective_to, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)'
        )
        .run(
          'corrupt_null_rate_version',
          standardCode.id,
          '2026-01-01',
          null,
          now.getTime(),
          now.getTime()
        )

      expect(() =>
        db.transaction((tx) =>
          updateTaxRateVersion(
            tx,
            'corrupt_null_rate_version',
            { effectiveTo: '2026-12-31' },
            SYSTEM_ACTOR
          )
        )
      ).toThrow(TaxValidationError)
    })
  })

  describe('Slice 10: every mutation produces exactly one matching audit row', () => {
    function auditRowsFor(entityId: string): { action: string; changedFields: string | null }[] {
      return rawDb
        .prepare(
          'SELECT action, changed_fields as changedFields FROM audit_log_entries WHERE entity_id = ? ORDER BY rowid'
        )
        .all(entityId) as { action: string; changedFields: string | null }[]
    }

    it('createTaxRateVersion produces exactly one create row with null->value fields', () => {
      const created = db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          { taxCodeId: standardCode.id, ratePpm: 150000, effectiveFrom: '2026-01-01' },
          SYSTEM_ACTOR
        )
      )

      const rows = auditRowsFor(created.id)
      expect(rows).toHaveLength(1)
      expect(rows[0].action).toBe('create')
      const changed = JSON.parse(rows[0].changedFields as string)
      expect(changed.ratePpm).toEqual({ old: null, new: 150000 })
      expect(changed.effectiveFrom).toEqual({ old: null, new: '2026-01-01' })
    })

    it('updateTaxRateVersion produces exactly one update row with only the changed field', () => {
      const created = db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          { taxCodeId: standardCode.id, ratePpm: 150000, effectiveFrom: '2026-01-01' },
          SYSTEM_ACTOR
        )
      )
      db.transaction((tx) =>
        updateTaxRateVersion(tx, created.id, { ratePpm: 180000 }, SYSTEM_ACTOR)
      )

      const rows = auditRowsFor(created.id)
      expect(rows).toHaveLength(2) // create + update
      const updateRow = rows.find((r) => r.action === 'update')
      const changed = JSON.parse(updateRow!.changedFields as string)
      expect(changed).toEqual({ ratePpm: { old: 150000, new: 180000 } })
    })

    it('a rejected overlapping creation produces zero audit rows', () => {
      db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          { taxCodeId: standardCode.id, ratePpm: 150000, effectiveFrom: '2026-01-01' },
          SYSTEM_ACTOR
        )
      )
      const beforeCount = rawDb.prepare('SELECT COUNT(*) as c FROM audit_log_entries').get() as {
        c: number
      }

      expect(() =>
        db.transaction((tx) =>
          createTaxRateVersion(
            tx,
            { taxCodeId: standardCode.id, ratePpm: 160000, effectiveFrom: '2026-06-01' },
            SYSTEM_ACTOR
          )
        )
      ).toThrow(TaxRateOverlapError)

      const afterCount = rawDb.prepare('SELECT COUNT(*) as c FROM audit_log_entries').get() as {
        c: number
      }
      expect(afterCount.c).toBe(beforeCount.c)
    })
  })
})
