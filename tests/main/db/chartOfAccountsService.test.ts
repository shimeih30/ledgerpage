import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import {
  createAccount,
  deactivateAccount,
  ensureStarterChartOfAccounts,
  getAccountById,
  listAccounts,
  reactivateAccount,
  requireActiveAccountForPosting,
  updateAccount,
  ChartOfAccountsServiceError,
  type UpdateAccountInput
} from '../../../src/main/db/chartOfAccountsService'
import * as chartOfAccountsService from '../../../src/main/db/chartOfAccountsService'
import { AccountValidationError } from '../../../src/main/db/validation/accountValidation'
import { STARTER_ACCOUNT_DEFINITIONS } from '../../../src/main/db/starterAccounts'
import { journalEntries, journalEntryLines } from '../../../src/main/db/schema'
import type { AuditActor } from '../../../src/main/audit/auditService'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const SYSTEM_ACTOR: AuditActor = { type: 'system' }

describe('chartOfAccountsService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    dir = createTempDir('ledgerpage-chart-of-accounts-service')
    rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    db = drizzle<Record<string, never>>(rawDb)
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  function createFixtureCompany(): void {
    createCompany(db, {
      name: 'Fixture Co',
      address: 'Addr',
      contactDetails: 'contact@example.com',
      currencyId: 'currency_usd'
    })
  }

  function rawAuditRowsFor(entityId: string): { action: string; entityType: string }[] {
    return rawDb
      .prepare(
        'SELECT action, entity_type as entityType FROM audit_log_entries WHERE entity_id = ?'
      )
      .all(entityId) as { action: string; entityType: string }[]
  }

  describe('ensureStarterChartOfAccounts', () => {
    it('inserts exactly 13 approved accounts with the exact code/name/category/subtype values', () => {
      createFixtureCompany()
      ensureStarterChartOfAccounts(db, SYSTEM_ACTOR)

      const accounts = listAccounts(db)
      expect(accounts).toHaveLength(13)

      for (const definition of STARTER_ACCOUNT_DEFINITIONS) {
        const match = accounts.find((a) => a.code === definition.code)
        expect(match).toBeDefined()
        expect(match?.name).toBe(definition.name)
        expect(match?.category).toBe(definition.category)
        expect(match?.subtype).toBe(definition.subtype)
      }
    })

    it('all starter accounts start active', () => {
      createFixtureCompany()
      ensureStarterChartOfAccounts(db, SYSTEM_ACTOR)

      const accounts = listAccounts(db)
      expect(accounts.every((a) => a.isActive)).toBe(true)
    })

    it('creates zero journal entries and zero journal lines', () => {
      createFixtureCompany()
      ensureStarterChartOfAccounts(db, SYSTEM_ACTOR)

      expect(db.select().from(journalEntries).all()).toHaveLength(0)
      expect(db.select().from(journalEntryLines).all()).toHaveLength(0)
    })

    it('writes exactly one audit row per inserted account', () => {
      createFixtureCompany()
      ensureStarterChartOfAccounts(db, SYSTEM_ACTOR)

      const accounts = listAccounts(db)
      for (const account of accounts) {
        expect(rawAuditRowsFor(account.id)).toEqual([{ action: 'create', entityType: 'account' }])
      }
    })

    it('a second call is fully idempotent: inserts nothing, changes nothing, adds no audit rows', () => {
      createFixtureCompany()
      ensureStarterChartOfAccounts(db, SYSTEM_ACTOR)
      const accountsAfterFirst = listAccounts(db)
      const totalAuditRowsAfterFirst = (
        rawDb.prepare('SELECT COUNT(*) as count FROM audit_log_entries').get() as {
          count: number
        }
      ).count

      ensureStarterChartOfAccounts(db, SYSTEM_ACTOR)
      const accountsAfterSecond = listAccounts(db)
      const totalAuditRowsAfterSecond = (
        rawDb.prepare('SELECT COUNT(*) as count FROM audit_log_entries').get() as {
          count: number
        }
      ).count

      expect(accountsAfterSecond).toHaveLength(13)
      expect(accountsAfterSecond.map((a) => a.id).sort()).toEqual(
        accountsAfterFirst.map((a) => a.id).sort()
      )
      expect(totalAuditRowsAfterSecond).toBe(totalAuditRowsAfterFirst)
    })

    it('preserves a pre-existing account with a starter code instead of overwriting it', () => {
      createFixtureCompany()
      const customAccount = createAccount(
        db,
        { code: '1000', name: 'My Custom Cash Account', category: 'asset' },
        SYSTEM_ACTOR
      )

      ensureStarterChartOfAccounts(db, SYSTEM_ACTOR)

      const afterSeed = getAccountById(db, customAccount.id)
      expect(afterSeed?.name).toBe('My Custom Cash Account')
      expect(listAccounts(db).filter((a) => a.code === '1000')).toHaveLength(1)
    })

    it('fills only the missing starter codes when some already exist', () => {
      createFixtureCompany()
      createAccount(db, { code: '1000', name: 'Existing Cash', category: 'asset' }, SYSTEM_ACTOR)

      ensureStarterChartOfAccounts(db, SYSTEM_ACTOR)

      const accounts = listAccounts(db)
      expect(accounts).toHaveLength(13)
      const cashAccount = accounts.find((a) => a.code === '1000')
      expect(cashAccount?.name).toBe('Existing Cash')
    })

    it('fails safely before company setup', () => {
      expect(() => ensureStarterChartOfAccounts(db, SYSTEM_ACTOR)).toThrow(
        ChartOfAccountsServiceError
      )
    })
  })

  describe('createAccount', () => {
    beforeEach(() => {
      createFixtureCompany()
    })

    it('creates a valid account', () => {
      const account = createAccount(
        db,
        { code: '7000', name: 'Test Account', category: 'expense' },
        SYSTEM_ACTOR
      )
      expect(account.code).toBe('7000')
      expect(account.name).toBe('Test Account')
      expect(account.category).toBe('expense')
      expect(account.isActive).toBe(true)
    })

    it('trims the code', () => {
      const account = createAccount(
        db,
        { code: '  7000  ', name: 'Test Account', category: 'expense' },
        SYSTEM_ACTOR
      )
      expect(account.code).toBe('7000')
    })

    it('trims the name', () => {
      const account = createAccount(
        db,
        { code: '7000', name: '  Test Account  ', category: 'expense' },
        SYSTEM_ACTOR
      )
      expect(account.name).toBe('Test Account')
    })

    it('normalizes a blank subtype to null', () => {
      const account = createAccount(
        db,
        { code: '7000', name: 'Test Account', category: 'expense', subtype: '   ' },
        SYSTEM_ACTOR
      )
      expect(account.subtype).toBeNull()
    })

    it('rejects a duplicate code', () => {
      createAccount(db, { code: '7000', name: 'First', category: 'expense' }, SYSTEM_ACTOR)
      expect(() =>
        createAccount(db, { code: '7000', name: 'Second', category: 'expense' }, SYSTEM_ACTOR)
      ).toThrow(ChartOfAccountsServiceError)
    })

    describe('invalid codes are rejected', () => {
      it.each([
        ['fewer than 4 digits', '123'],
        ['more than 10 digits', '12345678901'],
        ['letters', '70AB'],
        ['spaces', '70 00'],
        ['a plus sign', '+7000'],
        ['a minus sign', '-7000'],
        ['a decimal point', '70.00']
      ])('%s', (_label, code) => {
        expect(() =>
          createAccount(db, { code, name: 'Test', category: 'expense' }, SYSTEM_ACTOR)
        ).toThrow(AccountValidationError)
      })
    })

    it('rejects an invalid category', () => {
      expect(() =>
        createAccount(db, { code: '7000', name: 'Test', category: 'bogus' }, SYSTEM_ACTOR)
      ).toThrow(AccountValidationError)
    })

    describe('normal balance is derived correctly', () => {
      it.each([
        ['asset', 'debit'],
        ['cost_of_goods_sold', 'debit'],
        ['expense', 'debit'],
        ['liability', 'credit'],
        ['equity', 'credit'],
        ['revenue', 'credit']
      ])('%s -> %s', (category, expectedNormalBalance) => {
        const account = createAccount(
          db,
          { code: `${7000 + Math.floor(Math.random() * 900)}`, name: 'Test', category },
          SYSTEM_ACTOR
        )
        expect(account.normalBalance).toBe(expectedNormalBalance)
      })
    })

    it('writes exactly one audit row', () => {
      const account = createAccount(
        db,
        { code: '7000', name: 'Test Account', category: 'expense' },
        SYSTEM_ACTOR
      )
      expect(rawAuditRowsFor(account.id)).toEqual([{ action: 'create', entityType: 'account' }])
    })
  })

  describe('updateAccount', () => {
    beforeEach(() => {
      createFixtureCompany()
    })

    it('updates the name', () => {
      const account = createAccount(
        db,
        { code: '7000', name: 'Old Name', category: 'expense' },
        SYSTEM_ACTOR
      )
      const updated = updateAccount(db, account.id, { name: 'New Name' }, SYSTEM_ACTOR)
      expect(updated.name).toBe('New Name')
    })

    it('updates the subtype', () => {
      const account = createAccount(
        db,
        { code: '7000', name: 'Test', category: 'expense', subtype: 'old_subtype' },
        SYSTEM_ACTOR
      )
      const updated = updateAccount(db, account.id, { subtype: 'new_subtype' }, SYSTEM_ACTOR)
      expect(updated.subtype).toBe('new_subtype')
    })

    it('clears the subtype to null', () => {
      const account = createAccount(
        db,
        { code: '7000', name: 'Test', category: 'expense', subtype: 'old_subtype' },
        SYSTEM_ACTOR
      )
      const updated = updateAccount(db, account.id, { subtype: null }, SYSTEM_ACTOR)
      expect(updated.subtype).toBeNull()
    })

    it('a no-op update writes no audit row', () => {
      const account = createAccount(
        db,
        { code: '7000', name: 'Test', category: 'expense' },
        SYSTEM_ACTOR
      )
      updateAccount(db, account.id, { name: 'Test' }, SYSTEM_ACTOR)
      expect(rawAuditRowsFor(account.id)).toEqual([{ action: 'create', entityType: 'account' }])
    })

    it('UpdateAccountInput structurally has no code or category field', () => {
      const input: UpdateAccountInput = { name: 'X' }
      // @ts-expect-error -- code is not a valid key of UpdateAccountInput
      expect(input.code).toBeUndefined()
      // @ts-expect-error -- category is not a valid key of UpdateAccountInput
      expect(input.category).toBeUndefined()
    })

    it('an injected code/category via an unsafe cast has no runtime effect', () => {
      const account = createAccount(
        db,
        { code: '7000', name: 'Test', category: 'expense' },
        SYSTEM_ACTOR
      )
      const unsafeInput = {
        name: 'Renamed',
        code: '9999',
        category: 'asset'
      } as UpdateAccountInput
      const updated = updateAccount(db, account.id, unsafeInput, SYSTEM_ACTOR)
      expect(updated.code).toBe('7000')
      expect(updated.category).toBe('expense')
      expect(updated.name).toBe('Renamed')
    })
  })

  describe('lifecycle', () => {
    beforeEach(() => {
      createFixtureCompany()
    })

    it('deactivates an account', () => {
      const account = createAccount(
        db,
        { code: '7000', name: 'Test', category: 'expense' },
        SYSTEM_ACTOR
      )
      const deactivated = deactivateAccount(db, account.id, SYSTEM_ACTOR)
      expect(deactivated.isActive).toBe(false)
    })

    it('repeated deactivate is a no-op (writes no additional audit row)', () => {
      const account = createAccount(
        db,
        { code: '7000', name: 'Test', category: 'expense' },
        SYSTEM_ACTOR
      )
      deactivateAccount(db, account.id, SYSTEM_ACTOR)
      deactivateAccount(db, account.id, SYSTEM_ACTOR)
      expect(rawAuditRowsFor(account.id)).toEqual([
        { action: 'create', entityType: 'account' },
        { action: 'deactivate', entityType: 'account' }
      ])
    })

    it('reactivates an account', () => {
      const account = createAccount(
        db,
        { code: '7000', name: 'Test', category: 'expense' },
        SYSTEM_ACTOR
      )
      deactivateAccount(db, account.id, SYSTEM_ACTOR)
      const reactivated = reactivateAccount(db, account.id, SYSTEM_ACTOR)
      expect(reactivated.isActive).toBe(true)
    })

    it('repeated reactivate is a no-op (writes no additional audit row)', () => {
      const account = createAccount(
        db,
        { code: '7000', name: 'Test', category: 'expense' },
        SYSTEM_ACTOR
      )
      deactivateAccount(db, account.id, SYSTEM_ACTOR)
      reactivateAccount(db, account.id, SYSTEM_ACTOR)
      reactivateAccount(db, account.id, SYSTEM_ACTOR)
      expect(rawAuditRowsFor(account.id)).toEqual([
        { action: 'create', entityType: 'account' },
        { action: 'deactivate', entityType: 'account' },
        { action: 'reactivate', entityType: 'account' }
      ])
    })

    it('an inactive account remains returned by get/list', () => {
      const account = createAccount(
        db,
        { code: '7000', name: 'Test', category: 'expense' },
        SYSTEM_ACTOR
      )
      deactivateAccount(db, account.id, SYSTEM_ACTOR)

      expect(getAccountById(db, account.id)).toBeDefined()
      expect(listAccounts(db).some((a) => a.id === account.id)).toBe(true)
    })

    it('requireActiveAccountForPosting rejects an inactive account', () => {
      const account = createAccount(
        db,
        { code: '7000', name: 'Test', category: 'expense' },
        SYSTEM_ACTOR
      )
      deactivateAccount(db, account.id, SYSTEM_ACTOR)
      expect(() => requireActiveAccountForPosting(db, account.id)).toThrow(
        ChartOfAccountsServiceError
      )
    })

    it('requireActiveAccountForPosting accepts an active account', () => {
      const account = createAccount(
        db,
        { code: '7000', name: 'Test', category: 'expense' },
        SYSTEM_ACTOR
      )
      expect(() => requireActiveAccountForPosting(db, account.id)).not.toThrow()
    })

    it('no delete/remove function is exported', () => {
      const exportedNames = Object.keys(chartOfAccountsService)
      for (const name of exportedNames) {
        expect(name.toLowerCase()).not.toContain('delete')
        expect(name.toLowerCase()).not.toContain('remove')
      }
    })
  })

  describe('direct SQL constraints', () => {
    beforeEach(() => {
      createFixtureCompany()
    })

    function insertRawAccount(overrides: Record<string, string | number> = {}): void {
      const now = Date.now()
      const fields = {
        id: `account_${Math.random()}`,
        company_id: 'primary_company',
        code: `${7000 + Math.floor(Math.random() * 900)}`,
        name: 'Raw Account',
        category: 'asset',
        is_active: 1,
        created_at: now,
        updated_at: now,
        ...overrides
      }
      const columns = Object.keys(fields).join(', ')
      const placeholders = Object.keys(fields)
        .map(() => '?')
        .join(', ')
      rawDb
        .prepare(`INSERT INTO accounts (${columns}) VALUES (${placeholders})`)
        .run(...Object.values(fields))
    }

    it('rejects a duplicate (company_id, code) pair', () => {
      insertRawAccount({ code: '7000' })
      expect(() => insertRawAccount({ code: '7000' })).toThrow(/UNIQUE constraint failed/)
    })

    it('rejects an invalid account code', () => {
      expect(() => insertRawAccount({ code: '12' })).toThrow(/CHECK constraint failed/)
    })

    it('rejects an invalid category', () => {
      expect(() => insertRawAccount({ category: 'bogus' })).toThrow(/CHECK constraint failed/)
    })

    it('rejects a non-primary company id', () => {
      expect(() => insertRawAccount({ company_id: 'someone_else' })).toThrow(
        /CHECK constraint failed/
      )
    })
  })
})
