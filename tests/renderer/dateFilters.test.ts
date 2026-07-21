import { describe, expect, it } from 'vitest'
import {
  INVALID_DATE_MESSAGE,
  RANGE_ERROR_MESSAGE,
  parseLocalCalendarDate,
  validateDateFilters
} from '../../src/renderer/src/audit/dateFilters'

describe('parseLocalCalendarDate', () => {
  it('parses a well-formed calendar date', () => {
    expect(parseLocalCalendarDate('2026-01-15')).toEqual({ year: 2026, month: 1, day: 15 })
  })

  it('rejects a malformed string that is not YYYY-MM-DD shaped', () => {
    expect(parseLocalCalendarDate('not-a-date')).toBeUndefined()
    expect(parseLocalCalendarDate('2026/01/15')).toBeUndefined()
    expect(parseLocalCalendarDate('2026-1-15')).toBeUndefined()
    expect(parseLocalCalendarDate('')).toBeUndefined()
  })

  it('rejects an impossible calendar date (Feb 30) rather than letting it roll over into March', () => {
    expect(parseLocalCalendarDate('2026-02-30')).toBeUndefined()
  })

  it('rejects an out-of-range month rather than letting it roll over into a later year', () => {
    expect(parseLocalCalendarDate('2026-13-01')).toBeUndefined()
    expect(parseLocalCalendarDate('2026-00-01')).toBeUndefined()
  })

  it('rejects day 0 and a day beyond a 30-day month', () => {
    expect(parseLocalCalendarDate('2026-04-00')).toBeUndefined()
    expect(parseLocalCalendarDate('2026-04-31')).toBeUndefined()
  })

  it('correctly recognizes Feb 29 as valid in a leap year', () => {
    expect(parseLocalCalendarDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 })
  })

  it('correctly rejects Feb 29 as invalid in a non-leap year', () => {
    expect(parseLocalCalendarDate('2026-02-29')).toBeUndefined()
  })

  it('correctly handles the century leap-year exception (2000 is a leap year, 2100 is not)', () => {
    expect(parseLocalCalendarDate('2000-02-29')).toEqual({ year: 2000, month: 2, day: 29 })
    expect(parseLocalCalendarDate('2100-02-29')).toBeUndefined()
  })
})

describe('validateDateFilters', () => {
  it('both empty is valid, with no boundaries computed', () => {
    expect(validateDateFilters('', '')).toEqual({
      ok: true,
      fromOccurredAt: undefined,
      toOccurredAt: undefined
    })
  })

  it('an impossible From date fails with fromError, and never computes a boundary for either field', () => {
    const result = validateDateFilters('2026-02-30', '')
    expect(result).toEqual({ ok: false, fromError: INVALID_DATE_MESSAGE, toError: undefined })
  })

  it('an impossible To date fails with toError, and never computes a boundary for either field', () => {
    const result = validateDateFilters('', '2026-02-30')
    expect(result).toEqual({ ok: false, fromError: undefined, toError: INVALID_DATE_MESSAGE })
  })

  it('both individually invalid reports both field errors at once', () => {
    const result = validateDateFilters('2026-02-30', '2026-13-01')
    expect(result).toEqual({
      ok: false,
      fromError: INVALID_DATE_MESSAGE,
      toError: INVALID_DATE_MESSAGE
    })
  })

  it('two valid dates in order succeed, with correct local start/end-of-day boundaries', () => {
    const result = validateDateFilters('2026-01-15', '2026-01-20')
    expect(result).toEqual({
      ok: true,
      fromOccurredAt: new Date(2026, 0, 15, 0, 0, 0, 0).getTime(),
      toOccurredAt: new Date(2026, 0, 20, 23, 59, 59, 999).getTime()
    })
  })

  it('two valid dates with From after To fails with a range error, not a field error', () => {
    const result = validateDateFilters('2026-01-20', '2026-01-15')
    expect(result).toEqual({ ok: false, rangeError: RANGE_ERROR_MESSAGE })
  })

  it('the same date for From and To is a valid, zero-width range', () => {
    const result = validateDateFilters('2026-01-15', '2026-01-15')
    expect(result.ok).toBe(true)
  })
})
