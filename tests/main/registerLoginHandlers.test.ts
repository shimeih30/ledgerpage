import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseConnection } from '../../src/main/db/connection'
import { runMigrations } from '../../src/main/db/runMigrations'
import { seedReferenceData } from '../../src/main/db/seedReferenceData'
import { seedRoles } from '../../src/main/db/seedRoles'
import { createCompany } from '../../src/main/db/companyService'
import { createUser } from '../../src/main/auth/userService'
import { hashPassword } from '../../src/main/auth/passwordHashing'
import { userRoles } from '../../src/main/db/schema'
import type { AppDb } from '../../src/main/db/dbTypes'
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

describe('registerLoginHandlers', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(async () => {
    vi.resetModules()
    handle.mockClear()
    dir = createTempDir('ledgerpage-login-handlers')
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
    const passwordHash = await hashPassword(REAL_PASSWORD)
    const owner = db.transaction((tx) =>
      createUser(tx, { loginIdentifier: 'ben', displayName: 'Ben', passwordHash })
    )
    db.insert(userRoles)
      .values({ userId: owner.id, roleId: 'role_owner', createdAt: new Date() })
      .run()
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  async function registerAndCapture(): Promise<{
    handlers: Record<string, (event: unknown, input?: unknown) => unknown>
    channels: string[]
  }> {
    const { registerLoginHandlers } = await import('../../src/main/ipc/registerLoginHandlers')
    const { createLoginService } = await import('../../src/main/users/loginService')
    const { createSessionManager } = await import('../../src/main/auth/sessionManager')
    const loginService = createLoginService({ sessionManager: createSessionManager() })

    registerLoginHandlers({ context, db, loginService })

    const handlers: Record<string, (event: unknown, input?: unknown) => unknown> = {}
    const channels: string[] = []
    for (const call of handle.mock.calls as [
      string,
      (event: unknown, input?: unknown) => unknown
    ][]) {
      handlers[call[0]] = call[1]
      channels.push(call[0])
    }
    return { handlers, channels }
  }

  it('registers exactly the five approved login/session channels — nothing more', async () => {
    const { channels } = await registerAndCapture()
    const {
      LOGIN_ATTEMPT_CHANNEL,
      LOGIN_GET_SESSION_STATE_CHANNEL,
      LOGIN_LOGOUT_CHANNEL,
      LOGIN_TOUCH_CHANNEL,
      LOGIN_UNLOCK_CHANNEL
    } = await import('../../src/shared/ipc/login')

    expect(channels.sort()).toEqual(
      [
        LOGIN_ATTEMPT_CHANNEL,
        LOGIN_GET_SESSION_STATE_CHANNEL,
        LOGIN_UNLOCK_CHANNEL,
        LOGIN_LOGOUT_CHANNEL,
        LOGIN_TOUCH_CHANNEL
      ].sort()
    )
  })

  describe('sender validation — every channel rejects an unapproved sender', () => {
    it('login:attempt', async () => {
      const { handlers } = await registerAndCapture()
      await expect(
        handlers['login:attempt'](UNAPPROVED_EVENT, { loginIdentifier: 'ben', password: 'x' })
      ).rejects.toThrow()
    })

    it('login:get-session-state', async () => {
      const { handlers } = await registerAndCapture()
      expect(() => handlers['login:get-session-state'](UNAPPROVED_EVENT)).toThrow()
    })

    it('login:unlock', async () => {
      const { handlers } = await registerAndCapture()
      await expect(handlers['login:unlock'](UNAPPROVED_EVENT, { password: 'x' })).rejects.toThrow()
    })

    it('login:logout', async () => {
      const { handlers } = await registerAndCapture()
      expect(() => handlers['login:logout'](UNAPPROVED_EVENT)).toThrow()
    })

    it('login:touch', async () => {
      const { handlers } = await registerAndCapture()
      expect(() => handlers['login:touch'](UNAPPROVED_EVENT)).toThrow()
    })
  })

  describe('login:attempt', () => {
    it('rejects malformed input as a safe failure, not a thrown error', async () => {
      const { handlers } = await registerAndCapture()
      const result = await handlers['login:attempt'](APPROVED_EVENT, { loginIdentifier: 123 })
      expect(result).toEqual({ success: false })
    })

    it('succeeds for correct credentials, and the result never contains a session id', async () => {
      const { handlers } = await registerAndCapture()
      const result = await handlers['login:attempt'](APPROVED_EVENT, {
        loginIdentifier: 'ben',
        password: REAL_PASSWORD
      })
      expect(result).toEqual({
        success: true,
        session: {
          displayName: 'Ben',
          isOwner: true,
          canViewAuditLog: true,
          canViewProducts: true,
          canManageProducts: true,
          canViewInventoryItems: true,
          canManageInventoryItems: true,
          canViewSuppliers: true,
          canManageSuppliers: true,
          canViewCustomers: true,
          canManageCustomers: true,
          canViewInventoryLots: true,
          canManageInventoryLots: true,
          canOverrideInventoryLots: true,
          canViewAccounts: true,
          canManageAccounts: true,
          canViewJournalEntries: true,
          canManageJournalEntries: true
        }
      })
      expect(Object.keys(result as object)).not.toContain('sessionId')
    })

    it('fails for wrong credentials without revealing which part was wrong', async () => {
      const { handlers } = await registerAndCapture()
      const result = await handlers['login:attempt'](APPROVED_EVENT, {
        loginIdentifier: 'ben',
        password: 'wrong-password'
      })
      expect(result).toEqual({ success: false })
    })
  })

  describe('login:get-session-state', () => {
    it('reports logged_out with no session established', async () => {
      const { handlers } = await registerAndCapture()
      expect(handlers['login:get-session-state'](APPROVED_EVENT)).toEqual({ state: 'logged_out' })
    })

    it('reports active after a successful login, via the same underlying loginService instance', async () => {
      const { handlers } = await registerAndCapture()
      await handlers['login:attempt'](APPROVED_EVENT, {
        loginIdentifier: 'ben',
        password: REAL_PASSWORD
      })
      expect(handlers['login:get-session-state'](APPROVED_EVENT)).toEqual({
        state: 'active',
        displayName: 'Ben',
        isOwner: true,
        canViewAuditLog: true,
        canViewProducts: true,
        canManageProducts: true,
        canViewInventoryItems: true,
        canManageInventoryItems: true,
        canViewSuppliers: true,
        canManageSuppliers: true,
        canViewCustomers: true,
        canManageCustomers: true,
        canViewInventoryLots: true,
        canManageInventoryLots: true,
        canOverrideInventoryLots: true,
        canViewAccounts: true,
        canManageAccounts: true,
        canViewJournalEntries: true,
        canManageJournalEntries: true
      })
    })
  })

  describe('login:unlock', () => {
    it('rejects malformed input as a safe failure', async () => {
      const { handlers } = await registerAndCapture()
      const result = await handlers['login:unlock'](APPROVED_EVENT, {})
      expect(result).toEqual({ success: false })
    })

    it('fails when there is no current session to unlock', async () => {
      const { handlers } = await registerAndCapture()
      const result = await handlers['login:unlock'](APPROVED_EVENT, { password: REAL_PASSWORD })
      expect(result).toEqual({ success: false })
    })
  })

  describe('login:logout', () => {
    it('clears the session — a subsequent get-session-state reports logged_out', async () => {
      const { handlers } = await registerAndCapture()
      await handlers['login:attempt'](APPROVED_EVENT, {
        loginIdentifier: 'ben',
        password: REAL_PASSWORD
      })
      expect((handlers['login:get-session-state'](APPROVED_EVENT) as { state: string }).state).toBe(
        'active'
      )

      handlers['login:logout'](APPROVED_EVENT)

      expect(handlers['login:get-session-state'](APPROVED_EVENT)).toEqual({ state: 'logged_out' })
    })
  })

  describe('login:touch', () => {
    it('does not throw when called with no current session', async () => {
      const { handlers } = await registerAndCapture()
      expect(() => handlers['login:touch'](APPROVED_EVENT)).not.toThrow()
    })
  })
})
