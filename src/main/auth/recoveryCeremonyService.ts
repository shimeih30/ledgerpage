import { randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { ownerRecoveryCredentials } from '../db/schema'
import { hashPassword, verifyPassword } from './passwordHashing'
import type { AppTransactionContext } from '../db/appTransaction'

/**
 * 20 random bytes (160 bits) — well beyond the ~128 bits typically
 * targeted for a recovery credential. Encoded 5 bits at a time (160/5 =
 * 32 exactly, no padding needed) using Crockford's Base32 alphabet,
 * which deliberately excludes I, L, O, and U — characters easily
 * confused with 1, 1, 0, and V/W during handwritten transcription. Not
 * an invented scheme: Crockford's alphabet is an established standard
 * chosen specifically to reuse well-understood unambiguous-transcription
 * properties rather than inventing a new one.
 */
const CROCKFORD_BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RECOVERY_KEY_BYTE_LENGTH = 20
const RECOVERY_KEY_GROUP_SIZE = 4

export const CEREMONY_TTL_MS = 15 * 60 * 1000 // 15 minutes
/**
 * How long a *confirmed* capability remains committable before it also
 * expires. Reuses the same window as the pending-ceremony TTL — there's
 * no principled reason for these to differ, and a single constant is
 * easier to reason about than two.
 */
export const CONFIRMED_CAPABILITY_TTL_MS = CEREMONY_TTL_MS

/**
 * Bounded retry limit for generating a unique ceremony/commit token,
 * shared by both — see generateUniqueToken inside
 * createRecoveryCeremonyService. Matches sessionManager's identical
 * session-ID collision retry count for the same reasoning: with a real
 * CSPRNG source this is not expected to be reached in practice.
 */
export const TOKEN_COLLISION_RETRY_ATTEMPTS = 10

export class RecoveryCeremonyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecoveryCeremonyError'
  }
}

function generateRecoveryKeyPlaintext(): string {
  const bytes = randomBytes(RECOVERY_KEY_BYTE_LENGTH)

  let characters = ''
  let bitBuffer = 0
  let bitCount = 0
  for (const byte of bytes) {
    bitBuffer = (bitBuffer << 8) | byte
    bitCount += 8
    while (bitCount >= 5) {
      bitCount -= 5
      const index = (bitBuffer >> bitCount) & 0b11111
      characters += CROCKFORD_BASE32_ALPHABET[index]
    }
  }

  const groups: string[] = []
  for (let i = 0; i < characters.length; i += RECOVERY_KEY_GROUP_SIZE) {
    groups.push(characters.slice(i, i + RECOVERY_KEY_GROUP_SIZE))
  }
  return groups.join('-')
}

interface PendingCeremony {
  userId: string
  candidateHash: string
  expiresAt: Date
  /**
   * Set synchronously, before the verifyPassword await, by the first
   * confirmCeremony call for this ceremony — and checked synchronously,
   * also before any await, by every call. Because both the check and
   * the set happen with no yield point between them, this is a correct
   * mutual-exclusion flag for two concurrent confirmCeremony calls on
   * the same ceremonyToken: whichever call's synchronous prefix runs
   * first sets this before it ever suspends, so a second call invoked
   * immediately after (even without awaiting the first) is guaranteed
   * to observe it already set. Verified empirically before relying on
   * this pattern, not merely assumed from general JS semantics.
   * Reset back to false only when it's safe to retry (wrong key,
   * verification threw, or commit-token generation failed) — never
   * reset when the ceremony has been consumed (confirmed) or removed
   * (cancelled/expired) some other way.
   */
  confirmationInProgress: boolean
}

/**
 * The private, in-memory record behind a confirmed capability. Nothing
 * in this shape is ever handed to a caller directly — confirmCeremony
 * only ever returns { commitToken }, an opaque string. This is the fix
 * for the original design's core flaw: ConfirmedCeremonyResult used to
 * carry userId and recoveryKeyHash as plain, inspectable, *constructible*
 * data, so any caller could fabricate one by hand and pass it straight
 * to commitRecoveryCredential without ever having gone through a real
 * ceremony. A capability that lives only in this closure's private Map,
 * looked up by an unguessable random token, cannot be forged.
 */
