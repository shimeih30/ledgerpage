/**
 * Serializes every authentication state transition (normal login and
 * session unlock alike) through one single, process-local queue —
 * deliberately global, not keyed per username or per session. A
 * per-identifier lock map would prevent the specific race this exists
 * to close, but would itself grow without bound as distinct login
 * identifiers are tried (including ones that don't correspond to any
 * real user) — exactly the kind of unbounded structure the anti-
 * enumeration design in authenticationService.ts already avoids for
 * login_events, and the same principle applies here.
 *
 * The race this closes: `authenticate` reads a user's current
 * failed_login_count, then awaits Argon2id verification (a real yield
 * point — hash-wasm's WASM execution does not run fully synchronously
 * to completion), then computes and writes the next count. Two
 * concurrent authenticate() calls for the same user could both read the
 * same starting count before either writes, undercounting failed
 * attempts and potentially letting the lockout threshold be bypassed by
 * concurrency alone. Funneling every call's *entire* body — including
 * its await points — through this one-at-a-time queue means at most one
 * authenticate()-family operation is ever actually running at a time,
 * globally, which eliminates the interleaving that the race depends on.
 *
 * For a single-user desktop app where realistically one interactive
 * login or unlock happens at a time, full serialization has no
 * meaningful performance cost — this is not a high-throughput server
 * authenticating many users concurrently.
 */

let queueTail: Promise<void> = Promise.resolve()

export function enqueueAuthenticationOperation<T>(operation: () => Promise<T>): Promise<T> {
  const runPromise = queueTail.then(operation, operation)

  // The queue's own continuation must never reject, or every operation
  // enqueued after a failing one would be permanently stuck behind it.
  queueTail = runPromise.then(
    () => undefined,
    () => undefined
  )

  return runPromise
}
