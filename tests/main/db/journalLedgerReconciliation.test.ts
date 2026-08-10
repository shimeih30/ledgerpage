import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { seedRoles } from '../../../src/main/db/seedRoles'
import { createCompany } from '../../../src/main/db/companyService'
import { ensureStarterChartOfAccounts } from '../../../src/main/db/chartOfAccountsService'
import { createJournalEntry, reverseJournalEntry } from '../../../src/main/db/journalEntryService'
import { getTrialBalance } from '../../../src/main/db/trialBalanceService'
import { userRoles } from '../../../src/main/db/schema'
import { createUser } from '../../../src/main/auth/userService'
import { hashPassword } from '../../../src/main/auth/passwordHashing'
import type { AuditActor } from '../../../src/main/audit/auditService'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const SYSTEM_ACTOR: AuditActor = { type: 'system' }
const REAL_PASSWORD = 'a-strong-password-1'

interface RawJournalRow {
  id: string
  entryNumber: string
  reversedEntryId: string | null
}

interface RawLineRow {
  id: string
  journalEntryId: string
  accountId: string
  debitMinor: number
  creditMinor: number
  description: string | null
  lineOrder: number
}

/**
 * This entire file deliberately never trusts journalEntryService's or
 * trialBalanceService's own return values as the source of truth for
 * any reconciliation calculation — every invariant here is proven by
 * querying journal_entries/journal_entry_lines directly via raw SQL
 * and reconstructing from first principles, mirroring
 * stockLedgerReconciliation.test.ts's own exact posture from Slice 15.
 */
