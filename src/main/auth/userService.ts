import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { company, PRIMARY_COMPANY_ID, users } from '../db/schema'
import { normalizeLoginIdentifier, requireTrimmedDisplayName } from './authValidation'
import { hashPassword, validatePasswordHashForStorage } from './passwordHashing'
import type { AppDb, AppTransaction } from '../db/dbTypes'

export class UserServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserServiceError'
  }
}

/**
 * The public, renderer-safe-shaped user record. Deliberately has no
 * passwordHash field at all — not merely omitted at the call site, but
 * absent from the type itself, so a future accidental
 * `return { ...fullRow }` can't silently leak it back in.
 */
export interface SafeUser {
  id: string
  companyId: string
  loginIdentifier: string
  displayName: string
  isActive: boolean
  failedLoginCount: number
  lockedUntil: Date | null
  createdAt: Date
  updatedAt: Date
}

/**
 * The internal, auth-specific shape — includes passwordHash. Returned
 * only by getUserAuthRecordByLoginIdentifier, named and documented
 * distinctly from the safe lookups above so the distinction is visible
 * at every call site, not just enforced by convention.
 */
export interface UserAuthRecord extends SafeUser {
  passwordHash: string
}

/**
 * Note: `passwordHash`, not `password`. hashPassword (passwordHashing.ts)
 * is async — hash-wasm's Argon2id runs as a Promise — but
 * better-sqlite3's `.transaction()` callback must be synchronous, and
 * createUser below requires an AppTransaction so Slice 8 can compose it
 * atomically with company/role-assignment creation (the same reason
 * numberingService and taxRateVersionService require a transaction).
 * Those two constraints together mean the async hashing step cannot
 * live inside createUser itself: callers call `await hashPassword(...)`
 * first, then pass the result in here. This is the same shape as
 * `changePassword` below choosing the opposite trade-off deliberately
 * (see its own doc comment) because it doesn't have Slice 8's
 * cross-table atomicity requirement.
 */
export interface CreateUserInput {
  loginIdentifier: string
  displayName: string
  passwordHash: string
}

function requireCompanyExists(db: AppDb): void {
  const found = db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.id, PRIMARY_COMPANY_ID))
    .get()
  if (!found) {
    throw new UserServiceError(
      'Cannot manage users: no company profile exists yet. Complete first-run setup first.'
    )
  }
}

