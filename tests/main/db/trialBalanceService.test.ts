import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { seedRoles } from '../../../src/main/db/seedRoles'
import { createCompany } from '../../../src/main/db/companyService'
import {
  deactivateAccount,
  ensureStarterChartOfAccounts
} from '../../../src/main/db/chartOfAccountsService'
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

describe('trialBalanceService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let userActor: AuditActor

  beforeEach(async () => {
    dir = createTempDir('ledgerpage-trial-balance-service')
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

  it('includes all 13 starter accounts', () => {
    const trialBalance = getTrialBalance(db)
    expect(trialBalance.accounts).toHaveLength(13)
  })

  it('includes inactive accounts', () => {
    const cashId = accountIdByCode('1000')
    deactivateAccount(db, cashId, SYSTEM_ACTOR)
    const trialBalance = getTrialBalance(db)
    const cashRow = trialBalance.accounts.find((a) => a.id === cashId)
    expect(cashRow).toBeDefined()
    expect(cashRow?.isActive).toBe(false)
  })

  it('includes zero-balance accounts', () => {
    const trialBalance = getTrialBalance(db)
    const undepositedFunds = trialBalance.accounts.find((a) => a.code === '1040')
    expect(undepositedFunds?.totalDebitMinor).toBe(0)
    expect(undepositedFunds?.totalCreditMinor).toBe(0)
  })

  describe('with no journals at all', () => {
    it('all account totals are zero, grand totals are zero, isBalanced is true', () => {
      const trialBalance = getTrialBalance(db)
      for (const account of trialBalance.accounts) {
        expect(account.totalDebitMinor).toBe(0)
        expect(account.totalCreditMinor).toBe(0)
        expect(account.closingDebitMinor).toBe(0)
        expect(account.closingCreditMinor).toBe(0)
      }
      expect(trialBalance.grandTotalDebitMinor).toBe(0)
      expect(trialBalance.grandTotalCreditMinor).toBe(0)
      expect(trialBalance.isBalanced).toBe(true)
    })
  })

  it('a balanced journal updates the correct accounts', () => {
    const cashId = accountIdByCode('1000')
    const revenueId = accountIdByCode('4000')
    createJournalEntry(
      db,
      {
        entryDate: new Date(),
        description: 'Cash sale',
        lines: [
          { accountId: cashId, debitMinor: 5000, creditMinor: 0 },
          { accountId: revenueId, debitMinor: 0, creditMinor: 5000 }
        ]
      },
      userActor
    )

    const trialBalance = getTrialBalance(db)
    const cashRow = trialBalance.accounts.find((a) => a.id === cashId)
    const revenueRow = trialBalance.accounts.find((a) => a.id === revenueId)
    expect(cashRow?.totalDebitMinor).toBe(5000)
    expect(cashRow?.closingDebitMinor).toBe(5000)
    expect(revenueRow?.totalCreditMinor).toBe(5000)
    expect(revenueRow?.closingCreditMinor).toBe(5000)
  })

  it('multiple journals aggregate correctly', () => {
    const cashId = accountIdByCode('1000')
    const revenueId = accountIdByCode('4000')
    for (const amount of [1000, 2000, 3000]) {
      createJournalEntry(
        db,
        {
          entryDate: new Date(),
          description: 'Cash sale',
          lines: [
            { accountId: cashId, debitMinor: amount, creditMinor: 0 },
            { accountId: revenueId, debitMinor: 0, creditMinor: amount }
          ]
        },
        userActor
      )
    }

    const trialBalance = getTrialBalance(db)
    const cashRow = trialBalance.accounts.find((a) => a.id === cashId)
    expect(cashRow?.totalDebitMinor).toBe(6000)
  })

  it('a reversal returns affected accounts to their prior balances', () => {
    const cashId = accountIdByCode('1000')
    const revenueId = accountIdByCode('4000')
    const entry = createJournalEntry(
      db,
      {
        entryDate: new Date(),
        description: 'Cash sale',
        lines: [
          { accountId: cashId, debitMinor: 5000, creditMinor: 0 },
          { accountId: revenueId, debitMinor: 0, creditMinor: 5000 }
        ]
      },
      userActor
    )
    reverseJournalEntry(db, entry.id, 'Undo', userActor)

    const trialBalance = getTrialBalance(db)
    const cashRow = trialBalance.accounts.find((a) => a.id === cashId)
    // Debit 5000 (original) + credit 5000 (reversal) => net closing zero,
    // but totalDebitMinor/totalCreditMinor both reflect the full
    // (now-netted) activity.
    expect(cashRow?.totalDebitMinor).toBe(5000)
    expect(cashRow?.totalCreditMinor).toBe(5000)
    expect(cashRow?.closingDebitMinor).toBe(0)
    expect(cashRow?.closingCreditMinor).toBe(0)
  })

  describe('normal balance by category', () => {
    it.each([
      ['1000', 'asset', 'debit'],
      ['5000', 'cost_of_goods_sold', 'debit'],
      ['6000', 'expense', 'debit'],
      ['2000', 'liability', 'credit'],
      ['3000', 'equity', 'credit'],
      ['4000', 'revenue', 'credit']
    ])('%s (%s) -> %s', (code, _category, expectedNormalBalance) => {
      const trialBalance = getTrialBalance(db)
      const row = trialBalance.accounts.find((a) => a.code === code)
      expect(row?.normalBalance).toBe(expectedNormalBalance)
    })
  })

  it('closingDebitMinor and closingCreditMinor are mutually exclusive for every account', () => {
    const cashId = accountIdByCode('1000')
    const revenueId = accountIdByCode('4000')
    createJournalEntry(
      db,
      {
        entryDate: new Date(),
        description: 'Cash sale',
        lines: [
          { accountId: cashId, debitMinor: 5000, creditMinor: 0 },
          { accountId: revenueId, debitMinor: 0, creditMinor: 5000 }
        ]
      },
      userActor
    )

    const trialBalance = getTrialBalance(db)
    for (const account of trialBalance.accounts) {
      const bothPositive = account.closingDebitMinor > 0 && account.closingCreditMinor > 0
      expect(bothPositive).toBe(false)
    }
  })

  it('grandTotalDebitMinor equals grandTotalCreditMinor', () => {
    const cashId = accountIdByCode('1000')
    const revenueId = accountIdByCode('4000')
    createJournalEntry(
      db,
      {
        entryDate: new Date(),
        description: 'Cash sale',
        lines: [
          { accountId: cashId, debitMinor: 7500, creditMinor: 0 },
          { accountId: revenueId, debitMinor: 0, creditMinor: 7500 }
        ]
      },
      userActor
    )
    const trialBalance = getTrialBalance(db)
    expect(trialBalance.grandTotalDebitMinor).toBe(trialBalance.grandTotalCreditMinor)
    expect(trialBalance.isBalanced).toBe(true)
  })

  it('ordering is deterministic by account code', () => {
    const trialBalance = getTrialBalance(db)
    const codes = trialBalance.accounts.map((a) => a.code)
    const sortedCodes = [...codes].sort()
    expect(codes).toEqual(sortedCodes)
  })

  it('totals are reconstructed directly from journal_entry_lines, not any cached field', () => {
    const cashId = accountIdByCode('1000')
    const revenueId = accountIdByCode('4000')
    createJournalEntry(
      db,
      {
        entryDate: new Date(),
        description: 'Cash sale',
        lines: [
          { accountId: cashId, debitMinor: 5000, creditMinor: 0 },
          { accountId: revenueId, debitMinor: 0, creditMinor: 5000 }
        ]
      },
      userActor
    )

    const rawSum = rawDb
      .prepare(
        'SELECT SUM(debit_minor) as totalDebit FROM journal_entry_lines WHERE account_id = ?'
      )
      .get(cashId) as { totalDebit: number }

    const trialBalance = getTrialBalance(db)
    const cashRow = trialBalance.accounts.find((a) => a.id === cashId)
    expect(cashRow?.totalDebitMinor).toBe(rawSum.totalDebit)
  })
})
