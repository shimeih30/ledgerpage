import { randomUUID } from 'node:crypto'
import { numberingRules, FUNCTIONAL_CURRENCY_ID, PRIMARY_COMPANY_ID, userRoles } from '../db/schema'
import { requireTrimmedText } from '../db/validation/companyValidation'
import { createCompany } from '../db/companyService'
import { createUser } from '../auth/userService'
import { hashPassword, type PasswordHash } from '../auth/passwordHashing'
import { normalizeLoginIdentifier, requireTrimmedDisplayName } from '../auth/authValidation'
import { runAppTransaction } from '../db/appTransaction'
import {
  createRecoveryCeremonyService,
  RecoveryCeremonyError,
  type ConfirmedCeremony,
  type PreparedCeremony,
  type RecoveryCeremonyService
} from '../auth/recoveryCeremonyService'
import { APPROVED_NUMBERING_DEFAULTS, numberingRuleId } from '../db/numberingDefaults'
import { getFirstRunStatus } from './firstRunStatusService'
import type { AppDb } from '../db/dbTypes'

const OWNER_ROLE_ID = 'role_owner'

export interface CompanyDetailsInput {
  name: string
  address: string
  contactDetails: string
}

export interface OwnerAccountInput {
  displayName: string
  loginIdentifier: string
  password: string
  passwordConfirmation: string
}

/**
 * A small, fixed set of safe codes — never a raw exception message —
 * for the one boundary this service crosses toward the renderer (via
 * registerSetupHandlers.ts). Matches this codebase's established
 * "never hand internal error text across a trust boundary" posture.
 */
export type CompleteSetupErrorCode =
  'setup_already_complete' | 'invalid_input' | 'recovery_confirmation_invalid' | 'unexpected_error'

export type CompleteSetupOutcome =
  { success: true } | { success: false; errorCode: CompleteSetupErrorCode }

/**
 * Never unconditionally the ceremonyToken/plaintextRecoveryKey pair —
 * `success: false` covers both "the underlying preparation itself
 * failed" and "this preparation became stale (superseded by a newer
 * one) before it could become the active attempt." Either way, the
 * caller must never be handed a pair that is already invalidated; see
 * prepareRecoveryKey's own doc comment for the full reasoning.
 */
export type PrepareRecoveryKeyOutcome =
  { success: true; ceremonyToken: string; plaintextRecoveryKey: string } | { success: false }

class FirstRunSetupInternalError extends Error {
  constructor(readonly code: CompleteSetupErrorCode) {
    super(code)
    this.name = 'FirstRunSetupInternalError'
  }
}

export interface FirstRunSetupServiceOptions {
  recoveryCeremonyService?: RecoveryCeremonyService
  now?: () => Date
}

export interface FirstRunSetupService {
  prepareRecoveryKey(): Promise<PrepareRecoveryKeyOutcome>
  confirmRecoveryKey(
    ceremonyToken: string,
    reenteredKey: string
  ): Promise<ConfirmedCeremony | undefined>
  cancelRecoveryKey(ceremonyToken: string): void
  completeSetup(
    db: AppDb,
    companyInput: CompanyDetailsInput,
    ownerInput: OwnerAccountInput,
    commitToken: string
  ): Promise<CompleteSetupOutcome>
}

function validateOwnerInputShape(ownerInput: OwnerAccountInput): {
  displayName: string
  normalizedLoginIdentifier: string
} {
  const displayName = requireTrimmedDisplayName(ownerInput.displayName)
  const normalizedLoginIdentifier = normalizeLoginIdentifier(ownerInput.loginIdentifier)

  if (ownerInput.password !== ownerInput.passwordConfirmation) {
    throw new FirstRunSetupInternalError('invalid_input')
  }

  return { displayName, normalizedLoginIdentifier }
}

function validateCompanyInputShape(companyInput: CompanyDetailsInput): void {
  requireTrimmedText(companyInput.name, 'name')
  requireTrimmedText(companyInput.address, 'address')
  requireTrimmedText(companyInput.contactDetails, 'contactDetails')
}

