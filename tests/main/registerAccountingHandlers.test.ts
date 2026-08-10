import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseConnection } from '../../src/main/db/connection'
import { runMigrations } from '../../src/main/db/runMigrations'
import { seedReferenceData } from '../../src/main/db/seedReferenceData'
import { seedRoles } from '../../src/main/db/seedRoles'
import { createCompany } from '../../src/main/db/companyService'
import { ensureStarterChartOfAccounts } from '../../src/main/db/chartOfAccountsService'
import { createJournalEntry } from '../../src/main/db/journalEntryService'
import { createUser, deactivateUser } from '../../src/main/auth/userService'
import { hashPassword } from '../../src/main/auth/passwordHashing'
import { userRoles } from '../../src/main/db/schema'
import type { AppDb } from '../../src/main/db/dbTypes'
import type { LoginService } from '../../src/main/users/loginService'
import { createTempDir, removeTempDir } from '../helpers/tempDir'

const handle = vi.fn()

vi.mock('electron', () => ({
  ipcMain: { handle }
}))

const context = { productionEntryFileUrl: 'file:///app/out/renderer/index.html' }
const APPROVED_EVENT = { senderFrame: { url: 'file:///app/out/renderer/index.html' } }
const UNAPPROVED_EVENT = { senderFrame: { url: 'https://evil.example.com' } }

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const REAL_PASSWORD = 'a-strong-password-1'

const EXPECTED_CHANNELS = [
  'accounts:list',
  'accounts:get',
  'accounts:create',
  'accounts:update',
  'accounts:deactivate',
  'accounts:reactivate',
  'journal-entries:list',
  'journal-entries:get',
  'journal-entries:create',
  'journal-entries:reverse',
  'trial-balance:get'
]

type Handler = (event: unknown, input?: unknown) => unknown