function toSafeUser(row: typeof users.$inferSelect): SafeUser {
  return {
    id: row.id,
    companyId: row.companyId,
    loginIdentifier: row.loginIdentifier,
    displayName: row.displayName,
    isActive: row.isActive,
    failedLoginCount: row.failedLoginCount,
    lockedUntil: row.lockedUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export function getUserById(db: AppDb, id: string): SafeUser | undefined {
  const row = db
    .select()
    .from(users)
    .where(and(eq(users.companyId, PRIMARY_COMPANY_ID), eq(users.id, id)))
    .get()
  return row ? toSafeUser(row) : undefined
}

export function getUserByLoginIdentifier(db: AppDb, loginIdentifier: string): SafeUser | undefined {
  const normalized = normalizeLoginIdentifier(loginIdentifier)
  const row = db
    .select()
    .from(users)
    .where(and(eq(users.companyId, PRIMARY_COMPANY_ID), eq(users.loginIdentifier, normalized)))
    .get()
  return row ? toSafeUser(row) : undefined
}

/**
 * Returns the full authentication record — including passwordHash —
 * for a normalized login identifier. This is the *only* function in
 * this module that ever returns passwordHash; it exists specifically
 * for authenticationService's use and is never called from anywhere
 * that might expose its result further than that one verification step.
 */
export function getUserAuthRecordByLoginIdentifier(
  db: AppDb,
  loginIdentifier: string
): UserAuthRecord | undefined {
  const normalized = normalizeLoginIdentifier(loginIdentifier)
  const row = db
    .select()
    .from(users)
    .where(and(eq(users.companyId, PRIMARY_COMPANY_ID), eq(users.loginIdentifier, normalized)))
    .get()
  return row ? { ...toSafeUser(row), passwordHash: row.passwordHash } : undefined
}

/**
 * Creates a user. Requires an active, caller-controlled transaction
 * (AppTransaction) — matching the pattern already established by
 * numberingService/taxRateVersionService/taxCodeService.updateTaxCode —
 * since Slice 8's first-run setup composes this alongside company and
 * role-assignment creation as one atomic operation. Requires the
 * singleton company to already exist. See CreateUserInput's doc comment
 * for why the password must already be hashed by the time it reaches
 * this function.
 */
export function createUser(
  tx: AppTransaction,
  input: CreateUserInput,
  now: Date = new Date()
): SafeUser {
  requireCompanyExists(tx)

  const normalizedLoginIdentifier = normalizeLoginIdentifier(input.loginIdentifier)
  const displayName = requireTrimmedDisplayName(input.displayName)

  // The real persistence-boundary gate: rejects plaintext, malformed
  // strings, argon2i/argon2d, and any hash using outdated parameters —
  // not merely "is this a non-empty string." Runs unconditionally,
  // regardless of whether input.passwordHash's static type already
  // carries the PasswordHash brand, per the explicit requirement that
  // branding alone is not a substitute for runtime validation.
  const passwordHash = validatePasswordHashForStorage(input.passwordHash)

  const existing = getUserByLoginIdentifier(tx, normalizedLoginIdentifier)
  if (existing) {
    throw new UserServiceError(
      `A user with the login identifier "${normalizedLoginIdentifier}" already exists`
    )
  }

  const id = `user_${randomUUID()}`

  tx.insert(users)
    .values({
      id,
      companyId: PRIMARY_COMPANY_ID,
      loginIdentifier: normalizedLoginIdentifier,
      displayName,
      passwordHash,
      passwordChangedAt: now,
      isActive: true,
      failedLoginCount: 0,
      lockedUntil: null,
      createdAt: now,
      updatedAt: now
    })
    .run()

  const created = getUserById(tx, id)
  if (!created) {
    throw new UserServiceError('User was not persisted after creation')
  }
  return created
}

function requireExistingUser(db: AppDb, id: string): SafeUser {
  const existing = getUserById(db, id)
  if (!existing) {
    throw new UserServiceError(`No user exists with id "${id}"`)
  }
  return existing
}

export function deactivateUser(db: AppDb, id: string, now: Date = new Date()): SafeUser {
  requireExistingUser(db, id)
  db.update(users)
    .set({ isActive: false, updatedAt: now })
    .where(and(eq(users.companyId, PRIMARY_COMPANY_ID), eq(users.id, id)))
    .run()
  return requireExistingUser(db, id)
}

export function reactivateUser(db: AppDb, id: string, now: Date = new Date()): SafeUser {
  requireExistingUser(db, id)
  db.update(users)
    .set({ isActive: true, updatedAt: now })
    .where(and(eq(users.companyId, PRIMARY_COMPANY_ID), eq(users.id, id)))
    .run()
  return requireExistingUser(db, id)
}

/**
 * Sets a new password: hashes it and advances password_changed_at. Async
 * (unlike createUser) because it has no equivalent of Slice 8's need to
 * compose atomically with unrelated tables in one transaction — a
 * standalone password change is naturally its own operation, so hashing
 * internally here doesn't create the same sync/async conflict createUser
 * would have. Does not touch failed_login_count/locked_until — see
 * setLoginLockoutState for that, a distinct, policy-free concern owned
 * by authenticationService.
 *
 * hashPassword already validates its own output internally, but this
 * path re-validates explicitly too (defense in depth, matching the
 * layered-validation pattern used throughout this codebase) rather than
 * trusting that internal guarantee alone at the actual persistence
 * point — the same synchronous gate createUser uses.
 */
export async function changePassword(
  db: AppDb,
  id: string,
  newPassword: string,
  now: Date = new Date()
): Promise<SafeUser> {
  requireExistingUser(db, id)
  const passwordHash = validatePasswordHashForStorage(await hashPassword(newPassword))

  db.update(users)
    .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
    .where(and(eq(users.companyId, PRIMARY_COMPANY_ID), eq(users.id, id)))
    .run()

  return requireExistingUser(db, id)
}

/**
 * A mechanical setter for the lockout-related columns — no policy of
 * its own (no threshold, no duration). authenticationService computes
 * the values and calls this; userService just persists them. Keeps
 * lockout *policy* entirely out of the data-access layer.
 */
export function setLoginLockoutState(
  db: AppDb,
  id: string,
  state: { failedLoginCount: number; lockedUntil: Date | null },
  now: Date = new Date()
): SafeUser {
  requireExistingUser(db, id)
  db.update(users)
    .set({
      failedLoginCount: state.failedLoginCount,
      lockedUntil: state.lockedUntil,
      updatedAt: now
    })
    .where(and(eq(users.companyId, PRIMARY_COMPANY_ID), eq(users.id, id)))
    .run()
  return requireExistingUser(db, id)
}
