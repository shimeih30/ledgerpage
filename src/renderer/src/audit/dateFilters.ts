function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function daysInMonth(year: number, month1Indexed: number): number {
  if (month1Indexed === 2 && isLeapYear(year)) {
    return 29
  }
  return DAYS_IN_MONTH[month1Indexed - 1]
}

export interface LocalCalendarDate {
  year: number
  /** 1-12, not the 0-indexed convention the Date constructor itself uses. */
  month: number
  day: number
}

/**
 * Parses a <input type="date"> value ("YYYY-MM-DD") into its explicit
 * year/month/day components, rejecting anything that isn't a real
 * calendar date — an out-of-range month, or a day beyond what that
 * month/year actually has (including leap-year February) — rather than
 * constructing a Date object and letting it silently roll an
 * impossible date like 2026-02-30 forward into March. Never uses the
 * Date constructor for this validation at all; the leap-year rule and
 * days-per-month table are both explicit here.
 *
 * In practice, a real <input type="date"> element's own value setter
 * already refuses to hold an impossible calendar-date string at all
 * (confirmed directly: setting .value to "2026-02-30" leaves the
 * element's value as "", both via direct property assignment and via
 * several attempted bypasses) — so this function's calendar-impossible
 * branch is defense in depth against that specific case, not something
 * reachable through this app's own date inputs today. It remains the
 * single source of truth for what counts as a valid local calendar
 * date, tested directly here independent of any particular input
 * element's own behavior.
 */
export function parseLocalCalendarDate(dateString: string): LocalCalendarDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString)
  if (!match) {
    return undefined
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (month < 1 || month > 12) {
    return undefined
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return undefined
  }
  return { year, month, day }
}

/**
 * Both of these use the Date constructor's local (multi-argument) form,
 * never an ISO string with a trailing Z — the Z suffix always means
 * UTC, which is exactly the bug being fixed here: a date input
 * represents the user's local calendar day, not a UTC one. The
 * multi-argument form interprets year/month/day/hour/... in whatever
 * timezone the renderer is actually running in, so the computed
 * boundary is correct regardless of which timezone that is.
 */
export function localStartOfDayMs(date: LocalCalendarDate): number {
  return new Date(date.year, date.month - 1, date.day, 0, 0, 0, 0).getTime()
}

export function localEndOfDayMs(date: LocalCalendarDate): number {
  return new Date(date.year, date.month - 1, date.day, 23, 59, 59, 999).getTime()
}

/**
 * The outcome of validating the two date fields together. `ok: false`
 * carries whichever specific error(s) apply — fromError/toError for an
 * individual field that isn't a real calendar date, or rangeError when
 * both are individually valid but From is after To. Never silently
 * drops an invalid date from the built filter; an invalid or
 * out-of-order date blocks the request entirely instead.
 */
export type DateFilterValidation =
  | { ok: true; fromOccurredAt?: number; toOccurredAt?: number }
  | { ok: false; fromError?: string; toError?: string; rangeError?: string }

export const INVALID_DATE_MESSAGE = 'Enter a valid date.'
export const RANGE_ERROR_MESSAGE = 'The From date must not be after the To date.'

export function validateDateFilters(fromDate: string, toDate: string): DateFilterValidation {
  let fromOccurredAt: number | undefined
  let toOccurredAt: number | undefined
  let fromError: string | undefined
  let toError: string | undefined

  if (fromDate) {
    const parsed = parseLocalCalendarDate(fromDate)
    if (!parsed) {
      fromError = INVALID_DATE_MESSAGE
    } else {
      fromOccurredAt = localStartOfDayMs(parsed)
    }
  }
  if (toDate) {
    const parsed = parseLocalCalendarDate(toDate)
    if (!parsed) {
      toError = INVALID_DATE_MESSAGE
    } else {
      toOccurredAt = localEndOfDayMs(parsed)
    }
  }

  if (fromError || toError) {
    return { ok: false, fromError, toError }
  }

  if (fromOccurredAt !== undefined && toOccurredAt !== undefined && fromOccurredAt > toOccurredAt) {
    return { ok: false, rangeError: RANGE_ERROR_MESSAGE }
  }

  return { ok: true, fromOccurredAt, toOccurredAt }
}
