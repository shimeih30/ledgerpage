export class CompanyValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompanyValidationError'
  }
}

/**
 * Validates a required text field is non-empty after trimming, returning
 * the trimmed value. Used for name/address/contactDetails.
 */
export function requireTrimmedText(value: string, fieldLabel: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new CompanyValidationError(`${fieldLabel} must not be empty`)
  }
  return trimmed
}

/**
 * Validates an optional text field, trimming and converting an
 * empty/whitespace-only string to null rather than storing a blank
 * value. Used for tradingName.
 */
export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * Validates logoAssetPath as a managed *relative* path — never an
 * absolute path, never a path that escapes its managed directory via
 * `..` segments. This only validates the shape of the path; the actual
 * copy/validate/replace file workflow is out of scope for this slice.
 */
export function validateManagedRelativeLogoPath(path: string): string {
  const trimmed = path.trim()

  if (trimmed.length === 0) {
    throw new CompanyValidationError('logoAssetPath must not be empty when provided')
  }

  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    throw new CompanyValidationError('logoAssetPath must be relative, not absolute')
  }

  // Windows drive-letter absolute paths, e.g. "C:\..." or "C:/...".
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    throw new CompanyValidationError('logoAssetPath must be relative, not absolute')
  }

  const segments = trimmed.split(/[\\/]/)
  if (segments.includes('..')) {
    throw new CompanyValidationError('logoAssetPath must not contain ".." path traversal segments')
  }

  return trimmed
}
