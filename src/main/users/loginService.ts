import { authenticate } from '../auth/authenticationService'
import { getUserById, type SafeUser } from '../auth/userService'
import { can } from '../auth/authorizationService'
import type { SessionManager } from '../auth/sessionManager'
import { getFreshRoleCodesForUser, hasOwnerRole } from './roleCodes'
import type { AppDb } from '../db/dbTypes'

export interface SafeSessionInfo {
  displayName: string
  isOwner: boolean
  /**
   * Cosmetic-only, matching isOwner's existing precedent exactly — this
   * flag decides whether the renderer *shows* an Audit Log nav link,
   * nothing more. The real boundary is the audit:list IPC handler's own
   * requireAuthorizedCaller('audit.read') check, which reads role codes
   * fresh from SQLite on every call, completely independent of this
   * value. A renderer that somehow showed the link to an unauthorized
   * user would still get a clean not_authorized failure from the actual
   * handler, never real data.
   */
  canViewAuditLog: boolean
  /**
   * Same cosmetic-only posture as canViewAuditLog — gates whether the
   * renderer shows a Products nav link / read-only view at all. Real
   * enforcement is products:*'s own requireAuthorizedCaller('products.read')
   * checks, resolved fresh from SQLite on every call.
   */
  canViewProducts: boolean
  /**
   * Same cosmetic-only posture — gates whether the renderer shows
   * create/edit/deactivate controls on the Products screens. Real
   * enforcement is products:*'s own requireAuthorizedCaller('products.manage')
   * checks on each individual mutating call, never this flag.
   */
  canManageProducts: boolean
  /**
   * Same cosmetic-only posture — gates whether the renderer shows an
   * Inventory Items nav link / read-only view at all. Real enforcement
   * is inventory-items:*'s own
   * requireAuthorizedCaller('inventory_items.read') checks, resolved
   * fresh from SQLite on every call.
   */
  canViewInventoryItems: boolean
  /**
   * Same cosmetic-only posture — gates whether the renderer shows
   * create/edit/deactivate controls on the Inventory Items screens.
   * Real enforcement is inventory-items:*'s own
   * requireAuthorizedCaller('inventory_items.manage') checks on each
   * individual mutating call, never this flag.
   */
  canManageInventoryItems: boolean
}

export type LoginOutcome = { success: true; session: SafeSessionInfo } | { success: false }

export type UnlockOutcome = { success: true; session: SafeSessionInfo } | { success: false }

export type SessionState =
  | { state: 'logged_out' }
  | { state: 'locked'; displayName: string }
  | {
      state: 'active'
      displayName: string
      isOwner: boolean
      canViewAuditLog: boolean
      canViewProducts: boolean
      canManageProducts: boolean
      canViewInventoryItems: boolean
      canManageInventoryItems: boolean
    }

export interface StartIdleLockTimerOptions {
  /** Idle duration after which the current session is locked. Default 5 minutes. */
  lockAfterIdleMs?: number
  /** How often the timer checks. Default 10 seconds. */
  checkIntervalMs?: number
}

export interface LoginService {
  login(db: AppDb, loginIdentifier: string, password: string): Promise<LoginOutcome>
  getSessionState(db: AppDb): SessionState
  unlock(db: AppDb, password: string): Promise<UnlockOutcome>
  logout(): void
  /**
   * Records activity on the current session — but only if it is a live,
   * still-active-user, and (critically) *unlocked* session. A locked
   * session's idle clock is never refreshed by this: there is nothing
   * legitimate for it to protect against once already locked, and
   * refreshing it here would let a stray/direct touchSession call mask
   * the very state getSessionState's polling exists to surface. Missing,
   * hard-expired, inactive-user, and locked sessions are all ignored
   * safely (no-op, never a thrown error) — the same "fail safe, not
   * loud" posture as every other read in this file. Requires `db`
   * because it must revalidate the session's user still exists and is
   * active before ever calling sessionManager.touch — the same
   * resolveLiveSession gate every other method here goes through.
   */
  touch(db: AppDb): void
  /**
   * Resolves the current session to its live, active-user, *unlocked*
   * user id — or undefined if there is no current session, it has
   * hard-expired, its user no longer exists/is no longer active, or the
   * session is currently locked. A locked session must never count as
   * an active authorized session: this is the one function every
   * privileged-operation caller (userManagementService's
   * requireOwnerCaller) uses to determine "who is asking," so excluding
   * locked sessions here is what makes every users/roles operation
   * correctly fail closed with session_invalid while the lock screen is
   * displayed, without needing a separate check duplicated at every call
   * site. Never a substitute for that caller's own fresh authorization
   * check via getFreshRoleCodesForUser. Never destroys the session
   * merely because it is locked — a correct-password unlock (see
   * `unlock` above) restores authority on the exact same session,
   * without requiring a new login.
   */
  getCurrentActiveUserId(db: AppDb): string | undefined
  /**
   * Starts the idle-lock timer — a periodic check that locks (never
   * destroys) the current session once it has been idle longer than
   * `lockAfterIdleMs`. Idempotent: calling this again first disposes
   * any previously running timer, so tests and re-initialization never
   * accumulate multiple concurrent timers.
   */
  startIdleLockTimer(db: AppDb, options?: StartIdleLockTimerOptions): void
  /** Stops the idle-lock timer. Safe to call even if none is running. */
  dispose(): void
}

