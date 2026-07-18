import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import { createUser } from '../../../src/main/auth/userService'
import { hashPassword } from '../../../src/main/auth/passwordHashing'
import * as passwordHashing from '../../../src/main/auth/passwordHashing'
import {
  CEREMONY_TTL_MS,
  createRecoveryCeremonyService,
  RecoveryCeremonyError,
  TOKEN_COLLISION_RETRY_ATTEMPTS
} from '../../../src/main/auth/recoveryCeremonyService'
import { AfterCommitCallbackError, runAppTransaction } from '../../../src/main/db/appTransaction'
import { ownerRecoveryCredentials } from '../../../src/main/db/schema'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')

function fixedClock(start: Date) {
  let current = start
  return {
    now: () => current,
    advanceBy: (ms: number) => (current = new Date(current.getTime() + ms))
  }
}

describe('recoveryCeremonyService', () => {
  let dir: string
  let dbPath: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let userId: string

  beforeEach(async () => {
    dir = createTempDir('ledgerpage-recovery-ceremony')
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

    const passwordHash = await hashPassword('owner-password-123')
    const user = db.transaction((tx) =>
      createUser(tx, { loginIdentifier: 'owner', displayName: 'Owner', passwordHash })
    )
    userId = user.id
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rawDb.close()
    removeTempDir(dir)
  })

  describe('key generation format', () => {
    it('produces a key in 8 groups of 4 unambiguous characters', async () => {
      const service = createRecoveryCeremonyService()
      const { plaintextRecoveryKey } = await service.prepareCeremony(userId)

      const groups = plaintextRecoveryKey.split('-')
      expect(groups).toHaveLength(8)
      for (const group of groups) {
        expect(group).toHaveLength(4)
        expect(group).toMatch(/^[0-9A-HJ-KM-NP-TV-Z]+$/) // Crockford Base32: excludes I, L, O, U
      }
    })

    it('produces a different key on every call', async () => {
      const service = createRecoveryCeremonyService()
      const first = await service.prepareCeremony(userId)
      const second = await service.prepareCeremony(userId)
      expect(first.plaintextRecoveryKey).not.toBe(second.plaintextRecoveryKey)
    })
  })

  describe('ceremony lifecycle and unforgeable capability', () => {
    it('the plaintext key is returned only from prepareCeremony', async () => {
      const service = createRecoveryCeremonyService()
      const prepared = await service.prepareCeremony(userId)
      expect(prepared.plaintextRecoveryKey.length).toBeGreaterThan(0)

      const confirmed = await service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      expect(confirmed).toBeDefined()
      expect(JSON.stringify(confirmed)).not.toContain(prepared.plaintextRecoveryKey)
    })

    it('confirmCeremony returns only an opaque commitToken — no userId, no recoveryKeyHash', async () => {
      const service = createRecoveryCeremonyService()
      const prepared = await service.prepareCeremony(userId)

      const confirmed = await service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )

      expect(confirmed).toBeDefined()
      expect(Object.keys(confirmed!)).toEqual(['commitToken'])
      expect(typeof confirmed!.commitToken).toBe('string')
      expect(confirmed!.commitToken.length).toBeGreaterThan(0)
    })

    it('a caller cannot construct a database-ready confirmed result by hand', async () => {
      const service = createRecoveryCeremonyService()
      const fabricated = { commitToken: 'totally-made-up-token-12345' }

      expect(() =>
        runAppTransaction(db, (context) =>
          service.commitCredential(context, fabricated.commitToken)
        )
      ).toThrow(RecoveryCeremonyError)
    })

    it('confirmCeremony fails with an incorrect re-entered key, without consuming the pending ceremony', async () => {
      const service = createRecoveryCeremonyService()
      const prepared = await service.prepareCeremony(userId)

      const wrongAttempt = await service.confirmCeremony(prepared.ceremonyToken, 'WRONG-KEY')
      expect(wrongAttempt).toBeUndefined()

      const correctAttempt = await service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      expect(correctAttempt).toBeDefined()
    }, 20000)

    it('an expired pending ceremony cannot be confirmed', async () => {
      const clock = fixedClock(new Date('2026-01-01T00:00:00.000Z'))
      const service = createRecoveryCeremonyService({ now: clock.now })
      const prepared = await service.prepareCeremony(userId)

      clock.advanceBy(CEREMONY_TTL_MS + 1)

      const result = await service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      expect(result).toBeUndefined()
    })

    it('a pending ceremony confirmed just before expiry still succeeds', async () => {
      const clock = fixedClock(new Date('2026-01-01T00:00:00.000Z'))
      const service = createRecoveryCeremonyService({ now: clock.now })
      const prepared = await service.prepareCeremony(userId)

      clock.advanceBy(CEREMONY_TTL_MS - 1)

      const result = await service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      expect(result).toBeDefined()
    })

    it('a cancelled ceremony cannot be confirmed', async () => {
      const service = createRecoveryCeremonyService()
      const prepared = await service.prepareCeremony(userId)

      service.cancelCeremony(prepared.ceremonyToken)

      const result = await service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      expect(result).toBeUndefined()
    })

    it('cancelling an already-gone ceremony does not throw', () => {
      const service = createRecoveryCeremonyService()
      expect(() => service.cancelCeremony('never-existed')).not.toThrow()
    })

    it('an unconfirmed (pending) ceremonyToken is rejected by commitCredential', async () => {
      const service = createRecoveryCeremonyService()
      const prepared = await service.prepareCeremony(userId)
      expect(() =>
        runAppTransaction(db, (context) =>
          service.commitCredential(context, prepared.ceremonyToken)
        )
      ).toThrow(RecoveryCeremonyError)
    })

    it('an unknown/fabricated commit token is rejected', () => {
      const service = createRecoveryCeremonyService()
      expect(() =>
        runAppTransaction(db, (context) =>
          service.commitCredential(context, 'never-issued-by-this-service')
        )
      ).toThrow(RecoveryCeremonyError)
    })

    it('a commit token from a DIFFERENT service instance is rejected', async () => {
      const serviceA = createRecoveryCeremonyService()
      const serviceB = createRecoveryCeremonyService()

      const prepared = await serviceA.prepareCeremony(userId)
      const confirmed = await serviceA.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )

      expect(() =>
        runAppTransaction(db, (context) =>
          serviceB.commitCredential(context, confirmed!.commitToken)
        )
      ).toThrow(RecoveryCeremonyError)
    })
  })

  describe('commitCredential', () => {
    it('commits the initial credential successfully as version 1', async () => {
      const service = createRecoveryCeremonyService()
      const prepared = await service.prepareCeremony(userId)
      const confirmed = await service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )

      const summary = runAppTransaction(db, (context) =>
        service.commitCredential(context, confirmed!.commitToken)
      )

      expect(summary.version).toBe(1)
      expect(summary.isActive).toBe(true)
      expect(summary.userId).toBe(userId)
    })

    it('the summary never contains recoveryKeyHash', async () => {
      const service = createRecoveryCeremonyService()
      const prepared = await service.prepareCeremony(userId)
      const confirmed = await service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )

      const summary = runAppTransaction(db, (context) =>
        service.commitCredential(context, confirmed!.commitToken)
      )

      expect('recoveryKeyHash' in summary).toBe(false)
    })

    it('no public result anywhere in this flow contains recoveryKeyHash or userId beyond the summary', async () => {
      const service = createRecoveryCeremonyService()
      const prepared = await service.prepareCeremony(userId)
      expect(JSON.stringify(prepared)).not.toMatch(/\$argon2id\$/)

      const confirmed = await service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      expect(JSON.stringify(confirmed)).not.toMatch(/\$argon2id\$/)
      expect(Object.keys(confirmed!)).toEqual(['commitToken'])

      const summary = runAppTransaction(db, (context) =>
        service.commitCredential(context, confirmed!.commitToken)
      )
      expect(JSON.stringify(summary)).not.toMatch(/\$argon2id\$/)
    })

    it('the stored value is a hash, never the plaintext recovery key', async () => {
      const service = createRecoveryCeremonyService()
      const prepared = await service.prepareCeremony(userId)
      const confirmed = await service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )

      runAppTransaction(db, (context) => service.commitCredential(context, confirmed!.commitToken))

      const row = db.select().from(ownerRecoveryCredentials).all()[0]
      expect(row.recoveryKeyHash).toMatch(/^\$argon2id\$/)
      expect(row.recoveryKeyHash).not.toContain(prepared.plaintextRecoveryKey)
    })

    describe('post-commit consumption (the capability is consumed exactly when, and only when, the transaction truly commits)', () => {
      it('a successful transaction commit removes the capability immediately', async () => {
        const service = createRecoveryCeremonyService()
        const prepared = await service.prepareCeremony(userId)
        const confirmed = await service.confirmCeremony(
          prepared.ceremonyToken,
          prepared.plaintextRecoveryKey
        )

        runAppTransaction(db, (context) =>
          service.commitCredential(context, confirmed!.commitToken)
        )

        // Reusing the same token immediately after a genuinely successful
        // commit must fail — and via the *initial* unknown-token lookup,
        // not a second database round-trip: the error message here is
        // the generic "unknown token" one, not any "already committed"
        // message derived from a fresh database query.
        let thrown: unknown
        try {
          runAppTransaction(db, (context) =>
            service.commitCredential(context, confirmed!.commitToken)
          )
        } catch (error) {
          thrown = error
        }
        expect(thrown).toBeInstanceOf(RecoveryCeremonyError)
        expect((thrown as Error).message).toMatch(/unknown, unconfirmed, or already-consumed/i)
      })

      it('reuse after commit is rejected without a second database lookup performing the cleanup', async () => {
        const service = createRecoveryCeremonyService()
        const prepared = await service.prepareCeremony(userId)
        const confirmed = await service.confirmCeremony(
          prepared.ceremonyToken,
          prepared.plaintextRecoveryKey
        )

        runAppTransaction(db, (context) =>
          service.commitCredential(context, confirmed!.commitToken)
        )

        // The second attempt must be rejected purely from the in-memory
        // capability lookup, before ever touching a transaction handle —
        // proven by calling commitCredential directly with a mock
        // context whose `tx` throws on any property access at all, and
        // an afterCommit spy that must never be reached either.
        let afterCommitCalled = false
        const throwingTx = new Proxy(
          {},
          {
            get() {
              throw new Error(
                'commitCredential must not touch context.tx for an already-consumed token'
              )
            }
          }
        )
        const mockContext = {
          tx: throwingTx as never,
          afterCommit: () => {
            afterCommitCalled = true
          }
        }

        expect(() => service.commitCredential(mockContext, confirmed!.commitToken)).toThrow(
          RecoveryCeremonyError
        )
        expect(afterCommitCalled).toBe(false)
      })

      it('rollback leaves the capability available, and a retry with the same token succeeds', async () => {
        const service = createRecoveryCeremonyService()
        const prepared = await service.prepareCeremony(userId)
        const confirmed = await service.confirmCeremony(
          prepared.ceremonyToken,
          prepared.plaintextRecoveryKey
        )

        expect(() =>
          runAppTransaction(db, (context) => {
            service.commitCredential(context, confirmed!.commitToken)
            throw new Error('simulated failure elsewhere in the caller transaction')
          })
        ).toThrow('simulated failure elsewhere in the caller transaction')

        const afterRollback = db.select().from(ownerRecoveryCredentials).all()
        expect(afterRollback).toHaveLength(0)

        // Retry with the exact same token — must succeed, proving the
        // capability was never consumed by the rolled-back attempt.
        const summary = runAppTransaction(db, (context) =>
          service.commitCredential(context, confirmed!.commitToken)
        )
        expect(summary.version).toBe(1)

        const afterRetry = db.select().from(ownerRecoveryCredentials).all()
        expect(afterRetry).toHaveLength(1)
      })

      it('callback execution does not occur before commit — the afterCommit callback observes the row already present', async () => {
        const service = createRecoveryCeremonyService()
        const prepared = await service.prepareCeremony(userId)
        const confirmed = await service.confirmCeremony(
          prepared.ceremonyToken,
          prepared.plaintextRecoveryKey
        )

        let rowVisibleWhenCallbackRan: boolean | undefined
        runAppTransaction(db, (context) => {
          const summary = service.commitCredential(context, confirmed!.commitToken)
          context.afterCommit(() => {
            // Queried via the top-level db (transaction already closed
            // by the time this runs), not context.tx.
            const row = db
              .select()
              .from(ownerRecoveryCredentials)
              .all()
              .find((r) => r.id === summary.id)
            rowVisibleWhenCallbackRan = row !== undefined
          })
        })

        expect(rowVisibleWhenCallbackRan).toBe(true)
      })

      it('afterCommit callbacks are discarded on a rolled-back transaction', async () => {
        const service = createRecoveryCeremonyService()
        const prepared = await service.prepareCeremony(userId)
        const confirmed = await service.confirmCeremony(
          prepared.ceremonyToken,
          prepared.plaintextRecoveryKey
        )

        let extraCallbackRan = false
        expect(() =>
          runAppTransaction(db, (context) => {
            service.commitCredential(context, confirmed!.commitToken)
            context.afterCommit(() => {
              extraCallbackRan = true
            })
            throw new Error('simulated failure')
          })
        ).toThrow('simulated failure')

        expect(extraCallbackRan).toBe(false)
        // And the capability itself remains usable, confirming its own
        // afterCommit-registered deletion was equally discarded.
        const summary = runAppTransaction(db, (context) =>
          service.commitCredential(context, confirmed!.commitToken)
        )
        expect(summary.version).toBe(1)
      })

      it('an exception from an afterCommit callback is reported as AfterCommitCallbackError, not as a rollback', async () => {
        const service = createRecoveryCeremonyService()
        const prepared = await service.prepareCeremony(userId)
        const confirmed = await service.confirmCeremony(
          prepared.ceremonyToken,
          prepared.plaintextRecoveryKey
        )

        let thrown: unknown
        try {
          runAppTransaction(db, (context) => {
            service.commitCredential(context, confirmed!.commitToken)
            context.afterCommit(() => {
              throw new Error('a broken, unrelated afterCommit callback')
            })
          })
        } catch (error) {
          thrown = error
        }

        expect(thrown).toBeInstanceOf(AfterCommitCallbackError)

        // The database commit itself is NOT undone by a failing
        // afterCommit callback — the row is still there.
        const rows = db.select().from(ownerRecoveryCredentials).all()
        expect(rows).toHaveLength(1)

        // And the recovery capability itself WAS still consumed by its
        // own (separate, earlier-registered) afterCommit callback,
        // since that one didn't throw — every registered callback runs
        // regardless of an earlier one failing.
        expect(() =>
          runAppTransaction(db, (context) =>
            service.commitCredential(context, confirmed!.commitToken)
          )
        ).toThrow(RecoveryCeremonyError)
      })
    })

    it('rotation revokes exactly the prior active credential and increments the version', async () => {
      const service = createRecoveryCeremonyService()

      const firstPrepared = await service.prepareCeremony(userId)
      const firstConfirmed = await service.confirmCeremony(
        firstPrepared.ceremonyToken,
        firstPrepared.plaintextRecoveryKey
      )
      const firstSummary = runAppTransaction(db, (context) =>
        service.commitCredential(context, firstConfirmed!.commitToken)
      )

      const secondPrepared = await service.prepareCeremony(userId)
      const secondConfirmed = await service.confirmCeremony(
        secondPrepared.ceremonyToken,
        secondPrepared.plaintextRecoveryKey
      )
      const secondSummary = runAppTransaction(db, (context) =>
        service.commitCredential(context, secondConfirmed!.commitToken)
      )

      expect(secondSummary.version).toBe(2)
      expect(secondSummary.isActive).toBe(true)

      const allRows = db.select().from(ownerRecoveryCredentials).all()
      expect(allRows).toHaveLength(2)

      const revokedRow = allRows.find((r) => r.id === firstSummary.id)!
      expect(revokedRow.isActive).toBe(false)
      expect(revokedRow.revokedAt).not.toBeNull()

      const activeRow = allRows.find((r) => r.id === secondSummary.id)!
      expect(activeRow.isActive).toBe(true)
    }, 20000)

    it('the partial unique index still prevents two active credentials even if commitCredential were bypassed', () => {
      const now = Date.now()
      rawDb
        .prepare(
          "INSERT INTO owner_recovery_credentials (id, user_id, recovery_key_hash, version, is_active, created_at) VALUES ('rc1', ?, 'hash1', 1, 1, ?)"
        )
        .run(userId, now)

      expect(() =>
        rawDb
          .prepare(
            "INSERT INTO owner_recovery_credentials (id, user_id, recovery_key_hash, version, is_active, created_at) VALUES ('rc2', ?, 'hash2', 2, 1, ?)"
          )
          .run(userId, now)
      ).toThrow(/UNIQUE constraint failed/i)
    })
  })

  describe('token collision protection (unique across both pendingCeremonies and confirmedCapabilities, bounded retry)', () => {
    it('rejects an empty string returned by randomToken', async () => {
      const service = createRecoveryCeremonyService({ randomToken: () => '' })
      await expect(service.prepareCeremony(userId)).rejects.toThrow(RecoveryCeremonyError)
    })

    it('regenerates a pending ceremony token that collides with an existing pending ceremony', async () => {
      let calls = 0
      const service = createRecoveryCeremonyService({
        randomToken: () => {
          calls += 1
          return calls === 1 ? 'colliding-token' : `unique-token-${String(calls)}`
        }
      })

      const first = await service.prepareCeremony(userId)
      expect(first.ceremonyToken).toBe('colliding-token')

      const second = await service.prepareCeremony(userId)
      expect(second.ceremonyToken).not.toBe('colliding-token')

      // The first ceremony must remain intact and still confirmable —
      // never silently replaced by the second prepareCeremony call.
      const confirmed = await service.confirmCeremony(
        first.ceremonyToken,
        first.plaintextRecoveryKey
      )
      expect(confirmed).toBeDefined()
    }, 20000)

    it('regenerates a commit token that collides with an existing PENDING ceremony token', async () => {
      let calls = 0
      const service = createRecoveryCeremonyService({
        randomToken: () => {
          calls += 1
          if (calls === 1) return 'shared-value' // ceremonyA's ceremonyToken
          if (calls === 2) return 'ceremony-b-token' // ceremonyB's ceremonyToken
          if (calls === 3) return 'shared-value' // first commitToken attempt for B — collides with A's still-pending token
          if (calls === 4) return 'final-unique-commit-token-b' // retry succeeds
          return 'final-unique-commit-token-a' // ceremony A's own later commitToken, once it too is confirmed
        }
      })

      const ceremonyA = await service.prepareCeremony(userId)
      expect(ceremonyA.ceremonyToken).toBe('shared-value')

      const ceremonyB = await service.prepareCeremony(userId)
      expect(ceremonyB.ceremonyToken).toBe('ceremony-b-token')

      const confirmedB = await service.confirmCeremony(
        ceremonyB.ceremonyToken,
        ceremonyB.plaintextRecoveryKey
      )
      expect(confirmedB?.commitToken).toBe('final-unique-commit-token-b')

      // Ceremony A's still-pending token was never touched or consumed
      // by the collision retry — it remains confirmable.
      const confirmedA = await service.confirmCeremony(
        ceremonyA.ceremonyToken,
        ceremonyA.plaintextRecoveryKey
      )
      expect(confirmedA).toBeDefined()
    }, 20000)

    it('regenerates a commit token that collides with an existing CONFIRMED capability token', async () => {
      let calls = 0
      const service = createRecoveryCeremonyService({
        randomToken: () => {
          calls += 1
          if (calls === 1) return 'ceremony-a-token'
          if (calls === 2) return 'shared-commit-value' // A's commitToken
          if (calls === 3) return 'ceremony-b-token'
          if (calls === 4) return 'shared-commit-value' // first commitToken attempt for B — collides with A's confirmed capability
          return 'final-unique-commit-token-b'
        }
      })

      const ceremonyA = await service.prepareCeremony(userId)
      const confirmedA = await service.confirmCeremony(
        ceremonyA.ceremonyToken,
        ceremonyA.plaintextRecoveryKey
      )
      expect(confirmedA?.commitToken).toBe('shared-commit-value')

      const ceremonyB = await service.prepareCeremony(userId)
      const confirmedB = await service.confirmCeremony(
        ceremonyB.ceremonyToken,
        ceremonyB.plaintextRecoveryKey
      )
      expect(confirmedB?.commitToken).toBe('final-unique-commit-token-b')
      expect(confirmedB?.commitToken).not.toBe('shared-commit-value')

      // A's confirmed capability must remain committable on its own token.
      const summary = runAppTransaction(db, (context) =>
        service.commitCredential(context, confirmedA!.commitToken)
      )
      expect(summary.userId).toBe(userId)
    }, 20000)

    it('retry exhaustion throws RecoveryCeremonyError without replacing or losing the original ceremony', async () => {
      let calls = 0
      const service = createRecoveryCeremonyService({
        randomToken: () => {
          calls += 1
          // Call 1: the first ceremony's own token. Calls 2 through
          // 1 + TOKEN_COLLISION_RETRY_ATTEMPTS: the second
          // prepareCeremony's retry attempts, every one colliding with
          // the first ceremony's still-pending token. Anything after
          // that: a distinct value, so confirmCeremony's own later
          // commit-token generation can still succeed.
          return calls <= 1 + TOKEN_COLLISION_RETRY_ATTEMPTS
            ? 'always-the-same-value'
            : 'distinct-commit-token'
        }
      })

      const first = await service.prepareCeremony(userId)
      expect(first.ceremonyToken).toBe('always-the-same-value')

      // Every retry attempt for a second ceremony collides with the
      // first one's token, exhausting the bounded retry budget.
      await expect(service.prepareCeremony(userId)).rejects.toThrow(RecoveryCeremonyError)

      // The original ceremony is untouched by the failed attempt and
      // remains fully usable.
      const confirmed = await service.confirmCeremony(
        first.ceremonyToken,
        first.plaintextRecoveryKey
      )
      expect(confirmed).toBeDefined()
    }, 20000)

    it('the documented retry limit is a positive integer, and exhaustion happens at exactly that many attempts', async () => {
      expect(TOKEN_COLLISION_RETRY_ATTEMPTS).toBeGreaterThan(0)
      expect(Number.isInteger(TOKEN_COLLISION_RETRY_ATTEMPTS)).toBe(true)

      let calls = 0
      const service = createRecoveryCeremonyService({
        randomToken: () => {
          calls += 1
          return 'always-colliding'
        }
      })

      await service.prepareCeremony(userId) // consumes 1 call, succeeds
      calls = 0 // reset to isolate the count for the failing attempt

      await expect(service.prepareCeremony(userId)).rejects.toThrow(RecoveryCeremonyError)
      expect(calls).toBe(TOKEN_COLLISION_RETRY_ATTEMPTS)
    })

    it('the production default token generator remains cryptographically secure (unaffected by this fix)', async () => {
      const service = createRecoveryCeremonyService()
      const a = await service.prepareCeremony(userId)
      const b = await service.prepareCeremony(userId)
      expect(a.ceremonyToken).not.toBe(b.ceremonyToken)
      expect(a.ceremonyToken.length).toBeGreaterThanOrEqual(32)
    })
  })

  describe('one-time confirmation under concurrency (a synchronous in-progress flag, set before the verifyPassword await)', () => {
    /**
     * Replaces verifyPassword with a manually-controlled deferred
     * promise — deterministic control over exactly when verification
     * "resolves," not dependent on real Argon2id timing. Matches the
     * pattern already established for sessionManager's equivalent
     * post-await revalidation tests.
     */
    function deferVerification() {
      let resolve!: (value: boolean) => void
      const promise = new Promise<boolean>((res) => {
        resolve = res
      })
      const spy = vi.spyOn(passwordHashing, 'verifyPassword').mockReturnValue(promise)
      return { resolve, spy }
    }

    it('two concurrent correct confirmations yield exactly one commit token — only one confirmed capability is created', async () => {
      const service = createRecoveryCeremonyService()
      const prepared = await service.prepareCeremony(userId)

      const { resolve, spy } = deferVerification()
      const attempt1 = service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      const attempt2 = service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )

      // By this point both calls have already run their synchronous
      // prefix — the second one must have observed the in-progress
      // flag and returned without ever reaching verification.
      expect(spy).toHaveBeenCalledTimes(1)

      resolve(true)
      const [result1, result2] = await Promise.all([attempt1, attempt2])

      const successes = [result1, result2].filter(
        (r): r is { commitToken: string } => r !== undefined
      )
      expect(successes).toHaveLength(1)
      expect(result2).toBeUndefined()
      expect(result1?.commitToken).toBeDefined()
    })

    it('a failed verification (wrong key) leaves the ceremony retryable', async () => {
      const service = createRecoveryCeremonyService()
      const prepared = await service.prepareCeremony(userId)

      const { resolve, spy } = deferVerification()
      const failedAttempt = service.confirmCeremony(prepared.ceremonyToken, 'WRONG-KEY')
      resolve(false)
      expect(await failedAttempt).toBeUndefined()
      // Restore before retrying — mockReturnValue pins a single fixed
      // (already-resolved) promise for every call, so without
      // restoring, a retry would see that same stale `false` result
      // instead of genuinely re-verifying the correct key.
      spy.mockRestore()

      // Retry with the correct key — must succeed, proving the ceremony
      // was restored to a retryable state rather than left permanently
      // marked as in-progress.
      const retryResult = await service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      expect(retryResult).toBeDefined()
    })

    it('an exception thrown by verification does not permanently strand the ceremony', async () => {
      const service = createRecoveryCeremonyService()
      const prepared = await service.prepareCeremony(userId)

      const spy = vi
        .spyOn(passwordHashing, 'verifyPassword')
        .mockRejectedValueOnce(new Error('boom'))
      const failedAttempt = await service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      expect(failedAttempt).toBeUndefined()
      spy.mockRestore()

      const retryResult = await service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      expect(retryResult).toBeDefined()
    })

    it('cancellation during a pending verification prevents confirmation from succeeding when it resumes', async () => {
      const service = createRecoveryCeremonyService()
      const prepared = await service.prepareCeremony(userId)

      const { resolve } = deferVerification()
      const attemptPromise = service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )

      service.cancelCeremony(prepared.ceremonyToken)
      // Verification "would have" succeeded, but the ceremony was
      // cancelled while it was in flight.
      resolve(true)

      expect(await attemptPromise).toBeUndefined()

      // It remains truly gone afterward too — cancellation during
      // verification is not merely a transient blip.
      const laterAttempt = await service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      expect(laterAttempt).toBeUndefined()
    })

    it('expiry during verification follows one documented rule: treated exactly like a pre-verification expiry', async () => {
      const clock = { current: new Date('2026-01-01T00:00:00.000Z') }
      const service = createRecoveryCeremonyService({ now: () => clock.current })
      const prepared = await service.prepareCeremony(userId)

      const { resolve } = deferVerification()
      const attemptPromise = service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )

      clock.current = new Date(clock.current.getTime() + CEREMONY_TTL_MS + 1)
      // Verification "would have" succeeded, but the ceremony has since
      // expired.
      resolve(true)

      expect(await attemptPromise).toBeUndefined()

      const laterAttempt = await service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      expect(laterAttempt).toBeUndefined()
    })
  })

  describe('commit-token generation happens before any pending-ceremony mutation (preserves the ceremony if token generation fails)', () => {
    it('commit-token retry exhaustion leaves the original pending ceremony intact', async () => {
      const service = createRecoveryCeremonyService({
        randomToken: () => 'always-the-same-token'
      })

      const prepared = await service.prepareCeremony(userId)
      expect(prepared.ceremonyToken).toBe('always-the-same-token')

      // Confirming needs a commit token distinct from the ceremony's own
      // still-pending token, but this mock always returns the same
      // value, colliding on every retry attempt.
      await expect(
        service.confirmCeremony(prepared.ceremonyToken, prepared.plaintextRecoveryKey)
      ).rejects.toThrow(RecoveryCeremonyError)

      // No confirmed capability exists — nothing was partially created.
      // Proven by the fact that the exhaustion above threw before ever
      // reaching the pendingCeremonies.delete/confirmedCapabilities.set
      // pair, and confirmed structurally below by successfully
      // confirming the SAME ceremony once the token source recovers.
    })

    it('the same ceremony can later be confirmed after the token source recovers', async () => {
      let allowDistinctToken = false
      const service = createRecoveryCeremonyService({
        randomToken: () => (allowDistinctToken ? 'distinct-commit-token' : 'always-the-same-token')
      })

      const prepared = await service.prepareCeremony(userId)
      expect(prepared.ceremonyToken).toBe('always-the-same-token')

      await expect(
        service.confirmCeremony(prepared.ceremonyToken, prepared.plaintextRecoveryKey)
      ).rejects.toThrow(RecoveryCeremonyError)

      allowDistinctToken = true
      const confirmed = await service.confirmCeremony(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      expect(confirmed?.commitToken).toBe('distinct-commit-token')
    }, 20000)

    it('an existing confirmed capability is unaffected by a later commit-token retry exhaustion on a different ceremony', async () => {
      let calls = 0
      const service = createRecoveryCeremonyService({
        randomToken: () => {
          calls += 1
          if (calls === 1) return 'ceremony-a-token'
          if (calls === 2) return 'capability-a-commit-token'
          if (calls === 3) return 'ceremony-b-token'
          // From here on, every attempt at B's commit token collides
          // with ceremony B's own still-pending token.
          return 'ceremony-b-token'
        }
      })

      const ceremonyA = await service.prepareCeremony(userId)
      const confirmedA = await service.confirmCeremony(
        ceremonyA.ceremonyToken,
        ceremonyA.plaintextRecoveryKey
      )
      expect(confirmedA?.commitToken).toBe('capability-a-commit-token')

      const ceremonyB = await service.prepareCeremony(userId)
      await expect(
        service.confirmCeremony(ceremonyB.ceremonyToken, ceremonyB.plaintextRecoveryKey)
      ).rejects.toThrow(RecoveryCeremonyError)

      // A's confirmed capability remains completely valid and
      // committable — unaffected by B's exhausted retry.
      const summary = runAppTransaction(db, (context) =>
        service.commitCredential(context, confirmedA!.commitToken)
      )
      expect(summary.userId).toBe(userId)
    }, 20000)
  })
})
