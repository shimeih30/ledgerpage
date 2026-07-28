export class CustomerValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomerValidationError'
  }
}

export function requireTrimmedCustomerName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new CustomerValidationError('name must not be empty')
  }
  return trimmed
}

/**
 * contactDetails is nullable -- trimmed, and a blank (post-trim) value
 * normalizes to null rather than an empty string, matching this
 * codebase's established "blank becomes null" convention for optional
 * text fields (mirroring suppliers.contactDetails's own precedent).
 */
export function normalizeCustomerContactDetails(
  contactDetails: string | null | undefined
): string | null {
  if (contactDetails === null || contactDetails === undefined) {
    return null
  }
  const trimmed = contactDetails.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * Strict non-negative safe-integer validation for paymentTermsDays --
 * null/undefined pass through unchanged (meaning "no default payment
 * terms configured"); 0 is a valid, meaningful value ("due
 * immediately"), not treated as absent. Rejects non-numbers, NaN,
 * Infinity, non-integers, and unsafe integers as separately-reasoned
 * checks.
 */
export function requireNullablePaymentTermsDays(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new CustomerValidationError(
      `paymentTermsDays must be a finite number, received ${String(value)}`
    )
  }
  if (!Number.isInteger(value)) {
    throw new CustomerValidationError(
      `paymentTermsDays must be an integer, received ${String(value)}`
    )
  }
  if (!Number.isSafeInteger(value)) {
    throw new CustomerValidationError('paymentTermsDays must be a safe integer')
  }
  if (value < 0) {
    throw new CustomerValidationError(
      `paymentTermsDays must not be negative, received ${String(value)}`
    )
  }
  return value
}

/**
 * Same strictness as requireNullablePaymentTermsDays, for
 * creditLimitMinor. null means "no configured limit" -- explicitly NOT
 * "unlimited credit," a distinction this codebase leaves to the
 * renderer/documentation to communicate, not this validator's concern.
 * This slice calculates no balance, no remaining credit, and enforces
 * nothing against this value.
 */
export function requireNullableCreditLimitMinor(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new CustomerValidationError(
      `creditLimitMinor must be a finite number, received ${String(value)}`
    )
  }
  if (!Number.isInteger(value)) {
    throw new CustomerValidationError(
      `creditLimitMinor must be an integer, received ${String(value)}`
    )
  }
  if (!Number.isSafeInteger(value)) {
    throw new CustomerValidationError('creditLimitMinor must be a safe integer')
  }
  if (value < 0) {
    throw new CustomerValidationError(
      `creditLimitMinor must not be negative, received ${String(value)}`
    )
  }
  return value
}