describe('registerAccountingHandlers', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let cashAccountId: string
  let revenueAccountId: string

  beforeEach(() => {
    vi.resetModules()
    handle.mockClear()
    dir = createTempDir('ledgerpage-accounting-handlers')
    rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    seedRoles(rawDb)
    db = drizzle<Record<string, never>>(rawDb)
    createCompany(db, {
      name: 'Fixture Co',
      address: 'Addr',
      contactDetails: 'c@example.com',
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
    ensureStarterChartOfAccounts(db, { type: 'system' })
    cashAccountId = getAccountIdByCode('1000')
    revenueAccountId = getAccountIdByCode('4000')
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  function getAccountIdByCode(code: string): string {
    const row = rawDb.prepare('SELECT id FROM accounts WHERE code = ?').get(code) as
      { id: string } | undefined
    if (!row) {
      throw new Error(`No account found with code ${code}`)
    }
    return row.id
  }

  async function createUserWithRole(loginIdentifier: string, roleId: string): Promise<string> {
    const passwordHash = await hashPassword(REAL_PASSWORD)
    const user = db.transaction((tx) =>
      createUser(tx, { loginIdentifier, displayName: loginIdentifier, passwordHash })
    )
    db.insert(userRoles).values({ userId: user.id, roleId, createdAt: new Date() }).run()
    return user.id
  }

  async function registerAndCapture(loggedInAs: string | null): Promise<{
    handlers: Record<string, Handler>
    channels: string[]
    loginService: LoginService
  }> {
    const { registerAccountingHandlers } =
      await import('../../src/main/ipc/registerAccountingHandlers')
    const { createLoginService } = await import('../../src/main/users/loginService')
    const { createSessionManager } = await import('../../src/main/auth/sessionManager')
    const sessionManager = createSessionManager()
    const loginService = createLoginService({ sessionManager })

    if (loggedInAs) {
      await loginService.login(db, loggedInAs, REAL_PASSWORD)
    }

    registerAccountingHandlers({ context, db, loginService })

    const handlers: Record<string, Handler> = {}
    const channels: string[] = []
    for (const call of handle.mock.calls as [string, Handler][]) {
      handlers[call[0]] = call[1]
      channels.push(call[0])
    }
    return { handlers, channels, loginService }
  }

  function balancedLines(debitMinor = 5000) {
    return [
      { accountId: cashAccountId, debitMinor, creditMinor: 0 },
      { accountId: revenueAccountId, debitMinor: 0, creditMinor: debitMinor }
    ]
  }

  // ---------------------------------------------------------------
  // 1. Channel registration
  // ---------------------------------------------------------------
  describe('channel registration', () => {
    it('registers exactly the 11 approved accounting channels -- no extra channel', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { channels } = await registerAndCapture('owner')
      expect(channels.sort()).toEqual([...EXPECTED_CHANNELS].sort())
    })
  })

  // ---------------------------------------------------------------
  // Sender validation
  // ---------------------------------------------------------------
  describe('sender validation', () => {
    it('an approved renderer sender succeeds', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['accounts:list'](APPROVED_EVENT) as { success: boolean }
      expect(result.success).toBe(true)
    })

    it('rejects an unapproved sender on every channel', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      for (const channel of EXPECTED_CHANNELS) {
        expect(() => handlers[channel](UNAPPROVED_EVENT, {})).toThrow()
      }
    })
  })

  // ---------------------------------------------------------------
  // 2. Authorization matrix
  // ---------------------------------------------------------------
  describe('authorization matrix', () => {
    it('Owner: all account and journal reads/mutations allowed, trial balance allowed', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')

      expect((handlers['accounts:list'](APPROVED_EVENT) as { success: boolean }).success).toBe(true)
      const createResult = handlers['accounts:create'](APPROVED_EVENT, {
        code: '7000',
        name: 'Test',
        category: 'expense'
      }) as { success: boolean }
      expect(createResult.success).toBe(true)
      expect(
        (
          handlers['journal-entries:create'](APPROVED_EVENT, {
            entryDate: Date.now(),
            description: 'X',
            lines: balancedLines()
          }) as { success: boolean }
        ).success
      ).toBe(true)
      expect((handlers['trial-balance:get'](APPROVED_EVENT) as { success: boolean }).success).toBe(
        true
      )
    })

    it('Executive: reads allowed, all mutations rejected as not_authorized', async () => {
      await createUserWithRole('exec1', 'role_executive')
      const { handlers } = await registerAndCapture('exec1')

      expect((handlers['accounts:list'](APPROVED_EVENT) as { success: boolean }).success).toBe(true)
      expect(
        (handlers['journal-entries:list'](APPROVED_EVENT) as { success: boolean }).success
      ).toBe(true)
      expect((handlers['trial-balance:get'](APPROVED_EVENT) as { success: boolean }).success).toBe(
        true
      )

      expect(
        handlers['accounts:create'](APPROVED_EVENT, {
          code: '7000',
          name: 'Test',
          category: 'expense'
        })
      ).toEqual({ success: false, errorCode: 'not_authorized' })
      expect(handlers['accounts:update'](APPROVED_EVENT, { id: cashAccountId, name: 'X' })).toEqual(
        { success: false, errorCode: 'not_authorized' }
      )
      expect(handlers['accounts:deactivate'](APPROVED_EVENT, { id: cashAccountId })).toEqual({
        success: false,
        errorCode: 'not_authorized'
      })
      expect(handlers['accounts:reactivate'](APPROVED_EVENT, { id: cashAccountId })).toEqual({
        success: false,
        errorCode: 'not_authorized'
      })
      expect(
        handlers['journal-entries:create'](APPROVED_EVENT, {
          entryDate: Date.now(),
          description: 'X',
          lines: balancedLines()
        })
      ).toEqual({ success: false, errorCode: 'not_authorized' })
      expect(
        handlers['journal-entries:reverse'](APPROVED_EVENT, {
          journalEntryId: 'does-not-matter',
          reversalReason: 'X'
        })
      ).toEqual({ success: false, errorCode: 'not_authorized' })
    })

    it('Operations: every accounting call rejected as not_authorized', async () => {
      const ownerId = await createUserWithRole('owner', 'role_owner')
      const original = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        { type: 'user', userId: ownerId }
      )
      await createUserWithRole('ops1', 'role_operations')
      const { handlers } = await registerAndCapture('ops1')

      const validInputByChannel: Record<string, unknown> = {
        'accounts:list': undefined,
        'accounts:get': { id: cashAccountId },
        'accounts:create': { code: '8000', name: 'Test', category: 'expense' },
        'accounts:update': { id: cashAccountId, name: 'X' },
        'accounts:deactivate': { id: cashAccountId },
        'accounts:reactivate': { id: cashAccountId },
        'journal-entries:list': undefined,
        'journal-entries:get': { id: original.id },
        'journal-entries:create': {
          entryDate: Date.now(),
          description: 'X',
          lines: balancedLines()
        },
        'journal-entries:reverse': { journalEntryId: original.id, reversalReason: 'X' },
        'trial-balance:get': undefined
      }

      for (const channel of EXPECTED_CHANNELS) {
        const result = handlers[channel](APPROVED_EVENT, validInputByChannel[channel])
        expect(result).toEqual({ success: false, errorCode: 'not_authorized' })
      }
    })

    it('Finance: all account and journal reads/mutations allowed, trial balance allowed', async () => {
      await createUserWithRole('fin1', 'role_finance')
      const { handlers } = await registerAndCapture('fin1')

      expect((handlers['accounts:list'](APPROVED_EVENT) as { success: boolean }).success).toBe(true)
      const createResult = handlers['accounts:create'](APPROVED_EVENT, {
        code: '7000',
        name: 'Test',
        category: 'expense'
      }) as { success: boolean }
      expect(createResult.success).toBe(true)
      expect(
        (
          handlers['journal-entries:create'](APPROVED_EVENT, {
            entryDate: Date.now(),
            description: 'X',
            lines: balancedLines()
          }) as { success: boolean }
        ).success
      ).toBe(true)
      expect((handlers['trial-balance:get'](APPROVED_EVENT) as { success: boolean }).success).toBe(
        true
      )
    })
  })

  // ---------------------------------------------------------------
  // Session cases
  // ---------------------------------------------------------------
  describe('session cases', () => {
    it('no active session returns session_invalid', async () => {
      const { handlers } = await registerAndCapture(null)
      expect(handlers['accounts:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    })

    it('a locked session returns session_invalid', async () => {
      await createUserWithRole('owner2', 'role_owner')
      const { handlers, loginService } = await registerAndCapture('owner2')
      loginService.startIdleLockTimer(db, { lockAfterIdleMs: 20, checkIntervalMs: 10 })
      await new Promise((resolve) => setTimeout(resolve, 100))
      loginService.dispose()
      expect(loginService.getSessionState(db).state).toBe('locked')

      expect(handlers['accounts:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    }, 20000)

    it("a deactivated user's session returns session_invalid", async () => {
      const userId = await createUserWithRole('owner3', 'role_owner')
      const { handlers } = await registerAndCapture('owner3')
      deactivateUser(db, userId)

      expect(handlers['accounts:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    })

    it('authorization uses fresh SQLite role codes, not session-cached ones', async () => {
      await createUserWithRole('owner4', 'role_owner')
      const { handlers } = await registerAndCapture('owner4')
      expect((handlers['accounts:list'](APPROVED_EVENT) as { success: boolean }).success).toBe(true)

      db.delete(userRoles).run()

      expect(handlers['accounts:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'not_authorized'
      })
    })
  })

  // ---------------------------------------------------------------
  // 3. Input-shape and injection tests -- accounts
  // ---------------------------------------------------------------
  describe('account input shape and injection resistance', () => {
    it('create accepts only code/name/category/subtype -- injected fields have no effect', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')

      const result = handlers['accounts:create'](APPROVED_EVENT, {
        code: '7000',
        name: 'Test',
        category: 'expense',
        subtype: null,
        companyId: 'someone_else',
        isActive: false,
        createdAt: 12345,
        updatedAt: 12345,
        actor: { type: 'system' },
        actorId: 'fake-user'
      }) as { success: true; account: { code: string; isActive: boolean } }

      expect(result.success).toBe(true)
      expect(result.account.code).toBe('7000')
      expect(result.account.isActive).toBe(true)
    })

    it('update accepts only id/name/subtype -- injected code/category/companyId/isActive/timestamps have no effect', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')

      const result = handlers['accounts:update'](APPROVED_EVENT, {
        id: cashAccountId,
        name: 'Renamed Cash',
        code: '9999',
        category: 'liability',
        companyId: 'someone_else',
        isActive: false,
        createdAt: 1,
        updatedAt: 1
      }) as { success: true; account: { code: string; category: string; name: string } }

      expect(result.success).toBe(true)
      expect(result.account.name).toBe('Renamed Cash')
      expect(result.account.code).toBe('1000')
      expect(result.account.category).toBe('asset')
    })
  })

  // ---------------------------------------------------------------
  // 3. Input-shape and injection tests -- journals
  // ---------------------------------------------------------------
  describe('journal input shape and injection resistance', () => {
    it('create accepts only entryDate/description/externalReference/lines -- injected fields have no effect', async () => {
      const ownerId = await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')

      const result = handlers['journal-entries:create'](APPROVED_EVENT, {
        entryDate: Date.now(),
        description: 'X',
        lines: balancedLines(),
        currencyId: 'currency_zwg',
        entryNumber: 'JE-999999',
        createdByUserId: 'fake-user',
        actor: { type: 'system' },
        actorId: 'fake-user',
        companyId: 'someone_else',
        reversedEntryId: 'fake-original',
        reversalReason: 'should not appear',
        createdAt: 1
      }) as {
        success: true
        entry: {
          currencyId: string
          entryNumber: string
          createdByUserId: string
          reversedEntryId: string | null
          reversalReason: string | null
        }
      }

      expect(result.success).toBe(true)
      expect(result.entry.currencyId).toBe('currency_usd')
      expect(result.entry.entryNumber).not.toBe('JE-999999')
      expect(result.entry.createdByUserId).toBe(ownerId)
      expect(result.entry.reversedEntryId).toBeNull()
      expect(result.entry.reversalReason).toBeNull()
    })

    it('injected line id/lineOrder/companyId/journalEntryId have no effect -- line order derives from array order', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')

      const result = handlers['journal-entries:create'](APPROVED_EVENT, {
        entryDate: Date.now(),
        description: 'X',
        lines: [
          {
            accountId: cashAccountId,
            debitMinor: 1000,
            creditMinor: 0,
            id: 'fake-line-1',
            lineOrder: 99,
            companyId: 'someone_else',
            journalEntryId: 'fake-journal'
          },
          {
            accountId: revenueAccountId,
            debitMinor: 0,
            creditMinor: 1000,
            id: 'fake-line-2',
            lineOrder: 1,
            companyId: 'someone_else',
            journalEntryId: 'fake-journal'
          }
        ]
      }) as { success: true; entry: { lines: { lineOrder: number; accountId: string }[] } }

      expect(result.success).toBe(true)
      expect(result.entry.lines[0].lineOrder).toBe(0)
      expect(result.entry.lines[1].lineOrder).toBe(1)
      expect(result.entry.lines[0].accountId).toBe(cashAccountId)
    })

    it('reversal accepts only journalEntryId/reversalReason -- injected fields have no effect', async () => {
      const ownerId = await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')

      const original = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        { type: 'user', userId: ownerId }
      )

      const result = handlers['journal-entries:reverse'](APPROVED_EVENT, {
        journalEntryId: original.id,
        reversalReason: 'Undo',
        currencyId: 'currency_zwg',
        createdByUserId: 'fake-user',
        actor: { type: 'system' }
      }) as { success: true; entry: { currencyId: string; createdByUserId: string } }

      expect(result.success).toBe(true)
      expect(result.entry.currencyId).toBe('currency_usd')
      expect(result.entry.createdByUserId).toBe(ownerId)
    })
  })

  // ---------------------------------------------------------------
  // 4. Malformed-input tests
  // ---------------------------------------------------------------
  describe('malformed input', () => {
    it.each([
      ['missing object', undefined],
      ['wrong primitive type', 'not-an-object'],
      ['missing required string (code)', { name: 'X', category: 'asset' }],
      ['blank required string (code)', { code: '   ', name: 'X', category: 'asset' }]
    ])('accounts:create rejects %s', async (_label, input) => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['accounts:create'](APPROVED_EVENT, input)).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })

    it('accounts:get rejects a malformed account id', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['accounts:get'](APPROVED_EVENT, {})).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })

    it('journal-entries:create rejects a malformed line array', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(
        handlers['journal-entries:create'](APPROVED_EVENT, {
          entryDate: Date.now(),
          description: 'X',
          lines: 'not-an-array'
        })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('journal-entries:create rejects a non-object line', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(
        handlers['journal-entries:create'](APPROVED_EVENT, {
          entryDate: Date.now(),
          description: 'X',
          lines: ['not-an-object']
        })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('journal-entries:create rejects a line missing accountId', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(
        handlers['journal-entries:create'](APPROVED_EVENT, {
          entryDate: Date.now(),
          description: 'X',
          lines: [{ debitMinor: 100, creditMinor: 0 }]
        })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('journal-entries:create rejects a non-numeric debit/credit at the IPC shape layer', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(
        handlers['journal-entries:create'](APPROVED_EVENT, {
          entryDate: Date.now(),
          description: 'X',
          lines: [
            { accountId: cashAccountId, debitMinor: 'not-a-number', creditMinor: 0 },
            { accountId: revenueAccountId, debitMinor: 0, creditMinor: 100 }
          ]
        })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('journal-entries:create rejects a malformed entryDate', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(
        handlers['journal-entries:create'](APPROVED_EVENT, {
          entryDate: 'not-a-date',
          description: 'X',
          lines: balancedLines()
        })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('journal-entries:reverse rejects a malformed reversal reason', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(
        handlers['journal-entries:reverse'](APPROVED_EVENT, {
          journalEntryId: 'x',
          reversalReason: ''
        })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('non-integer debit/credit that passes the IPC shape check is still rejected by domain validation, not silently accepted', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['journal-entries:create'](APPROVED_EVENT, {
        entryDate: Date.now(),
        description: 'X',
        lines: [
          { accountId: cashAccountId, debitMinor: 100.5, creditMinor: 0 },
          { accountId: revenueAccountId, debitMinor: 0, creditMinor: 100.5 }
        ]
      }) as { success: false; errorCode: string }
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('invalid_input')
    })
  })

  // ---------------------------------------------------------------
  // 5. Error mapping tests
  // ---------------------------------------------------------------
  describe('error mapping', () => {
    it('duplicate account code -> duplicate_code', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(
        handlers['accounts:create'](APPROVED_EVENT, {
          code: '1000',
          name: 'Duplicate',
          category: 'asset'
        })
      ).toEqual({ success: false, errorCode: 'duplicate_code' })
    })

    it('missing account -> not_found', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['accounts:get'](APPROVED_EVENT, { id: 'does-not-exist' })).toEqual({
        success: false,
        errorCode: 'not_found'
      })
    })

    it('missing journal entry -> not_found', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['journal-entries:get'](APPROVED_EVENT, { id: 'does-not-exist' })).toEqual({
        success: false,
        errorCode: 'not_found'
      })
    })

    it('inactive posting account -> inactive_account', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      handlers['accounts:deactivate'](APPROVED_EVENT, { id: cashAccountId })

      const result = handlers['journal-entries:create'](APPROVED_EVENT, {
        entryDate: Date.now(),
        description: 'X',
        lines: balancedLines()
      })
      expect(result).toEqual({ success: false, errorCode: 'inactive_account' })
    })

    it('unbalanced entry -> unbalanced_entry', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['journal-entries:create'](APPROVED_EVENT, {
        entryDate: Date.now(),
        description: 'X',
        lines: [
          { accountId: cashAccountId, debitMinor: 100, creditMinor: 0 },
          { accountId: revenueAccountId, debitMinor: 0, creditMinor: 99 }
        ]
      })
      expect(result).toEqual({ success: false, errorCode: 'unbalanced_entry' })
    })

    it('already reversed -> already_reversed', async () => {
      const ownerId = await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const original = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        { type: 'user', userId: ownerId }
      )
      handlers['journal-entries:reverse'](APPROVED_EVENT, {
        journalEntryId: original.id,
        reversalReason: 'First'
      })
      const result = handlers['journal-entries:reverse'](APPROVED_EVENT, {
        journalEntryId: original.id,
        reversalReason: 'Second'
      })
      expect(result).toEqual({ success: false, errorCode: 'already_reversed' })
    })

    it('reversal of a reversal -> reversal_of_reversal', async () => {
      const ownerId = await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const original = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        { type: 'user', userId: ownerId }
      )
      const reversalResult = handlers['journal-entries:reverse'](APPROVED_EVENT, {
        journalEntryId: original.id,
        reversalReason: 'Undo'
      }) as { success: true; entry: { id: string } }

      const result = handlers['journal-entries:reverse'](APPROVED_EVENT, {
        journalEntryId: reversalResult.entry.id,
        reversalReason: 'Undo the undo'
      })
      expect(result).toEqual({ success: false, errorCode: 'reversal_of_reversal' })
    })

    it('missing/invalid session -> session_invalid', async () => {
      const { handlers } = await registerAndCapture(null)
      expect(handlers['accounts:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    })

    it('authenticated but forbidden -> not_authorized', async () => {
      await createUserWithRole('ops1', 'role_operations')
      const { handlers } = await registerAndCapture('ops1')
      expect(handlers['accounts:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'not_authorized'
      })
    })

    it('an unknown exception -> unexpected_error, with no raw message/stack/SQL/path leakage', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')

      // Force an unexpected error by closing the database out from
      // under a still-registered handler.
      rawDb.close()
      const result = handlers['accounts:list'](APPROVED_EVENT)
      const serialized = JSON.stringify(result)

      expect((result as { success: boolean }).success).toBe(false)
      expect((result as { errorCode: string }).errorCode).toBe('unexpected_error')
      expect(serialized).not.toMatch(/at\s+\S+\s+\(/)
      expect(serialized).not.toContain('SELECT')
      expect(serialized).not.toContain(dir)
      expect(serialized).not.toContain('.db')
      expect(Object.keys(result as object).sort()).toEqual(['errorCode', 'success'])
    })
  })

  // ---------------------------------------------------------------
  // 6. Safe-response mapping
  // ---------------------------------------------------------------
  describe('safe response mapping', () => {
    it('account response: normalBalance derived, no companyId or internal-only fields', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['accounts:get'](APPROVED_EVENT, { id: cashAccountId }) as {
        success: true
        account: Record<string, unknown>
      }
      expect(result.account.normalBalance).toBe('debit')
      expect(result.account.companyId).toBeUndefined()
      expect(Object.keys(result.account).sort()).toEqual(
        [
          'id',
          'code',
          'name',
          'category',
          'subtype',
          'normalBalance',
          'isActive',
          'createdAt',
          'updatedAt'
        ].sort()
      )
    })

    it('journal response: ordered lines, resolved account/user labels, no companyId', async () => {
      const ownerId = await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const created = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        { type: 'user', userId: ownerId }
      )
      const result = handlers['journal-entries:get'](APPROVED_EVENT, { id: created.id }) as {
        success: true
        entry: Record<string, unknown> & {
          lines: { accountCode: string; accountName: string; lineOrder: number }[]
          createdByLabel: string
        }
      }
      expect(result.entry.lines[0].lineOrder).toBe(0)
      expect(result.entry.lines[1].lineOrder).toBe(1)
      expect(result.entry.lines[0].accountCode).toBe('1000')
      expect(result.entry.createdByLabel).toBe('owner')
      expect(result.entry.companyId).toBeUndefined()
    })

    it('hasBeenReversed is false for a normal entry, true once it is reversed, and the reversal itself reports false', async () => {
      const ownerId = await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const original = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        { type: 'user', userId: ownerId }
      )

      const beforeReversal = handlers['journal-entries:get'](APPROVED_EVENT, {
        id: original.id
      }) as { success: true; entry: { hasBeenReversed: boolean } }
      expect(beforeReversal.entry.hasBeenReversed).toBe(false)

      const reversalResult = handlers['journal-entries:reverse'](APPROVED_EVENT, {
        journalEntryId: original.id,
        reversalReason: 'Undo'
      }) as { success: true; entry: { id: string; hasBeenReversed: boolean } }
      expect(reversalResult.entry.hasBeenReversed).toBe(false)

      const afterReversal = handlers['journal-entries:get'](APPROVED_EVENT, {
        id: original.id
      }) as { success: true; entry: { hasBeenReversed: boolean } }
      expect(afterReversal.entry.hasBeenReversed).toBe(true)
    })

    it('trial balance: safe rows, derived normalBalance, grand totals, isBalanced, no companyId', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['trial-balance:get'](APPROVED_EVENT) as {
        success: true
        trialBalance: {
          accounts: Record<string, unknown>[]
          grandTotalDebitMinor: number
          grandTotalCreditMinor: number
          isBalanced: boolean
        }
      }
      expect(result.trialBalance.accounts.length).toBeGreaterThan(0)
      expect(result.trialBalance.accounts[0].companyId).toBeUndefined()
      expect(typeof result.trialBalance.isBalanced).toBe('boolean')
      expect(result.trialBalance.grandTotalDebitMinor).toBe(
        result.trialBalance.grandTotalCreditMinor
      )
    })
  })

  // ---------------------------------------------------------------
  // Structural mutation-absence checks
  // ---------------------------------------------------------------
  describe('structural mutation-absence', () => {
    it('none of the 11 registered channels match any prohibited mutation-shaped name', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { channels } = await registerAndCapture('owner')
      const prohibited =
        /delete|remove|updateJournal|automatic|operational|draft|approve|unlock|close|selectCurrency/i
      for (const channel of channels) {
        expect(channel).not.toMatch(prohibited)
      }
    })
  })
})
