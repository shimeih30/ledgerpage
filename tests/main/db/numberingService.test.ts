import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import { allocateNext, NumberingError } from '../../../src/main/db/numberingService'
import { numberingRules, PRIMARY_COMPANY_ID } from '../../../src/main/db/schema'
import { numberingRuleId, type DocumentTypeKey } from '../../../src/main/db/numberingDefaults'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')

// Deliberately not "today" — proves the service uses the date it's given,
// not the real system clock, and keeps this test suite from silently
// breaking on a future New Year's Day.
const FIXTURE_DATE_2026 = new Date('2026-03-15T12:00:00.000Z')
const FIXTURE_DATE_2027 = new Date('2027-01-02T00:00:00.000Z')

describe('numberingService.allocateNext', () => {
  let dir: string
  let dbPath: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    dir = createTempDir('ledgerpage-numbering-service')
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
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  function insertFixtureRule(
    documentTypeKey: DocumentTypeKey,
    overrides: Partial<{
      prefix: string
      paddingLength: number
      resetBehavior: 'never' | 'yearly'
      currentSequenceValue: number
      currentSequenceYear: number | null
    }> = {}
  ): void {
    const now = new Date()
    db.insert(numberingRules)
      .values({
        id: numberingRuleId(documentTypeKey),
        companyId: PRIMARY_COMPANY_ID,
        documentTypeKey,
        prefix: overrides.prefix ?? 'SO',
        paddingLength: overrides.paddingLength ?? 6,
        resetBehavior: overrides.resetBehavior ?? 'yearly',
        currentSequenceValue: overrides.currentSequenceValue ?? 0,
        currentSequenceYear: overrides.currentSequenceYear ?? null,
        createdAt: now,
        updatedAt: now
      })
      .run()
  }

  function readRule(documentTypeKey: DocumentTypeKey) {
    return db
      .select()
      .from(numberingRules)
      .where(eq(numberingRules.documentTypeKey, documentTypeKey))
      .get()!
  }

  it('rejects an unsupported document type key', () => {
    expect(() =>
      db.transaction((tx) => allocateNext(tx, 'not_a_real_document_type', FIXTURE_DATE_2026))
    ).toThrow(NumberingError)
  })

  it('rejects allocation when no numbering rule exists for an otherwise-approved key', () => {
    // 'sales_order' is an approved key, but no fixture row was inserted.
    expect(() =>
      db.transaction((tx) => allocateNext(tx, 'sales_order', FIXTURE_DATE_2026))
    ).toThrow(NumberingError)
  })

  it('formats the first yearly allocation as PREFIX-YYYY-000001', () => {
    insertFixtureRule('sales_order', { prefix: 'SO', resetBehavior: 'yearly' })

    const result = db.transaction((tx) => allocateNext(tx, 'sales_order', FIXTURE_DATE_2026))

    expect(result).toBe('SO-2026-000001')
  })

  it('formats subsequent yearly allocations incrementing sequentially', () => {
    insertFixtureRule('sales_order', { prefix: 'SO', resetBehavior: 'yearly' })

    const first = db.transaction((tx) => allocateNext(tx, 'sales_order', FIXTURE_DATE_2026))
    const second = db.transaction((tx) => allocateNext(tx, 'sales_order', FIXTURE_DATE_2026))

    expect(first).toBe('SO-2026-000001')
    expect(second).toBe('SO-2026-000002')
  })

  it('resets a yearly sequence to 000001 when the supplied UTC year changes', () => {
    insertFixtureRule('sales_order', { prefix: 'SO', resetBehavior: 'yearly' })

    const inYearOne = db.transaction((tx) => allocateNext(tx, 'sales_order', FIXTURE_DATE_2026))
    const secondInYearOne = db.transaction((tx) =>
      allocateNext(tx, 'sales_order', FIXTURE_DATE_2026)
    )
    const inYearTwo = db.transaction((tx) => allocateNext(tx, 'sales_order', FIXTURE_DATE_2027))

    expect(inYearOne).toBe('SO-2026-000001')
    expect(secondInYearOne).toBe('SO-2026-000002')
    expect(inYearTwo).toBe('SO-2027-000001')
  })

  it('a never-reset sequence continues unbroken across a year boundary', () => {
    insertFixtureRule('customer', { prefix: 'CUS', resetBehavior: 'never' })

    const inYearOne = db.transaction((tx) => allocateNext(tx, 'customer', FIXTURE_DATE_2026))
    const inYearTwo = db.transaction((tx) => allocateNext(tx, 'customer', FIXTURE_DATE_2027))

    expect(inYearOne).toBe('CUS-000001')
    expect(inYearTwo).toBe('CUS-000002')
  })

  it('formats a never-reset number without a year segment', () => {
    insertFixtureRule('product', { prefix: 'PRD', resetBehavior: 'never' })
    const result = db.transaction((tx) => allocateNext(tx, 'product', FIXTURE_DATE_2026))
    expect(result).toBe('PRD-000001')
  })

  it('enforces six-digit padding', () => {
    insertFixtureRule('supplier', {
      prefix: 'SUP',
      resetBehavior: 'never',
      paddingLength: 6,
      currentSequenceValue: 41
    })
    const result = db.transaction((tx) => allocateNext(tx, 'supplier', FIXTURE_DATE_2026))
    expect(result).toBe('SUP-000042')
  })

  it('editing a prefix does not reset the sequence value', () => {
    insertFixtureRule('sales_order', {
      prefix: 'SO',
      resetBehavior: 'yearly',
      currentSequenceValue: 5,
      currentSequenceYear: 2026
    })

    // Simulate a settings-screen prefix edit (a later slice's concern) —
    // directly updating the prefix column, exactly as that future screen
    // would, without touching the sequence.
    db.update(numberingRules)
      .set({ prefix: 'SORD' })
      .where(eq(numberingRules.documentTypeKey, 'sales_order'))
      .run()

    const result = db.transaction((tx) => allocateNext(tx, 'sales_order', FIXTURE_DATE_2026))

    expect(result).toBe('SORD-2026-000006')
  })

  it('rolls back the allocation when the caller transaction throws after allocating', () => {
    insertFixtureRule('sales_order', { prefix: 'SO', resetBehavior: 'yearly' })

    expect(() =>
      db.transaction((tx) => {
        allocateNext(tx, 'sales_order', FIXTURE_DATE_2026)
        throw new Error('simulated failure elsewhere in the caller transaction')
      })
    ).toThrow('simulated failure elsewhere in the caller transaction')

    const rule = readRule('sales_order')
    expect(rule.currentSequenceValue).toBe(0)
    expect(rule.currentSequenceYear).toBeNull()
  })

  it('persists the increment once the caller transaction commits successfully', () => {
    insertFixtureRule('sales_order', { prefix: 'SO', resetBehavior: 'yearly' })

    db.transaction((tx) => allocateNext(tx, 'sales_order', FIXTURE_DATE_2026))

    const rule = readRule('sales_order')
    expect(rule.currentSequenceValue).toBe(1)
    expect(rule.currentSequenceYear).toBe(2026)
  })

  it('never commits independently of the caller transaction (rollback and commit are both proven above)', () => {
    // This is the combination of the two tests above, stated explicitly:
    // if allocation committed on its own, the rollback test would show a
    // persisted increment despite the throw. It doesn't. There is no
    // separate transaction inside allocateNext to diverge from the
    // caller's — verified by code review (no .transaction() call in
    // numberingService.ts) and by these two behavioral proofs together.
    insertFixtureRule('customer', { prefix: 'CUS', resetBehavior: 'never' })

    expect(() =>
      db.transaction((tx) => {
        allocateNext(tx, 'customer', FIXTURE_DATE_2026)
        throw new Error('rollback')
      })
    ).toThrow()
    expect(readRule('customer').currentSequenceValue).toBe(0)

    db.transaction((tx) => allocateNext(tx, 'customer', FIXTURE_DATE_2026))
    expect(readRule('customer').currentSequenceValue).toBe(1)
  })

  it('sequential allocations never produce a duplicate number, simulating competing writes', () => {
    // better-sqlite3 is synchronous with a single connection, and
    // LedgerPage holds at most one process against the database (the
    // Slice 3 single-instance lock) — so true concurrent writers cannot
    // exist within one running app. What can be proven directly is that
    // repeated allocation, including across separate transactions (the
    // realistic shape of "competing" calls from different operations in
    // this app), never repeats a value.
    insertFixtureRule('invoice', { prefix: 'INV', resetBehavior: 'yearly' })

    const results = new Set<string>()
    for (let i = 0; i < 20; i += 1) {
      const value = db.transaction((tx) => allocateNext(tx, 'invoice', FIXTURE_DATE_2026))
      expect(results.has(value)).toBe(false)
      results.add(value)
    }

    expect(results.size).toBe(20)
  })
})
