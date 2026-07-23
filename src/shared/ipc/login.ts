/**
 * Shared IPC contract for Slice 9's login/session channels.
 *
 * Imported by the main process (to register handlers), the preload
 * script (to wrap them safely), and the renderer (to type the exposed
 * window.ledgerpage global) — the same three-way pattern
 * src/shared/ipc/appInfo.ts and src/shared/ipc/setup.ts already
 * established.
 *
 * Deliberately excluded from every result type below: a session id (no
 * channel accepts or returns one — every operation implicitly targets
 * "the current session," which only the main process tracks), a
 * password hash, or any raw internal exception message.
 */

export const LOGIN_ATTEMPT_CHANNEL = 'login:attempt' as const
export const LOGIN_GET_SESSION_STATE_CHANNEL = 'login:get-session-state' as const
export const LOGIN_UNLOCK_CHANNEL = 'login:unlock' as const
export const LOGIN_LOGOUT_CHANNEL = 'login:logout' as const
export const LOGIN_TOUCH_CHANNEL = 'login:touch' as const

export interface LoginAttemptInput {
  loginIdentifier: string
  password: string
}

export interface SafeSessionInfo {
  displayName: string
  isOwner: boolean
  /**
   * Cosmetic-only, matching isOwner's own posture exactly — decides
   * whether the renderer shows an Audit Log nav link, nothing more.
   * The real boundary is audit:list's own requireAuthorizedCaller
   * check (see registerAuditHandlers.ts), which reads role codes fresh
   * from SQLite on every call, entirely independent of this value.
   */
  canViewAuditLog: boolean
  /**
   * Same cosmetic-only posture — gates whether the renderer shows a
   * Products nav link / read-only view. Real enforcement is products:*'s
   * own requireAuthorizedCaller('products.read') checks.
   */
  canViewProducts: boolean
  /**
   * Same cosmetic-only posture — gates whether the renderer shows
   * create/edit/deactivate controls on the Products screens. Real
   * enforcement is products:*'s own requireAuthorizedCaller('products.manage')
   * checks on each individual mutating call.
   */
  canManageProducts: boolean
}

export type LoginResult = { success: true; session: SafeSessionInfo } | { success: false }

/**
 * `locked` always carries `displayName` — never a bare tag the
 * renderer would need a second round-trip to resolve into a greeting
 * on the lock screen.
 */
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
    }

export interface UnlockInput {
  password: string
}

export type UnlockResult = { success: true; session: SafeSessionInfo } | { success: false }

export interface LedgerPageLoginApi {
  login: (input: LoginAttemptInput) => Promise<LoginResult>
  getSessionState: () => Promise<SessionState>
  unlockSession: (input: UnlockInput) => Promise<UnlockResult>
  logout: () => Promise<void>
  /**
   * Called by the renderer's own throttled activity listener — never
   * by the session-state poll itself (getSessionState is a pure read
   * and must never reset the idle clock). Carries no payload and
   * reveals nothing beyond "some activity happened."
   */
  touchSession: () => Promise<void>
}
