/**
 * Accepts at most two decimal places, at least one leading digit, and
 * an optional decimal point with at least one digit following it if
 * present ("10", "10.2", "10.29" all valid; "10.", ".5", "10.299",
 * "-5", "abc", "" all invalid). Deliberately stricter than a native
 * <input type="number"> would enforce on its own — for a money field,
 * erring toward strict and unambiguous is safer than lenient.
 */
const DECIMAL_INPUT_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/

/**
 * Parses a decimal-string UI value (e.g. "10.29") into an exact integer
 * number of minor currency units (e.g. 1029), returning undefined for
 * anything that doesn't match DECIMAL_INPUT_PATTERN.
 *
 * Never computes this via `Number(value) * 100` or similar floating-
 * point multiplication — confirmed directly that this is not a
 * theoretical concern: 0.29 * 100 === 28.999999999999996 in IEEE 754
 * double precision, and even Math.round doesn't save every case (1.005
 * * 100 === 100.49999999999999, which rounds to 100, not 101). Instead,
 * the whole and fractional parts are extracted as pure digit strings by
 * the regex above, the fractional part is padded to exactly two digits,
 * and the two digit strings are concatenated and parsed as a single
 * integer — this is exact integer arithmetic on digit characters, never
 * a floating-point multiplication, so there is no rounding step to get
 * wrong in the first place.
 */
export function parseDecimalToMinorUnits(rawInput: string): number | undefined {
  const trimmed = rawInput.trim()
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
 * The inverse of parseDecimalToMinorUnits, for displaying an existing
 * amount in an editable decimal-string field. Uses integer division and
 * modulo on the minor-units integer itself, never a float division
 * followed by a multiplication step, for the same exactness reasons.
 */
export function formatMinorUnitsAsDecimal(minorUnits: number): string {
  const wholePart = Math.floor(minorUnits / 100)
  const fractionalPart = Math.abs(minorUnits % 100)
  return `${wholePart}.${String(fractionalPart).padStart(2, '0')}`
}

/**
 * Strict non-negative integer parsing for the minimum-finished-stock-
 * level field — digits only, no decimal point, no sign, no leading/
 * trailing junk. "5", "0" valid; "5.5", "-5", "", "abc" all invalid.
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
