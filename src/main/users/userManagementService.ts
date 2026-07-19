import { eq } from 'drizzle-orm'
import { assertCan, AuthorizationError } from '../auth/authorizationService'
import { requireTrimmedDisplayName, normalizeLoginIdentifier } from '../auth/authValidation'
import { hashPassword, type PasswordHash } from '../auth/passwordHashing'
import { createUser, UserServiceError, deactivateUser, reactivateUser } from '../auth/userService'
import { runAppTransaction } from '../db/appTransaction'
import { PRIMARY_COMPANY_ID, userRoles, users } from '../db/schema'
import { getFreshRoleCodesForUser, hasOwnerRole } from './roleCodes'
import type { LoginService } from './loginService'
import type { SessionManager } from '../auth/sessionManager'
import type { AppDb } from '../db/dbTypes'

/**
 * Deliberately excludes 'owner' as a representable value — not merely
 * rejected at runtime. There is no code path anywhere in this service
 * that can grant or remove the Owner role; Slice 8's "exactly one
 * Owner, chosen once at first-run setup" invariant is preserved by
 * construction, not by a check that could be bypassed by a future
 * caller supplying a different string.
 */
export type NonOwnerRoleCode = 'executive' | 'operations' | 'finance'

const NON_OWNER_ROLE_ID_BY_CODE: Record<NonOwnerRoleCode, string> = {
  executive: 'role_executive',
  operations: 'role_operations',
  finance: 'role_finance'
}

function isNonOwnerRoleCode(value: string): value is NonOwnerRoleCode {
  return value === 'executive' || value === 'operations' || value === 'finance'
}

export interface SafeUserListItem {
  id: string
  loginIdentifier: string
  displayName: string
  isActive: boolean
  roleCode: string | null
}

export interface CreateAdditionalUserInput {
  displayName: string
  loginIdentifier: string
  password: string
  passwordConfirmation: string
  roleCode: string
}

export type UserManagementErrorCode =
  | 'not_authorized'
  | 'invalid_input'
  | 'duplicate_login_identifier'
  | 'cannot_modify_owner'
  | 'session_invalid'
  | 'unexpected_error'

export type ListUsersOutcome =
  | { success: true; users: SafeUserListItem[] }
  | { success: false; errorCode: UserManagementErrorCode }

export type ListAssignableRolesOutcome =
  | { success: true; roleCodes: NonOwnerRoleCode[] }
  | { success: false; errorCode: UserManagementErrorCode }

export type CreateUserOutcome =
  { success: true } | { success: false; errorCode: UserManagementErrorCode }

export type MutateUserOutcome =
  { success: true } | { success: false; errorCode: UserManagementErrorCode }

class UserManagementServiceError extends Error {
  constructor(readonly code: UserManagementErrorCode) {
    super(code)
    this.name = 'UserManagementServiceError'
  }
}

export interface UserManagementServiceOptions {
  loginService: LoginService
  sessionManager: SessionManager
  now?: () => Date
}

export interface UserManagementService {
  listUsers(db: AppDb): ListUsersOutcome
  createAdditionalUser(db: AppDb, input: CreateAdditionalUserInput): Promise<CreateUserOutcome>
  deactivateAdditionalUser(db: AppDb, targetUserId: string): MutateUserOutcome
  reactivateAdditionalUser(db: AppDb, targetUserId: string): MutateUserOutcome
  /**
   * Gated by the exact same requireOwnerCaller check as every other
   * operation in this service — logged-out, locked, and non-Owner
   * callers all receive a controlled failure, never the raw role list.
   * Documented choice: asserts `users.manage` (the same action every
   * other operation on this Owner-only user-creation screen asserts),
   * not a separate `roles.read` — keeping the whole screen consistently
   * Owner-only rather than splitting it across two different actions
   * for no behavioral benefit today.
   */
  listAssignableRoles(db: AppDb): ListAssignableRolesOutcome
}

