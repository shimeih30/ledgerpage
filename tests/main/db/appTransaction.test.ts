import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import {
  AfterCommitCallbackError,
  AsyncTransactionCallbackError,
  runAppTransaction,
  type AppTransactionContext
} from '../../../src/main/db/appTransaction'
import { currencies } from '../../../src/main/db/schema'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')

describe('runAppTransaction', () => {
  let dir: string
  let dbPath: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    dir = createTempDir('ledgerpage-app-transaction')
    dbPath = join(dir, 'ledgerpage.db')
    rawDb = createDatabaseConnection(dbPath)
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    db = drizzle<Record<string, never>>(rawDb)
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  it('returns whatever the callback function returns on success', () => {
    const result = runAppTransaction(db, () => 'hello')
    expect(result).toBe('hello')
  })

  it('context.tx can read and write exactly like a normal transaction', () => {
    runAppTransaction(db, (context) => {
      context.tx
        .update(currencies)
        .set({ name: 'Renamed Dollar' })
        .where(eq(currencies.id, 'currency_usd'))
        .run()
    })

    const row = db.select().from(currencies).where(eq(currencies.id, 'currency_usd')).get()
    expect(row?.name).toBe('Renamed Dollar')
  })

  it('afterCommit callbacks run only after the transaction returns (not before, not never)', () => {
    const log: string[] = []

    runAppTransaction(db, (context) => {
      log.push('inside transaction body')
      context.afterCommit(() => log.push('afterCommit ran'))
      log.push('still inside, after registering the callback')
    })

    expect(log).toEqual([
      'inside transaction body',
      'still inside, after registering the callback',
      'afterCommit ran'
    ])
  })

  it('multiple afterCommit callbacks all run, in registration order', () => {
    const log: number[] = []

    runAppTransaction(db, (context) => {
      context.afterCommit(() => log.push(1))
      context.afterCommit(() => log.push(2))
      context.afterCommit(() => log.push(3))
    })

    expect(log).toEqual([1, 2, 3])
  })

  it('afterCommit callbacks never run when the transaction throws', () => {
    let ran = false

    expect(() =>
      runAppTransaction(db, (context) => {
        context.afterCommit(() => {
          ran = true
        })
        throw new Error('simulated failure')
      })
    ).toThrow('simulated failure')

    expect(ran).toBe(false)
  })

  it('a thrown error inside the transaction body propagates unchanged, and the write is rolled back', () => {
    expect(() =>
      runAppTransaction(db, (context) => {
        context.tx
          .update(currencies)
          .set({ name: 'Should Not Stick' })
          .where(eq(currencies.id, 'currency_usd'))
          .run()
        throw new Error('boom')
      })
    ).toThrow('boom')

    const row = db.select().from(currencies).where(eq(currencies.id, 'currency_usd')).get()
    expect(row?.name).not.toBe('Should Not Stick')
  })

  it('a single failing afterCommit callback is reported via AfterCommitCallbackError without pretending the commit failed', () => {
    let thrown: unknown
    try {
      runAppTransaction(db, (context) => {
        context.tx
          .update(currencies)
          .set({ name: 'Committed Anyway' })
          .where(eq(currencies.id, 'currency_usd'))
          .run()
        context.afterCommit(() => {
          throw new Error('callback boom')
        })
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AfterCommitCallbackError)
    expect((thrown as AfterCommitCallbackError).errors).toHaveLength(1)

    // The database write is NOT rolled back by a failing afterCommit —
    // it already committed before any afterCommit callback ran.
    const row = db.select().from(currencies).where(eq(currencies.id, 'currency_usd')).get()
    expect(row?.name).toBe('Committed Anyway')
  })

  it('every afterCommit callback still runs even if an earlier one throws, and all failures are collected', () => {
    const ran: number[] = []

    let thrown: unknown
    try {
      runAppTransaction(db, (context) => {
        context.afterCommit(() => {
          ran.push(1)
          throw new Error('first callback failed')
        })
        context.afterCommit(() => {
          ran.push(2)
        })
        context.afterCommit(() => {
          ran.push(3)
          throw new Error('third callback failed')
        })
      })
    } catch (error) {
      thrown = error
    }

    expect(ran).toEqual([1, 2, 3])
    expect(thrown).toBeInstanceOf(AfterCommitCallbackError)
    expect((thrown as AfterCommitCallbackError).errors).toHaveLength(2)
  })

  it('AfterCommitCallbackError message documents that the commit succeeded, not that it rolled back', () => {
    let thrown: unknown
    try {
      runAppTransaction(db, (context) => {
        context.afterCommit(() => {
          throw new Error('x')
        })
      })
    } catch (error) {
      thrown = error
    }

    const message = (thrown as Error).message
    expect(message).toMatch(/successful database commit/i)
    // Explicitly reassures the reader the commit was NOT undone — this
    // is a positive statement the message is expected to contain, not
    // something to avoid.
    expect(message).toMatch(/was not rolled back/i)
  })

  describe('synchronous-only enforcement', () => {
    /**
     * runAppTransaction's TypeScript signature already rejects an async
     * callback at compile time (see the fixture function below this
     * describe block) — these runtime tests exercise the *second* layer
     * of defense, for a caller that bypasses the type system entirely
     * (plain JS, or an explicit assertion), proving the thenable check
     * inside the live transaction actually works, not just that the
     * types claim it should.
     */
    function callWithUncheckedAsyncCallback<T>(
      dbArg: AppDb,
      fn: (context: AppTransactionContext) => Promise<T>
    ): T {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately bypassing the compile-time guard to test the runtime one
      return (runAppTransaction as any)(dbArg, fn)
    }

    it('a synchronous callback commits and returns its value', () => {
      const result = runAppTransaction(db, (context) => {
        context.tx
          .update(currencies)
          .set({ name: 'Sync Commit Works' })
          .where(eq(currencies.id, 'currency_usd'))
          .run()
        return 'sync-value'
      })

      expect(result).toBe('sync-value')
      const row = db.select().from(currencies).where(eq(currencies.id, 'currency_usd')).get()
      expect(row?.name).toBe('Sync Commit Works')
    })

    it('an async callback is rejected with AsyncTransactionCallbackError', () => {
      expect(() =>
        callWithUncheckedAsyncCallback(db, async (context) => {
          void context
          await Promise.resolve()
          return 'never reached synchronously'
        })
      ).toThrow(AsyncTransactionCallbackError)
    })

    it("writes made before the async callback's first await are rolled back", () => {
      expect(() =>
        callWithUncheckedAsyncCallback(db, async (context) => {
          context.tx
            .update(currencies)
            .set({ name: 'Should Not Survive' })
            .where(eq(currencies.id, 'currency_usd'))
            .run()
          await Promise.resolve()
          return 'ignored'
        })
      ).toThrow(AsyncTransactionCallbackError)

      const row = db.select().from(currencies).where(eq(currencies.id, 'currency_usd')).get()
      expect(row?.name).not.toBe('Should Not Survive')
    })

    it('afterCommit callbacks do not run for an async callback', () => {
      let ran = false

      expect(() =>
        callWithUncheckedAsyncCallback(db, async (context) => {
          context.afterCommit(() => {
            ran = true
          })
          await Promise.resolve()
          return 'ignored'
        })
      ).toThrow(AsyncTransactionCallbackError)

      expect(ran).toBe(false)
    })

    it('a callback returning an explicit Promise (not just an async function) is rejected the same way', () => {
      expect(() =>
        callWithUncheckedAsyncCallback(db, (context) => {
          void context
          return Promise.resolve('explicit promise')
        })
      ).toThrow(AsyncTransactionCallbackError)
    })

    it('a function-shaped thenable (not a plain object or real Promise) is also detected and rejected', () => {
      // A plain JS function can carry a callable `.then` property of its
      // own — `typeof` such a value is 'function', not 'object', so a
      // thenable check that only tests `typeof value === 'object'`
      // would silently miss it. Constructed here without ever going
      // through Promise/async syntax at all, to isolate exactly that
      // gap.
      function buildFunctionShapedThenable(): unknown {
        const fn = (): void => {
          /* never actually called */
        }
        Object.assign(fn, {
          then: (resolve: (value: unknown) => void) => {
            resolve('ignored')
          }
        })
        return fn
      }

      let ran = false
      expect(() =>
        callWithUncheckedAsyncCallback(db, (context) => {
          context.tx
            .update(currencies)
            .set({ name: 'Should Not Survive Either' })
            .where(eq(currencies.id, 'currency_usd'))
            .run()
          context.afterCommit(() => {
            ran = true
          })
          return buildFunctionShapedThenable() as never
        })
      ).toThrow(AsyncTransactionCallbackError)

      expect(ran).toBe(false)
      const row = db.select().from(currencies).where(eq(currencies.id, 'currency_usd')).get()
      expect(row?.name).not.toBe('Should Not Survive Either')
    })
  })
})

/**
 * Compile-time-only fixture — never imported or called by anything,
 * exists purely so `pnpm typecheck` proves runAppTransaction's types
 * reject an async (or otherwise Promise-returning) callback. Exported
 * so it isn't itself flagged as an unused declaration.
 */
export function _typeCheckOnly_runAppTransactionRejectsAsyncCallbacks(db: AppDb): void {
  // @ts-expect-error — an async callback must be rejected at compile time, not just at runtime
  runAppTransaction(db, async (context) => {
    context.tx.select().from(currencies).all()
    return 1
  })

  // @ts-expect-error — a callback that explicitly returns a Promise must be rejected the same way
  runAppTransaction(db, (context) => {
    void context
    return Promise.resolve(1)
  })

  // Sanity check with no @ts-expect-error: an ordinary synchronous
  // callback must continue to typecheck normally, with its return type
  // correctly inferred.
  const syncResult: number = runAppTransaction(db, (context) => {
    void context
    return 1
  })
  void syncResult
}
