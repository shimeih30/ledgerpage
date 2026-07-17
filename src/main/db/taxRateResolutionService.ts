import { and, eq, gte, isNull, lte, or } from 'drizzle-orm'
import { PRIMARY_COMPANY_ID, taxCodes, taxRateVersions } from './schema'
import { normalizeTaxCode, requireValidIsoCalendarDate } from './validation/taxValidation'
import type { AppDb } from './dbTypes'
import type { TaxCategory } from './taxCodeService'

export class TaxResolutionAmbiguousError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaxResolutionAmbiguousError'
  }
}

/**
 * Thrown when a rate-bearing category's (standard/other) matched version
 * has a null rate_ppm — this should be impossible given
 * taxRateVersionService's category/rate validation (every create and
 * update runs the final proposed value through the same canonical check),
 * so encountering it here means the data was corrupted by some other
 * path (direct SQL, a bug, manual DB editing). Resolution never silently
 * substitutes zero for missing rate-bearing data; that would understate
 * tax on every transaction using this code until the corruption was
 * separately noticed.
 */
export class TaxResolutionIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaxResolutionIntegrityError'
  }
}

export interface TaxResolutionResult {
  taxCodeId: string
  taxCode: string
  category: TaxCategory
  ratePpm: number
  effectiveFrom: string
  effectiveTo: string | null
}

export type TaxCodeIdentity = { taxCodeId: string } | { code: string }

const ZERO_RATE_CATEGORIES: readonly TaxCategory[] = ['zero_rated', 'exempt']

/**
 * Resolves the tax rate in effect for `transactionDate` (an ISO
 * YYYY-MM-DD calendar date — validated strictly, never parsed via
 * `new Date()`).
 *
 * Read-only: never opens a transaction, never writes anything, and
 * calling it any number of times with the same inputs is guaranteed to
 * return the same result until a new rate version is actually created —
 * "resolving historical transactions must not mutate data" is true by
 * construction here, not just by convention.
 *
 * `{ code }` is normalized with the same normalizeTaxCode function
 * taxCodeService uses (imported, not reimplemented) — "vat15",
 * " VAT15 ", and "VAT15" all resolve identically, and a whitespace-only
 * code is rejected by that same function's existing validation error.
 * Both lookup paths — by id and by normalized code — are scoped to
 * PRIMARY_COMPANY_ID; the id-based path is scoped defensively (there is
 * only one company, so this changes nothing observable today, but it
 * keeps this function from ever resolving a row it has no business
 * seeing if that assumption changes later).
 *
 * Deactivating a tax code (taxCodeService.deactivateTaxCode) does NOT
 * affect resolution: this function resolves purely from the tax code's
 * identity and its rate versions' effective dates, regardless of
 * is_active. This is deliberate — a historical report covering a period
 * when a since-retired tax code was active must still resolve its rate
 * correctly; hiding a deactivated code's history would corrupt that
 * report. (A future slice may choose to block *creating new
 * transactions* against an inactive code — that is a different concern
 * from resolving what rate applied in the past, and is out of scope
 * here.)
 *
 * A tax code with no rate version at all covering the given date
 * returns undefined — the documented not-found result — for every
 * category, including zero_rated/exempt. "Zero-rated and exempt codes
 * resolve to zero without requiring a numeric stored rate" (the
 * approved requirement) means their rate version's rate_ppm column may
 * be NULL, not that the version itself is optional: a zero-rated code
 * still needs a version row establishing *when* it was effective, the
 * same as any other category. When a version does match, its resolved
 * ratePpm is forced to 0 for zero_rated/exempt regardless of whatever
 * (if anything) is stored in that version's rate_ppm.
 *
 * For standard/other, a matched version's rate_ppm must be a non-null
 * integer — see TaxResolutionIntegrityError above. There is no fallback
 * to zero for these categories.
 *
 * Throws TaxResolutionAmbiguousError if more than one version matches,
 * which should be impossible given taxRateVersionService's overlap
 * prevention; treated as a data-integrity error rather than silently
 * picking one, per the explicit "do not fall back silently to the
 * newest rate" requirement.
 */
export function resolveTaxRate(
  db: AppDb,
  identity: TaxCodeIdentity,
  transactionDate: string
): TaxResolutionResult | undefined {
  requireValidIsoCalendarDate(transactionDate, 'transactionDate')

  const taxCode =
    'taxCodeId' in identity
      ? db
          .select()
          .from(taxCodes)
          .where(
            and(eq(taxCodes.companyId, PRIMARY_COMPANY_ID), eq(taxCodes.id, identity.taxCodeId))
          )
          .get()
      : db
          .select()
          .from(taxCodes)
          .where(
            and(
              eq(taxCodes.companyId, PRIMARY_COMPANY_ID),
              eq(taxCodes.code, normalizeTaxCode(identity.code))
            )
          )
          .get()

  if (!taxCode) {
    return undefined
  }

  const matches = db
    .select()
    .from(taxRateVersions)
    .where(
      and(
        eq(taxRateVersions.taxCodeId, taxCode.id),
        lte(taxRateVersions.effectiveFrom, transactionDate),
        or(isNull(taxRateVersions.effectiveTo), gte(taxRateVersions.effectiveTo, transactionDate))
      )
    )
    .all()

  if (matches.length > 1) {
    throw new TaxResolutionAmbiguousError(
      `${matches.length} rate versions match tax code "${taxCode.code}" on ${transactionDate} — ` +
        'this indicates corrupted overlap data, since creation-time validation should prevent it'
    )
  }

  if (matches.length === 0) {
    return undefined
  }

  const version = matches[0]
  const category = taxCode.category as TaxCategory
  const isZeroCategory = ZERO_RATE_CATEGORIES.includes(category)

  let ratePpm: number
  if (isZeroCategory) {
    ratePpm = 0
  } else if (version.ratePpm === null) {
    throw new TaxResolutionIntegrityError(
      `Tax rate version "${version.id}" for rate-bearing category "${category}" (tax code ` +
        `"${taxCode.code}") has a null rate_ppm on ${transactionDate} — this indicates corrupted ` +
        'data; resolution never substitutes zero for a missing rate-bearing rate'
    )
  } else {
    ratePpm = version.ratePpm
  }

  return {
    taxCodeId: taxCode.id,
    taxCode: taxCode.code,
    category,
    ratePpm,
    effectiveFrom: version.effectiveFrom,
    effectiveTo: version.effectiveTo
  }
}
