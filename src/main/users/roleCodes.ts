import { eq } from 'drizzle-orm'
import { roles, userRoles } from '../db/schema'
import type { AppDb, AppTransaction } from '../db/dbTypes'

/**
 * Reads a user's current role codes fresh from SQLite — `roles.code`
 * (the lower-case value `authorizationService.ROLE_CODES` expects,
 * e.g. `'owner'`), never `user_roles.role_id`/`roles.id` (the stable
 * `'role_owner'`-shaped primary key used only for the foreign key
 * relationship). These are two different columns; conflating them
 * would make every `can()`/`assertCan()` check silently fail closed
 * against every real role.
 *
 * Deliberately takes no cache, no session snapshot — every caller that
 * needs an authorization-relevant answer (is this session's user still
 * the Owner? still active in some role at all?) calls this fresh, every
 * time. `sessionManager`'s own `roleCodes` field (set once at login) is
 * never read for this purpose anywhere in this codebase.
 */
export function getFreshRoleCodesForUser(db: AppDb | AppTransaction, userId: string): string[] {
  return db
    .select({ code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId))
    .all()
    .map((row) => row.code)
}

/** True if `roleCodes` includes the Owner role. A tiny, named predicate so every call site reads the same way. */
export function hasOwnerRole(roleCodes: readonly string[]): boolean {
  return roleCodes.includes('owner')
}