const DEFAULT_LOCK_AFTER_IDLE_MS = 5 * 60 * 1000 // 5 minutes
const DEFAULT_CHECK_INTERVAL_MS = 10 * 1000 // 10 seconds

export interface LoginServiceOptions {
  sessionManager: SessionManager
  now?: () => Date
}

function toSafeSessionInfo(user: SafeUser, roleCodes: readonly string[]): SafeSessionInfo {
  return {
    displayName: user.displayName,
    isOwner: hasOwnerRole(roleCodes),
    canViewAuditLog: can({ roleCodes }, 'audit.read'),
    canViewProducts: can({ roleCodes }, 'products.read'),
    canManageProducts: can({ roleCodes }, 'products.manage'),
    canViewInventoryItems: can({ roleCodes }, 'inventory_items.read'),
    canManageInventoryItems: can({ roleCodes }, 'inventory_items.manage')
  }
}

/**
 * Factory, not a singleton — matching every other stateful Slice 7/8
 * service. Owns exactly one bounded piece of state: `currentSessionId`
 * (or undefined) — never a per-request map, never more than one
 * "current" session. `sessionManager` itself is shared (constructed
 * once in main/index.ts and passed in here and to
 * userManagementService), since it's the actual holder of session
 * data; this service only ever tracks *which* of sessionManager's
 * sessions is "the current one."
 */
