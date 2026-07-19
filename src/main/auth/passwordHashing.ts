import { argon2id, argon2Verify } from 'hash-wasm'
import { randomBytes } from 'node:crypto'

export class PasswordValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PasswordValidationError'
  }
}

/**
 * Thrown by verifyPassword when the stored hash string isn't a
 * well-formed Argon2id PHC string — a controlled, catchable failure
 * mode rather than a crash or an uncaught exception from hash-wasm.
 * Callers that need anti-enumeration-safe behavior (authenticationService)
 * catch this alongside an ordinary verification mismatch and map both to
 * the same generic public failure result — this error exists so the
 * *reason* is still distinguishable at the point that logs/diagnoses it,
 * without that distinction ever reaching a caller-facing boundary.
 */
export class PasswordHashFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PasswordHashFormatError'
  }
}

/**
 * Thrown by validatePasswordHashForStorage when a value about to be
 * persisted is not a well-formed, current-parameter Argon2id hash. This
 * is a stricter, write-time gate than PasswordHashFormatError (which
 * only cares whether hash-wasm can parse a *read-time* value well enough
 * to attempt verification): storage validation additionally rejects a
 * syntactically valid but outdated-parameter or wrong-variant
 * (argon2i/argon2d) hash, which verification alone would still happily
 * process.
 */
export class PasswordHashValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PasswordHashValidationError'
  }
}

/**
 * Explicit Argon2id parameters — never left to hash-wasm's defaults.
 *
 * Stronger than OWASP's baseline recommendation (m=19456 KiB/t=2/p=1)
 * deliberately: LedgerPage hashes only once per login attempt on the
 * user's own machine, never under concurrent server load, so there is
 * room to spend more compute per hash than a typical web backend would.
 * Measured ~280ms per hash/verify on typical hardware at these
 * parameters — comfortable for an interactive login, not imperceptible.
 *
 * The PHC encoded output already embeds m/t/p, which needsRehash parses
 * back out below to detect a future parameter change without needing a
 * separate stored column.
 */
export const ARGON2ID_PARAMETERS = {
  memorySize: 65536, // KiB (64 MiB)
  iterations: 3,
  parallelism: 1,
  hashLength: 32, // bytes
  saltLength: 16 // bytes — the RFC-recommended minimum for Argon2
} as const

/**
 * Exported so callers that need to validate a password's length before
 * ever calling hashPassword — e.g. the renderer's inline form
 * validation, or setup's IPC-layer revalidation — reference these exact
 * values instead of duplicating "8"/"256" as disconnected magic
 * numbers that could quietly drift out of sync with the real gate
 * below.
 */
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 256

/**
 * A string known to have passed validatePasswordHashForStorage at least
 * once. The brand is a compile-time nudge only (any string can be forced
 * into this type with `as PasswordHash`) — it is not treated as a
 * security guarantee anywhere in this codebase. Every function that
 * persists a hash re-validates it at runtime regardless of whether the
 * value already carries this type.
 */
export type PasswordHash = string & { readonly __brand: 'PasswordHash' }

/**
 * The full PHC-string shape hash-wasm's argon2id({ outputType: 'encoded' })
 * produces: $argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>, with the
 * salt/hash segments in hash-wasm's actual observed alphabet (standard
 * base64 characters, unpadded — confirmed empirically against real
 * output before this pattern was written; no `=` padding, `+`/`/` do
 * appear). The literal `argon2id` segment means this pattern alone
 * already rejects argon2i/argon2d — there is no separate "reject other
 * variants" branch, because there is no way to match this pattern with
 * a different variant name in that position.
 */
const FULL_ARGON2ID_PHC_PATTERN =
  /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/

const ARGON2_VERSION = 19

/**
 * The synchronous gate every stored password hash must pass through
 * immediately before persistence — the write-time counterpart to
 * verifyPassword's read-time leniency. Requires: the literal argon2id
 * variant (rejects argon2i/argon2d structurally, not via a separate
 * check), version 19 exactly, and the *currently approved* m/t/p
 * parameters exactly (not merely "some valid Argon2id hash" — an
 * outdated-but-otherwise-valid hash is rejected here, unlike
 * needsRehash's read-time "flag it for upgrade" role). Rejects
 * plaintext and any malformed string outright, since they simply won't
 * match the PHC pattern at all.
 *
 * Never includes the rejected value in its error message or anywhere
 * else — a password hash (or, worse, an accidentally-passed plaintext
 * password) must never appear in a thrown error that might reach a log.
 */
