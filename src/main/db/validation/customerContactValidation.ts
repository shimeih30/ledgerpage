export class CustomerContactValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomerContactValidationError'
  }
}

export function requireTrimmedContactName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new CustomerContactValidationError('name must not be empty')
  }
  return trimmed
}

/**
 * role/phone/email are all nullable, trimmed, with a blank (post-trim)
 * value normalizing to null -- matching contactDetails' own
 * "blank becomes null" convention. No format validation is applied to
 * phone or email (approved decision: no established convention exists
 * anywhere in this codebase for either), and neither is required.
 */
export function normalizeOptionalContactField(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}
