import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as sessionManagerModule from '../../../src/main/auth/sessionManager'
import {
  createSessionManager,
  DEFAULT_IDLE_TIMEOUT_MS,
  SessionManagerError
} from '../../../src/main/auth/sessionManager'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import {
  createUser,
  deactivateUser,
  getUserAuthRecordByLoginIdentifier
} from '../../../src/main/auth/userService'
import { hashPassword } from '../../../src/main/auth/passwordHashing'
import * as passwordHashing from '../../../src/main/auth/passwordHashing'
import {
  authenticate,
  MAX_FAILED_LOGIN_ATTEMPTS
} from '../../../src/main/auth/authenticationService'
import { loginEvents } from '../../../src/main/db/schema'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const FIXED_START = new Date('2026-01-01T00:00:00.000Z')
const REAL_PASSWORD = 'correct-password-123'

function fixedClock(startTime = FIXED_START) {
  let current = startTime
  return {
    now: () => current,
    advanceBy: (ms: number) => {
      current = new Date(current.getTime() + ms)
    }
  }
}

function counterRandomId() {
  let counter = 0
  return () => `test-session-id-${(counter += 1)}`
}

describe('sessionManager', () => {
  it('generates opaque, unique session IDs by default (real CSPRNG source)', () => {
    const manager = createSessionManager()
    const a = manager.create('user1', 'primary_company', ['owner'])
    const b = manager.create('user1', 'primary_company', ['owner'])
    expect(a.sessionId).not.toBe(b.sessionId)
    expect(a.sessionId.length).toBeGreaterThanOrEqual(32)
  })

  it('create returns a snapshot with the expected shape', () => {
    const clock = fixedClock()
    const manager = createSessionManager({ now: clock.now, randomId: counterRandomId() })
    const session = manager.create('user1', 'primary_company', ['owner', 'finance'])

    expect(session).toEqual({
      sessionId: 'test-session-id-1',
      userId: 'user1',
      companyId: 'primary_company',
      roleCodes: ['owner', 'finance'],
      createdAt: FIXED_START,
      lastActivityAt: FIXED_START,
      isLocked: false
    })
  })

  it('get returns a snapshot for a live session', () => {
    const clock = fixedClock()
    const manager = createSessionManager({ now: clock.now, randomId: counterRandomId() })
    const created = manager.create('user1', 'primary_company', ['owner'])

    expect(manager.get(created.sessionId)).toEqual(created)
  })

  it('get returns undefined for an unknown session ID', () => {
    const manager = createSessionManager()
    expect(manager.get('does-not-exist')).toBeUndefined()
  })

  describe('mutable-state isolation (clones every Date and array on the way out and in)', () => {
    it('mutating a returned snapshot roleCodes array does not affect the stored session', () => {
      const manager = createSessionManager({ randomId: counterRandomId() })
      const created = manager.create('user1', 'primary_company', ['owner'])

      const snapshot = manager.get(created.sessionId)!
      ;(snapshot.roleCodes as string[]).push('hacked_role')

      const fresh = manager.get(created.sessionId)!
      expect(fresh.roleCodes).toEqual(['owner'])
    })

    it('mutating a returned snapshot isLocked flag directly does not affect the stored session', () => {
      const manager = createSessionManager({ randomId: counterRandomId() })
      const created = manager.create('user1', 'primary_company', ['owner'])

      const snapshot = manager.get(created.sessionId)!
      snapshot.isLocked = true

      const fresh = manager.get(created.sessionId)!
      expect(fresh.isLocked).toBe(false)
    })

    it('mutating snapshot.createdAt does not alter the stored session', () => {
      const manager = createSessionManager({ randomId: counterRandomId() })
      const created = manager.create('user1', 'primary_company', ['owner'])
      const originalTime = created.createdAt.getTime()

      const snapshot = manager.get(created.sessionId)!
      snapshot.createdAt.setFullYear(1999)

      const fresh = manager.get(created.sessionId)!
      expect(fresh.createdAt.getTime()).toBe(originalTime)
    })

    it('mutating snapshot.lastActivityAt does not alter the stored session', () => {
      const manager = createSessionManager({ randomId: counterRandomId() })
      const created = manager.create('user1', 'primary_company', ['owner'])
      const originalTime = created.lastActivityAt.getTime()

      const snapshot = manager.get(created.sessionId)!
      snapshot.lastActivityAt.setFullYear(1999)

      const fresh = manager.get(created.sessionId)!
      expect(fresh.lastActivityAt.getTime()).toBe(originalTime)
    })

    it('mutating a Date passed in via the injectable clock after create() does not alter the stored session', () => {
      const mutableNow = new Date(FIXED_START.getTime())
      const manager = createSessionManager({ now: () => mutableNow, randomId: counterRandomId() })
      const created = manager.create('user1', 'primary_company', ['owner'])

      mutableNow.setFullYear(1999)

      const fresh = manager.get(created.sessionId)!
      expect(fresh.createdAt.getTime()).toBe(FIXED_START.getTime())
    })
  })

  it('touch refreshes lastActivityAt', () => {
    const clock = fixedClock()
    const manager = createSessionManager({ now: clock.now, randomId: counterRandomId() })
    const created = manager.create('user1', 'primary_company', ['owner'])

    clock.advanceBy(5000)
    const touched = manager.touch(created.sessionId)

    expect(touched?.lastActivityAt.getTime()).toBe(FIXED_START.getTime() + 5000)
    expect(touched?.createdAt).toEqual(FIXED_START)
  })

  it('touch on an unknown session returns undefined', () => {
    const manager = createSessionManager()
    expect(manager.touch('does-not-exist')).toBeUndefined()
  })

  it('idle expiration works with an injected clock: a session past the timeout is rejected and removed', () => {
    const clock = fixedClock()
    const manager = createSessionManager({
      now: clock.now,
      randomId: counterRandomId(),
      idleTimeoutMs: 1000
    })
    const created = manager.create('user1', 'primary_company', ['owner'])

    clock.advanceBy(1001)

    expect(manager.get(created.sessionId)).toBeUndefined()
  })

  it('a session touched right before the deadline stays alive', () => {
    const clock = fixedClock()
    const manager = createSessionManager({
      now: clock.now,
      randomId: counterRandomId(),
      idleTimeoutMs: 1000
    })
    const created = manager.create('user1', 'primary_company', ['owner'])

    clock.advanceBy(900)
    expect(manager.touch(created.sessionId)).toBeDefined()

    clock.advanceBy(900)
    expect(manager.get(created.sessionId)).toBeDefined()
  })

  it('uses the documented default idle timeout when none is supplied', () => {
    expect(DEFAULT_IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000)
  })

  describe('idleTimeoutMs validation', () => {
    it.each([0, -1, NaN, Infinity, 1.5, -1000])(
      'rejects an invalid idleTimeoutMs value: %s',
      (value) => {
        expect(() => createSessionManager({ idleTimeoutMs: value })).toThrow(SessionManagerError)
      }
    )

    it('accepts a valid positive finite integer idleTimeoutMs', () => {
      expect(() => createSessionManager({ idleTimeoutMs: 60000 })).not.toThrow()
    })
  })

  describe('randomId validation and collision handling', () => {
    it('rejects an empty string returned by randomId', () => {
      const manager = createSessionManager({ randomId: () => '' })
      expect(() => manager.create('user1', 'primary_company', ['owner'])).toThrow(
        SessionManagerError
      )
    })

    it('regenerates on a colliding ID from an already-live session rather than overwriting it', () => {
      let calls = 0
      const manager = createSessionManager({
        randomId: () => {
          calls += 1
          return calls <= 2 ? 'always-the-same-id' : `unique-id-${String(calls)}`
        }
      })

      const first = manager.create('user1', 'primary_company', ['owner'])
      expect(first.sessionId).toBe('always-the-same-id')

      const second = manager.create('user2', 'primary_company', ['finance'])
      expect(second.sessionId).not.toBe('always-the-same-id')
      expect(manager.get(first.sessionId)?.userId).toBe('user1')
    })

    it('fails with a controlled SessionManagerError after exhausting the retry budget', () => {
      const manager = createSessionManager({ randomId: () => 'always-colliding-id' })
      manager.create('user1', 'primary_company', ['owner'])

      expect(() => manager.create('user2', 'primary_company', ['finance'])).toThrow(
        SessionManagerError
      )
    })

    it('an ID colliding only with an EXPIRED session is reused without error', () => {
      const clock = fixedClock()
      const manager = createSessionManager({
        now: clock.now,
        randomId: () => 'reusable-id',
        idleTimeoutMs: 1000
      })
      const first = manager.create('user1', 'primary_company', ['owner'])
      clock.advanceBy(2000)

      const second = manager.create('user2', 'primary_company', ['finance'])
      expect(second.sessionId).toBe('reusable-id')
      expect(manager.get(second.sessionId)?.userId).toBe('user2')
      void first
    })
  })

  it('lock sets isLocked true', () => {
    const manager = createSessionManager({ randomId: counterRandomId() })
    const created = manager.create('user1', 'primary_company', ['owner'])

    const locked = manager.lock(created.sessionId)
    expect(locked?.isLocked).toBe(true)
  })

  it('destroy removes the session', () => {
    const manager = createSessionManager({ randomId: counterRandomId() })
    const created = manager.create('user1', 'primary_company', ['owner'])

    expect(manager.destroy(created.sessionId)).toBe(true)
    expect(manager.get(created.sessionId)).toBeUndefined()
  })

  it('destroy on an already-gone session returns false', () => {
    const manager = createSessionManager()
    expect(manager.destroy('does-not-exist')).toBe(false)
  })

  it("invalidateAllForUser removes only that user's sessions, leaving others untouched", () => {
    let counter = 0
    const manager = createSessionManager({ randomId: () => `session-${(counter += 1)}` })
    const a1 = manager.create('userA', 'primary_company', ['owner'])
    const a2 = manager.create('userA', 'primary_company', ['owner'])
    const b1 = manager.create('userB', 'primary_company', ['finance'])

    const removedCount = manager.invalidateAllForUser('userA')

    expect(removedCount).toBe(2)
    expect(manager.get(a1.sessionId)).toBeUndefined()
    expect(manager.get(a2.sessionId)).toBeUndefined()
    expect(manager.get(b1.sessionId)).toBeDefined()
  })

  it('two independent manager instances never share state', () => {
    const managerA = createSessionManager({ randomId: () => 'same-id-both-managers' })
    const managerB = createSessionManager({ randomId: () => 'same-id-both-managers' })

    managerA.create('userA', 'primary_company', ['owner'])

    expect(managerB.get('same-id-both-managers')).toBeUndefined()
  })

  describe('no exported raw/credential-free unlock capability exists', () => {
    it('the module exports no applyVerifiedUnlock or any equivalent raw mutator', () => {
      const exportedNames = Object.keys(sessionManagerModule)
      for (const forbidden of ['applyVerifiedUnlock', 'unlock', 'forceUnlock', 'rawUnlock']) {
        expect(exportedNames).not.toContain(forbidden)
      }
      // The module's only function exports should be the factory and
      // the error class constructor — nothing else callable.
      const exportedFunctionNames = exportedNames.filter((key) => {
        const value = (sessionManagerModule as Record<string, unknown>)[key]
        return typeof value === 'function'
      })
      expect(exportedFunctionNames.sort()).toEqual(
        ['SessionManagerError', 'createSessionManager'].sort()
      )
    })

    it('the manager object exposes exactly the documented SessionManager methods — no hidden extras', () => {
      const manager = createSessionManager()
      expect(Object.keys(manager).sort()).toEqual(
        [
          'create',
          'get',
          'touch',
          'lock',
          'unlockWithCredentials',
          'destroy',
          'invalidateAllForUser'
        ].sort()
      )
    })

    it('a type assertion to "any" reveals no hidden unlock-shaped method on the manager', () => {
      const manager = createSessionManager() as unknown as Record<string, unknown>
      for (const guess of [
        'unlock',
        'forceUnlock',
        'rawUnlock',
        'applyVerifiedUnlock',
        'setUnlocked'
      ]) {
        expect(manager[guess]).toBeUndefined()
      }
    })

    it('unlockWithCredentials is the only member capable of changing isLocked from true to false', () => {
      // Structural sanity check: of the seven methods, only lock and
      // unlockWithCredentials mention "lock" at all in their name, and
      // lock's own documented behavior only ever sets isLocked to true.
      const manager = createSessionManager()
      const methodNames = Object.keys(manager)
      const lockRelated = methodNames.filter((name) => /lock/i.test(name))
      expect(lockRelated.sort()).toEqual(['lock', 'unlockWithCredentials'].sort())
    })
  })

  describe('unlockWithCredentials (the only sanctioned way to clear isLocked)', () => {
    let dir: string
    let dbPath: string
    let rawDb: ReturnType<typeof createDatabaseConnection>
    let db: AppDb
    let userId: string

    beforeEach(async () => {
      dir = createTempDir('ledgerpage-session-manager-unlock')
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
      const user = db.transaction((tx) =>
        createUser(tx, { loginIdentifier: 'ben', displayName: 'Ben', passwordHash })
      )
      userId = user.id
    })

    afterEach(() => {
      vi.restoreAllMocks()
      rawDb.close()
      removeTempDir(dir)
    })

    it('a correct password unlocks a locked session', async () => {
      const manager = createSessionManager()
      const session = manager.create(userId, 'primary_company', ['owner'])
      manager.lock(session.sessionId)

      const result = await manager.unlockWithCredentials(db, session.sessionId, REAL_PASSWORD)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.session.isLocked).toBe(false)
      }
      expect(manager.get(session.sessionId)?.isLocked).toBe(false)
    })

    it('a wrong password leaves the session locked', async () => {
      const manager = createSessionManager()
      const session = manager.create(userId, 'primary_company', ['owner'])
      manager.lock(session.sessionId)

      const result = await manager.unlockWithCredentials(db, session.sessionId, 'wrong-password')

      expect(result.success).toBe(false)
      expect(manager.get(session.sessionId)?.isLocked).toBe(true)
    })

    it('an inactive user cannot unlock a session', async () => {
      deactivateUser(db, userId)
      const manager = createSessionManager()
      const session = manager.create(userId, 'primary_company', ['owner'])
      manager.lock(session.sessionId)

      const result = await manager.unlockWithCredentials(db, session.sessionId, REAL_PASSWORD)

      expect(result.success).toBe(false)
      expect(manager.get(session.sessionId)?.isLocked).toBe(true)
    })

    it('a currently account-locked user cannot unlock a session, even with the correct password', async () => {
      for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i += 1) {
        await authenticate(db, 'ben', 'wrong-password', 'normal_login')
      }
      const manager = createSessionManager()
      const session = manager.create(userId, 'primary_company', ['owner'])
      manager.lock(session.sessionId)

      const result = await manager.unlockWithCredentials(db, session.sessionId, REAL_PASSWORD)

      expect(result.success).toBe(false)
      expect(manager.get(session.sessionId)?.isLocked).toBe(true)
    }, 20000)

    it('a nonexistent session ID fails uniformly without throwing', async () => {
      const manager = createSessionManager()
      const result = await manager.unlockWithCredentials(db, 'no-such-session', REAL_PASSWORD)
      expect(result.success).toBe(false)
    })

    it('records a login_events row with source = session_unlock', async () => {
      const manager = createSessionManager()
      const session = manager.create(userId, 'primary_company', ['owner'])
      manager.lock(session.sessionId)

      await manager.unlockWithCredentials(db, session.sessionId, REAL_PASSWORD)

      const rows = db.select().from(loginEvents).all()
      expect(rows).toHaveLength(1)
      expect(rows[0].source).toBe('session_unlock')
      expect(rows[0].success).toBe(true)
    })

    it('a failed unlock attempt updates the real user failed-login state, following normal lockout policy', async () => {
      const manager = createSessionManager()
      const session = manager.create(userId, 'primary_company', ['owner'])
      manager.lock(session.sessionId)

      await manager.unlockWithCredentials(db, session.sessionId, 'wrong-password')

      const authRecord = getUserAuthRecordByLoginIdentifier(db, 'ben')!
      expect(authRecord.failedLoginCount).toBe(1)
    })

    it('enough failed unlock attempts lock the real account, following the same threshold as normal login', async () => {
      const manager = createSessionManager()
      const session = manager.create(userId, 'primary_company', ['owner'])
      manager.lock(session.sessionId)

      for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i += 1) {
        await manager.unlockWithCredentials(db, session.sessionId, 'wrong-password')
      }

      const authRecord = getUserAuthRecordByLoginIdentifier(db, 'ben')!
      expect(authRecord.lockedUntil).not.toBeNull()
    }, 20000)

    it('successful unlock refreshes lastActivityAt', async () => {
      const startTime = new Date('2026-01-01T00:00:00.000Z')
      const manager = createSessionManager({ now: () => startTime })
      const session = manager.create(userId, 'primary_company', ['owner'])
      manager.lock(session.sessionId)

      const unlockTime = new Date(startTime.getTime() + 60000)
      const result = await manager.unlockWithCredentials(
        db,
        session.sessionId,
        REAL_PASSWORD,
        unlockTime
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.session.lastActivityAt.getTime()).toBe(unlockTime.getTime())
      }
    })

    it('no result from this operation exposes a password hash or mutable internal session state', async () => {
      const manager = createSessionManager()
      const session = manager.create(userId, 'primary_company', ['owner'])
      manager.lock(session.sessionId)

      const result = await manager.unlockWithCredentials(db, session.sessionId, REAL_PASSWORD)

      const serialized = JSON.stringify(result)
      expect(serialized).not.toMatch(/\$argon2id\$/)
      expect(serialized).not.toContain(REAL_PASSWORD)

      if (result.success) {
        ;(result.session.roleCodes as string[]).push('hacked')
        expect(manager.get(session.sessionId)?.roleCodes).toEqual(['owner'])
      }
    })

    describe('post-await revalidation (the session must still be live, matching, and locked after verification)', () => {
      /**
       * Replaces verifyPassword with a manually-controlled deferred
       * promise, giving deterministic control over exactly when
       * password verification "resolves" — a session mutation can be
       * performed by the test, synchronously, while
       * unlockWithCredentials is provably still suspended awaiting
       * this promise, with no dependence on real Argon2id timing.
       */
      function deferVerification() {
        let resolve!: (value: boolean) => void
        const promise = new Promise<boolean>((res) => {
          resolve = res
        })
        const spy = vi.spyOn(passwordHashing, 'verifyPassword').mockReturnValue(promise)
        return { resolve, spy }
      }

      it('destroying the session while verification is pending prevents unlock', async () => {
        const manager = createSessionManager()
        const session = manager.create(userId, 'primary_company', ['owner'])
        manager.lock(session.sessionId)

        const { resolve } = deferVerification()
        const unlockPromise = manager.unlockWithCredentials(db, session.sessionId, REAL_PASSWORD)

        // At this point unlockWithCredentials is suspended awaiting the
        // deferred promise above — destroy the session now, before
        // verification "completes."
        manager.destroy(session.sessionId)
        resolve(true)

        const result = await unlockPromise
        expect(result.success).toBe(false)
      })

      it("invalidating the user's sessions while verification is pending prevents unlock", async () => {
        const manager = createSessionManager()
        const session = manager.create(userId, 'primary_company', ['owner'])
        manager.lock(session.sessionId)

        const { resolve } = deferVerification()
        const unlockPromise = manager.unlockWithCredentials(db, session.sessionId, REAL_PASSWORD)

        manager.invalidateAllForUser(userId)
        resolve(true)

        const result = await unlockPromise
        expect(result.success).toBe(false)
        expect(manager.get(session.sessionId)).toBeUndefined()
      })

      it('the session expiring during verification prevents unlock', async () => {
        const clock = { current: new Date('2026-01-01T00:00:00.000Z') }
        const manager = createSessionManager({
          now: () => clock.current,
          idleTimeoutMs: 1000
        })
        const session = manager.create(userId, 'primary_company', ['owner'])
        manager.lock(session.sessionId)

        const { resolve } = deferVerification()
        const unlockPromise = manager.unlockWithCredentials(db, session.sessionId, REAL_PASSWORD)

        // Advance the clock past the idle timeout while verification is
        // still pending.
        clock.current = new Date(clock.current.getTime() + 1001)
        resolve(true)

        const result = await unlockPromise
        expect(result.success).toBe(false)
      })

      it('no stale SessionSnapshot is ever returned when the session changes during verification', async () => {
        const manager = createSessionManager()
        const session = manager.create(userId, 'primary_company', ['owner'])
        manager.lock(session.sessionId)

        const { resolve } = deferVerification()
        const unlockPromise = manager.unlockWithCredentials(db, session.sessionId, REAL_PASSWORD)

        manager.destroy(session.sessionId)
        resolve(true)

        const result = await unlockPromise
        // A failure result carries no `session` field at all — there is
        // no stale snapshot to inspect in the first place.
        expect(result).toEqual({ success: false })
      })

      it('an ordinary, uninterrupted correct-password unlock still succeeds', async () => {
        const manager = createSessionManager()
        const session = manager.create(userId, 'primary_company', ['owner'])
        manager.lock(session.sessionId)

        const { resolve } = deferVerification()
        const unlockPromise = manager.unlockWithCredentials(db, session.sessionId, REAL_PASSWORD)

        // Nothing disturbs the session this time.
        resolve(true)

        const result = await unlockPromise
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.session.isLocked).toBe(false)
        }
        expect(manager.get(session.sessionId)?.isLocked).toBe(false)
      })

      it('authentication/login-event behavior is unaffected by the revalidation fix', async () => {
        const manager = createSessionManager()
        const session = manager.create(userId, 'primary_company', ['owner'])
        manager.lock(session.sessionId)

        await manager.unlockWithCredentials(db, session.sessionId, REAL_PASSWORD)

        const rows = db.select().from(loginEvents).all()
        expect(rows).toHaveLength(1)
        expect(rows[0].source).toBe('session_unlock')
        expect(rows[0].success).toBe(true)
      })
    })

    describe('safe dummy identifier for a missing/expired session (never the caller-supplied sessionId)', () => {
      it("a missing session whose ID equals a real username does not increment that user's failed_login_count", async () => {
        const manager = createSessionManager()
        // "ben" is this suite's real, existing login identifier — used
        // directly as a session ID that was never actually created by
        // this manager, simulating a caller-supplied ID that
        // coincidentally collides with a real username.
        const before = getUserAuthRecordByLoginIdentifier(db, 'ben')!

        const result = await manager.unlockWithCredentials(db, 'ben', REAL_PASSWORD)

        expect(result.success).toBe(false)
        const after = getUserAuthRecordByLoginIdentifier(db, 'ben')!
        expect(after.failedLoginCount).toBe(before.failedLoginCount)
      })

      it('does not lock that user', async () => {
        const manager = createSessionManager()

        // Enough attempts to have crossed the lockout threshold, if this
        // were incorrectly being attributed to the real "ben" account.
        for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS + 2; i += 1) {
          await manager.unlockWithCredentials(db, 'ben', 'wrong-password')
        }

        const after = getUserAuthRecordByLoginIdentifier(db, 'ben')!
        expect(after.lockedUntil).toBeNull()
        expect(after.failedLoginCount).toBe(0)
      }, 20000)

      it('its login event has user_id = NULL, and never contains the sessionId string anywhere', async () => {
        const manager = createSessionManager()
        const missingSessionId = 'ben'

        await manager.unlockWithCredentials(db, missingSessionId, 'irrelevant-password')

        const rows = db.select().from(loginEvents).all()
        expect(rows).toHaveLength(1)
        expect(rows[0].userId).toBeNull()
        expect(rows[0].source).toBe('session_unlock')
        expect(JSON.stringify(rows)).not.toContain(missingSessionId)
      })

      it('password verification still runs for a missing session', async () => {
        const manager = createSessionManager()
        const spy = vi.spyOn(passwordHashing, 'verifyPassword')

        await manager.unlockWithCredentials(db, 'some-missing-session-id', REAL_PASSWORD)

        expect(spy).toHaveBeenCalledTimes(1)
      })

      it('a normal valid-session unlock is completely unaffected', async () => {
        const manager = createSessionManager()
        const session = manager.create(userId, 'primary_company', ['owner'])
        manager.lock(session.sessionId)

        const result = await manager.unlockWithCredentials(db, session.sessionId, REAL_PASSWORD)

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.session.isLocked).toBe(false)
        }
      })
    })
  })
})
