import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import { createTaxCode, deactivateTaxCode, type TaxCode } from '../../../src/main/db/taxCodeService'
import { createTaxRateVersion } from '../../../src/main/db/taxRateVersionService'
import {
  resolveTaxRate,
  TaxResolutionAmbiguousError,
  TaxResolutionIntegrityError
} from '../../../src/main/db/taxRateResolutionService'
import { TaxValidationError } from '../../../src/main/db/validation/taxValidation'
import { taxRateVersions } from '../../../src/main/db/schema'
import type { AuditActor } from '../../../src/main/audit/auditService'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const SYSTEM_ACTOR: AuditActor = { type: 'system' }

describe('taxRateResolutionService.resolveTaxRate', () => {
  let dir: string
  let dbPath: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let standardCode: TaxCode
  let zeroRatedCode: TaxCode

  beforeEach(() => {
    dir = createTempDir('ledgerpage-tax-resolution')
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

    // Two historical rates: 15% through mid-2026, then 17.5% for the
    // rest of that year (left closed, not open-ended, so a genuinely
    // later, non-overlapping version can be added in the test below).
    db.transaction((tx) => {
      createTaxRateVersion(
        tx,
        {
          taxCodeId: standardCode.id,
          ratePpm: 150000,
          effectiveFrom: '2020-01-01',
          effectiveTo: '2026-06-30'
        },
        SYSTEM_ACTOR
      )
      createTaxRateVersion(
        tx,
        {
          taxCodeId: standardCode.id,
          ratePpm: 175000,
          effectiveFrom: '2026-07-01',
          effectiveTo: '2026-12-31'
        },
        SYSTEM_ACTOR
      )
    })
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  it('resolves the older rate for a past date', () => {
    const result = resolveTaxRate(db, { taxCodeId: standardCode.id }, '2026-03-15')
    expect(result?.ratePpm).toBe(150000)
    expect(result?.effectiveFrom).toBe('2020-01-01')
  })

  it('resolves the newer rate for a later date', () => {
    const result = resolveTaxRate(db, { taxCodeId: standardCode.id }, '2026-09-01')
    expect(result?.ratePpm).toBe(175000)
  })

  it('resolves correctly by normalized code as well as by id', () => {
    const result = resolveTaxRate(db, { code: 'STD' }, '2026-03-15')
    expect(result?.ratePpm).toBe(150000)
  })

  it('resolves the exact boundary date to the version that covers it (inclusive)', () => {
    const lastDayOfOld = resolveTaxRate(db, { taxCodeId: standardCode.id }, '2026-06-30')
    const firstDayOfNew = resolveTaxRate(db, { taxCodeId: standardCode.id }, '2026-07-01')
    expect(lastDayOfOld?.ratePpm).toBe(150000)
    expect(firstDayOfNew?.ratePpm).toBe(175000)
  })

  it('adding a newer rate version does not alter resolution for a past date already resolved', () => {
    const before = resolveTaxRate(db, { taxCodeId: standardCode.id }, '2026-03-15')

    db.transaction((tx) =>
      createTaxRateVersion(
        tx,
        {
          taxCodeId: standardCode.id,
          ratePpm: 200000,
          effectiveFrom: '2027-01-01'
        },
        SYSTEM_ACTOR
      )
    )

    const after = resolveTaxRate(db, { taxCodeId: standardCode.id }, '2026-03-15')
    expect(after).toEqual(before)
  })

  it('returns the documented not-found result (undefined) when no version covers the date', () => {
    const result = resolveTaxRate(db, { taxCodeId: standardCode.id }, '2019-01-01')
    expect(result).toBeUndefined()
  })

  it('returns undefined for an unknown tax code identity', () => {
    expect(resolveTaxRate(db, { taxCodeId: 'does_not_exist' }, '2026-01-01')).toBeUndefined()
    expect(resolveTaxRate(db, { code: 'NOPE' }, '2026-01-01')).toBeUndefined()
  })

  it('zero_rated resolves to ratePpm 0 once a version exists covering the date', () => {
    db.transaction((tx) =>
      createTaxRateVersion(
        tx,
        { taxCodeId: zeroRatedCode.id, effectiveFrom: '2026-01-01' },
        SYSTEM_ACTOR
      )
    )
    const result = resolveTaxRate(db, { taxCodeId: zeroRatedCode.id }, '2026-05-01')
    expect(result?.ratePpm).toBe(0)
    expect(result?.category).toBe('zero_rated')
  })

  it('zero_rated with no covering version still returns not-found (undefined), not a synthetic zero', () => {
    const result = resolveTaxRate(db, { taxCodeId: zeroRatedCode.id }, '2026-05-01')
    expect(result).toBeUndefined()
  })

  it('treats two matching versions as a data-integrity error rather than picking one', () => {
    // Bypass the service's own overlap prevention to simulate corrupted
    // data — this is deliberately using the schema directly, the only
    // way to construct the scenario this test needs to exercise.
    const now = new Date()
    rawDb
      .prepare(
        'INSERT INTO tax_rate_versions (id, tax_code_id, rate_ppm, effective_from, effective_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        'corrupt_overlap_version',
        standardCode.id,
        999999,
        '2026-01-01',
        '2026-12-31',
        now.getTime(),
        now.getTime()
      )

    expect(() => resolveTaxRate(db, { taxCodeId: standardCode.id }, '2026-03-15')).toThrow(
      TaxResolutionAmbiguousError
    )
  })

  it('resolution is unaffected by the machine local timezone (string comparison only, no Date construction)', () => {
    // Both boundary dates resolve identically regardless of what
    // process.env.TZ happens to be — proven indirectly by using dates
    // that would shift to a different calendar day under a naive
    // Date-based comparison crossing UTC midnight, and confirming the
    // resolved rate still matches the exact stored boundary.
    const originalTz = process.env.TZ
    process.env.TZ = 'Pacific/Kiritimati' // UTC+14, deliberately extreme
    try {
      const result = resolveTaxRate(db, { taxCodeId: standardCode.id }, '2026-06-30')
      expect(result?.ratePpm).toBe(150000)
    } finally {
      process.env.TZ = originalTz
    }
  })

  it('resolves correctly for a deactivated tax code — deactivation does not affect historical resolution', () => {
    deactivateTaxCode(db, standardCode.id, SYSTEM_ACTOR)
    const result = resolveTaxRate(db, { taxCodeId: standardCode.id }, '2026-03-15')
    expect(result?.ratePpm).toBe(150000)
  })

  it('is read-only: resolving does not modify any tax_rate_versions row', () => {
    const beforeRows = db.select().from(taxRateVersions).all()

    resolveTaxRate(db, { taxCodeId: standardCode.id }, '2026-03-15')
    resolveTaxRate(db, { taxCodeId: standardCode.id }, '2026-09-01')

    const afterRows = db.select().from(taxRateVersions).all()
    expect(afterRows).toEqual(beforeRows)
  })

  describe('rate-bearing categories never fall back to zero (corruption is surfaced, not hidden)', () => {
    it('throws TaxResolutionIntegrityError when a standard/other version has a null rate_ppm', () => {
      // Bypass the service's own category/rate validation to simulate
      // corrupted data directly — the only way to construct a standard
      // category version with a null rate_ppm, since
      // taxRateVersionService now refuses to ever create or update one
      // into that state.
      const otherCode = createTaxCode(
        db,
        { code: 'OTH', name: 'Other', category: 'other' },
        SYSTEM_ACTOR
      )
      const now = new Date()
      rawDb
        .prepare(
          'INSERT INTO tax_rate_versions (id, tax_code_id, rate_ppm, effective_from, effective_to, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)'
        )
        .run(
          'corrupt_null_rate_version',
          otherCode.id,
          '2026-01-01',
          null,
          now.getTime(),
          now.getTime()
        )

      expect(() => resolveTaxRate(db, { taxCodeId: otherCode.id }, '2026-03-15')).toThrow(
        TaxResolutionIntegrityError
      )
    })

    it('does not throw for zero_rated/exempt even though their rate_ppm is legitimately null', () => {
      expect(() => resolveTaxRate(db, { taxCodeId: zeroRatedCode.id }, '2020-01-01')).not.toThrow()
    })
  })

  describe('code-based resolution: normalization and company scoping', () => {
    it('resolves identically regardless of input casing and surrounding whitespace', () => {
      const exact = resolveTaxRate(db, { code: 'STD' }, '2026-03-15')
      const lower = resolveTaxRate(db, { code: 'std' }, '2026-03-15')
      const padded = resolveTaxRate(db, { code: '  STD  ' }, '2026-03-15')
      const mixedPadded = resolveTaxRate(db, { code: ' Std ' }, '2026-03-15')

      expect(lower).toEqual(exact)
      expect(padded).toEqual(exact)
      expect(mixedPadded).toEqual(exact)
      expect(exact?.ratePpm).toBe(150000)
    })

    it('rejects whitespace-only code input with the existing normalization validation error', () => {
      expect(() => resolveTaxRate(db, { code: '   ' }, '2026-03-15')).toThrow(TaxValidationError)
    })
  })
})