export function createLoginService(options: LoginServiceOptions): LoginService {
  const { sessionManager } = options
  const now = options.now ?? (() => new Date())

  let currentSessionId: string | undefined
  let idleLockTimer: ReturnType<typeof setInterval> | undefined

  interface LiveSessionContext {
    sessionId: string
    userId: string
    isLocked: boolean
    lastActivityAt: Date
    user: SafeUser
  }

  /**
   * The one place this service resolves "is there a current, genuinely
   * usable session." Every public method that needs to know reads
   * through here — never a cached field, never the session snapshot's
   * own stale copy of anything durable.
   *
   * Three ways this can fail, all treated identically (return
   * undefined and tear down whatever stale state exists):
   * - no currentSessionId at all;
   * - sessionManager reports the session gone (hard-expired via its
   *   own idleTimeoutMs, explicitly destroyed some other way) — this
   *   is where hard-expiry cleanup becomes visible to this service:
   *   currentSessionId is cleared here, not left dangling;
   * - the session's user no longer exists, or is no longer active
   *   (deactivated, possibly by a different flow entirely) — this is
   *   the "recheck that the session user still exists and is active"
   *   requirement, enforced on every single read, not just at login
   *   time.
   */
  function resolveLiveSession(db: AppDb): LiveSessionContext | undefined {
    if (!currentSessionId) {
      return undefined
    }

    const session = sessionManager.get(currentSessionId)
    if (!session) {
      currentSessionId = undefined
      return undefined
    }

    const user = getUserById(db, session.userId)
    if (!user || !user.isActive) {
      sessionManager.destroy(currentSessionId)
      currentSessionId = undefined
      return undefined
    }

    return {
      sessionId: session.sessionId,
      userId: session.userId,
      isLocked: session.isLocked,
      lastActivityAt: session.lastActivityAt,
      user
    }
  }

  return {
    async login(db, loginIdentifier, password) {
      const authResult = await authenticate(db, loginIdentifier, password, 'normal_login', now())
      if (!authResult.success) {
        return { success: false }
      }

      // One-current-session replacement: explicitly destroy whatever
      // was current before creating the new one — sessionManager's own
      // map is a general multi-session store, but this service enforces
      // "at most one current session" as its own invariant, never
      // leaving two sessions simultaneously reachable as "the current
      // one."
      if (currentSessionId) {
        sessionManager.destroy(currentSessionId)
        currentSessionId = undefined
      }

      const roleCodes = getFreshRoleCodesForUser(db, authResult.user.id)
      const session = sessionManager.create(
        authResult.user.id,
        authResult.user.companyId,
        roleCodes
      )
      currentSessionId = session.sessionId

      return { success: true, session: toSafeSessionInfo(authResult.user, roleCodes) }
    },

    getSessionState(db) {
      const context = resolveLiveSession(db)
      if (!context) {
        return { state: 'logged_out' }
      }

      if (context.isLocked) {
        return { state: 'locked', displayName: context.user.displayName }
      }

      const roleCodes = getFreshRoleCodesForUser(db, context.userId)
      return {
        state: 'active',
        displayName: context.user.displayName,
        isOwner: hasOwnerRole(roleCodes),
        canViewAuditLog: can({ roleCodes }, 'audit.read'),
        canViewProducts: can({ roleCodes }, 'products.read'),
        canManageProducts: can({ roleCodes }, 'products.manage'),
        canViewInventoryItems: can({ roleCodes }, 'inventory_items.read'),
        canManageInventoryItems: can({ roleCodes }, 'inventory_items.manage')
      }
    },

    async unlock(db, password) {
      const context = resolveLiveSession(db)
      if (!context) {
        return { success: false }
      }

      // unlockWithCredentials performs the real authenticate() call
      // internally (anti-enumeration, lockout-aware, and — since
      // authenticate() re-reads the user fresh right before computing
      // its outcome — already correctly rejects a user deactivated
      // during this same async call) and re-validates the session is
      // still the same live, locked one immediately after that await,
      // before ever clearing isLocked. Reused exactly as Slice 7 built
      // it — no duplicated re-validation needed here.
      const result = await sessionManager.unlockWithCredentials(
        db,
        context.sessionId,
        password,
        now()
      )
      if (!result.success) {
        return { success: false }
      }

      const user = getUserById(db, result.session.userId)
      if (!user || !user.isActive) {
        // Vanishingly unlikely (authenticate's own isActive gate inside
        // unlockWithCredentials already covers this), kept as the same
        // defense-in-depth every other read in this file applies.
        sessionManager.destroy(result.session.sessionId)
        currentSessionId = undefined
        return { success: false }
      }

      const roleCodes = getFreshRoleCodesForUser(db, user.id)
      return { success: true, session: toSafeSessionInfo(user, roleCodes) }
    },

    logout() {
      if (currentSessionId) {
        sessionManager.destroy(currentSessionId)
        currentSessionId = undefined
      }
    },

    touch(db) {
      const context = resolveLiveSession(db)
      if (!context || context.isLocked) {
        return
      }
      sessionManager.touch(context.sessionId)
    },

    getCurrentActiveUserId(db) {
      const context = resolveLiveSession(db)
      if (!context || context.isLocked) {
        return undefined
      }
      return context.userId
    },

    startIdleLockTimer(db, timerOptions = {}) {
      const lockAfterIdleMs = timerOptions.lockAfterIdleMs ?? DEFAULT_LOCK_AFTER_IDLE_MS
      const checkIntervalMs = timerOptions.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS

      if (idleLockTimer) {
        clearInterval(idleLockTimer)
      }

      idleLockTimer = setInterval(() => {
        // Re-resolved fresh on every tick — never a captured reference
        // from timer-start time. A logout/hard-expiry between ticks
        // must not cause this to lock (or error on) a session that no
        // longer exists.
        const context = resolveLiveSession(db)
        if (!context || context.isLocked) {
          return
        }
        const idleMs = now().getTime() - context.lastActivityAt.getTime()
        if (idleMs >= lockAfterIdleMs) {
          sessionManager.lock(context.sessionId)
        }
      }, checkIntervalMs)

      // Node/Electron main-process timers keep the event loop alive by
      // default; unref lets the process still exit cleanly (e.g. during
      // tests, or app quit) without requiring dispose() to be called
      // first in every path.
      idleLockTimer.unref?.()
    },

    dispose() {
      if (idleLockTimer) {
        clearInterval(idleLockTimer)
        idleLockTimer = undefined
      }
    }
  }
}
