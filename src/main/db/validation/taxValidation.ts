export class TaxValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaxValidationError'
  }
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * Strictly validates an ISO 8601 calendar date string (YYYY-MM-DD).
 *
 * Deliberately does not use `new Date(string)` anywhere: verified
 * empirically that JS's Date parser silently rolls an invalid calendar
 * date forward instead of rejecting it (e.g. `new Date('2026-02-30')`
 * becomes 2026-03-02, and `new Date('2026-02-29')` in a non-leap year
 * becomes 2026-03-01). This function parses the string by hand and
 * checks month range (1-12) and day range against the actual days in
 * that specific month/year, including leap years.
 */
export function isValidIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return false
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (month < 1 || month > 12) {
    return false
  }

  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]
  if (day < 1 || day > maxDay) {
    return false
  }

  return true
}

export function requireValidIsoCalendarDate(value: string, fieldLabel: string): string {
  if (!isValidIsoCalendarDate(value)) {
    throw new TaxValidationError(
      `${fieldLabel} must be a valid ISO calendar date (YYYY-MM-DD): "${value}"`
    )
  }
  return value
}

/**
 * Converts a percentage to the exact integer parts-per-million
 * representation stored in tax_rate_versions.rate_ppm.
 *
 * ppm = percent * 10,000 — exact for any percentage with up to 4 decimal
 * places (e.g. 15% -> 150000, 14.975% -> 149750). Never a float: the
 * multiplication and rounding happen once, here, at the boundary where a
 * human-entered percentage becomes a stored integer; every other layer
 * of the application only ever sees the integer.
 */
export function ppmFromPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    throw new TaxValidationError(`percent must be a finite number, received ${String(percent)}`)
  }
  return Math.round(percent * 10000)
}

/** The inverse of ppmFromPercent, for display purposes. */
export function percentFromPpm(ratePpm: number): number {
  return ratePpm / 10000
}

const MAX_RATE_PPM = 5000000

export function validateRatePpm(value: number, fieldLabel = 'ratePpm'): number {
  if (!Number.isInteger(value)) {
    throw new TaxValidationError(
      `${fieldLabel} must be an integer number of parts per million, received ${String(value)}`
    )
  }
  if (value < 0) {
    throw new TaxValidationError(`${fieldLabel} must not be negative, received ${String(value)}`)
  }
  if (value > MAX_RATE_PPM) {
    throw new TaxValidationError(
      `${fieldLabel} must not exceed ${MAX_RATE_PPM} (500%), received ${String(value)}`
    )
  }
  return value
}

/**
 * Normalizes a tax code to its stored form: trimmed and upper-cased,
 * matching the convention already used for currency codes elsewhere in
 * this codebase. "vat15", " VAT15 ", and "VAT15" all normalize to the
 * same stored/compared value.
 */
export function normalizeTaxCode(code: string): string {
  const trimmed = code.trim()
  if (trimmed.length === 0) {
    throw new TaxValidationError('code must not be empty')
  }
  return trimmed.toUpperCase()
}

export function requireTrimmedTaxName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new TaxValidationError('name must not be empty')
  }
  return trimmed
}

/**
 * A sentinel used only for open-ended-range comparison — never stored,
 * never returned, never compared against anything but another date
 * string. Chosen far enough in the future to exceed any real effective
 * date while still sorting correctly as a plain ISO-shaped string.
 */
const OPEN_ENDED_SENTINEL = '9999-12-31'

export interface DateRange {
  effectiveFrom: string
  effectiveTo: string | null
}

/**
 * True if two date ranges share at least one calendar date. Both
 * endpoints are inclusive on both ranges (the approved convention for
 * this slice): a range ending 2026-06-30 and a range starting
 * 2026-07-01 do not overlap; a range ending 2026-06-30 and a range
 * starting 2026-06-30 do.
 *
 * Pure string comparison throughout — no Date object is ever
 * constructed — which is exactly what keeps this immune to the
 * machine's local timezone.
 */
export function dateRangesOverlap(a: DateRange, b: DateRange): boolean {
  const aTo = a.effectiveTo ?? OPEN_ENDED_SENTINEL
  const bTo = b.effectiveTo ?? OPEN_ENDED_SENTINEL
  return a.effectiveFrom <= bTo && b.effectiveFrom <= aTo
}
