import { randomBytes } from 'node:crypto'
import { authenticate } from './authenticationService'
import { getUserById } from './userService'
import type { AppDb } from '../db/dbTypes'

/**
 * Sessions are in-memory only — there is no session table, and nothing
 * here is ever written to SQLite. A process restart discards every
 * session, which is the intended behavior (there is no "remember me
 * across app restarts" concept in this slice).
 */
export interface SessionSnapshot {
  sessionId: string
  userId: string
  companyId: string
  roleCodes: readonly string[]
  createdAt: Date
  lastActivityAt: Date
  isLocked: boolean
}

export interface SessionManagerOptions {
  /** Idle timeout in milliseconds. Defaults to DEFAULT_IDLE_TIMEOUT_MS. Must be a finite positive integer. */
  idleTimeoutMs?: number
  /** Injectable clock, defaults to the real system clock. */
  now?: () => Date
  /** Injectable session-ID source, defaults to a CSPRNG. Must return a non-empty string. */
  randomId?: () => string
}

export interface UnlockSuccess {
  success: true
  session: SessionSnapshot
}

export interface UnlockFailure {
  success: false
}

export type UnlockResult = UnlockSuccess | UnlockFailure

export interface SessionManager {
  create(userId: string, companyId: string, roleCodes: readonly string[]): SessionSnapshot
  get(sessionId: string): SessionSnapshot | undefined
  touch(sessionId: string): SessionSnapshot | undefined
  lock(sessionId: string): SessionSnapshot | undefined
  /**
   * The ONLY way to clear a session's lock flag — there is no raw
   * unlock operation anywhere in this module's exports, and nothing
   * outside this function's own closure can reach the mutation that
   * flips `isLocked`. Requires `db`, `sessionId`, and `password`
   * because it always performs real credential verification: it calls
   * `authenticate(db, ..., 'session_unlock', now)` — the exact same
   * primitive normal login uses, so it inherits identical
   * anti-enumeration behavior, lockout policy, and (via authenticate's
   * own internal queue) serialization automatically — and only clears
   * the lock flag if that call reports success. A wrong password, an
   * inactive user, or a currently account-locked user all leave the
   * session exactly as it was: still locked, `lastActivityAt`
   * untouched. Even when the session itself doesn't exist (already
   * expired, destroyed, or a fabricated ID), a real `authenticate()`
   * call still runs before returning failure — no code path here skips
   * the expensive verification step based on whether the session was
   * found, matching the same anti-enumeration principle `authenticate`
   * itself applies to a nonexistent login identifier.
   */
  unlockWithCredentials(
    db: AppDb,
    sessionId: string,
    password: string,
    now?: Date
  ): Promise<UnlockResult>
  destroy(sessionId: string): boolean
  /** Returns the number of sessions removed. */
  invalidateAllForUser(userId: string): number
}

export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

const DEFAULT_ID_COLLISION_RETRY_ATTEMPTS = 10

/**
 * A fixed, private dummy login identifier — used only by
 * unlockWithCredentials when there is no real session to resolve a
 * user from. Deliberately contains spaces, which
 * normalizeLoginIdentifier unconditionally rejects (its whitespace
 * check throws before any lookup happens), so this is guaranteed —
 * structurally, not merely by convention — to never resolve to a real
 * account, regardless of what login identifiers exist in the database.
 * Never derived from sessionId, password, or any other caller-supplied
 * input: a caller-controlled sessionId could coincidentally equal a
 * real user's login identifier, and falling back to it directly (the
 * bug this constant fixes) would have let a missing/expired-session
 * unlock attempt silently increment or lock that real, unrelated
 * account's login state.
 */
const DUMMY_UNLOCK_LOGIN_IDENTIFIER = 'ledgerpage session unlock dummy identifier'

export class SessionManagerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionManagerError'
  }
}

interface InternalSessionRecord {
  sessionId: string
  userId: string
  companyId: string
  roleCodes: string[]
  createdAt: Date
  lastActivityAt: Date
  isLocked: boolean
}

function defaultRandomId(): string {
  return randomBytes(32).toString('base64url') // 256 bits, deliberately more entropy than a UUID
}

function cloneDate(value: Date): Date {
  return new Date(value.getTime())
}

/**
 * Factory, not a singleton/class with module-level state — each call
 * returns an independent manager with its own Map, so tests never share
 * state with each other and production code can create exactly one
 * instance to use for the app's lifetime.
 *
 * `unlockWithCredentials` is defined here, inside this closure, rather
 * than as a separate exported function or module — this is the entire
 * point: the mutation that flips `isLocked` (inline below) is reachable
 * only from within this function body, never through any exported
 * symbol, a WeakMap-based side channel, or anything else a caller could
 * import and call directly without going through real credential
 * verification first.
 */