/**
 * The one bounded, explicit piece of state this service tracks — never
 * a per-request map, never an indefinitely growing collection. At most
 * one of these exists at a time, replaced wholesale (never mutated
 * piecemeal into an inconsistent mix of old-and-new fields) by each
 * successful prepareRecoveryKey() call, and cleared immediately
 * (synchronously) the instant a *new* prepareRecoveryKey() call begins
 * — not only once that new call's own async work finishes.
 */
interface ActiveAttempt {
  /**
   * Assigned synchronously at prepareRecoveryKey() call time. Checked
   * as an explicit, enforced invariant — not merely relied on via
   * object identity or token equality — by every one of
   * confirmRecoveryKey/cancelRecoveryKey/completeSetup: `activeAttempt`
   * is only ever treated as genuinely current when its own generation
   * still equals the outer currentGeneration counter.
   */
  generation: number
  ownerId: string
  ceremonyToken: string
  /** Set only once confirmRecoveryKey succeeds for *this* attempt. */
  commitToken?: string
}

/**
 * Factory, not a singleton — matching every other stateful Slice 7
 * service (sessionManager, recoveryCeremonyService). Owns exactly one
 * RecoveryCeremonyService instance and exactly one bounded
 * ActiveAttempt slot (or undefined) — never a per-request map.
 */