describe('journal ledger reconciliation (independent of journalEntryService/trialBalanceService)', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let userActor: AuditActor
  let cashAccountId: string
  let revenueAccountId: string

  beforeEach(async () => {
    dir = createTempDir('ledgerpage-journal-ledger-reconciliation')
    rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    seedRoles(rawDb)
    db = drizzle<Record<string, never>>(rawDb)
    createCompany(db, {
      name: 'Fixture Co',
      address: 'Addr',
      contactDetails: 'contact@example.com',
      currencyId: 'currency_usd'
    })
    const now = Date.now()
    rawDb
      .prepare(
        `INSERT INTO numbering_rules
           (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at)
           VALUES ('numbering_rule_journal_entry', 'primary_company', 'journal_entry', 'JE', 6, 'yearly', 0, NULL, ?, ?)`
      )
      .run(now, now)
    const passwordHash = await hashPassword(REAL_PASSWORD)
    const user = db.transaction((tx) =>
      createUser(tx, { loginIdentifier: 'ben', displayName: 'Ben', passwordHash })
    )
    db.insert(userRoles)
      .values({ userId: user.id, roleId: 'role_owner', createdAt: new Date() })
      .run()
    userActor = { type: 'user', userId: user.id }

    ensureStarterChartOfAccounts(db, SYSTEM_ACTOR)
    cashAccountId = accountIdByCode('1000')
    revenueAccountId = accountIdByCode('4000')
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  function accountIdByCode(code: string): string {
    const row = rawDb.prepare('SELECT id FROM accounts WHERE code = ?').get(code) as
      { id: string } | undefined
    if (!row) {
      throw new Error(`No account found with code ${code}`)
    }
    return row.id
  }

  function rawJournals(): RawJournalRow[] {
    return rawDb
      .prepare(
        'SELECT id, entry_number as entryNumber, reversed_entry_id as reversedEntryId FROM journal_entries'
      )
      .all() as RawJournalRow[]
  }

  function rawLinesFor(journalEntryId: string): RawLineRow[] {
    return rawDb
      .prepare(
        `SELECT id, journal_entry_id as journalEntryId, account_id as accountId,
                debit_minor as debitMinor, credit_minor as creditMinor,
                description, line_order as lineOrder
         FROM journal_entry_lines
         WHERE journal_entry_id = ?
         ORDER BY line_order ASC`
      )
      .all(journalEntryId) as RawLineRow[]
  }

  function allRawLines(): RawLineRow[] {
    return rawDb
      .prepare(
        `SELECT id, journal_entry_id as journalEntryId, account_id as accountId,
                debit_minor as debitMinor, credit_minor as creditMinor,
                description, line_order as lineOrder
         FROM journal_entry_lines`
      )
      .all() as RawLineRow[]
  }

  function createBalancedEntry(debitMinor: number, description = 'X') {
    return createJournalEntry(
      db,
      {
        entryDate: new Date(),
        description,
        lines: [
          { accountId: cashAccountId, debitMinor, creditMinor: 0 },
          { accountId: revenueAccountId, debitMinor: 0, creditMinor: debitMinor }
        ]
      },
      userActor
    )
  }

  describe('per-journal invariants', () => {
    it('every journal has at least two lines', () => {
      createBalancedEntry(1000)
      createBalancedEntry(2000)

      for (const journal of rawJournals()) {
        expect(rawLinesFor(journal.id).length).toBeGreaterThanOrEqual(2)
      }
    })

    it('each line has exactly one positive side', () => {
      createBalancedEntry(1500)

      for (const line of allRawLines()) {
        const debitPositive = line.debitMinor > 0
        const creditPositive = line.creditMinor > 0
        expect(debitPositive).not.toBe(creditPositive)
      }
    })

    it('every journal independently balances: SUM(debit) = SUM(credit)', () => {
      createBalancedEntry(1000)
      createBalancedEntry(2500)
      createJournalEntry(
        db,
        {
          entryDate: new Date(),
          description: 'Three-line',
          lines: [
            { accountId: cashAccountId, debitMinor: 300, creditMinor: 0 },
            { accountId: cashAccountId, debitMinor: 200, creditMinor: 0 },
            { accountId: revenueAccountId, debitMinor: 0, creditMinor: 500 }
          ]
        },
        userActor
      )

      for (const journal of rawJournals()) {
        const lines = rawLinesFor(journal.id)
        const totalDebit = lines.reduce((sum, l) => sum + l.debitMinor, 0)
        const totalCredit = lines.reduce((sum, l) => sum + l.creditMinor, 0)
        expect(totalDebit).toBe(totalCredit)
      }
    })

    it('every journal total is greater than zero', () => {
      createBalancedEntry(750)

      for (const journal of rawJournals()) {
        const lines = rawLinesFor(journal.id)
        const totalDebit = lines.reduce((sum, l) => sum + l.debitMinor, 0)
        expect(totalDebit).toBeGreaterThan(0)
      }
    })
  })

  describe('reversal invariants', () => {
    it('every reversal line exactly inverts the corresponding original line: same account, same lineOrder, swapped debit/credit, same description', () => {
      const original = createJournalEntry(
        db,
        {
          entryDate: new Date(),
          description: 'X',
          lines: [
            { accountId: cashAccountId, debitMinor: 500, creditMinor: 0, description: 'Cash' },
            { accountId: revenueAccountId, debitMinor: 0, creditMinor: 500, description: 'Rev' }
          ]
        },
        userActor
      )
      const reversal = reverseJournalEntry(db, original.id, 'Undo', userActor)

      const originalLines = rawLinesFor(original.id)
      const reversalLines = rawLinesFor(reversal.id)

      expect(originalLines).toHaveLength(reversalLines.length)
      for (let i = 0; i < originalLines.length; i++) {
        const originalLine = originalLines[i]
        const reversalLine = reversalLines[i]
        expect(reversalLine.accountId).toBe(originalLine.accountId)
        expect(reversalLine.lineOrder).toBe(originalLine.lineOrder)
        expect(reversalLine.debitMinor).toBe(originalLine.creditMinor)
        expect(reversalLine.creditMinor).toBe(originalLine.debitMinor)
        expect(reversalLine.description).toBe(originalLine.description)
      }
    })

    it('the original journal row remains completely unchanged after reversal', () => {
      const original = createBalancedEntry(1000)
      const originalRowBefore = rawDb
        .prepare('SELECT * FROM journal_entries WHERE id = ?')
        .get(original.id)
      const originalLinesBefore = rawLinesFor(original.id)

      reverseJournalEntry(db, original.id, 'Undo', userActor)

      const originalRowAfter = rawDb
        .prepare('SELECT * FROM journal_entries WHERE id = ?')
        .get(original.id)
      const originalLinesAfter = rawLinesFor(original.id)

      expect(originalRowAfter).toEqual(originalRowBefore)
      expect(originalLinesAfter).toEqual(originalLinesBefore)
    })

    it('one original journal has at most one reversal', () => {
      const original = createBalancedEntry(1000)
      reverseJournalEntry(db, original.id, 'First', userActor)

      const reversalsOfOriginal = rawJournals().filter((j) => j.reversedEntryId === original.id)
      expect(reversalsOfOriginal).toHaveLength(1)

      expect(() => reverseJournalEntry(db, original.id, 'Second', userActor)).toThrow()
      expect(rawJournals().filter((j) => j.reversedEntryId === original.id)).toHaveLength(1)
    })

    it('reversal journals cannot themselves be reversed', () => {
      const original = createBalancedEntry(1000)
      const reversal = reverseJournalEntry(db, original.id, 'Undo', userActor)

      expect(() => reverseJournalEntry(db, reversal.id, 'Undo the undo', userActor)).toThrow()

      const reversalsOfReversal = rawJournals().filter((j) => j.reversedEntryId === reversal.id)
      expect(reversalsOfReversal).toHaveLength(0)
    })
  })

  describe('ledger-wide invariants', () => {
    it('all ledger-wide debits equal all ledger-wide credits', () => {
      createBalancedEntry(1000)
      createBalancedEntry(2000)
      const toReverse = createBalancedEntry(3000)
      reverseJournalEntry(db, toReverse.id, 'Undo', userActor)

      const allLines = allRawLines()
      const totalDebit = allLines.reduce((sum, l) => sum + l.debitMinor, 0)
      const totalCredit = allLines.reduce((sum, l) => sum + l.creditMinor, 0)
      expect(totalDebit).toBe(totalCredit)
    })

    it('trial balance grand totals match independently reconstructed raw-SQL totals', () => {
      createBalancedEntry(1000)
      createBalancedEntry(2000)

      const allLines = allRawLines()
      const rawTotalDebit = allLines.reduce((sum, l) => sum + l.debitMinor, 0)
      const rawTotalCredit = allLines.reduce((sum, l) => sum + l.creditMinor, 0)

      const trialBalance = getTrialBalance(db)
      expect(trialBalance.grandTotalDebitMinor).toBe(rawTotalDebit)
      expect(trialBalance.grandTotalCreditMinor).toBe(rawTotalCredit)
    })

    it('per-account trial balance totals match independently reconstructed raw-SQL per-account sums', () => {
      createBalancedEntry(1500)
      createBalancedEntry(2500)

      const cashLines = allRawLines().filter((l) => l.accountId === cashAccountId)
      const rawCashDebit = cashLines.reduce((sum, l) => sum + l.debitMinor, 0)

      const trialBalance = getTrialBalance(db)
      const cashRow = trialBalance.accounts.find((a) => a.id === cashAccountId)
      expect(cashRow?.totalDebitMinor).toBe(rawCashDebit)
    })

    it('starter-account seeding creates no journal rows', () => {
      // ensureStarterChartOfAccounts already ran in beforeEach.
      expect(rawJournals()).toHaveLength(0)
      expect(allRawLines()).toHaveLength(0)
    })

    it('opening balances entered as an ordinary manual journal reconcile normally', () => {
      // Opening balances are not a special mechanism -- an ordinary
      // manual journal, exercised here exactly like any other entry,
      // reconciling via the same invariants as every other journal.
      const openingBalance = createJournalEntry(
        db,
        {
          entryDate: new Date('2026-01-01'),
          description: 'Opening balance: cash on hand',
          lines: [
            { accountId: cashAccountId, debitMinor: 100000, creditMinor: 0 },
            {
              accountId: accountIdByCode('3000'),
              debitMinor: 0,
              creditMinor: 100000
            }
          ]
        },
        userActor
      )

      const lines = rawLinesFor(openingBalance.id)
      const totalDebit = lines.reduce((sum, l) => sum + l.debitMinor, 0)
      const totalCredit = lines.reduce((sum, l) => sum + l.creditMinor, 0)
      expect(totalDebit).toBe(totalCredit)
      expect(totalDebit).toBe(100000)

      const trialBalance = getTrialBalance(db)
      expect(trialBalance.isBalanced).toBe(true)
    })
  })
})
