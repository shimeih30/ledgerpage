import { randomUUID } from 'node:crypto'
import { loginEvents } from '../db/schema'
import {
  getUserAuthRecordByLoginIdentifier,
  setLoginLockoutState,
  type SafeUser,
  type UserAuthRecord
} from './userService'
import { normalizeLoginIdentifier } from './authValidation'
import { DUMMY_PASSWORD_HASH, verifyPassword } from './passwordHashing'
import { enqueueAuthenticationOperation } from './authenticationQueue'
import type { AppDb } from '../db/dbTypes'

export const MAX_FAILED_LOGIN_ATTEMPTS = 5
export const LOCK_DURATION_MS = 15 * 60 * 1000 // 15 minutes

export type LoginEventSource = 'normal_login' | 'session_unlock' | 'owner_recovery'

export interface AuthenticationSuccess {
  success: true
  user: SafeUser
}

export interface AuthenticationFailure {
  success: false
}

export type AuthenticationResult = AuthenticationSuccess | AuthenticationFailure

/**
 * Verifies a login identifier and password. Every ordinary failure mode
 * — nonexistent identifier, wrong password, inactive user, locked user —
 * produces the exact same public result shape (`{ success: false }`),
 * and every one of them runs a real password-verification step before
 * returning, using the fixed dummy hash when no user was found. This is
 * the anti-enumeration design in full: there is no early return based on
 * user existence, no distinguishing error message, and no code path that
 * skips the expensive verification step.
 *
 * This does NOT guarantee nanosecond-identical timing — OS scheduling,
 * GC pauses, and JIT warm-up make that an unachievable promise for any
 * process, and this code makes no claim otherwise. What it guarantees is
 * that no *shortcut* exists in the code itself: the same verification
 * call runs on every path, and no branch returns before it.
 *
 * Never writes an unmatched identifier anywhere — a nonexistent login
 * produces a login_events row with user_id = NULL and nothing else that
 * could reconstruct what was typed.
 *
 * The entire body runs inside enqueueAuthenticationOperation — a single,
 * process-local, non-per-user queue (see authenticationQueue.ts) — so at
 * most one authenticate()-family call is ever actually executing at a
 * time, globally. This closes a genuine race: without it, two concurrent
 * calls could both read the same starting failed_login_count before
 * either writes back an incremented value, undercounting failed attempts
 * and potentially letting the lockout threshold be bypassed by
 * concurrency alone. As a second, independent layer of protection, the
 * user's lockout-relevant state is re-read fresh immediately before
 * computing the final outcome — not reused from the lookup performed
 * before the password-verification await — so even a state change from
 * some other source during this call's (possibly queued) execution is
 * reflected correctly. No SQLite transaction is ever held open while
 * awaiting Argon2id: verification happens entirely before the
 * synchronous db.transaction(...) call below opens.
 */
export async function authenticate(
  db: AppDb,
  loginIdentifier: string,
  password: string,
  source: LoginEventSource,
  now: Date = new Date()
): Promise<AuthenticationResult> {
  return enqueueAuthenticationOperation(() =>
    performAuthentication(db, loginIdentifier, password, source, now)
  )
}

async function performAuthentication(
  db: AppDb,
  loginIdentifier: string,
  password: string,
  source: LoginEventSource,
  now: Date
): Promise<AuthenticationResult> {
  let userRecord: UserAuthRecord | undefined

  try {
    const normalized = normalizeLoginIdentifier(loginIdentifier)
    userRecord = getUserAuthRecordByLoginIdentifier(db, normalized)
  } catch {
    // A malformed identifier (empty, too short/long, contains
    // whitespace) is treated exactly like "no such user" — it must not
    // short-circuit before the verification step below, and must not
    // surface a distinguishable validation error to the caller.
    userRecord = undefined
  }

  let passwordCorrect: boolean
  try {
    passwordCorrect = await verifyPassword(
      password,
      userRecord?.passwordHash ?? DUMMY_PASSWORD_HASH
    )
  } catch {
    // A malformed stored hash (data corruption) or invalid password
    // input both count as "did not verify" for the public result —
    // still uniform, still nothing distinguishing leaked.
    passwordCorrect = false
  }

  // Re-read fresh, right before computing the final outcome — never
  // trust the pre-verification lookup for the actual state transition,
  // even under full serialization (defense in depth: this also protects
  // against a state change from an entirely different source, not just
  // a concurrent authenticate() call).
  const freshUserRecord = userRecord
    ? getUserAuthRecordByLoginIdentifier(db, userRecord.loginIdentifier)
    : undefined

  let success = false
  let nextFailedLoginCount = 0
  let nextLockedUntil: Date | null = null

  if (freshUserRecord) {
    const isCurrentlyLocked =
      freshUserRecord.lockedUntil != null && freshUserRecord.lockedUntil.getTime() > now.getTime()

    if (!passwordCorrect) {
      // A genuine wrong-password attempt: this is what the counter
      // tracks. Increments regardless of active/locked state, and
      // re-extends the lock if already at/above threshold — a
      // deliberate anti-persistence property, not an oversight: an
      // attacker retrying during lockout keeps extending their own
      // lockout window rather than being able to simply wait it out
      // while continuing to guess.
      nextFailedLoginCount = freshUserRecord.failedLoginCount + 1
      nextLockedUntil =
        nextFailedLoginCount >= MAX_FAILED_LOGIN_ATTEMPTS
          ? new Date(now.getTime() + LOCK_DURATION_MS)
          : freshUserRecord.lockedUntil
    } else if (!freshUserRecord.isActive || isCurrentlyLocked) {
      // Correct password, but blocked by an access-control gate rather
      // than a wrong guess — the counter is left exactly as it was;
      // this isn't a brute-force signal.
      nextFailedLoginCount = freshUserRecord.failedLoginCount
      nextLockedUntil = freshUserRecord.lockedUntil
    } else {
      success = true
      nextFailedLoginCount = 0
      nextLockedUntil = null
    }
  }

  db.transaction((tx) => {
    tx.insert(loginEvents)
      .values({
        id: `login_event_${randomUUID()}`,
        userId: freshUserRecord ? freshUserRecord.id : null,
        occurredAt: now,
        success,
        source
      })
      .run()

    if (freshUserRecord) {
      setLoginLockoutState(
        tx,
        freshUserRecord.id,
        { failedLoginCount: nextFailedLoginCount, lockedUntil: nextLockedUntil },
        now
      )
    }
  })

  if (!success || !freshUserRecord) {
    return { success: false }
  }

  return {
    success: true,
    user: {
      id: freshUserRecord.id,
      companyId: freshUserRecord.companyId,
      loginIdentifier: freshUserRecord.loginIdentifier,
      displayName: freshUserRecord.displayName,
      isActive: freshUserRecord.isActive,
      failedLoginCount: nextFailedLoginCount,
      lockedUntil: nextLockedUntil,
      createdAt: freshUserRecord.createdAt,
      updatedAt: freshUserRecord.updatedAt
    }
  }
}
