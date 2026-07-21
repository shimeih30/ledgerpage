import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { seedRoles } from '../../../src/main/db/seedRoles'
import { createCompany } from '../../../src/main/db/companyService'
import { createUser, deactivateUser } from '../../../src/main/auth/userService'
import { hashPassword } from '../../../src/main/auth/passwordHashing'
import { createSessionManager } from '../../../src/main/auth/sessionManager'
import { createLoginService, type LoginService } from '../../../src/main/users/loginService'
import { requireAuthorizedCaller } from '../../../src/main/auth/requireAuthorizedCaller'
import { userRoles } from '../../../src/main/db/schema'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const REAL_PASSWORD = 'a-strong-password-1'

describe('requireAuthorizedCaller', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    dir = createTempDir('ledgerpage-require-authorized-caller')
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

  async function loginAs(loginIdentifier: string): Promise<{ loginService: LoginService }> {
    const sessionManager = createSessionManager()
    const loginService = createLoginService({ sessionManager })
    await loginService.login(db, loginIdentifier, REAL_PASSWORD)
    return { loginService }
  }

  it('an active Owner succeeds for audit.read', async () => {
    await createUserWithRole('owner1', 'role_owner')
    const { loginService } = await loginAs('owner1')

    const result = requireAuthorizedCaller(db, loginService, 'audit.read')
    expect(result.ok).toBe(true)
  }, 20000)

  it('an active Executive succeeds for audit.read', async () => {
    await createUserWithRole('exec1', 'role_executive')
    const { loginService } = await loginAs('exec1')

    const result = requireAuthorizedCaller(db, loginService, 'audit.read')
    expect(result.ok).toBe(true)
  }, 20000)

  it('an active Finance user succeeds for audit.read', async () => {
    await createUserWithRole('fin1', 'role_finance')
    const { loginService } = await loginAs('fin1')

    const result = requireAuthorizedCaller(db, loginService, 'audit.read')
    expect(result.ok).toBe(true)
  }, 20000)

  it('an active Operations user is rejected as not_authorized for audit.read', async () => {
    await createUserWithRole('ops1', 'role_operations')
    const { loginService } = await loginAs('ops1')

    const result = requireAuthorizedCaller(db, loginService, 'audit.read')
    expect(result).toEqual({ ok: false, errorCode: 'not_authorized' })
  }, 20000)

  it('a logged-out caller (no session at all) is rejected as session_invalid', () => {
    const sessionManager = createSessionManager()
    const loginService = createLoginService({ sessionManager })

    const result = requireAuthorizedCaller(db, loginService, 'audit.read')
    expect(result).toEqual({ ok: false, errorCode: 'session_invalid' })
  })

  it('a locked session is rejected as session_invalid, even for an Owner', async () => {
    await createUserWithRole('owner2', 'role_owner')
    const { loginService } = await loginAs('owner2')

    loginService.startIdleLockTimer(db, { lockAfterIdleMs: 20, checkIntervalMs: 10 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    loginService.dispose()
    expect(loginService.getSessionState(db).state).toBe('locked')

    const result = requireAuthorizedCaller(db, loginService, 'audit.read')
    expect(result).toEqual({ ok: false, errorCode: 'session_invalid' })
  }, 20000)

  it('a hard-expired session is rejected as session_invalid', async () => {
    const fixedNow = { value: new Date('2026-01-01T00:00:00.000Z') }
    await createUserWithRole('owner3', 'role_owner')
    const sessionManager = createSessionManager({ idleTimeoutMs: 1000, now: () => fixedNow.value })
    const loginService = createLoginService({ sessionManager, now: () => fixedNow.value })
    await loginService.login(db, 'owner3', REAL_PASSWORD)

    fixedNow.value = new Date(fixedNow.value.getTime() + 2000)

    const result = requireAuthorizedCaller(db, loginService, 'audit.read')
    expect(result).toEqual({ ok: false, errorCode: 'session_invalid' })
  }, 20000)

  it('a deactivated user\u2019s session is rejected as session_invalid', async () => {
    const userId = await createUserWithRole('owner4', 'role_owner')
    const { loginService } = await loginAs('owner4')
    expect(loginService.getSessionState(db).state).toBe('active')

    deactivateUser(db, userId)

    const result = requireAuthorizedCaller(db, loginService, 'audit.read')
    expect(result).toEqual({ ok: false, errorCode: 'session_invalid' })
  }, 20000)

  it('fresh SQLite roles override whatever roles were cached at login time', async () => {
    const userId = await createUserWithRole('owner5', 'role_owner')
    const { loginService } = await loginAs('owner5')
    expect(requireAuthorizedCaller(db, loginService, 'audit.read').ok).toBe(true)

    // No legitimate operation can do this (by design) — simulated
    // directly to prove the check is genuinely fresh, not relying on
    // whatever roleCodes sessionManager cached at login time.
    db.delete(userRoles).run()
    db.insert(userRoles).values({ userId, roleId: 'role_operations', createdAt: new Date() }).run()

    const result = requireAuthorizedCaller(db, loginService, 'audit.read')
    expect(result).toEqual({ ok: false, errorCode: 'not_authorized' })
  }, 20000)

  it('returns the caller\u2019s own userId on success', async () => {
    const userId = await createUserWithRole('owner6', 'role_owner')
    const { loginService } = await loginAs('owner6')

    const result = requireAuthorizedCaller(db, loginService, 'audit.read')
    expect(result).toEqual({ ok: true, callerUserId: userId })
  }, 20000)
})
