import { describe, expect, it } from 'vitest'
import {
  formatScaledIntegerAsQuantity,
  parseQuantityToScaledInteger,
  quantityScaleForDecimalPlaces,
  requireNonNegativeScaledInteger,
  requirePositiveScaledInteger
} from '../../../src/main/db/quantityScale'

describe('quantityScaleForDecimalPlaces', () => {
  it('computes 10^decimalPlaces', () => {
    expect(quantityScaleForDecimalPlaces(0)).toBe(1)
    expect(quantityScaleForDecimalPlaces(2)).toBe(100)
    expect(quantityScaleForDecimalPlaces(3)).toBe(1000)
  })
})

describe('parseQuantityToScaledInteger', () => {
  it('parses "1.500" at 3 decimal places to 1500', () => {
    expect(parseQuantityToScaledInteger('1.500', 3)).toBe(1500)
  })

  it('parses "0.250" at 3 decimal places to 250', () => {
    expect(parseQuantityToScaledInteger('0.250', 3)).toBe(250)
  })

  it('parses a whole number with no decimal point', () => {
    expect(parseQuantityToScaledInteger('20', 3)).toBe(20000)
  })

  it('parses fewer decimal places than allowed, padding with zeros', () => {
    expect(parseQuantityToScaledInteger('1.5', 3)).toBe(1500)
    expect(parseQuantityToScaledInteger('1.05', 3)).toBe(1050)
  })

  it('parses at 0 decimal places (whole numbers only)', () => {
    expect(parseQuantityToScaledInteger('42', 0)).toBe(42)
  })

  it('rejects a decimal point at 0 decimal places', () => {
    expect(parseQuantityToScaledInteger('42.5', 0)).toBeUndefined()
  })

  it('rejects more decimal places than allowed', () => {
    expect(parseQuantityToScaledInteger('1.5001', 3)).toBeUndefined()
  })

  it('rejects a negative sign', () => {
    expect(parseQuantityToScaledInteger('-1.5', 3)).toBeUndefined()
  })

  it('rejects a plus sign', () => {
    expect(parseQuantityToScaledInteger('+1.5', 3)).toBeUndefined()
  })

  it('rejects NaN-shaped input', () => {
    expect(parseQuantityToScaledInteger('NaN', 3)).toBeUndefined()
  })

  it('rejects Infinity-shaped input', () => {
    expect(parseQuantityToScaledInteger('Infinity', 3)).toBeUndefined()
  })

  it('rejects blank input', () => {
    expect(parseQuantityToScaledInteger('', 3)).toBeUndefined()
    expect(parseQuantityToScaledInteger('   ', 3)).toBeUndefined()
  })

  it('rejects a trailing decimal point with no digits', () => {
    expect(parseQuantityToScaledInteger('1.', 3)).toBeUndefined()
  })

  it('rejects a leading decimal point with no whole part', () => {
    expect(parseQuantityToScaledInteger('.5', 3)).toBeUndefined()
  })

  it('rejects non-numeric garbage', () => {
    expect(parseQuantityToScaledInteger('abc', 3)).toBeUndefined()
  })

  it('rejects an unsafe integer result', () => {
    expect(parseQuantityToScaledInteger('99999999999999999.999', 3)).toBeUndefined()
  })

  it('trims surrounding whitespace before parsing', () => {
    expect(parseQuantityToScaledInteger('  1.500  ', 3)).toBe(1500)
  })

  it('never produces a floating-point rounding error for 0.29-style inputs', () => {
    // Direct confirmation that Number("0.29") * 100 would NOT equal 29
    // exactly in IEEE 754 double precision -- this parser must still
    // produce exactly 29 via digit-string concatenation.
    expect(Number('0.29') * 100).not.toBe(29)
    expect(parseQuantityToScaledInteger('0.29', 2)).toBe(29)
  })
})

describe('formatScaledIntegerAsQuantity', () => {
  it('formats 1500 at 3 decimal places as "1.500"', () => {
    expect(formatScaledIntegerAsQuantity(1500, 3)).toBe('1.500')
  })

  it('formats 250 at 3 decimal places as "0.250"', () => {
    expect(formatScaledIntegerAsQuantity(250, 3)).toBe('0.250')
  })

  it('formats 0 at 3 decimal places as "0.000"', () => {
    expect(formatScaledIntegerAsQuantity(0, 3)).toBe('0.000')
  })

  it('formats at 0 decimal places as a plain integer string', () => {
    expect(formatScaledIntegerAsQuantity(42, 0)).toBe('42')
  })

  it('round-trips through parse then format', () => {
    const parsed = parseQuantityToScaledInteger('1.500', 3)
    expect(parsed).toBeDefined()
    expect(formatScaledIntegerAsQuantity(parsed as number, 3)).toBe('1.500')
  })
})

describe('requirePositiveScaledInteger', () => {
  it('accepts a positive integer', () => {
    expect(requirePositiveScaledInteger(1500)).toBe(1500)
  })

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects %s', (value) => {
    expect(() => requirePositiveScaledInteger(value)).toThrow(RangeError)
  })
})

describe('requireNonNegativeScaledInteger', () => {
  it('accepts zero', () => {
    expect(requireNonNegativeScaledInteger(0)).toBe(0)
  })

  it('accepts a positive integer', () => {
    expect(requireNonNegativeScaledInteger(1500)).toBe(1500)
  })

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects %s', (value) => {
    expect(() => requireNonNegativeScaledInteger(value)).toThrow(RangeError)
  })
})
