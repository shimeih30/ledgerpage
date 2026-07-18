export class AuthValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthValidationError'
  }
}

const MIN_LOGIN_IDENTIFIER_LENGTH = 3
const MAX_LOGIN_IDENTIFIER_LENGTH = 64

/**
 * Normalizes a login identifier to its stored/compared form: trimmed
 * and lower-cased, so "Ben", " ben ", and "BEN" are all the same login.
 *
 * For M1 this is a generic username, not an email address — no @
 * requirement, no email-shaped validation — per the roadmap's explicit
 * instruction not to assume email unless stated. Internal whitespace is
 * rejected (a login identifier with a space in the middle is almost
 * certainly a mistake, not an intentional username).
 */
export function normalizeLoginIdentifier(identifier: string): string {
  if (typeof identifier !== 'string') {
    throw new AuthValidationError('login identifier must be a string')
  }

  const trimmed = identifier.trim()

  if (trimmed.length === 0) {
    throw new AuthValidationError('login identifier must not be empty')
  }
  if (/\s/.test(trimmed)) {
    throw new AuthValidationError('login identifier must not contain whitespace')
  }
  if (trimmed.length < MIN_LOGIN_IDENTIFIER_LENGTH) {
    throw new AuthValidationError(
      `login identifier must be at least ${MIN_LOGIN_IDENTIFIER_LENGTH} characters`
    )
  }
  if (trimmed.length > MAX_LOGIN_IDENTIFIER_LENGTH) {
    throw new AuthValidationError(
      `login identifier must not exceed ${MAX_LOGIN_IDENTIFIER_LENGTH} characters`
    )
  }

  return trimmed.toLowerCase()
}

export function requireTrimmedDisplayName(displayName: string): string {
  if (typeof displayName !== 'string') {
    throw new AuthValidationError('display name must be a string')
  }
  const trimmed = displayName.trim()
  if (trimmed.length === 0) {
    throw new AuthValidationError('display name must not be empty')
  }
  return trimmed
}
