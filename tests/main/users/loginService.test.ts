import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { seedRoles } from '../../../src/main/db/seedRoles'
import { createCompany } from '../../../src/main/db/companyService'
import { createUser, deactivateUser, reactivateUser } from '../../../src/main/auth/userService'
import { hashPassword } from '../../../src/main/auth/passwordHashing'
import { createSessionManager } from '../../../src/main/auth/sessionManager'
import { createLoginService } from '../../../src/main/users/loginService'
import { userRoles } from '../../../src/main/db/schema'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const REAL_PASSWORD = 'a-strong-password-1'

describe('loginService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let ownerId: string

  beforeEach(async () => {
    dir = createTempDir('ledgerpage-login-service')
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

  describe('the happy path', () => {
    it('starts logged_out, and a correct login produces an active session with correct role codes', async () => {
      const service = createLoginService({ sessionManager: createSessionManager() })
      expect(service.getSessionState(db)).toEqual({ state: 'logged_out' })

      const result = await service.login(db, 'ben', REAL_PASSWORD)
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
          canManageCustomers: true
        }
      })
      expect(service.getSessionState(db)).toEqual({
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
        canManageCustomers: true
      })
    }, 20000)

    it('a non-Owner login reports isOwner: false', async () => {
      const passwordHash = await hashPassword(REAL_PASSWORD)
      db.transaction((tx) => {
        const finance = createUser(tx, {
          loginIdentifier: 'financeuser',
          displayName: 'Finance User',
          passwordHash
        })
        tx.insert(userRoles)
          .values({ userId: finance.id, roleId: 'role_finance', createdAt: new Date() })
          .run()
      })

      const service = createLoginService({ sessionManager: createSessionManager() })
      const result = await service.login(db, 'financeuser', REAL_PASSWORD)
      expect(result).toEqual({
        success: true,
        session: {
          displayName: 'Finance User',
          isOwner: false,
          canViewAuditLog: true,
          canViewProducts: true,
          canManageProducts: false,
          canViewInventoryItems: true,
          canManageInventoryItems: false,
          canViewSuppliers: true,
          canManageSuppliers: true,
          canViewCustomers: true,
          canManageCustomers: true
        }
      })
    }, 20000)

    it('wrong password does not create a session', async () => {
      const service = createLoginService({ sessionManager: createSessionManager() })
      const result = await service.login(db, 'ben', 'totally-wrong-password')
      expect(result).toEqual({ success: false })
      expect(service.getSessionState(db)).toEqual({ state: 'logged_out' })
    }, 20000)

    it('logout clears the session', async () => {
      const service = createLoginService({ sessionManager: createSessionManager() })
      await service.login(db, 'ben', REAL_PASSWORD)
      service.logout()
      expect(service.getSessionState(db)).toEqual({ state: 'logged_out' })
    }, 20000)

    it('logout is a safe no-op when nothing is logged in', () => {
      const service = createLoginService({ sessionManager: createSessionManager() })
      expect(() => service.logout()).not.toThrow()
      expect(service.getSessionState(db)).toEqual({ state: 'logged_out' })
    })
  })

  describe('deactivated user acceptance criterion', () => {
    it('a deactivated user cannot log in even with the correct password', async () => {
      const passwordHash = await hashPassword(REAL_PASSWORD)
      const other = db.transaction((tx) => {
        const user = createUser(tx, {
          loginIdentifier: 'other',
          displayName: 'Other',
          passwordHash
        })
        tx.insert(userRoles)
          .values({ userId: user.id, roleId: 'role_finance', createdAt: new Date() })
          .run()
        return user
      })
      deactivateUser(db, other.id)

      const service = createLoginService({ sessionManager: createSessionManager() })
      const result = await service.login(db, 'other', REAL_PASSWORD)
      expect(result).toEqual({ success: false })
    }, 20000)
  })

  describe('correction 2: session-state rechecks user existence and active status', () => {
    it('deactivating the currently-logged-in user causes the next getSessionState call to report logged_out', async () => {
      const service = createLoginService({ sessionManager: createSessionManager() })
      await service.login(db, 'ben', REAL_PASSWORD)
      expect(service.getSessionState(db).state).toBe('active')

      deactivateUser(db, ownerId)

      expect(service.getSessionState(db)).toEqual({ state: 'logged_out' })
    }, 20000)

    it('reactivating does not silently restore the old session — a fresh login is required', async () => {
      const service = createLoginService({ sessionManager: createSessionManager() })
      await service.login(db, 'ben', REAL_PASSWORD)
      deactivateUser(db, ownerId)
      expect(service.getSessionState(db)).toEqual({ state: 'logged_out' })

      reactivateUser(db, ownerId)
      // Still logged_out — the torn-down session is gone for good; only a
      // fresh login (not mere reactivation) creates a new one.
      expect(service.getSessionState(db)).toEqual({ state: 'logged_out' })

      const result = await service.login(db, 'ben', REAL_PASSWORD)
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
          canManageCustomers: true
        }
      })
    }, 20000)

    it('getCurrentActiveUserId also rechecks and returns undefined once the user is deactivated', async () => {
      const service = createLoginService({ sessionManager: createSessionManager() })
      await service.login(db, 'ben', REAL_PASSWORD)
      expect(service.getCurrentActiveUserId(db)).toBe(ownerId)

      deactivateUser(db, ownerId)
      expect(service.getCurrentActiveUserId(db)).toBeUndefined()
    }, 20000)
  })

  describe('correction 3: fresh role codes, never session-cached', () => {
    it('isOwner reflects the live role assignment, not what was true at login time', async () => {
      // There is no role-change operation in this codebase (by design —
      // see userManagementService.ts), so this is verified the only way
      // it can be: directly mutating user_roles to simulate a role
      // change from an entirely different source, and confirming
      // getSessionState picks it up immediately rather than reporting
      // the stale, at-login-time value.
      const service = createLoginService({ sessionManager: createSessionManager() })
      await service.login(db, 'ben', REAL_PASSWORD)
      expect(service.getSessionState(db)).toEqual({
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
        canManageCustomers: true
      })

      db.delete(userRoles).where(eq(userRoles.userId, ownerId)).run()
      db.insert(userRoles)
        .values({ userId: ownerId, roleId: 'role_finance', createdAt: new Date() })
        .run()

      expect(service.getSessionState(db)).toEqual({
        state: 'active',
        displayName: 'Ben',
        isOwner: false,
        canViewAuditLog: true,
        canViewProducts: true,
        canManageProducts: false,
        canViewInventoryItems: true,
        canManageInventoryItems: false,
        canViewSuppliers: true,
        canManageSuppliers: true,
        canViewCustomers: true,
        canManageCustomers: true
      })
    }, 20000)
  })

  describe('lock, unlock, and the idle-lock timer', () => {
    it('startIdleLockTimer locks (not destroys) an idle session, and unlock resumes it without a new session', async () => {
      const service = createLoginService({ sessionManager: createSessionManager() })
      await service.login(db, 'ben', REAL_PASSWORD)

      service.startIdleLockTimer(db, { lockAfterIdleMs: 30, checkIntervalMs: 10 })
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(service.getSessionState(db)).toEqual({ state: 'locked', displayName: 'Ben' })
      service.dispose()

      const wrongUnlock = await service.unlock(db, 'wrong-password')
      expect(wrongUnlock).toEqual({ success: false })
      expect(service.getSessionState(db)).toEqual({ state: 'locked', displayName: 'Ben' })

      const correctUnlock = await service.unlock(db, REAL_PASSWORD)
      expect(correctUnlock).toEqual({
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
          canManageCustomers: true
        }
      })
      expect(service.getSessionState(db)).toEqual({
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
        canManageCustomers: true
      })
    }, 20000)

    it('unlock fails when there is no current session', async () => {
      const service = createLoginService({ sessionManager: createSessionManager() })
      const result = await service.unlock(db, REAL_PASSWORD)
      expect(result).toEqual({ success: false })
    }, 20000)

    it('getSessionState is a pure read and never resets the idle clock (touch is the only thing that does)', async () => {
      const fixedNow = { value: new Date('2026-01-01T00:00:00.000Z') }
      const service = createLoginService({
        sessionManager: createSessionManager({ now: () => fixedNow.value }),
        now: () => fixedNow.value
      })
      await service.login(db, 'ben', REAL_PASSWORD)

      // Advance time past the lock threshold, but poll getSessionState
      // repeatedly in between — this must not delay the lock.
      service.startIdleLockTimer(db, { lockAfterIdleMs: 1000, checkIntervalMs: 10 })
      fixedNow.value = new Date(fixedNow.value.getTime() + 500)
      service.getSessionState(db)
      service.getSessionState(db)
      fixedNow.value = new Date(fixedNow.value.getTime() + 600)
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(service.getSessionState(db)).toEqual({ state: 'locked', displayName: 'Ben' })
      service.dispose()
    }, 20000)

    it('touch resets the idle clock, preventing the lock', async () => {
      const fixedNow = { value: new Date('2026-01-01T00:00:00.000Z') }
      const service = createLoginService({
        sessionManager: createSessionManager({ now: () => fixedNow.value }),
        now: () => fixedNow.value
      })
      await service.login(db, 'ben', REAL_PASSWORD)

      service.startIdleLockTimer(db, { lockAfterIdleMs: 1000, checkIntervalMs: 10 })
      fixedNow.value = new Date(fixedNow.value.getTime() + 900)
      service.touch(db)
      fixedNow.value = new Date(fixedNow.value.getTime() + 900)
      await new Promise((resolve) => setTimeout(resolve, 50))

      // 900ms since the touch, still under the 1000ms threshold.
      expect(service.getSessionState(db)).toEqual({
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
        canManageCustomers: true
      })
      service.dispose()
    }, 20000)

    it('touch does not refresh a locked session — sessionManager.touch is never called while locked', async () => {
      const sessionManager = createSessionManager()
      const touchSpy = vi.spyOn(sessionManager, 'touch')
      const service = createLoginService({ sessionManager })
      await service.login(db, 'ben', REAL_PASSWORD)

      service.startIdleLockTimer(db, { lockAfterIdleMs: 20, checkIntervalMs: 10 })
      await new Promise((resolve) => setTimeout(resolve, 100))
      service.dispose()
      expect(service.getSessionState(db).state).toBe('locked')

      touchSpy.mockClear() // discard any calls from before locking
      service.touch(db)

      expect(touchSpy).not.toHaveBeenCalled()
    }, 20000)

    it('a direct touch call after user deactivation does not preserve or revive the session', async () => {
      const service = createLoginService({ sessionManager: createSessionManager() })
      await service.login(db, 'ben', REAL_PASSWORD)
      expect(service.getSessionState(db).state).toBe('active')

      deactivateUser(db, ownerId)

      expect(() => service.touch(db)).not.toThrow()
      expect(service.getSessionState(db)).toEqual({ state: 'logged_out' })
    }, 20000)

    it('touch is a safe no-op with no current session at all', () => {
      const service = createLoginService({ sessionManager: createSessionManager() })
      expect(() => service.touch(db)).not.toThrow()
    })
  })

  describe('correction 6: one-current-session replacement, hard-expiry cleanup, idle-timer disposal', () => {
    it('a second login replaces the first — the old session is destroyed, not left coexisting', async () => {
      const sessionManager = createSessionManager()
      const service = createLoginService({ sessionManager })
      await service.login(db, 'ben', REAL_PASSWORD)

      const passwordHash = await hashPassword(REAL_PASSWORD)
      db.transaction((tx) => {
        const finance = createUser(tx, {
          loginIdentifier: 'financeuser',
          displayName: 'Finance User',
          passwordHash
        })
        tx.insert(userRoles)
          .values({ userId: finance.id, roleId: 'role_finance', createdAt: new Date() })
          .run()
      })

      const secondLogin = await service.login(db, 'financeuser', REAL_PASSWORD)
      expect(secondLogin).toEqual({
        success: true,
        session: {
          displayName: 'Finance User',
          isOwner: false,
          canViewAuditLog: true,
          canViewProducts: true,
          canManageProducts: false,
          canViewInventoryItems: true,
          canManageInventoryItems: false,
          canViewSuppliers: true,
          canManageSuppliers: true,
          canViewCustomers: true,
          canManageCustomers: true
        }
      })
      expect(service.getSessionState(db)).toEqual({
        state: 'active',
        displayName: 'Finance User',
        isOwner: false,
        canViewAuditLog: true,
        canViewProducts: true,
        canManageProducts: false,
        canViewInventoryItems: true,
        canManageInventoryItems: false,
        canViewSuppliers: true,
        canManageSuppliers: true,
        canViewCustomers: true,
        canManageCustomers: true
      })
    }, 20000)

    it('hard-expiry (sessionManager idleTimeoutMs) is surfaced as logged_out, not left dangling', async () => {
      const fixedNow = { value: new Date('2026-01-01T00:00:00.000Z') }
      const sessionManager = createSessionManager({
        idleTimeoutMs: 1000,
        now: () => fixedNow.value
      })
      const service = createLoginService({ sessionManager, now: () => fixedNow.value })
      await service.login(db, 'ben', REAL_PASSWORD)

      fixedNow.value = new Date(fixedNow.value.getTime() + 2000)
      expect(service.getSessionState(db)).toEqual({ state: 'logged_out' })

      // A fresh login afterward works normally — no dangling state left
      // over from the hard-expired session.
      const result = await service.login(db, 'ben', REAL_PASSWORD)
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
          canManageCustomers: true
        }
      })
    }, 20000)

    it('dispose stops the idle-lock timer — no further lock checks occur after it', async () => {
      const service = createLoginService({ sessionManager: createSessionManager() })
      await service.login(db, 'ben', REAL_PASSWORD)

      service.startIdleLockTimer(db, { lockAfterIdleMs: 20, checkIntervalMs: 10 })
      service.dispose()
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Still active — disposal happened before the lock threshold could
      // have fired via a subsequent tick.
      expect(service.getSessionState(db)).toEqual({
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
        canManageCustomers: true
      })
    }, 20000)

    it('dispose is safe to call when no timer is running, and safe to call twice', () => {
      const service = createLoginService({ sessionManager: createSessionManager() })
      expect(() => service.dispose()).not.toThrow()
      expect(() => service.dispose()).not.toThrow()
    })

    it('starting the idle-lock timer twice disposes the first before starting the second', async () => {
      const service = createLoginService({ sessionManager: createSessionManager() })
      await service.login(db, 'ben', REAL_PASSWORD)

      const clearIntervalSpy = vi.spyOn(global, 'clearInterval')

      service.startIdleLockTimer(db, { lockAfterIdleMs: 20, checkIntervalMs: 10 })
      expect(clearIntervalSpy).not.toHaveBeenCalled()

      service.startIdleLockTimer(db, { lockAfterIdleMs: 20, checkIntervalMs: 10 })
      // The second call must dispose the first timer before installing
      // its own — proven directly by observing clearInterval actually
      // being invoked, not merely inferred from eventual session state.
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1)

      service.dispose()
      expect(clearIntervalSpy).toHaveBeenCalledTimes(2)
      clearIntervalSpy.mockRestore()
    }, 20000)
  })
})
