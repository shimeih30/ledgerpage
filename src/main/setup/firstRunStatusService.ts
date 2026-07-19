import { and, eq } from 'drizzle-orm'
import {
  company,
  numberingRules,
  ownerRecoveryCredentials,
  PRIMARY_COMPANY_ID,
  userRoles,
  users
} from '../db/schema'
import { APPROVED_NUMBERING_DEFAULTS } from '../db/numberingDefaults'
import type { AppDb } from '../db/dbTypes'

const OWNER_ROLE_ID = 'role_owner'

export type FirstRunStatus =
  | { status: 'setup_required' }
  | { status: 'setup_complete' }
  | { status: 'inconsistent_state'; reason: string }

/**
 * The single, central, main-process source of truth for whether
 * first-run setup still needs to run. Computed fresh from durable
 * database state on every call — never cached, never derived from
 * anything the renderer supplies.
 *
 * Three outcomes, fail-closed on the third:
 *
 * - `setup_required`: the setup-owned durable state is genuinely
 *   pristine — zero `users`, zero `user_roles`, zero
 *   `owner_recovery_credentials`, no `company` row, and zero
 *   `numbering_rules` for the primary company. Reference-data rows and
 *   the four fixed role seeds may already exist (they're seeded by
 *   ordinary startup, not by setup) and never make this non-pristine.
 *   Checking only "zero users" here — the original design — treated a
 *   partially-completed or corrupted setup attempt (a company row
 *   inserted but the transaction that would have added the Owner never
 *   finished, for instance) as an ordinary fresh start, which is
 *   exactly the kind of silent-repair-by-omission this codebase's
 *   "fail closed, never auto-repair" posture forbids.
 * - `setup_complete`: the primary company exists, all 10 approved
 *   `numbering_rules` rows exist, exactly one `role_owner` assignment
 *   identifies the initial Owner, that Owner's user row exists, and
 *   that Owner has exactly one active recovery credential. Additional
 *   *non-Owner* users are explicitly allowed and never affect this —
 *   Slice 9 is expected to add ordinary user management, and treating
 *   every additional user row as inconsistent would make this function
 *   start reporting real, correctly-running installations as broken
 *   the moment that happens.
 * - `inconsistent_state`: fails closed for every other combination —
 *   including a non-pristine zero-user state (company and/or
 *   numbering rows already present with no user to match), no Owner
 *   assignment once users exist, more than one Owner assignment, an
 *   Owner assignment referencing a missing user, an Owner with zero or
 *   more than one active recovery credential, and missing
 *   company/numbering rows. Never auto-repaired or silently
 *   overwritten anywhere this result feeds into. `reason` is for
 *   main-process diagnostics only — never handed to the renderer
 *   verbatim (registerSetupHandlers.ts maps this to one fixed, generic
 *   message).
 */