export function createSessionManager(options: SessionManagerOptions = {}): SessionManager {
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0 || !Number.isInteger(idleTimeoutMs)) {
    throw new SessionManagerError('idleTimeoutMs must be a finite positive integer')
  }

  const now = options.now ?? (() => new Date())
  const randomId = options.randomId ?? defaultRandomId

  const sessions = new Map<string, InternalSessionRecord>()

  function toSnapshot(record: InternalSessionRecord): SessionSnapshot {
    // A new plain object every time, with cloned Date instances and a
    // copied roleCodes array — mutating anything on the returned
    // snapshot, including calling .setTime() on one of its Date fields,
    // can never affect the stored session. Verified directly by test,
    // not just asserted here: Dates are mutable objects in JS, so
    // returning the same reference (the original bug this fix
    // addresses) would have let a caller silently corrupt internal
    // state through what looks like a read-only snapshot.
    return {
      sessionId: record.sessionId,
      userId: record.userId,
      companyId: record.companyId,
      roleCodes: [...record.roleCodes],
      createdAt: cloneDate(record.createdAt),
      lastActivityAt: cloneDate(record.lastActivityAt),
      isLocked: record.isLocked
    }
  }

  /** Looks up a session, transparently expiring (and removing) it if idle too long. */
  function getLiveRecord(sessionId: string): InternalSessionRecord | undefined {
    const record = sessions.get(sessionId)
    if (!record) {
      return undefined
    }
    const currentTime = now()
    if (currentTime.getTime() - record.lastActivityAt.getTime() > idleTimeoutMs) {
      sessions.delete(sessionId)
      return undefined
    }
    return record
  }

  function generateUniqueSessionId(): string {
    for (let attempt = 0; attempt < DEFAULT_ID_COLLISION_RETRY_ATTEMPTS; attempt += 1) {
      const candidate = randomId()
      if (typeof candidate !== 'string' || candidate.length === 0) {
        throw new SessionManagerError('randomId() must return a non-empty string')
      }
      // A collision is only a real problem if it collides with a
      // currently-live session — an expired entry sharing the same ID
      // is not something we need to preserve, but we still never
      // overwrite an existing *live* session under any circumstance.
      if (!getLiveRecord(candidate)) {
        return candidate
      }
    }
    // Documented collision behavior: bounded retry, then fail closed
    // with a controlled error rather than ever silently overwriting a
    // live session or looping forever. With a real CSPRNG source (256
    // bits of entropy by default) this path is not expected to be
    // reachable in practice; it exists to make a misbehaving injected
    // randomId() (e.g. a test double with a tiny ID space) fail loudly
    // instead of corrupting state.
    throw new SessionManagerError(
      `Could not generate a unique session ID after ${String(DEFAULT_ID_COLLISION_RETRY_ATTEMPTS)} attempts`
    )
  }

  return {
    create(userId, companyId, roleCodes) {
      const sessionId = generateUniqueSessionId()
      const currentTime = cloneDate(now())
      const record: InternalSessionRecord = {
        sessionId,
        userId,
        companyId,
        roleCodes: [...roleCodes],
        createdAt: currentTime,
        lastActivityAt: cloneDate(currentTime),
        isLocked: false
      }
      sessions.set(sessionId, record)
      return toSnapshot(record)
    },

    get(sessionId) {
      const record = getLiveRecord(sessionId)
      return record ? toSnapshot(record) : undefined
    },

    touch(sessionId) {
      const record = getLiveRecord(sessionId)
      if (!record) {
        return undefined
      }
      record.lastActivityAt = cloneDate(now())
      return toSnapshot(record)
    },

    lock(sessionId) {
      const record = getLiveRecord(sessionId)
      if (!record) {
        return undefined
      }
      record.isLocked = true
      return toSnapshot(record)
    },

    async unlockWithCredentials(db, sessionId, password, unlockNow = new Date()) {
      // Deliberately capture only the userId here, never the record
      // itself — the record is a live, internally-mutable object, and
      // during the upcoming await (real Argon2id verification, a
      // genuine yield point) the session it belongs to can be
      // destroyed, expired, or invalidated by an entirely unrelated
      // caller. Mutating or returning whatever this variable pointed to
      // before the await would silently operate on a session that may
      // no longer be the live, current one — or may not exist at all
      // anymore — even though the object reference itself would still
      // look valid.
      const userIdBeforeVerification = getLiveRecord(sessionId)?.userId

      // Even when the session doesn't exist, still resolve a login
      // identifier to verify against where possible, falling back to
      // the fixed DUMMY_UNLOCK_LOGIN_IDENTIFIER constant (never
      // sessionId — a caller-controlled value that could coincidentally
      // equal a real user's login identifier) so authenticate() still
      // runs its full verification step every time, against a target
      // that can never resolve to a real account, no shortcut based on
      // session existence.
      const loginIdentifierForVerification = userIdBeforeVerification
        ? getUserById(db, userIdBeforeVerification)?.loginIdentifier
        : undefined

      const authResult = await authenticate(
        db,
        loginIdentifierForVerification ?? DUMMY_UNLOCK_LOGIN_IDENTIFIER,
        password,
        'session_unlock',
        unlockNow
      )

      if (!authResult.success) {
        return { success: false }
      }

      // Re-read the CURRENT live session fresh, through the same
      // expiry-aware lookup every other method uses — never trust
      // anything captured before the await above. Confirms, against the
      // state as it stands right now: the session still exists, it
      // still belongs to the user who was just authenticated (not some
      // unrelated session that happens to reuse this ID after the
      // original was destroyed and, in principle, a new one created),
      // and it is still locked (if some other path already unlocked it
      // during verification, this is not this call's success to claim).
      const currentRecord = getLiveRecord(sessionId)
      if (
        !currentRecord ||
        currentRecord.userId !== authResult.user.id ||
        !currentRecord.isLocked
      ) {
        return { success: false }
      }

      // The only place in this entire module that ever sets
      // isLocked = false. Reached only after a real, successful
      // authenticate() call above, against the freshly re-read record.
      currentRecord.isLocked = false
      currentRecord.lastActivityAt = cloneDate(unlockNow)

      return { success: true, session: toSnapshot(currentRecord) }
    },

    destroy(sessionId) {
      return sessions.delete(sessionId)
    },

    invalidateAllForUser(userId) {
      let removedCount = 0
      for (const [sessionId, record] of sessions) {
        if (record.userId === userId) {
          sessions.delete(sessionId)
          removedCount += 1
        }
      }
      return removedCount
    }
  }
}