interface ConfirmedCapability {
  userId: string
  recoveryKeyHash: string
  /** Generated once, at confirmation time, and used as the eventual credential row's id. */
  credentialId: string
  expiresAt: Date
}

export interface PreparedCeremony {
  ceremonyToken: string
  /** Returned exactly once, by this function, to the trusted caller. Never stored, never logged. */
  plaintextRecoveryKey: string
}

/**
 * The only thing confirmCeremony returns on success: an opaque token,
 * not database-ready material of any kind. There is no way to construct
 * a value of this shape that commitCredential will accept without it
 * having come from a real, successful confirmCeremony call on this same
 * service instance.
 */
export interface ConfirmedCeremony {
  commitToken: string
}

export interface OwnerRecoveryCredentialSummary {
  id: string
  userId: string
  version: number
  isActive: boolean
  createdAt: Date
  revokedAt: Date | null
}

export interface RecoveryCeremonyServiceOptions {
  now?: () => Date
  randomToken?: () => string
}

export interface RecoveryCeremonyService {
  /**
   * Generates a candidate recovery key, hashes it immediately, and
   * stores only the hash in memory keyed by an opaque ceremony token.
   * The plaintext is returned here and only here — this function's
   * return value is the single point where the caller must display it
   * to the person and ask them to save it.
   */
  prepareCeremony(userId: string): Promise<PreparedCeremony>
  /**
   * Verifies a re-entered key against the stored candidate hash. A
   * mismatch returns undefined without consuming the pending ceremony
   * (the person can retry against the same still-valid candidate — a
   * typo on re-entry shouldn't force starting over). A successful match
   * consumes the pending ceremony and mints a new, unrelated opaque
   * commitToken bound to a private confirmed capability — never the
   * userId or recoveryKeyHash themselves. An expired or unknown
   * ceremonyToken always returns undefined, with no distinction between
   * the two reasons in the return value.
   */
  confirmCeremony(
    ceremonyToken: string,
    reenteredKey: string
  ): Promise<ConfirmedCeremony | undefined>
  /** Removes a pending ceremony without confirming it. Safe to call on an already-gone token. */
  cancelCeremony(ceremonyToken: string): void
  /**
   * Commits a confirmed capability: revokes the user's prior active
   * credential (if any) and inserts the new one, atomically inside the
   * caller's transaction — via `context.tx`, exactly like every other
   * cross-row-consistency operation in this codebase. Requires an
   * AppTransactionContext (see src/main/db/appTransaction.ts), not a
   * plain AppTransaction, specifically so this function can register
   * consumption of the in-memory capability with `context.afterCommit`
   * rather than deciding to consume it based on its own writes alone —
   * "on a successful database commit, consume the capability" is only
   * true if consumption is tied to the transaction's *actual* outcome,
   * which this function cannot determine purely synchronously from
   * inside a nested call. Call via
   * `runAppTransaction(db, (context) => service.commitCredential(context, commitToken))`.
   *
   * Looks up commitToken against THIS service instance's private
   * confirmed-capability state only — a fabricated token, an unconfirmed
   * (pending) ceremonyToken used by mistake, an expired confirmed
   * capability, or a token that belongs to a different
   * RecoveryCeremonyService instance are all rejected with
   * RecoveryCeremonyError.
   *
   * Consumption timing: the capability is removed from memory only via
   * an afterCommit callback, which runs only once the surrounding
   * transaction has truly committed. A rolled-back attempt never runs
   * that callback, so the capability remains for a retry with the same
   * token; a genuinely committed attempt removes it immediately, so a
   * second attempt with the same token fails the initial lookup at the
   * top of this function — "the same capability cannot commit twice"
   * holds without needing a separate database re-check.
   */
  commitCredential(
    context: AppTransactionContext,
    commitToken: string,
    now?: Date
  ): OwnerRecoveryCredentialSummary
}

/**
 * Factory, not a singleton — matching sessionManager's pattern for the
 * same reason (independent state per instance, injectable clock/token
 * source for tests). Both the pending-ceremony and confirmed-capability
 * maps live only in memory: a process restart, or simply constructing a
 * fresh service, discards every uncommitted ceremony and every
 * unconsumed capability automatically, with no special-case code needed
 * for that guarantee.
 */
