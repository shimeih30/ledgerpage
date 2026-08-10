/**
 * Slice 15's approved quantity representation: every inventory item's
 * physical quantity is stored as a scaled integer in its base unit,
 * where the scale is derived from that unit's own decimalPlaces
 * (quantityScale = 10 ^ decimalPlaces) — mirroring money's own
 * integer-minor-units convention exactly, just with a per-unit scale
 * instead of a fixed 2 decimal places. "1.500 kg" at 3 decimal places
 * is stored as the integer 1500; "0.250 L" at 3 decimal places is
 * stored as 250.
 *
 * Never computed via `Number(value) * quantityScale` or similar
 * floating-point multiplication — confirmed directly that ordinary
 * IEEE 754 double-precision arithmetic does not round-trip exactly for
 * many decimal fractions (e.g. 0.29 * 100 === 28.999999999999996).
 * Parsing instead extracts the whole and fractional parts as pure
 * digit strings via a regex anchored to the exact allowed decimal
 * length, then concatenates and parses them as a single integer —
 * exact integer arithmetic on digit characters, never a floating-point
 * multiplication. Formatting (the inverse direction, integer -> string)
 * uses only integer division/modulo by the scale, which is exact for
 * safe-integer inputs and an integer divisor.
 */

export function quantityScaleForDecimalPlaces(decimalPlaces: number): number {
  return 10 ** decimalPlaces
}

function buildDecimalPattern(decimalPlaces: number): RegExp {
  if (decimalPlaces <= 0) {
    return /^(\d+)$/
  }
  return new RegExp(`^(\\d+)(?:\\.(\\d{1,${decimalPlaces}}))?$`)
}

/**
 * Parses a decimal-string UI/input value (e.g. "1.5") into an exact
 * scaled integer for the given number of decimal places (e.g. 1500 at
 * 3 decimal places). Rejects: blank input, negative signs, plus signs,
 * NaN/Infinity-shaped input, more decimal places than allowed, and any
 * result that isn't a safe integer. Returns undefined for any invalid
 * input — there is no "blank means null" case here, since a quantity
 * being parsed for a lot/movement is always required, unlike a
 * nullable field such as a credit limit.
 */
export function parseQuantityToScaledInteger(
  rawInput: string,
  decimalPlaces: number
): number | undefined {
  const trimmed = rawInput.trim()
  if (trimmed.length === 0) {
    return undefined
  }
  const pattern = buildDecimalPattern(decimalPlaces)
  const match = pattern.exec(trimmed)
  if (!match) {
    return undefined
  }
  const wholePart = match[1]
  const fractionalPart = (match[2] ?? '').padEnd(decimalPlaces, '0')
  const combined = `${wholePart}${fractionalPart}`
  const scaled = Number.parseInt(combined, 10)
  return Number.isSafeInteger(scaled) ? scaled : undefined
}

/**
 * Formats a stored scaled integer back into a decimal-string display
 * value (e.g. 1500 at 3 decimal places -> "1.500"). The inverse of
 * parseQuantityToScaledInteger.
 */
export function formatScaledIntegerAsQuantity(scaledValue: number, decimalPlaces: number): string {
  if (decimalPlaces <= 0) {
    return String(scaledValue)
  }
  const scale = quantityScaleForDecimalPlaces(decimalPlaces)
  const whole = Math.trunc(scaledValue / scale)
  const fraction = Math.abs(scaledValue % scale)
    .toString()
    .padStart(decimalPlaces, '0')
  return `${whole}.${fraction}`
}

/**
 * Strict validation for an already-scaled integer quantity value
 * (as opposed to parsing a raw decimal string) -- used where a caller
 * supplies a quantity that has already been scaled (e.g. internal
 * service-to-service calls), not a user-typed decimal string. Rejects
 * non-numbers, NaN, Infinity, non-integers, and unsafe integers as
 * separately-reasoned checks, matching every other strict-integer
 * validator in this codebase.
 */
export function requirePositiveScaledInteger(value: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new RangeError(`quantity must be a finite number, received ${String(value)}`)
  }
  if (!Number.isInteger(value)) {
    throw new RangeError(`quantity must be an integer, received ${String(value)}`)
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError('quantity must be a safe integer')
  }
  if (value <= 0) {
    throw new RangeError(`quantity must be positive, received ${String(value)}`)
  }
  return value
}

export function requireNonNegativeScaledInteger(value: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new RangeError(`quantity must be a finite number, received ${String(value)}`)
  }
  if (!Number.isInteger(value)) {
    throw new RangeError(`quantity must be an integer, received ${String(value)}`)
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError('quantity must be a safe integer')
  }
  if (value < 0) {
    throw new RangeError(`quantity must not be negative, received ${String(value)}`)
  }
  return value
}
