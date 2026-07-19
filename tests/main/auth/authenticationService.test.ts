import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import {
  createUser,
  deactivateUser,
  getUserAuthRecordByLoginIdentifier
} from '../../../src/main/auth/userService'
import {
  authenticate,
  LOCK_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS
} from '../../../src/main/auth/authenticationService'
import * as passwordHashing from '../../../src/main/auth/passwordHashing'
import { DUMMY_PASSWORD_HASH, hashPassword } from '../../../src/main/auth/passwordHashing'
import { loginEvents } from '../../../src/main/db/schema'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const REAL_PASSWORD = 'correct-password-123'

describe('authenticationService.authenticate', () => {
  let dir: string
  let dbPath: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(async () => {
    dir = createTempDir('ledgerpage-authentication-service')
    dbPath = join(dir, 'ledgerpage.db')
    rawDb = createDatabaseConnection(dbPath)
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    db = drizzle<Record<string, never>>(rawDb)

    createCompany(db, {
      name: 'Fixture Co',
      address: 'Addr',
      contactDetails: 'contact@example.com',
      currencyId: 'currency_usd'
    })

    const passwordHash = await hashPassword(REAL_PASSWORD)
    db.transaction((tx) =>
      createUser(tx, { loginIdentifier: 'ben', displayName: 'Ben', passwordHash })
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rawDb.close()
    removeTempDir(dir)
  })

  it('a nonexistent identifier and a wrong password both return the exact same public failure shape', async () => {
    const nonexistentResult = await authenticate(
      db,
      'nobody',
      'irrelevant-password',
      'normal_login'
    )
    const wrongPasswordResult = await authenticate(db, 'ben', 'wrong-password', 'normal_login')

    expect(nonexistentResult).toEqual({ success: false })
    expect(wrongPasswordResult).toEqual({ success: false })
  })

  it('an inactive user returns the same ordinary failure result as a wrong password', async () => {
    const user = getUserAuthRecordByLoginIdentifier(db, 'ben')!
    deactivateUser(db, user.id)

    const inactiveResult = await authenticate(db, 'ben', REAL_PASSWORD, 'normal_login')
    expect(inactiveResult).toEqual({ success: false })
  })

  it('verification runs for a nonexistent identifier, against the fixed dummy hash', async () => {
    const spy = vi.spyOn(passwordHashing, 'verifyPassword')

    await authenticate(db, 'nobody-such-user', 'some-password', 'normal_login')

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('some-password', DUMMY_PASSWORD_HASH)
  })

  it('verification runs for a real user with a wrong password, against the real stored hash', async () => {
    const user = getUserAuthRecordByLoginIdentifier(db, 'ben')!
    const spy = vi.spyOn(passwordHashing, 'verifyPassword')

    await authenticate(db, 'ben', 'wrong-password', 'normal_login')

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('wrong-password', user.passwordHash)
  })

  it('verification runs even for an already-inactive user (no early-return shortcut)', async () => {
    const user = getUserAuthRecordByLoginIdentifier(db, 'ben')!
    deactivateUser(db, user.id)
    const spy = vi.spyOn(passwordHashing, 'verifyPassword')

    await authenticate(db, 'ben', REAL_PASSWORD, 'normal_login')

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(REAL_PASSWORD, user.passwordHash)
  })

  it('a nonexistent identifier never appears anywhere in login_events, and user_id is NULL', async () => {
    await authenticate(db, 'attacker-tried-this-username', 'whatever', 'normal_login')

    const rows = db.select().from(loginEvents).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].userId).toBeNull()
    expect(rows[0].success).toBe(false)

    const rawContents = JSON.stringify(rows)
    expect(rawContents).not.toContain('attacker-tried-this-username')
  })

  it('successful login events and failure events contain no credential data', async () => {
    await authenticate(db, 'ben', 'wrong-password', 'normal_login')
    await authenticate(db, 'ben', REAL_PASSWORD, 'normal_login')

    const rows = db.select().from(loginEvents).all()
    const rawContents = JSON.stringify(rows)
    expect(rawContents).not.toContain(REAL_PASSWORD)
    expect(rawContents).not.toContain('wrong-password')
    // No hash-looking field either — login_events has no such column, but
    // guard against an accidental future field carrying one through.
    expect(rawContents).not.toContain('argon2')
  })

  it('the returned safe user on success contains no passwordHash', async () => {
    const result = await authenticate(db, 'ben', REAL_PASSWORD, 'normal_login')
    expect(result.success).toBe(true)
    if (result.success) {
      expect('passwordHash' in result.user).toBe(false)
    }
  })

  it('failed attempts increment failed_login_count for a real user', async () => {
    await authenticate(db, 'ben', 'wrong-password', 'normal_login')
    const afterOne = getUserAuthRecordByLoginIdentifier(db, 'ben')!
    expect(afterOne.failedLoginCount).toBe(1)

    await authenticate(db, 'ben', 'wrong-password', 'normal_login')
    const afterTwo = getUserAuthRecordByLoginIdentifier(db, 'ben')!
    expect(afterTwo.failedLoginCount).toBe(2)
  })

  it('a nonexistent identifier never creates or affects any real user row', async () => {
    const before = getUserAuthRecordByLoginIdentifier(db, 'ben')!

    await authenticate(db, 'attacker', 'whatever', 'normal_login')

    const after = getUserAuthRecordByLoginIdentifier(db, 'ben')!
    expect(after.failedLoginCount).toBe(before.failedLoginCount)

    const userCount = (rawDb.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c
    expect(userCount).toBe(1) // still just "ben" — no row created for "attacker"
  })

  it('locks the account for LOCK_DURATION_MS after MAX_FAILED_LOGIN_ATTEMPTS failed attempts', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i += 1) {
      await authenticate(db, 'ben', 'wrong-password', 'normal_login', now)
    }

    const locked = getUserAuthRecordByLoginIdentifier(db, 'ben')!
    expect(locked.failedLoginCount).toBe(MAX_FAILED_LOGIN_ATTEMPTS)
    expect(locked.lockedUntil).not.toBeNull()
    expect(locked.lockedUntil?.getTime()).toBe(now.getTime() + LOCK_DURATION_MS)
  }, 20000)

  it('a locked user cannot authenticate even with the correct password, and lock expires at the correct injected time', async () => {
    const lockStart = new Date('2026-01-01T00:00:00.000Z')
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i += 1) {
      await authenticate(db, 'ben', 'wrong-password', 'normal_login', lockStart)
    }

    const stillLockedTime = new Date(lockStart.getTime() + LOCK_DURATION_MS - 1)
    const stillLockedResult = await authenticate(
      db,
      'ben',
      REAL_PASSWORD,
      'normal_login',
      stillLockedTime
    )
    expect(stillLockedResult).toEqual({ success: false })

    const justAfterExpiryTime = new Date(lockStart.getTime() + LOCK_DURATION_MS + 1)
    const afterExpiryResult = await authenticate(
      db,
      'ben',
      REAL_PASSWORD,
      'normal_login',
      justAfterExpiryTime
    )
    expect(afterExpiryResult.success).toBe(true)
  }, 20000)

  it('successful login resets failed_login_count and locked_until', async () => {
    await authenticate(db, 'ben', 'wrong-password', 'normal_login')
    await authenticate(db, 'ben', 'wrong-password', 'normal_login')

    const midway = getUserAuthRecordByLoginIdentifier(db, 'ben')!
    expect(midway.failedLoginCount).toBe(2)

    const result = await authenticate(db, 'ben', REAL_PASSWORD, 'normal_login')
    expect(result.success).toBe(true)

    const after = getUserAuthRecordByLoginIdentifier(db, 'ben')!
    expect(after.failedLoginCount).toBe(0)
    expect(after.lockedUntil).toBeNull()
  }, 20000)

  it('a correct password submitted while locked does not itself further increment the failure counter', async () => {
    const lockStart = new Date('2026-01-01T00:00:00.000Z')
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i += 1) {
      await authenticate(db, 'ben', 'wrong-password', 'normal_login', lockStart)
    }
    const afterLockout = getUserAuthRecordByLoginIdentifier(db, 'ben')!
    expect(afterLockout.failedLoginCount).toBe(MAX_FAILED_LOGIN_ATTEMPTS)

    await authenticate(db, 'ben', REAL_PASSWORD, 'normal_login', lockStart)

    const afterCorrectAttempt = getUserAuthRecordByLoginIdentifier(db, 'ben')!
    expect(afterCorrectAttempt.failedLoginCount).toBe(MAX_FAILED_LOGIN_ATTEMPTS)
  }, 20000)

  it('a malformed/empty login identifier is treated exactly like a nonexistent user, not a distinct error', async () => {
    const result = await authenticate(db, '   ', 'whatever', 'normal_login')
    expect(result).toEqual({ success: false })

    const rows = db.select().from(loginEvents).all()
    expect(rows[rows.length - 1].userId).toBeNull()
  })

  describe('serialized concurrent authentication (fix 5: no undercounting under concurrency)', () => {
    it('simultaneous failed attempts against the same user are all counted, none lost', async () => {
      const concurrentAttempts = 4

      await Promise.all(
        Array.from({ length: concurrentAttempts }, () =>
          authenticate(db, 'ben', 'wrong-password', 'normal_login')
        )
      )

      const after = getUserAuthRecordByLoginIdentifier(db, 'ben')!
      expect(after.failedLoginCount).toBe(concurrentAttempts)
    }, 20000)

    it('the lockout threshold cannot be bypassed by firing attempts concurrently', async () => {
      // One more concurrent attempt than the threshold — every one of
      // them must still be individually counted (proving no pair of
      // calls raced past each other and undercounted), and the account
      // must end up locked exactly once the threshold is reached.
      const concurrentAttempts = MAX_FAILED_LOGIN_ATTEMPTS + 1

      await Promise.all(
        Array.from({ length: concurrentAttempts }, () =>
          authenticate(db, 'ben', 'wrong-password', 'normal_login')
        )
      )

      const after = getUserAuthRecordByLoginIdentifier(db, 'ben')!
      expect(after.failedLoginCount).toBe(concurrentAttempts)
      expect(after.lockedUntil).not.toBeNull()
    }, 20000)

    it('every concurrent attempt produces exactly one login_events row, all paired correctly with the final state', async () => {
      const concurrentAttempts = 3

      await Promise.all(
        Array.from({ length: concurrentAttempts }, () =>
          authenticate(db, 'ben', 'wrong-password', 'normal_login')
        )
      )

      const rows = db.select().from(loginEvents).all()
      expect(rows).toHaveLength(concurrentAttempts)
      expect(rows.every((row) => row.success === false)).toBe(true)
      expect(
        rows.every((row) => row.userId === getUserAuthRecordByLoginIdentifier(db, 'ben')!.id)
      ).toBe(true)
    }, 20000)

    it('concurrent attempts against a nonexistent identifier still create no user row and no counted state', async () => {
      await Promise.all(
        Array.from({ length: 3 }, () =>
          authenticate(db, 'nobody-at-all', 'whatever', 'normal_login')
        )
      )

      const userCount = (rawDb.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c
      expect(userCount).toBe(1) // still just "ben" from beforeEach

      const rows = db.select().from(loginEvents).all()
      expect(rows.every((row) => row.userId === null)).toBe(true)
    }, 20000)

    it('a concurrent mix of one correct and several wrong attempts still resolves each on the fresh state at its turn', async () => {
      const results = await Promise.all([
        authenticate(db, 'ben', 'wrong-password', 'normal_login'),
        authenticate(db, 'ben', 'wrong-password', 'normal_login'),
        authenticate(db, 'ben', REAL_PASSWORD, 'normal_login')
      ])

      // Exactly one of the three succeeded (the correct-password one),
      // regardless of queue ordering.
      expect(results.filter((r) => r.success)).toHaveLength(1)
    }, 20000)
  })
})
