import { assertCan, AuthorizationError, type Action } from './authorizationService'
import { getFreshRoleCodesForUser } from '../users/roleCodes'
import type { LoginService } from '../users/loginService'
import type { AppDb } from '../db/dbTypes'

export type RequireAuthorizedCallerErrorCode = 'session_invalid' | 'not_authorized'

export type RequireAuthorizedCallerResult =
  { ok: true; callerUserId: string } | { ok: false; errorCode: RequireAuthorizedCallerErrorCode }

/**
 * The generic version of the gate userManagementService.ts's own
 * requireOwnerCaller/tryRequireOwnerCaller established for Slice 9's
 * Owner-only surface — reusable here (and by any future slice's
 * service) for an arbitrary Action, not just 'users.manage'.
 * userManagementService.ts itself is deliberately NOT refactored to use
 * this in this slice: it's approved, frozen, twice-corrected code, and
 * touching it here would be unjustified churn for a slice that doesn't
 * need to.
 *
 * Resolves "who is asking" via loginService.getCurrentActiveUserId,
 * which already excludes locked, hard-expired, missing, and
 * deactivated-user sessions (Slice 9's own corrective patch) — a locked
 * session has no application authority here either, with no separate
 * check needed. Reads that caller's role codes fresh from SQLite on
 * every call via the existing getFreshRoleCodesForUser — never
 * sessionManager's own cached roleCodes, never a renderer-supplied
 * flag — and asserts `action` via the existing can()/assertCan().
 *
 * Returns a discriminated result rather than throwing, matching every
 * other privileged-operation gate in this codebase: 'session_invalid'
 * when there is no live, unlocked, active-user session at all;
 * 'not_authorized' when there is one but it lacks the requested action.
 * Never reveals which of the two specifically failed beyond that code —
 * same anti-enumeration posture as the rest of this codebase's
 * authorization surface.
 */
export function requireAuthorizedCaller(
  db: AppDb,
  loginService: LoginService,
  action: Action
): RequireAuthorizedCallerResult {
  const callerUserId = loginService.getCurrentActiveUserId(db)
  if (!callerUserId) {
    return { ok: false, errorCode: 'session_invalid' }
  }

  const callerRoleCodes = getFreshRoleCodesForUser(db, callerUserId)
  try {
    assertCan({ roleCodes: callerRoleCodes }, action)
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, errorCode: 'not_authorized' }
    }
    throw error
  }

  return { ok: true, callerUserId }
}
