/**
 * Strict non-negative integer parsing for minimumStock, reorderQuantity,
 * and leadTimeDays -- digits only, no decimal point, no sign, no
 * leading/trailing junk. "5", "0" valid; "5.5", "-5", "+5", "", "abc",
 * "NaN", "Infinity" all invalid. A dedicated copy for this domain
 * (rather than importing productDecimal.ts's own parseNonNegativeInteger)
 * matching this codebase's established one-copy-per-domain convention
 * for validation/parsing helpers.
 */
const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/

export function parseNonNegativeInteger(rawInput: string): number | undefined {
  const trimmed = rawInput.trim()
  if (!NON_NEGATIVE_INTEGER_PATTERN.test(trimmed)) {
    return undefined
  }
  const value = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(value) ? value : undefined
}

/**
 * Same strictness as parseNonNegativeInteger, but for the optional
 * maximumStock field: an empty (post-trim) string is a valid "no
 * maximum set" and returns null; anything else is validated with the
 * same non-negative-integer rule and returns undefined on failure.
 */
export function parseNullableNonNegativeInteger(rawInput: string): number | null | undefined {
  const trimmed = rawInput.trim()
  if (trimmed === '') {
    return null
  }
  return parseNonNegativeInteger(trimmed)
}