export function createRecoveryCeremonyService(
  options: RecoveryCeremonyServiceOptions = {}
): RecoveryCeremonyService {
  const now = options.now ?? (() => new Date())
  const randomToken = options.randomToken ?? (() => randomBytes(32).toString('base64url'))

  const pendingCeremonies = new Map<string, PendingCeremony>()
  const confirmedCapabilities = new Map<string, ConfirmedCapability>()

  /**
   * Generates a token guaranteed not to collide with any existing
   * pending ceremony OR confirmed capability — checked across both
   * maps, not just the one the caller is about to insert into, since a
   * ceremonyToken and a commitToken are semantically distinct
   * capabilities that must never be confusable with each other even by
   * coincidence. Bounded retry (documented constant below), matching
   * sessionManager's identical session-ID collision handling: with the
   * default 256-bit CSPRNG source this path is not expected to be
   * reachable in practice, but a misbehaving injected randomToken()
   * (e.g. a test double with a tiny ID space) must fail loudly with a
   * controlled error rather than silently overwrite an existing
   * ceremony or capability.
   */
  function generateUniqueToken(): string {
    for (let attempt = 0; attempt < TOKEN_COLLISION_RETRY_ATTEMPTS; attempt += 1) {
      const candidate = randomToken()
      if (typeof candidate !== 'string' || candidate.length === 0) {
        throw new RecoveryCeremonyError('randomToken() must return a non-empty string')
      }
      if (!pendingCeremonies.has(candidate) && !confirmedCapabilities.has(candidate)) {
        return candidate
      }
    }
    throw new RecoveryCeremonyError(
      `Could not generate a unique recovery token after ${String(TOKEN_COLLISION_RETRY_ATTEMPTS)} attempts`
    )
  }

  function toSummary(
    row: typeof ownerRecoveryCredentials.$inferSelect
  ): OwnerRecoveryCredentialSummary {
    return {
      id: row.id,
      userId: row.userId,
      version: row.version,
      isActive: row.isActive,
      createdAt: row.createdAt,
      revokedAt: row.revokedAt
    }
  }

  return {
    async prepareCeremony(userId) {
      const plaintextRecoveryKey = generateRecoveryKeyPlaintext()
      const candidateHash = await hashPassword(plaintextRecoveryKey)
      const ceremonyToken = generateUniqueToken()
      const expiresAt = new Date(now().getTime() + CEREMONY_TTL_MS)

      pendingCeremonies.set(ceremonyToken, {
        userId,
        candidateHash,
        expiresAt,
        confirmationInProgress: false
      })

      return { ceremonyToken, plaintextRecoveryKey }
    },

    async confirmCeremony(ceremonyToken, reenteredKey) {
      const ceremony = pendingCeremonies.get(ceremonyToken)
      if (!ceremony) {
        return undefined
      }

      if (now().getTime() > ceremony.expiresAt.getTime()) {
        pendingCeremonies.delete(ceremonyToken)
        return undefined
      }

      // A second concurrent confirmCeremony call for the same token
      // observes this already set (see PendingCeremony's doc comment
      // for why this synchronous check-and-set is race-free) and fails
      // the same ordinary way as a wrong key — no distinguishable
      // result reveals that another confirmation is in flight.
      if (ceremony.confirmationInProgress) {
        return undefined
      }
      ceremony.confirmationInProgress = true

      let matches: boolean
      try {
        matches = await verifyPassword(reenteredKey, ceremony.candidateHash)
      } catch {
        // A thrown verification error is treated exactly like a wrong
        // key below — it must not permanently strand the ceremony in
        // an in-progress state.
        matches = false
      }

      // Re-read the ceremony's current state after the await — it may
      // have been cancelled (removed outright) or, independently,
      // expired while this call was suspended. Both are checked here,
      // as one explicitly documented rule: whatever state the ceremony
      // is in by the time verification finishes is what determines the
      // outcome, never the state captured before the await.
      const currentEntry = pendingCeremonies.get(ceremonyToken)
      if (currentEntry !== ceremony) {
        // Cancelled (or otherwise no longer the live entry) during
        // verification — nothing to restore, since it is already gone;
        // this call simply fails without resurrecting it.
        return undefined
      }
      if (now().getTime() > currentEntry.expiresAt.getTime()) {
        // Expired during verification — removed and failed, the same
        // outcome as an expiry detected before verification even
        // started above.
        pendingCeremonies.delete(ceremonyToken)
        return undefined
      }

      if (!matches) {
        // Restore to a retryable state — this was an ordinary wrong-key
        // (or verification-threw) outcome, not a cancellation or
        // expiry, so the ceremony itself remains fully valid for
        // another attempt.
        ceremony.confirmationInProgress = false
        return undefined
      }

      // Generate and validate the commit token BEFORE mutating either
      // map — if the bounded retry budget is exhausted, the pending
      // ceremony must remain completely untouched (including being
      // retryable again later, not stuck in-progress) rather than
      // having already been deleted with no confirmed capability to
      // show for it.
      let commitToken: string
      try {
        commitToken = generateUniqueToken()
      } catch (error) {
        ceremony.confirmationInProgress = false
        throw error
      }

      // Only now, with every fallible step already behind us, transition
      // state — with no await between removing the pending ceremony and
      // inserting the confirmed capability, so no other call can ever
      // observe a moment where the ceremony has been consumed but no
      // capability exists yet, or vice versa.
      pendingCeremonies.delete(ceremonyToken)
      confirmedCapabilities.set(commitToken, {
        userId: ceremony.userId,
        recoveryKeyHash: ceremony.candidateHash,
        credentialId: `recovery_credential_${randomUUID()}`,
        expiresAt: new Date(now().getTime() + CONFIRMED_CAPABILITY_TTL_MS)
      })

      return { commitToken }
    },

    cancelCeremony(ceremonyToken) {
      pendingCeremonies.delete(ceremonyToken)
    },

    commitCredential(context, commitToken, commitNow = new Date()) {
      const capability = confirmedCapabilities.get(commitToken)
      if (!capability) {
        throw new RecoveryCeremonyError(
          'Unknown, unconfirmed, or already-consumed recovery commit token'
        )
      }

      if (now().getTime() > capability.expiresAt.getTime()) {
        confirmedCapabilities.delete(commitToken)
        throw new RecoveryCeremonyError('Recovery commit token has expired')
      }

      const tx = context.tx

      const priorActive = tx
        .select()
        .from(ownerRecoveryCredentials)
        .where(
          and(
            eq(ownerRecoveryCredentials.userId, capability.userId),
            eq(ownerRecoveryCredentials.isActive, true)
          )
        )
        .get()

      if (priorActive) {
        tx.update(ownerRecoveryCredentials)
          .set({ isActive: false, revokedAt: commitNow })
          .where(eq(ownerRecoveryCredentials.id, priorActive.id))
          .run()
      }

      const highestVersionRow = tx
        .select({ version: ownerRecoveryCredentials.version })
        .from(ownerRecoveryCredentials)
        .where(eq(ownerRecoveryCredentials.userId, capability.userId))
        .orderBy(desc(ownerRecoveryCredentials.version))
        .limit(1)
        .get()
      const nextVersion = highestVersionRow ? highestVersionRow.version + 1 : 1

      tx.insert(ownerRecoveryCredentials)
        .values({
          id: capability.credentialId,
          userId: capability.userId,
          recoveryKeyHash: capability.recoveryKeyHash,
          version: nextVersion,
          isActive: true,
          createdAt: commitNow,
          revokedAt: null
        })
        .run()

      const created = tx
        .select()
        .from(ownerRecoveryCredentials)
        .where(eq(ownerRecoveryCredentials.id, capability.credentialId))
        .get()
      if (!created) {
        throw new Error('Recovery credential was not persisted after creation')
      }

      // Consumption is tied to the transaction's real outcome, not to
      // this function's own writes succeeding: this callback only runs
      // once runAppTransaction confirms the surrounding SQLite
      // transaction has actually committed. If the caller's transaction
      // later fails for any reason — including code that runs after
      // this call returns, still inside the same transaction — this
      // callback never fires, and the capability remains in
      // confirmedCapabilities for a retry with the same commitToken.
      context.afterCommit(() => {
        confirmedCapabilities.delete(commitToken)
      })

      return toSummary(created)
    }
  }
}
