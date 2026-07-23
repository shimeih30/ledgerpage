import { describe, expect, it } from 'vitest'
import {
  formatMinorUnitsAsDecimal,
  parseDecimalToMinorUnits
} from '../../src/renderer/src/products/productDecimal'

describe('parseDecimalToMinorUnits', () => {
  it('parses a whole number', () => {
    expect(parseDecimalToMinorUnits('10')).toBe(1000)
  })

  it('parses one decimal place', () => {
    expect(parseDecimalToMinorUnits('10.2')).toBe(1020)
  })

  it('parses exactly the 10.29 case this slice was specifically flagged for', () => {
    expect(parseDecimalToMinorUnits('10.29')).toBe(1029)
  })

  it('parses 0.29 exactly -- naive floating-point multiplication (0.29 * 100) produces 28.999999999999996, not 29', () => {
    expect(parseDecimalToMinorUnits('0.29')).toBe(29)
  })

  it('parses 1.005 as invalid (three decimal places) -- naive rounding of 1.005 * 100 would wrongly give 100, not 101', () => {
    expect(parseDecimalToMinorUnits('1.005')).toBeUndefined()
  })

  it('parses zero', () => {
    expect(parseDecimalToMinorUnits('0')).toBe(0)
    expect(parseDecimalToMinorUnits('0.00')).toBe(0)
  })

  it('trims surrounding whitespace', () => {
    expect(parseDecimalToMinorUnits('  10.29  ')).toBe(1029)
  })

  it('rejects more than two decimal places', () => {
    expect(parseDecimalToMinorUnits('10.299')).toBeUndefined()
  })

  it('rejects a negative value', () => {
    expect(parseDecimalToMinorUnits('-5')).toBeUndefined()
    expect(parseDecimalToMinorUnits('-5.00')).toBeUndefined()
  })

  it('rejects a non-numeric string', () => {
    expect(parseDecimalToMinorUnits('abc')).toBeUndefined()
    expect(parseDecimalToMinorUnits('10abc')).toBeUndefined()
  })

  it('rejects an empty or whitespace-only string', () => {
    expect(parseDecimalToMinorUnits('')).toBeUndefined()
    expect(parseDecimalToMinorUnits('   ')).toBeUndefined()
  })

  it('rejects a trailing decimal point with no digits after it', () => {
    expect(parseDecimalToMinorUnits('10.')).toBeUndefined()
  })

  it('rejects a leading decimal point with no leading digit', () => {
    expect(parseDecimalToMinorUnits('.5')).toBeUndefined()
  })

  it('rejects scientific notation and other numeric-looking but non-decimal forms', () => {
    expect(parseDecimalToMinorUnits('1e3')).toBeUndefined()
    expect(parseDecimalToMinorUnits('Infinity')).toBeUndefined()
    expect(parseDecimalToMinorUnits('NaN')).toBeUndefined()
  })

  it('parses a large but safe-integer amount correctly', () => {
    expect(parseDecimalToMinorUnits('99999999.99')).toBe(9999999999)
  })
})

describe('formatMinorUnitsAsDecimal', () => {
  it('formats a round number of dollars', () => {
    expect(formatMinorUnitsAsDecimal(1000)).toBe('10.00')
  })

  it('formats 1029 back to 10.29 exactly', () => {
    expect(formatMinorUnitsAsDecimal(1029)).toBe('10.29')
  })

  it('formats zero', () => {
    expect(formatMinorUnitsAsDecimal(0)).toBe('0.00')
  })

  it('pads a single-digit cents value with a leading zero', () => {
    expect(formatMinorUnitsAsDecimal(1005)).toBe('10.05')
  })

  it('round-trips through parseDecimalToMinorUnits for a range of values', () => {
    for (const value of ['0.00', '0.01', '0.29', '1.00', '10.29', '999.99']) {
      const minorUnits = parseDecimalToMinorUnits(value)
      expect(minorUnits).toBeDefined()
      expect(formatMinorUnitsAsDecimal(minorUnits as number)).toBe(value)
    }
  })
})