/**
 * Factory, matching every other Slice 7/8/9 stateful/service pattern —
 * though this service itself holds no state of its own; it only ever
 * reads the live database and the current session via `loginService`.
 */
export function createUserManagementService(
  options: UserManagementServiceOptions
): UserManagementService {
  const { loginService, sessionManager } = options
  const now = options.now ?? (() => new Date())

  /**
   * The one, single gate every operation in this service passes
   * through: resolves "who is calling" via loginService's own
   * live-session resolution (never a cached/renderer-supplied value),
   * then reads that caller's role codes fresh from SQLite (never
   * session-cached — the whole point of `getFreshRoleCodesForUser`)
   * and asserts `users.manage`. Throws a UserManagementServiceError
   * with a safe, fixed code on any failure; never leaks which specific
   * check failed beyond that.
   */
  function requireOwnerCaller(db: AppDb): string {
    const callerUserId = loginService.getCurrentActiveUserId(db)
    if (!callerUserId) {
      throw new UserManagementServiceError('session_invalid')
    }

    const callerRoleCodes = getFreshRoleCodesForUser(db, callerUserId)
    try {
      assertCan({ roleCodes: callerRoleCodes }, 'users.manage')
    } catch (error) {
      if (error instanceof AuthorizationError) {
        throw new UserManagementServiceError('not_authorized')
      }
      throw error
    }

    return callerUserId
  }

  /**
   * Wraps requireOwnerCaller with the same error-mapping every call site
   * needs — returns the caller's own id on success, so createAdditionalUser
   * can compare two calls' ids against each other (see its own comment).
   */
  function tryRequireOwnerCaller(
    db: AppDb
  ): { ok: true; callerUserId: string } | { ok: false; errorCode: UserManagementErrorCode } {
    try {
      return { ok: true, callerUserId: requireOwnerCaller(db) }
    } catch (error) {
      if (error instanceof UserManagementServiceError) {
        return { ok: false, errorCode: error.code }
      }
      return { ok: false, errorCode: 'unexpected_error' }
    }
  }

  return {
    listUsers(db) {
      const check = tryRequireOwnerCaller(db)
      if (!check.ok) {
        return { success: false, errorCode: check.errorCode }
      }

      const rows = db
        .select({
          id: users.id,
          loginIdentifier: users.loginIdentifier,
          displayName: users.displayName,
          isActive: users.isActive
        })
        .from(users)
        .where(eq(users.companyId, PRIMARY_COMPANY_ID))
        .all()

      const listItems: SafeUserListItem[] = rows.map((row) => {
        const roleCodes = getFreshRoleCodesForUser(db, row.id)
        return {
          id: row.id,
          loginIdentifier: row.loginIdentifier,
          displayName: row.displayName,
          isActive: row.isActive,
          roleCode: roleCodes[0] ?? null
        }
      })

      return { success: true, users: listItems }
    },

    listAssignableRoles(db) {
      const check = tryRequireOwnerCaller(db)
      if (!check.ok) {
        return { success: false, errorCode: check.errorCode }
      }

      return { success: true, roleCodes: NON_OWNER_ROLE_CODES }
    },

    async createAdditionalUser(db, input) {
      let displayName: string
      let normalizedLoginIdentifier: string
      try {
        displayName = requireTrimmedDisplayName(input.displayName)
        normalizedLoginIdentifier = normalizeLoginIdentifier(input.loginIdentifier)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      if (input.password !== input.passwordConfirmation) {
        return { success: false, errorCode: 'invalid_input' }
      }

      // 'owner' is not assignable through this path at all — checked
      // before the shape of roleCode even matters further, so a
      // deliberate attempt to grant Owner access this way is rejected
      // exactly like any other invalid enum value, not with a
      // different, more revealing error.
      if (!isNonOwnerRoleCode(input.roleCode)) {
        return { success: false, errorCode: 'invalid_input' }
      }
      const roleCode = input.roleCode

      const firstCheck = tryRequireOwnerCaller(db)
      if (!firstCheck.ok) {
        return { success: false, errorCode: firstCheck.errorCode }
      }
      const callerUserIdBeforeHash = firstCheck.callerUserId

      // Hashing happens outside any transaction — the one genuinely
      // async step, a real Argon2id computation (~300-800ms).
      let passwordHash: PasswordHash
      try {
        passwordHash = await hashPassword(input.password)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      // Revalidated a second time, immediately after the hash — the
      // calling Owner could have logged out, been locked, been
      // deactivated, or been replaced by a different session entirely
      // during the hash's real async window. Mirrors
      // firstRunSetupService.completeSetup's post-hash revalidation
      // pattern, extended one step further: not just "is *a* valid
      // Owner still calling," but "is it *the same* Owner who started
      // this" — an explicit identity comparison, not merely two
      // independent authorization checks that happen to both pass.
      // This check sits immediately before runAppTransaction below,
      // with no further await in between — the same "no gap for
      // anything to change" reasoning Slice 8's corrective patch
      // established for its own post-hash revalidation.
      const secondCheck = tryRequireOwnerCaller(db)
      if (!secondCheck.ok) {
        return { success: false, errorCode: secondCheck.errorCode }
      }
      if (secondCheck.callerUserId !== callerUserIdBeforeHash) {
        return { success: false, errorCode: 'session_invalid' }
      }

      try {
        runAppTransaction(db, (context) => {
          const writeTime = now()
          const created = createUser(
            context.tx,
            { loginIdentifier: normalizedLoginIdentifier, displayName, passwordHash },
            writeTime
          )
          context.tx
            .insert(userRoles)
            .values({
              userId: created.id,
              roleId: NON_OWNER_ROLE_ID_BY_CODE[roleCode],
              createdAt: writeTime
            })
            .run()
        })
      } catch (error) {
        if (error instanceof UserServiceError) {
          return { success: false, errorCode: 'duplicate_login_identifier' }
        }
        return { success: false, errorCode: 'unexpected_error' }
      }

      return { success: true }
    },

    deactivateAdditionalUser(db, targetUserId) {
      const check = tryRequireOwnerCaller(db)
      if (!check.ok) {
        return { success: false, errorCode: check.errorCode }
      }

      // Covers both "cannot deactivate the Owner" and "the Owner
      // cannot deactivate themselves" with one check — only the Owner
      // can ever reach this point (requireOwnerCaller above), so
      // targetUserId referring to an Owner-role holder can only mean
      // the caller targeted themselves or the one other Owner-role
      // holder, and Slice 8's invariant guarantees there is never more
      // than one.
      const targetRoleCodes = getFreshRoleCodesForUser(db, targetUserId)
      if (hasOwnerRole(targetRoleCodes)) {
        return { success: false, errorCode: 'cannot_modify_owner' }
      }

      try {
        deactivateUser(db, targetUserId, now())
      } catch {
        return { success: false, errorCode: 'unexpected_error' }
      }

      // Safe to invalidate now — deactivateUser is a single,
      // non-transactional UPDATE that auto-commits immediately in
      // SQLite (verified directly before relying on this), so by this
      // line the deactivation is already durable. No afterCommit
      // machinery is needed for a single-statement write like this
      // one, unlike Slice 8's multi-table Owner-creation transaction.
      sessionManager.invalidateAllForUser(targetUserId)

      return { success: true }
    },

    reactivateAdditionalUser(db, targetUserId) {
      const check = tryRequireOwnerCaller(db)
      if (!check.ok) {
        return { success: false, errorCode: check.errorCode }
      }

      try {
        reactivateUser(db, targetUserId, now())
      } catch {
        return { success: false, errorCode: 'unexpected_error' }
      }

      return { success: true }
    }
  }
}

// Re-exported so the IPC layer can validate an incoming role code
// against the exact same fixed set this service accepts, without
// duplicating the literal list.
export const NON_OWNER_ROLE_CODES = Object.keys(NON_OWNER_ROLE_ID_BY_CODE) as NonOwnerRoleCode[]
