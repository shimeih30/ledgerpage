import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { seedRoles } from '../../../src/main/db/seedRoles'
import { createCompany } from '../../../src/main/db/companyService'
import { createUser, deactivateUser } from '../../../src/main/auth/userService'
import { hashPassword } from '../../../src/main/auth/passwordHashing'
import * as passwordHashingModule from '../../../src/main/auth/passwordHashing'
import { createSessionManager } from '../../../src/main/auth/sessionManager'
import { createLoginService } from '../../../src/main/users/loginService'
import {
  createUserManagementService,
  NON_OWNER_ROLE_CODES,
  type CreateAdditionalUserInput
} from '../../../src/main/users/userManagementService'
import { PRIMARY_COMPANY_ID, userRoles, users } from '../../../src/main/db/schema'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const REAL_PASSWORD = 'a-strong-password-1'

const VALID_CREATE_INPUT: CreateAdditionalUserInput = {
  displayName: 'Finance Person',
  loginIdentifier: 'financeuser',
  password: REAL_PASSWORD,
  passwordConfirmation: REAL_PASSWORD,
  roleCode: 'finance'
}

describe('userManagementService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let ownerId: string

  beforeEach(async () => {
    dir = createTempDir('ledgerpage-user-management')
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
    vi.restoreAllMocks()
    rawDb.close()
    removeTempDir(dir)
  })

  async function createServicesLoggedInAsOwner(): Promise<{
    loginService: ReturnType<typeof createLoginService>
    userMgmt: ReturnType<typeof createUserManagementService>
  }> {
    const sessionManager = createSessionManager()
    const loginService = createLoginService({ sessionManager })
    const userMgmt = createUserManagementService({ loginService, sessionManager })
    await loginService.login(db, 'ben', REAL_PASSWORD)
    return { loginService, userMgmt }
  }

  describe('the happy path', () => {
    it('an Owner session can list, create, deactivate, and reactivate', async () => {
      const { userMgmt } = await createServicesLoggedInAsOwner()

      const initial = userMgmt.listUsers(db)
      expect(initial).toEqual({
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

      const createResult = await userMgmt.createAdditionalUser(db, VALID_CREATE_INPUT)
      expect(createResult).toEqual({ success: true })

      const afterCreate = userMgmt.listUsers(db)
      expect(afterCreate.success).toBe(true)
      const financeUser = afterCreate.success
        ? afterCreate.users.find((u) => u.loginIdentifier === 'financeuser')
        : undefined
      expect(financeUser).toMatchObject({
        displayName: 'Finance Person',
        isActive: true,
        roleCode: 'finance'
      })

      const deactivateResult = userMgmt.deactivateAdditionalUser(db, financeUser!.id)
      expect(deactivateResult).toEqual({ success: true })
      const afterDeactivate = userMgmt.listUsers(db)
      expect(
        afterDeactivate.success &&
          afterDeactivate.users.find((u) => u.id === financeUser!.id)?.isActive
      ).toBe(false)

      const reactivateResult = userMgmt.reactivateAdditionalUser(db, financeUser!.id)
      expect(reactivateResult).toEqual({ success: true })
      const afterReactivate = userMgmt.listUsers(db)
      expect(
        afterReactivate.success &&
          afterReactivate.users.find((u) => u.id === financeUser!.id)?.isActive
      ).toBe(true)
    }, 20000)

    it('supports all three non-Owner roles', async () => {
      const { userMgmt } = await createServicesLoggedInAsOwner()
      for (const roleCode of NON_OWNER_ROLE_CODES) {
        const result = await userMgmt.createAdditionalUser(db, {
          displayName: `${roleCode} person`,
          loginIdentifier: `${roleCode}user`,
          password: REAL_PASSWORD,
          passwordConfirmation: REAL_PASSWORD,
          roleCode
        })
        expect(result).toEqual({ success: true })
      }
      const listed = userMgmt.listUsers(db)
      expect(listed.success && listed.users).toHaveLength(1 + NON_OWNER_ROLE_CODES.length)
    }, 20000)

    it('listUsers never includes a password hash anywhere in the result', async () => {
      const { userMgmt } = await createServicesLoggedInAsOwner()
      await userMgmt.createAdditionalUser(db, VALID_CREATE_INPUT)
      const result = userMgmt.listUsers(db)
      const serialized = JSON.stringify(result)
      expect(serialized).not.toMatch(/\$argon2id\$/)
      expect(serialized).not.toContain(REAL_PASSWORD)
    }, 20000)
  })

  describe('correction 1: exactly-one-Owner invariant preserved', () => {
    it('cannot create a user with roleCode "owner"', async () => {
      const { userMgmt } = await createServicesLoggedInAsOwner()
      const result = await userMgmt.createAdditionalUser(db, {
        ...VALID_CREATE_INPUT,
        roleCode: 'owner'
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
      expect(db.select().from(users).all()).toHaveLength(1)
    }, 20000)

    it('cannot create a user with a nonsense roleCode', async () => {
      const { userMgmt } = await createServicesLoggedInAsOwner()
      const result = await userMgmt.createAdditionalUser(db, {
        ...VALID_CREATE_INPUT,
        roleCode: 'superadmin'
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    }, 20000)

    it('the Owner cannot be deactivated', async () => {
      const { userMgmt } = await createServicesLoggedInAsOwner()
      const result = userMgmt.deactivateAdditionalUser(db, ownerId)
      expect(result).toEqual({ success: false, errorCode: 'cannot_modify_owner' })

      const stillActive = db
        .select()
        .from(users)
        .all()
        .find((u) => u.id === ownerId)
      expect(stillActive?.isActive).toBe(true)
    }, 20000)

    it('a second Owner-role holder (constructed directly, simulating a corrupted state) is also protected from deactivation', async () => {
      // There is no legitimate way to create a second Owner through this
      // service (createAdditionalUser's roleCode excludes 'owner'
      // entirely) — this test constructs the scenario directly to prove
      // the guard is based on the target's actual role, not merely "is
      // this the id the plan calls the Owner."
      const passwordHash = await hashPassword(REAL_PASSWORD)
      const secondOwner = db.transaction((tx) =>
        createUser(tx, {
          loginIdentifier: 'secondowner',
          displayName: 'Second Owner',
          passwordHash
        })
      )
      db.insert(userRoles)
        .values({ userId: secondOwner.id, roleId: 'role_owner', createdAt: new Date() })
        .run()

      const { userMgmt } = await createServicesLoggedInAsOwner()
      const result = userMgmt.deactivateAdditionalUser(db, secondOwner.id)
      expect(result).toEqual({ success: false, errorCode: 'cannot_modify_owner' })
    }, 20000)

    it('exposes no operation that could change an existing user\u2019s role', () => {
      const service = createUserManagementService({
        loginService: createLoginService({ sessionManager: createSessionManager() }),
        sessionManager: createSessionManager()
      })
      expect(Object.keys(service).sort()).toEqual(
        [
          'listUsers',
          'listAssignableRoles',
          'createAdditionalUser',
          'deactivateAdditionalUser',
          'reactivateAdditionalUser'
        ].sort()
      )
    })
  })

  describe('authorization: non-Owner callers are rejected', () => {
    it('a non-Owner session cannot list, create, deactivate, or reactivate', async () => {
      const passwordHash = await hashPassword(REAL_PASSWORD)
      const opsUser = db.transaction((tx) => {
        const user = createUser(tx, {
          loginIdentifier: 'opsuser',
          displayName: 'Ops',
          passwordHash
        })
        tx.insert(userRoles)
          .values({ userId: user.id, roleId: 'role_operations', createdAt: new Date() })
          .run()
        return user
      })

      const sessionManager = createSessionManager()
      const loginService = createLoginService({ sessionManager })
      const userMgmt = createUserManagementService({ loginService, sessionManager })
      await loginService.login(db, 'opsuser', REAL_PASSWORD)

      expect(userMgmt.listUsers(db)).toEqual({ success: false, errorCode: 'not_authorized' })
      expect(await userMgmt.createAdditionalUser(db, VALID_CREATE_INPUT)).toEqual({
        success: false,
        errorCode: 'not_authorized'
      })
      expect(userMgmt.deactivateAdditionalUser(db, opsUser.id)).toEqual({
        success: false,
        errorCode: 'not_authorized'
      })
      expect(userMgmt.reactivateAdditionalUser(db, opsUser.id)).toEqual({
        success: false,
        errorCode: 'not_authorized'
      })
    }, 20000)

    it('no session at all is rejected as session_invalid on every operation', async () => {
      const sessionManager = createSessionManager()
      const loginService = createLoginService({ sessionManager })
      const userMgmt = createUserManagementService({ loginService, sessionManager })

      expect(userMgmt.listUsers(db)).toEqual({ success: false, errorCode: 'session_invalid' })
      expect(await userMgmt.createAdditionalUser(db, VALID_CREATE_INPUT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    }, 20000)
  })

  describe('locked sessions have no application authority', () => {
    async function loginAndLock(): Promise<{
      loginService: ReturnType<typeof createLoginService>
      userMgmt: ReturnType<typeof createUserManagementService>
    }> {
      const sessionManager = createSessionManager()
      const loginService = createLoginService({ sessionManager })
      const userMgmt = createUserManagementService({ loginService, sessionManager })
      await loginService.login(db, 'ben', REAL_PASSWORD)

      loginService.startIdleLockTimer(db, { lockAfterIdleMs: 20, checkIntervalMs: 10 })
      await new Promise((resolve) => setTimeout(resolve, 100))
      loginService.dispose()
      expect(loginService.getSessionState(db).state).toBe('locked')

      return { loginService, userMgmt }
    }

    it('an Owner can manage users while the session is active (baseline)', async () => {
      const { userMgmt } = await createServicesLoggedInAsOwner()
      expect(userMgmt.listUsers(db).success).toBe(true)
    }, 20000)

    it('once locked, listUsers/createAdditionalUser/deactivateAdditionalUser/reactivateAdditionalUser all fail with session_invalid, with no database mutation', async () => {
      const sessionManager = createSessionManager()
      const loginService = createLoginService({ sessionManager })
      const userMgmt = createUserManagementService({ loginService, sessionManager })
      await loginService.login(db, 'ben', REAL_PASSWORD)

      await userMgmt.createAdditionalUser(db, VALID_CREATE_INPUT)
      const listResult = userMgmt.listUsers(db)
      const financeUserId =
        listResult.success && listResult.users.find((u) => u.loginIdentifier === 'financeuser')?.id
      expect(financeUserId).toBeDefined()

      loginService.startIdleLockTimer(db, { lockAfterIdleMs: 20, checkIntervalMs: 10 })
      await new Promise((resolve) => setTimeout(resolve, 100))
      loginService.dispose()
      expect(loginService.getSessionState(db).state).toBe('locked')

      const usersBefore = db.select().from(users).all()

      expect(userMgmt.listUsers(db)).toEqual({ success: false, errorCode: 'session_invalid' })
      expect(await userMgmt.createAdditionalUser(db, VALID_CREATE_INPUT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
      expect(userMgmt.deactivateAdditionalUser(db, financeUserId as string)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
      expect(userMgmt.reactivateAdditionalUser(db, financeUserId as string)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })

      const usersAfter = db.select().from(users).all()
      expect(usersAfter).toEqual(usersBefore)
      const financeRowAfter = usersAfter.find((u) => u.id === financeUserId)
      expect(financeRowAfter?.isActive).toBe(true) // unchanged by the rejected deactivate attempt
    }, 20000)

    it('correct-password unlock restores authority on the same session, without a new login', async () => {
      const { loginService, userMgmt } = await loginAndLock()

      expect(userMgmt.listUsers(db)).toEqual({ success: false, errorCode: 'session_invalid' })

      const unlockResult = await loginService.unlock(db, REAL_PASSWORD)
      expect(unlockResult.success).toBe(true)

      expect(userMgmt.listUsers(db).success).toBe(true)
    }, 20000)
  })

  describe('correction 2: successful deactivation invalidates all sessions for that user', () => {
    it('a deactivated user\u2019s own active session is torn down (surfaced as logged_out on their side)', async () => {
      const sessionManager = createSessionManager()
      const ownerLoginService = createLoginService({ sessionManager })
      const userMgmt = createUserManagementService({
        loginService: ownerLoginService,
        sessionManager
      })
      await ownerLoginService.login(db, 'ben', REAL_PASSWORD)

      await userMgmt.createAdditionalUser(db, VALID_CREATE_INPUT)
      const listResult = userMgmt.listUsers(db)
      const financeUserId =
        listResult.success && listResult.users.find((u) => u.loginIdentifier === 'financeuser')?.id
      expect(financeUserId).toBeDefined()

      // A second, independent login service instance sharing the same
      // sessionManager — as main/index.ts wires it — represents the
      // finance user's own separately-logged-in session.
      const financeLoginService = createLoginService({ sessionManager })
      await financeLoginService.login(db, 'financeuser', REAL_PASSWORD)
      expect(financeLoginService.getSessionState(db).state).toBe('active')

      userMgmt.deactivateAdditionalUser(db, financeUserId as string)

      expect(financeLoginService.getSessionState(db)).toEqual({ state: 'logged_out' })
    }, 20000)

    it("the session is removed from sessionManager's own store directly — not merely filtered out by loginService's independent user-active recheck", async () => {
      // This is the test that actually isolates
      // sessionManager.invalidateAllForUser being called: loginService
      // itself independently rechecks user.isActive on every read (see
      // its own resolveLiveSession), which alone would already make
      // getSessionState report logged_out even without this explicit
      // invalidation. Bypassing loginService entirely — creating the
      // session directly via sessionManager, so this test can hold the
      // real sessionId — and checking sessionManager.get() (a pure,
      // non-mutating read) directly before and after is what actually
      // proves the raw session data itself was torn down.
      const sessionManager = createSessionManager()
      const ownerLoginService = createLoginService({ sessionManager })
      const userMgmt = createUserManagementService({
        loginService: ownerLoginService,
        sessionManager
      })
      await ownerLoginService.login(db, 'ben', REAL_PASSWORD)
      await userMgmt.createAdditionalUser(db, VALID_CREATE_INPUT)
      const listResult = userMgmt.listUsers(db)
      const financeUserId =
        listResult.success && listResult.users.find((u) => u.loginIdentifier === 'financeuser')?.id
      expect(financeUserId).toBeDefined()

      const financeSession = sessionManager.create(financeUserId as string, PRIMARY_COMPANY_ID, [
        'finance'
      ])
      expect(sessionManager.get(financeSession.sessionId)).toBeDefined()

      userMgmt.deactivateAdditionalUser(db, financeUserId as string)

      expect(sessionManager.get(financeSession.sessionId)).toBeUndefined()
    }, 20000)
  })

  describe('correction 3: fresh authorization, not session-cached', () => {
    it('a caller whose Owner role is removed mid-session loses users.manage access on the very next call', async () => {
      const { userMgmt } = await createServicesLoggedInAsOwner()
      expect(userMgmt.listUsers(db).success).toBe(true)

      // No legitimate operation can do this (by design), so it's
      // simulated directly to prove the check is genuinely fresh, not
      // relying on whatever roleCodes the session snapshot cached at
      // login time.
      db.delete(userRoles).where(eq(userRoles.userId, ownerId)).run()

      expect(userMgmt.listUsers(db)).toEqual({ success: false, errorCode: 'not_authorized' })
    }, 20000)
  })

  describe('correction 4: hash-then-revalidate for user creation', () => {
    it('user creation succeeds when the same active Owner remains current throughout', async () => {
      const { userMgmt } = await createServicesLoggedInAsOwner()
      const outcome = await userMgmt.createAdditionalUser(db, VALID_CREATE_INPUT)
      expect(outcome).toEqual({ success: true })
      expect(db.select().from(users).all()).toHaveLength(2)
    }, 20000)

    it('a create-user call paused during hashing is rejected if the calling Owner is deactivated before the hash resolves; no row is written', async () => {
      const { userMgmt } = await createServicesLoggedInAsOwner()

      const hashSpy = vi.spyOn(passwordHashingModule, 'hashPassword')
      let resolveHash!: (value: passwordHashingModule.PasswordHash) => void
      const deferredHash = new Promise<passwordHashingModule.PasswordHash>((resolve) => {
        resolveHash = resolve
      })
      hashSpy.mockImplementationOnce(() => deferredHash)

      const createPromise = userMgmt.createAdditionalUser(db, VALID_CREATE_INPUT)

      // While the hash is still pending, the calling Owner is
      // deactivated by a completely different path (simulating a
      // concurrent admin action, or a bug elsewhere) — not through
      // userMgmt itself, which would refuse (correction 1 guard).
      deactivateUser(db, ownerId)

      const realHash = await passwordHashingModule.hashPassword(REAL_PASSWORD)
      resolveHash(realHash)

      const outcome = await createPromise
      expect(outcome).toEqual({ success: false, errorCode: 'session_invalid' })
      expect(db.select().from(users).all()).toHaveLength(1)
    }, 20000)

    it('logout during hashing prevents creation; no row is written', async () => {
      const { loginService, userMgmt } = await createServicesLoggedInAsOwner()

      const hashSpy = vi.spyOn(passwordHashingModule, 'hashPassword')
      let resolveHash!: (value: passwordHashingModule.PasswordHash) => void
      const deferredHash = new Promise<passwordHashingModule.PasswordHash>((resolve) => {
        resolveHash = resolve
      })
      hashSpy.mockImplementationOnce(() => deferredHash)

      const createPromise = userMgmt.createAdditionalUser(db, VALID_CREATE_INPUT)

      loginService.logout()

      const realHash = await passwordHashingModule.hashPassword(REAL_PASSWORD)
      resolveHash(realHash)

      const outcome = await createPromise
      expect(outcome).toEqual({ success: false, errorCode: 'session_invalid' })
      expect(db.select().from(users).all()).toHaveLength(1)
    }, 20000)

    it('lock during hashing prevents creation; no row is written', async () => {
      const { loginService, userMgmt } = await createServicesLoggedInAsOwner()

      const hashSpy = vi.spyOn(passwordHashingModule, 'hashPassword')
      let resolveHash!: (value: passwordHashingModule.PasswordHash) => void
      const deferredHash = new Promise<passwordHashingModule.PasswordHash>((resolve) => {
        resolveHash = resolve
      })
      hashSpy.mockImplementationOnce(() => deferredHash)

      const createPromise = userMgmt.createAdditionalUser(db, VALID_CREATE_INPUT)

      loginService.startIdleLockTimer(db, { lockAfterIdleMs: 5, checkIntervalMs: 5 })
      await new Promise((resolve) => setTimeout(resolve, 50))
      loginService.dispose()
      expect(loginService.getSessionState(db).state).toBe('locked')

      const realHash = await passwordHashingModule.hashPassword(REAL_PASSWORD)
      resolveHash(realHash)

      const outcome = await createPromise
      expect(outcome).toEqual({ success: false, errorCode: 'session_invalid' })
      expect(db.select().from(users).all()).toHaveLength(1)
    }, 20000)

    it('replacing the current session with a different authenticated user during hashing prevents creation; no row is written', async () => {
      const { loginService, userMgmt } = await createServicesLoggedInAsOwner()

      // A second Owner-role holder, constructed directly — there is no
      // legitimate way to create one through this service (roleCode
      // excludes 'owner' entirely). This scenario specifically needs a
      // *different, still-authorized* caller to isolate the identity
      // comparison from the authorization check itself — a non-Owner
      // replacement would already be caught by requireOwnerCaller's own
      // assertCan, without needing an id comparison at all.
      const secondOwnerPasswordHash = await hashPassword(REAL_PASSWORD)
      db.transaction((tx) => {
        const secondOwner = createUser(tx, {
          loginIdentifier: 'secondowner',
          displayName: 'Second Owner',
          passwordHash: secondOwnerPasswordHash
        })
        tx.insert(userRoles)
          .values({ userId: secondOwner.id, roleId: 'role_owner', createdAt: new Date() })
          .run()
      })

      const hashSpy = vi.spyOn(passwordHashingModule, 'hashPassword')
      let resolveHash!: (value: passwordHashingModule.PasswordHash) => void
      const deferredHash = new Promise<passwordHashingModule.PasswordHash>((resolve) => {
        resolveHash = resolve
      })
      hashSpy.mockImplementationOnce(() => deferredHash)

      const createPromise = userMgmt.createAdditionalUser(db, VALID_CREATE_INPUT)

      // Session replaced mid-hash: one-current-session replacement
      // means logging in as the second Owner destroys the first
      // Owner's session and makes this "the current session" instead —
      // still a valid Owner, just not the same one who started this.
      await loginService.login(db, 'secondowner', REAL_PASSWORD)

      const realHash = await passwordHashingModule.hashPassword(REAL_PASSWORD)
      resolveHash(realHash)

      const outcome = await createPromise
      expect(outcome).toEqual({ success: false, errorCode: 'session_invalid' })
      // owner + secondowner only — no financeuser row from the rejected call
      expect(db.select().from(users).all()).toHaveLength(2)
    }, 20000)
  })

  describe('validation and error mapping', () => {
    it('rejects a password/passwordConfirmation mismatch as invalid_input', async () => {
      const { userMgmt } = await createServicesLoggedInAsOwner()
      const result = await userMgmt.createAdditionalUser(db, {
        ...VALID_CREATE_INPUT,
        passwordConfirmation: 'a-different-password-2'
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    }, 20000)

    it('rejects a duplicate login identifier', async () => {
      const { userMgmt } = await createServicesLoggedInAsOwner()
      await userMgmt.createAdditionalUser(db, VALID_CREATE_INPUT)
      const result = await userMgmt.createAdditionalUser(db, VALID_CREATE_INPUT)
      expect(result).toEqual({ success: false, errorCode: 'duplicate_login_identifier' })
    }, 20000)

    it('rejects an empty display name', async () => {
      const { userMgmt } = await createServicesLoggedInAsOwner()
      const result = await userMgmt.createAdditionalUser(db, {
        ...VALID_CREATE_INPUT,
        displayName: '   '
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    }, 20000)

    it('deactivating a nonexistent user reports unexpected_error, not a crash', async () => {
      const { userMgmt } = await createServicesLoggedInAsOwner()
      const result = userMgmt.deactivateAdditionalUser(db, 'user_does_not_exist')
      expect(result).toEqual({ success: false, errorCode: 'unexpected_error' })
    }, 20000)
  })
})