export function getFirstRunStatus(db: AppDb): FirstRunStatus {
  const userRows = db.select({ id: users.id }).from(users).all()
  const userIds = new Set(userRows.map((row) => row.id))

  // Defensive checks, ahead of everything else: a user_roles or
  // owner_recovery_credentials row whose user_id doesn't match any
  // real user should be structurally impossible (both columns are
  // foreign keys with ON DELETE RESTRICT, and no service in this
  // codebase ever hard-deletes a user) — but "fail closed if the
  // database is inconsistent" means verifying this explicitly rather
  // than trusting the constraint was never bypassed by something
  // outside this application.
  const allUserRoleRows = db.select({ userId: userRoles.userId }).from(userRoles).all()
  const orphanedUserRole = allUserRoleRows.find((row) => !userIds.has(row.userId))
  if (orphanedUserRole) {
    return {
      status: 'inconsistent_state',
      reason: 'a user_roles row exists whose user_id does not match any existing user'
    }
  }

  const allCredentialRows = db
    .select({ userId: ownerRecoveryCredentials.userId })
    .from(ownerRecoveryCredentials)
    .all()
  const orphanedCredential = allCredentialRows.find((row) => !userIds.has(row.userId))
  if (orphanedCredential) {
    return {
      status: 'inconsistent_state',
      reason: 'a recovery credential exists whose user_id does not match any existing user'
    }
  }

  const companyRow = db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.id, PRIMARY_COMPANY_ID))
    .get()
  const numberingRows = db
    .select({ documentTypeKey: numberingRules.documentTypeKey })
    .from(numberingRules)
    .where(eq(numberingRules.companyId, PRIMARY_COMPANY_ID))
    .all()

  if (userRows.length === 0) {
    // Pristine only if EVERY setup-owned table is empty/absent — not
    // just users. Reference data and the four fixed roles are seeded
    // by ordinary startup (verified elsewhere) and are deliberately
    // not part of this check.
    const isPristine =
      allUserRoleRows.length === 0 &&
      allCredentialRows.length === 0 &&
      !companyRow &&
      numberingRows.length === 0

    if (isPristine) {
      return { status: 'setup_required' }
    }

    return {
      status: 'inconsistent_state',
      reason:
        'no users exist, but setup-owned state is not pristine ' +
        `(user_roles=${String(allUserRoleRows.length)}, ` +
        `recovery_credentials=${String(allCredentialRows.length)}, ` +
        `company=${companyRow ? 'present' : 'absent'}, ` +
        `numbering_rules=${String(numberingRows.length)})`
    }
  }

  const ownerAssignments = db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.roleId, OWNER_ROLE_ID))
    .all()

  if (ownerAssignments.length === 0) {
    return {
      status: 'inconsistent_state',
      reason: 'users exist but no role_owner assignment exists'
    }
  }
  if (ownerAssignments.length > 1) {
    return {
      status: 'inconsistent_state',
      reason: `${String(ownerAssignments.length)} role_owner assignments exist; the invariant requires exactly one initial Owner`
    }
  }

  const ownerId = ownerAssignments[0].userId
  if (!userIds.has(ownerId)) {
    return {
      status: 'inconsistent_state',
      reason: 'the role_owner assignment references a user that does not exist'
    }
  }

  const activeCredentials = db
    .select({ id: ownerRecoveryCredentials.id })
    .from(ownerRecoveryCredentials)
    .where(
      and(eq(ownerRecoveryCredentials.userId, ownerId), eq(ownerRecoveryCredentials.isActive, true))
    )
    .all()

  if (activeCredentials.length === 0) {
    return {
      status: 'inconsistent_state',
      reason: 'the Owner has no active recovery credential'
    }
  }
  if (activeCredentials.length > 1) {
    // Should be structurally impossible — a partial unique index
    // enforces at most one active row per user (verified empirically
    // against a real connection when that schema was written) — kept
    // here anyway as the same "fail closed, don't trust the constraint
    // was never bypassed externally" defense as the orphan checks
    // above.
    return {
      status: 'inconsistent_state',
      reason: 'the Owner has more than one active recovery credential'
    }
  }

  if (!companyRow) {
    return {
      status: 'inconsistent_state',
      reason: 'an Owner exists but no company profile exists'
    }
  }

  const existingDocumentTypeKeys = new Set(numberingRows.map((row) => row.documentTypeKey))
  const missingDefaults = APPROVED_NUMBERING_DEFAULTS.filter(
    (def) => !existingDocumentTypeKeys.has(def.documentTypeKey)
  )
  if (missingDefaults.length > 0) {
    return {
      status: 'inconsistent_state',
      reason: `${String(missingDefaults.length)} of the 10 approved numbering rules are missing`
    }
  }

  // Additional non-Owner users (Slice 9 territory) are explicitly
  // permitted here — this function only ever inspects the single
  // Owner assignment identified above, never the total user count.
  return { status: 'setup_complete' }
}