export function createFirstRunSetupService(
  options: FirstRunSetupServiceOptions = {}
): FirstRunSetupService {
  const recoveryCeremonyService = options.recoveryCeremonyService ?? createRecoveryCeremonyService()
  const now = options.now ?? (() => new Date())

  // Bumped synchronously, before any await, on every prepareRecoveryKey
  // call — this is what makes "which of several concurrently-resolving
  // preparations is the real, current one" a question with a
  // deterministic answer regardless of which one's async work (a real
  // Argon2id hash, inside RecoveryCeremonyService.prepareCeremony)
  // happens to finish first. Verified empirically, before relying on
  // this pattern, that JavaScript's synchronous-prefix-before-first-
  // await semantics make a bump-then-compare check race-free for calls
  // invoked back to back — the same reasoning already established for
  // RecoveryCeremonyService's own confirmationInProgress flag.
  let currentGeneration = 0
  let activeAttempt: ActiveAttempt | undefined

  return {
    async prepareRecoveryKey() {
      currentGeneration += 1
      const myGeneration = currentGeneration

      // Immediately (synchronously, before any await) supersede
      // whatever was active before — the previous attempt must become
      // unconfirmable/uncompletable the *instant* a new preparation
      // begins, not only once the new one finishes resolving.
      // Verified empirically before relying on this: a concurrent
      // confirmRecoveryKey/completeSetup call issued while this new
      // preparation is still in flight sees activeAttempt already
      // cleared. A confirmed capability the superseded attempt may
      // already have obtained can remain privately inside
      // RecoveryCeremonyService until its own TTL expiry — that's
      // acceptable, because clearing activeAttempt here is what makes
      // it unreachable/unusable from this service regardless (every
      // gate below requires a live activeAttempt match).
      if (activeAttempt) {
        recoveryCeremonyService.cancelCeremony(activeAttempt.ceremonyToken)
        activeAttempt = undefined
      }

      const ownerId = `user_${randomUUID()}`

      let prepared: PreparedCeremony
      try {
        prepared = await recoveryCeremonyService.prepareCeremony(ownerId)
      } catch {
        // Preparation itself failed. Nothing is restored — per the
        // requirement, there must be no active attempt at all until
        // the caller explicitly retries, not a silent fallback to
        // whatever was active before (which was already cleared
        // above, synchronously, regardless of how this async call
        // turns out).
        return { success: false }
      }

      if (myGeneration !== currentGeneration) {
        // A newer prepareRecoveryKey() call started while this one's
        // async preparation was still in flight — this result is
        // stale by construction (its generation can never become
        // current again) and must never become the active attempt,
        // and must never be handed back looking like a usable pair.
        recoveryCeremonyService.cancelCeremony(prepared.ceremonyToken)
        return { success: false }
      }

      activeAttempt = { generation: myGeneration, ownerId, ceremonyToken: prepared.ceremonyToken }

      return {
        success: true,
        ceremonyToken: prepared.ceremonyToken,
        plaintextRecoveryKey: prepared.plaintextRecoveryKey
      }
    },

    async confirmRecoveryKey(ceremonyToken, reenteredKey) {
      if (
        !activeAttempt ||
        activeAttempt.generation !== currentGeneration ||
        activeAttempt.ceremonyToken !== ceremonyToken
      ) {
        // Not the current attempt's token — rejected before ever
        // reaching RecoveryCeremonyService, both to avoid wasting a
        // real Argon2id verification on a token that can never
        // succeed here, and so a stale/foreign token reveals nothing
        // about whether some *other* ceremony exists or is in
        // progress. The generation check is an explicitly enforced
        // invariant here, not merely documentation — token equality
        // alone is not trusted as the sole ownership signal.
        return undefined
      }
      const myGeneration = activeAttempt.generation

      const confirmed = await recoveryCeremonyService.confirmCeremony(ceremonyToken, reenteredKey)
      if (!confirmed) {
        return undefined
      }

      // Re-check after the await: a newer prepareRecoveryKey() call
      // may have superseded this attempt — clearing activeAttempt
      // synchronously the instant it began — while verification was
      // still in flight. If so, this confirmation is for an attempt
      // that is no longer active; its commitToken is deliberately
      // never recorded, so a later completeSetup call with it will not
      // find a matching activeAttempt and will safely reject it.
      if (
        !activeAttempt ||
        activeAttempt.generation !== myGeneration ||
        activeAttempt.generation !== currentGeneration ||
        activeAttempt.ceremonyToken !== ceremonyToken
      ) {
        return undefined
      }

      activeAttempt.commitToken = confirmed.commitToken
      return confirmed
    },

    cancelRecoveryKey(ceremonyToken) {
      // Clears state only when the supplied token matches the
      // currently active ceremony *and* that attempt's generation is
      // still current — cancelling a stale/superseded token must never
      // invalidate whatever attempt has since become active. Still
      // forwards the cancellation to RecoveryCeremonyService
      // regardless (harmless/idempotent on an already-cancelled or
      // already-superseded token), as a harmless extra cleanup.
      recoveryCeremonyService.cancelCeremony(ceremonyToken)
      if (
        activeAttempt &&
        activeAttempt.generation === currentGeneration &&
        activeAttempt.ceremonyToken === ceremonyToken
      ) {
        activeAttempt = undefined
      }
    },

    async completeSetup(db, companyInput, ownerInput, commitToken) {
      let displayName: string
      let normalizedLoginIdentifier: string
      try {
        validateCompanyInputShape(companyInput)
        ;({ displayName, normalizedLoginIdentifier } = validateOwnerInputShape(ownerInput))
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      // Fast fail before ever paying for an Argon2id hash: if setup is
      // already complete (or the database is in a state this function
      // must not touch), there is no point hashing anything.
      const preCheck = getFirstRunStatus(db)
      if (preCheck.status === 'setup_complete') {
        return { success: false, errorCode: 'setup_already_complete' }
      }
      if (preCheck.status === 'inconsistent_state') {
        return { success: false, errorCode: 'unexpected_error' }
      }

      // Only the commitToken bound to the CURRENT active attempt is
      // accepted — a stale or unrelated commit token (from a
      // superseded attempt, or fabricated) is rejected here, before
      // ever hashing a password or opening a transaction. The
      // generation check is an explicitly enforced invariant, not
      // merely token-string equality.
      if (
        !activeAttempt ||
        activeAttempt.generation !== currentGeneration ||
        activeAttempt.commitToken !== commitToken
      ) {
        return { success: false, errorCode: 'recovery_confirmation_invalid' }
      }

      // Captured before hashing — the one genuinely async step in this
      // function (a real Argon2id computation, ~300-800ms — a genuine
      // window for a newer prepareRecoveryKey() call to supersede this
      // attempt). Every subsequent use of the owner id / tokens reads
      // from these captured values, never activeAttempt directly,
      // after this point.
      const capturedGeneration = activeAttempt.generation
      const capturedOwnerId = activeAttempt.ownerId
      const capturedCeremonyToken = activeAttempt.ceremonyToken
      const capturedCommitToken = activeAttempt.commitToken

      let passwordHash: PasswordHash
      try {
        passwordHash = await hashPassword(ownerInput.password)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      // Revalidated immediately after the hash resolves, requiring an
      // exact match on every captured field (generation, ownerId,
      // ceremonyToken, commitToken) — not just the commitToken alone.
      // Because runAppTransaction itself is fully synchronous and
      // nothing async happens between this check and the call below,
      // this single check also *is* "immediately before
      // runAppTransaction begins" — there is no further gap for
      // activeAttempt to change in between.
      if (
        !activeAttempt ||
        activeAttempt.generation !== capturedGeneration ||
        activeAttempt.generation !== currentGeneration ||
        activeAttempt.ownerId !== capturedOwnerId ||
        activeAttempt.ceremonyToken !== capturedCeremonyToken ||
        activeAttempt.commitToken !== capturedCommitToken
      ) {
        return { success: false, errorCode: 'recovery_confirmation_invalid' }
      }

      try {
        runAppTransaction(db, (context) => {
          // Revalidated a third time, now inside the live transaction
          // — this is what actually closes the race between two
          // concurrent completion attempts sharing the same durable
          // database, not the pre-checks above, which only avoid
          // wasted hashing work and catch a superseded in-memory
          // attempt.
          const recheck = getFirstRunStatus(context.tx)
          if (recheck.status !== 'setup_required') {
            throw new FirstRunSetupInternalError('setup_already_complete')
          }

          const writeTime = now()

          createCompany(
            context.tx,
            { ...companyInput, currencyId: FUNCTIONAL_CURRENCY_ID },
            writeTime
          )

          for (const numberingDefault of APPROVED_NUMBERING_DEFAULTS) {
            context.tx
              .insert(numberingRules)
              .values({
                id: numberingRuleId(numberingDefault.documentTypeKey),
                companyId: PRIMARY_COMPANY_ID,
                documentTypeKey: numberingDefault.documentTypeKey,
                prefix: numberingDefault.prefix,
                paddingLength: numberingDefault.paddingLength,
                resetBehavior: numberingDefault.resetBehavior,
                currentSequenceValue: 0,
                currentSequenceYear: null,
                createdAt: writeTime,
                updatedAt: writeTime
              })
              .run()
          }

          createUser(
            context.tx,
            {
              id: capturedOwnerId,
              loginIdentifier: normalizedLoginIdentifier,
              displayName,
              passwordHash
            },
            writeTime
          )

          context.tx
            .insert(userRoles)
            .values({ userId: capturedOwnerId, roleId: OWNER_ROLE_ID, createdAt: writeTime })
            .run()

          // Binds the recovery credential to `capturedOwnerId` via
          // commitToken's own private state — if that private state's
          // userId ever failed to match the row just inserted above
          // (it cannot, by construction: both originate from the same
          // ownerId captured at prepareRecoveryKey time), the
          // database's own foreign-key constraint would reject the
          // insert and roll back this entire transaction rather than
          // silently associating the credential with the wrong user.
          recoveryCeremonyService.commitCredential(context, capturedCommitToken, writeTime)

          // Cleared only once the transaction has truly committed, and
          // only if activeAttempt is still the *exact* attempt that
          // committed (matched by generation) — an afterCommit
          // callback belonging to an older, already-superseded
          // completeSetup invocation must never clear a newer active
          // attempt. Never cleared on a rollback, so a retry with the
          // exact same (still valid, still current) commitToken finds
          // activeAttempt unchanged and succeeds normally.
          context.afterCommit(() => {
            if (activeAttempt && activeAttempt.generation === capturedGeneration) {
              activeAttempt = undefined
            }
          })
        })
      } catch (error) {
        if (error instanceof FirstRunSetupInternalError) {
          return { success: false, errorCode: error.code }
        }
        if (error instanceof RecoveryCeremonyError) {
          return { success: false, errorCode: 'recovery_confirmation_invalid' }
        }
        return { success: false, errorCode: 'unexpected_error' }
      }

      return { success: true }
    }
  }
}
