import { join } from 'node:path'
import { eq } from 'drizzle-orm'
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
const VALID_CREATE_INPUT = {
  displayName: 'Finance Person',
  loginIdentifier: 'financeuser',
  password: REAL_PASSWORD,
  passwordConfirmation: REAL_PASSWORD,
  roleCode: 'finance'
}

describe('registerUserManagementHandlers', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let ownerId: string

  beforeEach(async () => {
    vi.resetModules()
    handle.mockClear()
    dir = createTempDir('ledgerpage-user-mgmt-handlers')
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
    ownerId = owner.id
    db.insert(userRoles)
      .values({ userId: owner.id, roleId: 'role_owner', createdAt: new Date() })
      .run()
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  async function registerAndCapture(loggedInAs: 'ben' | null = 'ben'): Promise<{
    handlers: Record<string, (event: unknown, input?: unknown) => unknown>
    channels: string[]
    loginService: LoginService
  }> {
    const { registerUserManagementHandlers } =
      await import('../../src/main/ipc/registerUserManagementHandlers')
    const { createUserManagementService } =
      await import('../../src/main/users/userManagementService')
    const { createLoginService } = await import('../../src/main/users/loginService')
    const { createSessionManager } = await import('../../src/main/auth/sessionManager')

    const sessionManager = createSessionManager()
    const loginService = createLoginService({ sessionManager })
    const userManagementService = createUserManagementService({ loginService, sessionManager })

    if (loggedInAs) {
      await loginService.login(db, loggedInAs, REAL_PASSWORD)
    }

    registerUserManagementHandlers({ context, db, userManagementService })

    const handlers: Record<string, (event: unknown, input?: unknown) => unknown> = {}
    const channels: string[] = []
    for (const call of handle.mock.calls as [
      string,
      (event: unknown, input?: unknown) => unknown
    ][]) {
      handlers[call[0]] = call[1]
      channels.push(call[0])
    }
    return { handlers, channels, loginService }
  }

  it('registers exactly the five approved users/roles channels — nothing more', async () => {
    const { channels } = await registerAndCapture()
    const {
      USERS_LIST_CHANNEL,
      USERS_CREATE_CHANNEL,
      USERS_DEACTIVATE_CHANNEL,
      USERS_REACTIVATE_CHANNEL,
      ROLES_LIST_ASSIGNABLE_CHANNEL
    } = await import('../../src/shared/ipc/users')

    expect(channels.sort()).toEqual(
      [
        USERS_LIST_CHANNEL,
        USERS_CREATE_CHANNEL,
        USERS_DEACTIVATE_CHANNEL,
        USERS_REACTIVATE_CHANNEL,
        ROLES_LIST_ASSIGNABLE_CHANNEL
      ].sort()
    )
  })

  describe('sender validation — every channel rejects an unapproved sender', () => {
    it('users:list', async () => {
      const { handlers } = await registerAndCapture()
      expect(() => handlers['users:list'](UNAPPROVED_EVENT)).toThrow()
    })

    it('users:create', async () => {
      const { handlers } = await registerAndCapture()
      await expect(handlers['users:create'](UNAPPROVED_EVENT, VALID_CREATE_INPUT)).rejects.toThrow()
    })

    it('users:deactivate', async () => {
      const { handlers } = await registerAndCapture()
      expect(() => handlers['users:deactivate'](UNAPPROVED_EVENT, { userId: 'x' })).toThrow()
    })

    it('users:reactivate', async () => {
      const { handlers } = await registerAndCapture()
      expect(() => handlers['users:reactivate'](UNAPPROVED_EVENT, { userId: 'x' })).toThrow()
    })

    it('roles:list-assignable', async () => {
      const { handlers } = await registerAndCapture()
      expect(() => handlers['roles:list-assignable'](UNAPPROVED_EVENT)).toThrow()
    })
  })

  describe('users:list', () => {
    it('an Owner session sees the seeded Owner user', async () => {
      const { handlers } = await registerAndCapture()
      const result = handlers['users:list'](APPROVED_EVENT)
      expect(result).toEqual({
        success: true,
        users: [
          {
            id: ownerId,
            loginIdentifier: 'ben',
            displayName: 'Ben',
            isActive: true,
            roleCode: 'owner'
          }
        ]
      })
    })

    it('a non-Owner session is rejected with a controlled error code', async () => {
      const passwordHash = await hashPassword(REAL_PASSWORD)
      db.transaction((tx) => {
        const user = createUser(tx, {
          loginIdentifier: 'opsuser',
          displayName: 'Ops',
          passwordHash
        })
        tx.insert(userRoles)
          .values({ userId: user.id, roleId: 'role_operations', createdAt: new Date() })
          .run()
      })

      const { registerUserManagementHandlers } =
        await import('../../src/main/ipc/registerUserManagementHandlers')
      const { createUserManagementService } =
        await import('../../src/main/users/userManagementService')
      const { createLoginService } = await import('../../src/main/users/loginService')
      const { createSessionManager } = await import('../../src/main/auth/sessionManager')
      const sessionManager = createSessionManager()
      const loginService = createLoginService({ sessionManager })
      const userManagementService = createUserManagementService({ loginService, sessionManager })
      await loginService.login(db, 'opsuser', REAL_PASSWORD)
      registerUserManagementHandlers({ context, db, userManagementService })

      const handlers: Record<string, (event: unknown, input?: unknown) => unknown> = {}
      for (const call of handle.mock.calls as [string, (event: unknown) => unknown][]) {
        handlers[call[0]] = call[1]
      }

      const result = handlers['users:list'](APPROVED_EVENT)
      expect(result).toEqual({ success: false, errorCode: 'not_authorized' })
    })

    it('no session at all is rejected as session_invalid', async () => {
      const { handlers } = await registerAndCapture(null)
      const result = handlers['users:list'](APPROVED_EVENT)
      expect(result).toEqual({ success: false, errorCode: 'session_invalid' })
    })
  })

  describe('users:create', () => {
    it('rejects malformed input as invalid_input', async () => {
      const { handlers } = await registerAndCapture()
      const result = await handlers['users:create'](APPROVED_EVENT, { displayName: 'X' })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('succeeds end to end for an Owner session, and no password hash appears anywhere in the result', async () => {
      const { handlers } = await registerAndCapture()
      const result = await handlers['users:create'](APPROVED_EVENT, VALID_CREATE_INPUT)
      expect(result).toEqual({ success: true })
      expect(JSON.stringify(result)).not.toMatch(/\$argon2id\$/)
    })

    it('rejects roleCode "owner", preserving the exactly-one-Owner invariant at the IPC boundary too', async () => {
      const { handlers } = await registerAndCapture()
      const result = await handlers['users:create'](APPROVED_EVENT, {
        ...VALID_CREATE_INPUT,
        roleCode: 'owner'
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })
  })

  describe('users:deactivate / users:reactivate', () => {
    it('rejects malformed input as invalid_input', async () => {
      const { handlers } = await registerAndCapture()
      const result = handlers['users:deactivate'](APPROVED_EVENT, {})
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('cannot deactivate the Owner via this channel', async () => {
      const { handlers } = await registerAndCapture()
      const result = handlers['users:deactivate'](APPROVED_EVENT, { userId: ownerId })
      expect(result).toEqual({ success: false, errorCode: 'cannot_modify_owner' })
    })

    it('deactivates and reactivates a non-Owner user end to end', async () => {
      const { handlers } = await registerAndCapture()
      await handlers['users:create'](APPROVED_EVENT, VALID_CREATE_INPUT)
      const listResult = handlers['users:list'](APPROVED_EVENT) as {
        success: true
        users: { id: string; loginIdentifier: string }[]
      }
      const financeUserId = listResult.users.find((u) => u.loginIdentifier === 'financeuser')?.id
      expect(financeUserId).toBeDefined()

      const deactivateResult = handlers['users:deactivate'](APPROVED_EVENT, {
        userId: financeUserId
      })
      expect(deactivateResult).toEqual({ success: true })

      const reactivateResult = handlers['users:reactivate'](APPROVED_EVENT, {
        userId: financeUserId
      })
      expect(reactivateResult).toEqual({ success: true })
    })
  })

  describe('roles:list-assignable', () => {
    it('an active Owner receives exactly executive/operations/finance — never owner', async () => {
      const { handlers } = await registerAndCapture()
      const result = handlers['roles:list-assignable'](APPROVED_EVENT) as {
        success: true
        roles: { code: string; name: string }[]
      }
      expect(result.success).toBe(true)
      expect(result.roles.map((r) => r.code).sort()).toEqual(
        ['executive', 'finance', 'operations'].sort()
      )
      expect(result.roles.some((r) => r.code === 'owner')).toBe(false)
    })

    it('a logged-out caller is rejected with a controlled failure, not the raw list', async () => {
      const { handlers } = await registerAndCapture(null)
      const result = handlers['roles:list-assignable'](APPROVED_EVENT)
      expect(result).toEqual({ success: false, errorCode: 'session_invalid' })
    })

    it('a locked Owner session is rejected', async () => {
      const { handlers, loginService } = await registerAndCapture()
      loginService.startIdleLockTimer(db, { lockAfterIdleMs: 20, checkIntervalMs: 10 })
      await new Promise((resolve) => setTimeout(resolve, 100))
      loginService.dispose()
      expect(loginService.getSessionState(db).state).toBe('locked')

      const result = handlers['roles:list-assignable'](APPROVED_EVENT)
      expect(result).toEqual({ success: false, errorCode: 'session_invalid' })
    })

    it('a non-Owner session is rejected even when invoking the channel directly', async () => {
      const passwordHash = await hashPassword(REAL_PASSWORD)
      db.transaction((tx) => {
        const user = createUser(tx, {
          loginIdentifier: 'opsuser',
          displayName: 'Ops',
          passwordHash
        })
        tx.insert(userRoles)
          .values({ userId: user.id, roleId: 'role_operations', createdAt: new Date() })
          .run()
      })

      const { registerUserManagementHandlers } =
        await import('../../src/main/ipc/registerUserManagementHandlers')
      const { createUserManagementService } =
        await import('../../src/main/users/userManagementService')
      const { createLoginService } = await import('../../src/main/users/loginService')
      const { createSessionManager } = await import('../../src/main/auth/sessionManager')
      const sessionManager = createSessionManager()
      const loginService = createLoginService({ sessionManager })
      const userManagementService = createUserManagementService({ loginService, sessionManager })
      await loginService.login(db, 'opsuser', REAL_PASSWORD)
      registerUserManagementHandlers({ context, db, userManagementService })

      const handlers: Record<string, (event: unknown) => unknown> = {}
      for (const call of handle.mock.calls as [string, (event: unknown) => unknown][]) {
        handlers[call[0]] = call[1]
      }

      const result = handlers['roles:list-assignable'](APPROVED_EVENT)
      expect(result).toEqual({ success: false, errorCode: 'not_authorized' })
    })

    it('authorization uses fresh SQLite role codes, not session-cached ones', async () => {
      const { handlers } = await registerAndCapture()
      const activeResult = handlers['roles:list-assignable'](APPROVED_EVENT) as { success: boolean }
      expect(activeResult.success).toBe(true)

      // No legitimate operation can do this (by design) — simulated
      // directly to prove the check is genuinely fresh, not relying on
      // whatever roleCodes the session snapshot cached at login time.
      db.delete(userRoles).where(eq(userRoles.userId, ownerId)).run()

      const afterRoleRemovalResult = handlers['roles:list-assignable'](APPROVED_EVENT)
      expect(afterRoleRemovalResult).toEqual({ success: false, errorCode: 'not_authorized' })
    })
  })
})
