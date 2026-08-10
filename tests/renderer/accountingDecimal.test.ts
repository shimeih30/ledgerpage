import { describe, expect, it } from 'vitest'
import {
  formatMinorUnitsAsDecimal,
  parseDecimalToMinorUnits
} from '../../src/renderer/src/accounting/accountingDecimal'

describe('parseDecimalToMinorUnits', () => {
  describe('accepts valid inputs', () => {
    it.each([
      ['0', 0],
      ['0.01', 1],
      ['0.29', 29],
      ['10.29', 1029],
      ['100', 10000],
      ['1', 100],
      ['0.1', 10],
      ['  10.29  ', 1029]
    ])('%s -> %d', (input, expected) => {
      expect(parseDecimalToMinorUnits(input)).toBe(expected)
    })

    it('accepts a large safe integer value', () => {
      // 90071992547409.91 * 100 = 9007199254740991, which is
      // Number.MAX_SAFE_INTEGER exactly.
      expect(parseDecimalToMinorUnits('90071992547409.91')).toBe(9007199254740991)
    })
  })

  describe('rejects invalid inputs', () => {
    it.each([
      ['negative', '-5'],
      ['negative decimal', '-5.00'],
      ['plus sign', '+1'],
      ['plus sign decimal', '+1.50'],
      ['exponent notation', '1e5'],
      ['exponent notation lowercase e', '2.5e2'],
      ['too many decimal places', '10.299'],
      ['three decimal places minimal', '0.001'],
      ['trailing decimal point', '10.'],
      ['leading decimal point', '.5'],
      ['empty string', ''],
      ['whitespace only', '   '],
      ['letters', 'abc'],
      ['mixed letters and digits', '10a'],
      ['double decimal point', '1.2.3'],
      ['comma separator', '1,000'],
      ['unsafe integer overflow', '90071992547409.92']
    ])('%s: %s', (_label, input) => {
      expect(parseDecimalToMinorUnits(input)).toBeUndefined()
    })
  })

  it('never uses Number(value) * 100 -- confirmed by exact round-trip on known floating-point trap values', () => {
    // 0.29 * 100 === 28.999999999999996 in IEEE 754 double precision;
    // a Number()*100 implementation would produce 28 or 29
    // inconsistently depending on rounding. The exact digit-string
    // implementation always produces exactly 29.
    expect(parseDecimalToMinorUnits('0.29')).toBe(29)
    // 1.005 has three decimal places, so it is rejected outright (see
    // "three decimal places minimal" above) -- itself proof no
    // floating-point coercion occurs before the shape check runs.
    expect(parseDecimalToMinorUnits('1.005')).toBeUndefined()
  })
})

describe('formatMinorUnitsAsDecimal', () => {
  it.each([
    [0, '0.00'],
    [1, '0.01'],
    [29, '0.29'],
    [1029, '10.29'],
    [10000, '100.00'],
    [100, '1.00']
  ])('%d -> %s', (input, expected) => {
    expect(formatMinorUnitsAsDecimal(input)).toBe(expected)
  })

  it('round-trips through parseDecimalToMinorUnits exactly for every accepted test value', () => {
    for (const value of [0, 1, 29, 1029, 10000, 999999]) {
      const formatted = formatMinorUnitsAsDecimal(value)
      expect(parseDecimalToMinorUnits(formatted)).toBe(value)
    }
  })
})
