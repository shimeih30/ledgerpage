export class SupplierValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupplierValidationError'
  }
}

export function requireTrimmedSupplierName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new SupplierValidationError('name must not be empty')
  }
  return trimmed
}

/**
 * contactDetails is nullable -- trimmed, and a blank (post-trim) value
 * normalizes to null rather than an empty string, matching this
 * codebase's established "blank becomes null" convention for optional
 * text fields.
 */
export function normalizeSupplierContactDetails(
  contactDetails: string | null | undefined
): string | null {
  if (contactDetails === null || contactDetails === undefined) {
    return null
  }
  const trimmed = contactDetails.trim()
  return trimmed.length === 0 ? null : trimmed
}
