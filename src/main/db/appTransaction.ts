import type { AppDb, AppTransaction } from './dbTypes'

/**
 * Passed to the function given to runAppTransaction. `tx` is the live,
 * in-progress transaction — use it for all reads/writes exactly as any
 * other AppTransaction. `afterCommit` registers a callback to run only
 * once the surrounding SQLite transaction has actually committed —
 * never while it's still open, and never if it rolls back.
 */
export interface AppTransactionContext {
  readonly tx: AppTransaction
  /**
   * Registers `callback` to run after this transaction commits
   * successfully. Never runs if the transaction throws/rolls back.
   * Multiple registrations all run, in registration order, regardless
   * of whether an earlier one throws (see AfterCommitCallbackError).
   */
  afterCommit(callback: () => void): void
}

/**
 * Thrown when one or more afterCommit callbacks throw. The SQLite
 * transaction has ALREADY committed successfully by the time any
 * afterCommit callback runs — this error means a *post-commit* side
 * effect failed, never that the underlying database write didn't
 * happen or was rolled back. Verified empirically before this design
 * was relied on: the database row from a transaction whose afterCommit
 * callback throws is still present afterward.
 */
export class AfterCommitCallbackError extends Error {
  readonly errors: readonly unknown[]

  constructor(errors: readonly unknown[]) {
    super(
      `${String(errors.length)} afterCommit callback(s) failed after a successful database commit ` +
        '— the commit itself succeeded and was not rolled back'
    )
    this.name = 'AfterCommitCallbackError'
    this.errors = errors
  }
}

/**
 * Thrown when the function passed to runAppTransaction returns a
 * Promise or other thenable instead of a plain value. better-sqlite3's
 * transaction callback is fully synchronous — it does not, and cannot,
 * await anything. Passing an async function (or anything else that
 * returns a thenable) would let SQLite consider the transaction
 * "finished" and commit before any of the awaited work inside `fn` has
 * actually run, silently corrupting the transaction's atomicity
 * guarantee: writes issued after the callback's first `await` would
 * execute — if they execute at all — entirely outside the transaction,
 * or against a connection that has already moved on.
 *
 * Detected and thrown *inside* the live SQLite transaction (see
 * runAppTransaction below), before ever returning to better-sqlite3's
 * own transaction wrapper — this is what causes the transaction to roll
 * back exactly like any other thrown error, verified empirically before
 * this design was relied on: writes made before the callback's first
 * `await` do not survive.
 */
export class AsyncTransactionCallbackError extends Error {
  constructor() {
    super(
      'runAppTransaction callbacks must be synchronous — better-sqlite3 cannot await inside a ' +
        'transaction. The callback returned a Promise/thenable instead of a plain value, so the ' +
        'transaction was rolled back before any afterCommit callback could run.'
    )
    this.name = 'AsyncTransactionCallbackError'
  }
}

/**
 * `NotAPromise<T>` collapses to `never` whenever `T` would itself be a
 * Promise — used only in runAppTransaction's signature below to reject
 * an async (or otherwise Promise-returning) callback at compile time.
 * Verified empirically before relying on it: TypeScript correctly
 * rejects both `async (context) => {...}` and
 * `(context) => Promise.resolve(x)` callbacks passed where this type is
 * expected, while an ordinary synchronous callback continues to
 * typecheck and have its return type inferred normally. This is a
 * "where practical" compile-time nudge, not the actual security/
 * correctness boundary — the runtime thenable check inside
 * runAppTransaction below is what actually enforces this regardless of
 * what a caller's TypeScript types claim (an untyped JS caller, or one
 * that bypasses this with `as any`, still gets caught there).
 */
type NotAPromise<T> = T extends Promise<unknown> ? never : T

/**
 * True for anything with a callable `.then` — a real Promise, a
 * thenable object, or a thenable *function* (a plain JS function can
 * have a `.then` property attached to it, and `typeof` such a value is
 * `'function'`, not `'object'` — checking only `typeof value ===
 * 'object'` would silently miss it). `null` is excluded explicitly,
 * since `typeof null === 'object'` in JS.
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/**
 * Runs `fn` inside a real SQLite transaction (via `db.transaction(...)`,
 * the same primitive every other transactional service in this codebase
 * already uses) and, only if that transaction returns without throwing
 * — meaning SQLite has actually issued COMMIT, not ROLLBACK — runs
 * every callback registered via `context.afterCommit(...)` during `fn`,
 * in registration order. If `fn` throws, the transaction rolls back
 * (ordinary `db.transaction` behavior) and no afterCommit callback ever
 * runs — verified empirically before this was written, not merely
 * assumed from reading the surrounding library's documentation.
 *
 * `fn` MUST be synchronous. This is enforced two ways: `NotAPromise<T>`
 * in the signature below rejects an async/Promise-returning callback at
 * compile time where practical (see its own doc comment), and — because
 * that alone can be bypassed by an untyped caller or an explicit type
 * assertion — a runtime check inside the live transaction throws
 * AsyncTransactionCallbackError the instant `fn(context)` returns
 * anything thenable, before this function ever returns to
 * `db.transaction`'s own machinery. That throw happens while the SQLite
 * transaction is still open, so it rolls back exactly like any other
 * error — any writes issued before the callback's first `await` do not
 * survive — and no afterCommit callback registered during that attempt
 * ever runs. This function itself deliberately stays synchronous (it is
 * not declared `async`); it does not, and must not, wait for whatever
 * the abandoned async callback does after its first `await` — that
 * continuation runs (if at all) against an already-closed transaction,
 * which is precisely the misuse this whole mechanism exists to reject
 * loudly rather than silently mishandle.
 *
 * This exists specifically to let a caller consume an in-memory
 * capability (e.g. RecoveryCeremonyService's confirmed-commit-token map
 * entry) exactly when — and only when — the corresponding database
 * write has truly, durably happened, without needing a fragile
 * SQLite-level commit hook. Used narrowly, only where that specific
 * "consume in memory in lockstep with a real commit" need exists — most
 * of this codebase's transactional services have no such need and
 * continue to take a plain AppTransaction directly.
 */
export function runAppTransaction<T>(
  db: AppDb,
  fn: (context: AppTransactionContext) => NotAPromise<T>
): T {
  const afterCommitCallbacks: Array<() => void> = []

  const result = db.transaction((tx) => {
    const context: AppTransactionContext = {
      tx,
      afterCommit(callback) {
        afterCommitCallbacks.push(callback)
      }
    }
    const fnResult = fn(context)
    if (isThenable(fnResult)) {
      // Still inside the live SQLite transaction here — throwing rolls
      // it back exactly like any other error, before better-sqlite3's
      // own machinery ever sees a Promise as a "return value."
      throw new AsyncTransactionCallbackError()
    }
    return fnResult
  })

  // Reaching this line means db.transaction(...) returned instead of
  // throwing — the transaction committed. Callbacks run only now, never
  // inside the SQLite transaction itself.
  const callbackErrors: unknown[] = []
  for (const callback of afterCommitCallbacks) {
    try {
      callback()
    } catch (error) {
      callbackErrors.push(error)
    }
  }

  if (callbackErrors.length > 0) {
    throw new AfterCommitCallbackError(callbackErrors)
  }

  return result
}
