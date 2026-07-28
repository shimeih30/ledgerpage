/**
 * Accepts at most two decimal places, at least one leading digit, and
 * an optional decimal point with at least one digit following it if
 * present ("10", "10.2", "10.29" all valid; "10.", ".5", "10.299",
 * "-5", "+5", "abc" all invalid). A dedicated copy for this domain
 * (rather than importing supplierPriceDecimal.ts's own
 * parseSupplierPriceToMinorUnits or productDecimal.ts's
 * parseDecimalToMinorUnits), matching this codebase's established
 * one-copy-per-domain convention for validation/parsing helpers.
 */
const DECIMAL_INPUT_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/

/**
 * Parses a decimal-string UI value (e.g. "10.29") into an exact integer
 * number of minor currency units (e.g. 1029). A blank (post-trim) input
 * is a valid "no configured limit" and returns null, distinct from an
 * invalid value (undefined) -- the credit limit is nullable, unlike a
 * required price. Never computes this via `Number(value) * 100` or
 * similar floating-point multiplication — confirmed directly that
 * 0.29 * 100 === 28.999999999999996 in IEEE 754 double precision, and
 * even Math.round doesn't save every case (1.005 * 100 ===
 * 100.49999999999999, rounding to 100, not 101). Instead the whole and
 * fractional parts are extracted as pure digit strings by the regex
 * above and concatenated as a single integer — exact integer
 * arithmetic on digit characters, never a floating-point
 * multiplication.
 */
export function parseCreditLimitToMinorUnits(rawInput: string): number | null | undefined {
  const trimmed = rawInput.trim()
  if (trimmed === '') {
    return null
  }
  const match = DECIMAL_INPUT_PATTERN.exec(trimmed)
  if (!match) {
    return undefined
  }
  const wholePart = match[1]
  const fractionalPart = (match[2] ?? '').padEnd(2, '0')
  const combined = `${wholePart}${fractionalPart}`
  const minorUnits = Number.parseInt(combined, 10)
  return Number.isSafeInteger(minorUnits) ? minorUnits : undefined
}

/**
 * Formats a stored integer minor-units value back into a decimal-string
 * UI value (e.g. 1029 -> "10.29"). null (no configured limit) formats
 * to an empty string, the inverse of parseCreditLimitToMinorUnits's own
 * blank-means-null rule.
 */
export function formatMinorUnitsAsCreditLimit(minorUnits: number | null): string {
  if (minorUnits === null) {
    return ''
  }
  const whole = Math.trunc(minorUnits / 100)
  const fraction = Math.abs(minorUnits % 100)
    .toString()
    .padStart(2, '0')
  return `${whole}.${fraction}`
}
