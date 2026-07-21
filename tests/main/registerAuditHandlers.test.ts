import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseConnection } from '../../src/main/db/connection'
import { runMigrations } from '../../src/main/db/runMigrations'
import { seedReferenceData } from '../../src/main/db/seedReferenceData'
import { seedRoles } from '../../src/main/db/seedRoles'
import { createCompany } from '../../src/main/db/companyService'
import { createUser, deactivateUser } from '../../src/main/auth/userService'
import { hashPassword } from '../../src/main/auth/passwordHashing'
import { record } from '../../src/main/audit/auditService'
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

type Handler = (event: unknown, input?: unknown) => unknown

describe('registerAuditHandlers', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    vi.resetModules()
    handle.mockClear()
    dir = createTempDir('ledgerpage-audit-handlers')
    rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    seedRoles(rawDb)
    db = drizzle<Record<string, never>>(rawDb)
    createCompany(
      db,
      {
        name: 'Fixture Co',
        address: 'Addr',
        contactDetails: 'c@example.com',
        currencyId: 'currency_usd'
      },
      new Date()
    )
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

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
    const { registerAuditHandlers } = await import('../../src/main/ipc/registerAuditHandlers')
    const { createLoginService } = await import('../../src/main/users/loginService')
    const { createSessionManager } = await import('../../src/main/auth/sessionManager')
    const sessionManager = createSessionManager()
    const loginService = createLoginService({ sessionManager })

    if (loggedInAs) {
      await loginService.login(db, loggedInAs, REAL_PASSWORD)
    }

    registerAuditHandlers({ context, db, loginService })

    const handlers: Record<string, Handler> = {}
    const channels: string[] = []
    for (const call of handle.mock.calls as [string, Handler][]) {
      handlers[call[0]] = call[1]
      channels.push(call[0])
    }
    return { handlers, channels, loginService }
  }

  it('registers exactly one channel — audit:list — no mutation channel of any kind', async () => {
    await createUserWithRole('owner', 'role_owner')
    const { channels } = await registerAndCapture('owner')
    expect(channels).toEqual(['audit:list'])
  })

  it('rejects an unapproved sender', async () => {
    await createUserWithRole('owner', 'role_owner')
    const { handlers } = await registerAndCapture('owner')
    expect(() => handlers['audit:list'](UNAPPROVED_EVENT, {})).toThrow()
  })

  describe('input validation', () => {
    it('rejects a negative limit as invalid_input', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['audit:list'](APPROVED_EVENT, { limit: -5 })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects NaN as a limit', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['audit:list'](APPROVED_EVENT, { limit: NaN })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects Infinity as a limit', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['audit:list'](APPROVED_EVENT, { limit: Infinity })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects a non-integer limit', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['audit:list'](APPROVED_EVENT, { limit: 1.5 })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects a malformed cursor missing occurredAt', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['audit:list'](APPROVED_EVENT, { cursor: { id: 'audit_1' } })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects a malformed cursor missing id', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['audit:list'](APPROVED_EVENT, { cursor: { occurredAt: 123 } })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects a cursor that is not an object', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['audit:list'](APPROVED_EVENT, { cursor: 'not-an-object' })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects an inverted date range (fromOccurredAt after toOccurredAt)', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['audit:list'](APPROVED_EVENT, {
        fromOccurredAt: 2000,
        toOccurredAt: 1000
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects a non-string entityType', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['audit:list'](APPROVED_EVENT, { entityType: 123 })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('accepts an empty/omitted input as valid', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['audit:list'](APPROVED_EVENT, undefined)
      expect((result as { success: boolean }).success).toBe(true)
    })
  })

  describe('limit clamping', () => {
    it('hard-clamps a requested limit far beyond the maximum, never returning more than the cap', async () => {
      await createUserWithRole('owner', 'role_owner')
      db.transaction((tx) => {
        for (let i = 0; i < 250; i++) {
          record(tx, {
            entityType: 'x',
            entityId: String(i),
            entityLabel: 'x',
            action: 'create',
            actor: { type: 'system' },
            companyId: null,
            before: null,
            after: { a: i }
          })
        }
      })
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['audit:list'](APPROVED_EVENT, { limit: 999999 }) as {
        success: true
        entries: unknown[]
      }
      expect(result.entries.length).toBeLessThanOrEqual(200)
    })
  })

  describe('authorization — fresh SQLite roles, allow Owner/Executive/Finance, reject everyone else', () => {
    it('an active Owner succeeds', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['audit:list'](APPROVED_EVENT, {})
      expect((result as { success: boolean }).success).toBe(true)
    })

    it('an active Executive succeeds', async () => {
      await createUserWithRole('exec1', 'role_executive')
      const { handlers } = await registerAndCapture('exec1')
      const result = handlers['audit:list'](APPROVED_EVENT, {})
      expect((result as { success: boolean }).success).toBe(true)
    })

    it('an active Finance user succeeds', async () => {
      await createUserWithRole('fin1', 'role_finance')
      const { handlers } = await registerAndCapture('fin1')
      const result = handlers['audit:list'](APPROVED_EVENT, {})
      expect((result as { success: boolean }).success).toBe(true)
    })

    it('an active Operations user is rejected as not_authorized', async () => {
      await createUserWithRole('ops1', 'role_operations')
      const { handlers } = await registerAndCapture('ops1')
      const result = handlers['audit:list'](APPROVED_EVENT, {})
      expect(result).toEqual({ success: false, errorCode: 'not_authorized' })
    })

    it('a logged-out caller is rejected as session_invalid', async () => {
      const { handlers } = await registerAndCapture(null)
      const result = handlers['audit:list'](APPROVED_EVENT, {})
      expect(result).toEqual({ success: false, errorCode: 'session_invalid' })
    })

    it('a locked Owner session is rejected as session_invalid', async () => {
      await createUserWithRole('owner2', 'role_owner')
      const { handlers, loginService } = await registerAndCapture('owner2')
      loginService.startIdleLockTimer(db, { lockAfterIdleMs: 20, checkIntervalMs: 10 })
      await new Promise((resolve) => setTimeout(resolve, 100))
      loginService.dispose()
      expect(loginService.getSessionState(db).state).toBe('locked')

      const result = handlers['audit:list'](APPROVED_EVENT, {})
      expect(result).toEqual({ success: false, errorCode: 'session_invalid' })
    }, 20000)

    it('a deactivated user\u2019s session is rejected as session_invalid', async () => {
      const userId = await createUserWithRole('owner3', 'role_owner')
      const { handlers } = await registerAndCapture('owner3')
      deactivateUser(db, userId)

      const result = handlers['audit:list'](APPROVED_EVENT, {})
      expect(result).toEqual({ success: false, errorCode: 'session_invalid' })
    })

    it('authorization uses fresh SQLite role codes, not session-cached ones', async () => {
      const userId = await createUserWithRole('owner4', 'role_owner')
      const { handlers } = await registerAndCapture('owner4')
      expect((handlers['audit:list'](APPROVED_EVENT, {}) as { success: boolean }).success).toBe(
        true
      )

      db.delete(userRoles).run()
      db.insert(userRoles)
        .values({ userId, roleId: 'role_operations', createdAt: new Date() })
        .run()

      const result = handlers['audit:list'](APPROVED_EVENT, {})
      expect(result).toEqual({ success: false, errorCode: 'not_authorized' })
    })
  })

  describe('safe error mapping', () => {
    it('never leaks a raw exception message or stack trace in any failure result', async () => {
      await createUserWithRole('ops1', 'role_operations')
      const { handlers } = await registerAndCapture('ops1')
      const result = handlers['audit:list'](APPROVED_EVENT, {})
      const serialized = JSON.stringify(result)
      expect(serialized).not.toMatch(/at\s+\S+\s+\(/) // no stack-trace-shaped text
      expect(serialized).not.toContain('Error:')
    })

    it('maps a stored row with an extra sibling key in a field-change object to unexpected_error, with no message leaked', async () => {
      await createUserWithRole('owner-strict-shape', 'role_owner')
      rawDb
        .prepare(
          `INSERT INTO audit_log_entries
           (id, entity_type, entity_id, entity_label, action, changed_fields, actor_type, user_id, company_id, occurred_at)
           VALUES ('bad_shape_row', 'x', '1', 'x', 'update', ?, 'system', NULL, NULL, ?)`
        )
        .run('{"name": {"old": 1, "new": 2, "extra": "safe but not allowed"}}', Date.now())

      const { handlers } = await registerAndCapture('owner-strict-shape')
      const result = handlers['audit:list'](APPROVED_EVENT, {})
      expect(result).toEqual({ success: false, errorCode: 'unexpected_error' })

      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('extra')
      expect(serialized).not.toMatch(/at\s+\S+\s+\(/)
      expect(serialized).not.toContain('Error:')
    })
  })

  describe('successful listing', () => {
    it('returns entries and respects filters end to end', async () => {
      await createUserWithRole('owner5', 'role_owner')
      db.transaction((tx) => {
        record(tx, {
          entityType: 'tax_code',
          entityId: '1',
          entityLabel: 'x',
          action: 'create',
          actor: { type: 'system' },
          companyId: null,
          before: null,
          after: { a: 1 }
        })
        record(tx, {
          entityType: 'user',
          entityId: '2',
          entityLabel: 'x',
          action: 'create',
          actor: { type: 'system' },
          companyId: null,
          before: null,
          after: { a: 1 }
        })
      })
      const { handlers } = await registerAndCapture('owner5')
      const result = handlers['audit:list'](APPROVED_EVENT, { entityType: 'tax_code' }) as {
        success: true
        entries: { entityType: string }[]
      }
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].entityType).toBe('tax_code')
    })

    it('maps actorLabel through to the safe result, resolved server-side from the users table, never from renderer input', async () => {
      const ownerId = await createUserWithRole('display-name-owner', 'role_owner')
      db.transaction((tx) => {
        record(tx, {
          entityType: 'user',
          entityId: '1',
          entityLabel: 'x',
          action: 'create',
          actor: { type: 'user', userId: ownerId },
          companyId: null,
          before: null,
          after: { a: 1 }
        })
        record(tx, {
          entityType: 'company',
          entityId: '2',
          entityLabel: 'x',
          action: 'create',
          actor: { type: 'system' },
          companyId: null,
          before: null,
          after: { a: 1 }
        })
      })
      const { handlers } = await registerAndCapture('display-name-owner')
      // No actorLabel field exists anywhere on ListAuditEntriesInput --
      // there is no representable way for this call to have supplied
      // one, even if it tried to.
      const result = handlers['audit:list'](APPROVED_EVENT, {}) as {
        success: true
        entries: { actorType: string; actorLabel: string }[]
      }

      const userEntry = result.entries.find((e) => e.actorType === 'user')
      const systemEntry = result.entries.find((e) => e.actorType === 'system')
      expect(userEntry?.actorLabel).toBe('display-name-owner')
      expect(systemEntry?.actorLabel).toBe('System')
    })
  })
})