export function validatePasswordHashForStorage(value: string): PasswordHash {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PasswordHashValidationError('password hash must be a non-empty string')
  }

  const match = FULL_ARGON2ID_PHC_PATTERN.exec(value)
  if (!match) {
    throw new PasswordHashValidationError(
      'password hash is not a well-formed Argon2id PHC-encoded string'
    )
  }

  const version = Number(match[1])
  const memorySize = Number(match[2])
  const iterations = Number(match[3])
  const parallelism = Number(match[4])

  if (version !== ARGON2_VERSION) {
    throw new PasswordHashValidationError(`password hash must use Argon2 version ${ARGON2_VERSION}`)
  }

  if (
    memorySize !== ARGON2ID_PARAMETERS.memorySize ||
    iterations !== ARGON2ID_PARAMETERS.iterations ||
    parallelism !== ARGON2ID_PARAMETERS.parallelism
  ) {
    throw new PasswordHashValidationError(
      'password hash does not use the currently approved Argon2id parameters'
    )
  }

  return value as PasswordHash
}

/**
 * A fixed, precomputed Argon2id hash using the exact parameters above,
 * generated once during development (not at runtime) and embedded as a
 * literal. Used only by authenticationService's anti-enumeration path to
 * verify against when no real user was found — consuming comparable CPU
 * time to a real verification without ever protecting anything real.
 * Never regenerated at runtime: doing so on first use would itself be a
 * timing signal (a slower first call than subsequent ones).
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$AAECAwQFBgcICQoLDA0ODw$vgjwpUdAUNSExMbAdNRcYSAC3hcDWJQ7HKzYe6WX+Uc'

function requireValidPasswordInput(password: string): void {
  if (typeof password !== 'string') {
    throw new PasswordValidationError('password must be a string')
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordValidationError(`password must not exceed ${MAX_PASSWORD_LENGTH} characters`)
  }
  if (password.trim().length === 0) {
    throw new PasswordValidationError('password must not be empty or whitespace-only')
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordValidationError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
}

/**
 * Hashes `password` with a freshly generated random salt, using the
 * explicit parameters above. Never logs the plaintext or the resulting
 * hash — callers must take the same care with the return value.
 *
 * The return type is branded (PasswordHash, not plain string) so a
 * caller's own type-checking nudges them toward the validated path —
 * but branding is a compile-time convenience only, not a security
 * boundary: this function also runs its own output back through
 * validatePasswordHashForStorage before returning, so a genuine runtime
 * guarantee holds regardless of whether a caller's TypeScript types are
 * accurate. Every persistence boundary (createUser, changePassword)
 * independently re-validates whatever it's given rather than trusting
 * the brand alone, per the explicit "runtime validation is mandatory"
 * requirement.
 */
export async function hashPassword(password: string): Promise<PasswordHash> {
  requireValidPasswordInput(password)

  const salt = randomBytes(ARGON2ID_PARAMETERS.saltLength)

  const hash = await argon2id({
    password,
    salt,
    parallelism: ARGON2ID_PARAMETERS.parallelism,
    iterations: ARGON2ID_PARAMETERS.iterations,
    memorySize: ARGON2ID_PARAMETERS.memorySize,
    hashLength: ARGON2ID_PARAMETERS.hashLength,
    outputType: 'encoded'
  })

  return validatePasswordHashForStorage(hash)
}

/**
 * Verifies `password` against `storedHash`. Returns false for an
 * ordinary mismatch — never throws for "wrong password." Throws
 * PasswordHashFormatError if `storedHash` isn't a well-formed Argon2id
 * PHC string, so a corrupted or malformed stored value produces a
 * controlled, named failure instead of an uncaught crash.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (typeof storedHash !== 'string' || storedHash.length === 0) {
    throw new PasswordHashFormatError('storedHash must be a non-empty string')
  }

  try {
    return await argon2Verify({ password, hash: storedHash })
  } catch (error) {
    throw new PasswordHashFormatError(
      `storedHash is not a well-formed Argon2id hash: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

const PHC_PARAM_PATTERN = /\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/

/**
 * Parses the embedded m/t/p parameters out of a stored PHC-format hash
 * and compares them against the current ARGON2ID_PARAMETERS, returning
 * true if they differ — the upgrade-path signal a caller (e.g.
 * authenticationService, right after a successful verification, while
 * the plaintext is still available) can use to transparently rehash a
 * password on its next successful use after a parameter change.
 *
 * Returns true (needs rehash) for a hash whose parameters can't be
 * parsed at all — treating "can't confirm it's current" the same as
 * "it's out of date" is the safer default.
 */
export function needsRehash(storedHash: string): boolean {
  const match = PHC_PARAM_PATTERN.exec(storedHash)
  if (!match) {
    return true
  }

  const memorySize = Number(match[1])
  const iterations = Number(match[2])
  const parallelism = Number(match[3])

  return (
    memorySize !== ARGON2ID_PARAMETERS.memorySize ||
    iterations !== ARGON2ID_PARAMETERS.iterations ||
    parallelism !== ARGON2ID_PARAMETERS.parallelism
  )
}
