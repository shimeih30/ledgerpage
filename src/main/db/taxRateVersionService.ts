import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { taxCodes, taxRateVersions } from './schema'
import {
  dateRangesOverlap,
  requireValidIsoCalendarDate,
  TaxValidationError,
  validateRatePpm,
  type DateRange
} from './validation/taxValidation'
import type { AppTransaction } from './dbTypes'
import type { TaxCategory } from './taxCodeService'

export class TaxRateVersionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaxRateVersionError'
  }
}

export class TaxRateOverlapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaxRateOverlapError'
  }
}

export interface TaxRateVersion {
  id: string
  taxCodeId: string
  ratePpm: number | null
  effectiveFrom: string
  effectiveTo: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateTaxRateVersionInput {
  taxCodeId: string
  ratePpm?: number | null
  effectiveFrom: string
  effectiveTo?: string | null
}

export interface UpdateTaxRateVersionInput {
  ratePpm?: number | null
  effectiveFrom?: string
  effectiveTo?: string | null
}

/**
 * Categories that require a numeric rate on every version. zero_rated
 * and exempt resolve to zero (via taxRateResolutionService) without one
 * — this cross-table rule (the category lives on tax_codes, the rate on
 * tax_rate_versions) cannot be a CHECK constraint, so it lives here.
 */
const CATEGORIES_REQUIRING_RATE: readonly TaxCategory[] = ['standard', 'other']

/**
 * tx must be an active, caller-controlled transaction — matching
 * numberingService's pattern exactly, for the same reason: the overlap
 * check and the write must never be allowed to diverge. Every function
 * in this module requires an AppTransaction, never the broader AppDb,
 * making it a compile-time error to call these outside a transaction.
 */

function requireTaxCode(tx: AppTransaction, taxCodeId: string): typeof taxCodes.$inferSelect {
  const row = tx.select().from(taxCodes).where(eq(taxCodes.id, taxCodeId)).get()
  if (!row) {
    throw new TaxRateVersionError(`No tax code exists with id "${taxCodeId}"`)
  }
  return row
}

/**
 * Validates `ratePpm` against `category` and returns the value that must
 * actually be stored — this is the single source of truth for the
 * category/rate consistency rule, applied identically on every create
 * and every update (including updates that don't touch ratePpm at all —
 * see updateTaxRateVersion, which always re-runs the *final* proposed
 * value through this function rather than trusting a previously-stored
 * value to still be valid).
 *
 * - standard / other (rate-bearing): a non-null, in-range integer is
 *   required; null/undefined is rejected.
 * - zero_rated / exempt: null is the canonical stored value. Omitting
 *   ratePpm, or supplying null, or supplying exactly 0, all normalize to
 *   null. Supplying any other non-zero value is rejected outright — a
 *   zero-rated code storing a non-zero rate would be contradictory data
 *   that resolution would otherwise have to silently ignore (it doesn't:
 *   see taxRateResolutionService's category-based zero override), so
 *   this is refused at the point of entry instead.
 */
function validateRateAgainstCategory(
  category: string,
  ratePpm: number | null | undefined
): number | null {
  const requiresRate = CATEGORIES_REQUIRING_RATE.includes(category as TaxCategory)

  if (requiresRate) {
    if (ratePpm === null || ratePpm === undefined) {
      throw new TaxValidationError(
        `ratePpm is required for category "${category}" (only zero_rated and exempt may omit it)`
      )
    }
    return validateRatePpm(ratePpm)
  }

  // zero_rated / exempt: null is canonical.
  if (ratePpm === null || ratePpm === undefined) {
    return null
  }
  if (ratePpm !== 0) {
    throw new TaxValidationError(
      `ratePpm must be 0 or omitted for category "${category}" (zero_rated/exempt resolve to zero; ` +
        `the canonical stored value is null); received ${ratePpm}`
    )
  }
  return null
}

function toRange(effectiveFrom: string, effectiveTo: string | null): DateRange {
  return { effectiveFrom, effectiveTo }
}

/**
 * Throws TaxRateOverlapError if `candidate` overlaps any existing version
 * of the same tax code, excluding `excludeVersionId` (used by updates so
 * a version never "overlaps itself"). Reads every existing version for
 * the tax code inside the caller's transaction — correct under
 * LedgerPage's single-connection, single-instance-lock concurrency model
 * (see numberingService.ts for the same reasoning) since nothing else
 * can write between this read and the caller's write within the same
 * transaction.
 */
function assertNoOverlap(
  tx: AppTransaction,
  taxCodeId: string,
  candidate: DateRange,
  excludeVersionId?: string
): void {
  const existingVersions = tx
    .select()
    .from(taxRateVersions)
    .where(eq(taxRateVersions.taxCodeId, taxCodeId))
    .all()

  for (const existing of existingVersions) {
    if (excludeVersionId && existing.id === excludeVersionId) {
      continue
    }
    if (dateRangesOverlap(candidate, toRange(existing.effectiveFrom, existing.effectiveTo))) {
      throw new TaxRateOverlapError(
        `Effective range ${candidate.effectiveFrom} to ${candidate.effectiveTo ?? 'open-ended'} ` +
          `overlaps existing version ${existing.id} (${existing.effectiveFrom} to ${existing.effectiveTo ?? 'open-ended'})`
      )
    }
  }
}

export function listTaxRateVersions(tx: AppTransaction, taxCodeId: string): TaxRateVersion[] {
  const rows = tx
    .select()
    .from(taxRateVersions)
    .where(eq(taxRateVersions.taxCodeId, taxCodeId))
    .all()
  return rows.map(toTaxRateVersion)
}

export function createTaxRateVersion(
  tx: AppTransaction,
  input: CreateTaxRateVersionInput,
  now: Date = new Date()
): TaxRateVersion {
  const taxCode = requireTaxCode(tx, input.taxCodeId)

  requireValidIsoCalendarDate(input.effectiveFrom, 'effectiveFrom')
  if (input.effectiveTo != null) {
    requireValidIsoCalendarDate(input.effectiveTo, 'effectiveTo')
    if (input.effectiveTo < input.effectiveFrom) {
      throw new TaxValidationError('effectiveTo must not precede effectiveFrom')
    }
  }

  const ratePpm = validateRateAgainstCategory(taxCode.category, input.ratePpm)
  const effectiveTo = input.effectiveTo ?? null

  assertNoOverlap(tx, input.taxCodeId, toRange(input.effectiveFrom, effectiveTo))

  const id = `tax_rate_version_${randomUUID()}`

  tx.insert(taxRateVersions)
    .values({
      id,
      taxCodeId: input.taxCodeId,
      ratePpm,
      effectiveFrom: input.effectiveFrom,
      effectiveTo,
      createdAt: now,
      updatedAt: now
    })
    .run()

  const created = tx.select().from(taxRateVersions).where(eq(taxRateVersions.id, id)).get()
  if (!created) {
    throw new TaxRateVersionError('Tax rate version was not persisted after creation')
  }
  return toTaxRateVersion(created)
}

export function updateTaxRateVersion(
  tx: AppTransaction,
  id: string,
  input: UpdateTaxRateVersionInput,
  now: Date = new Date()
): TaxRateVersion {
  const existing = tx.select().from(taxRateVersions).where(eq(taxRateVersions.id, id)).get()
  if (!existing) {
    throw new TaxRateVersionError(`No tax rate version exists with id "${id}"`)
  }

  const taxCode = requireTaxCode(tx, existing.taxCodeId)

  const nextEffectiveFrom = input.effectiveFrom ?? existing.effectiveFrom
  const nextEffectiveTo = input.effectiveTo !== undefined ? input.effectiveTo : existing.effectiveTo

  requireValidIsoCalendarDate(nextEffectiveFrom, 'effectiveFrom')
  if (nextEffectiveTo != null) {
    requireValidIsoCalendarDate(nextEffectiveTo, 'effectiveTo')
    if (nextEffectiveTo < nextEffectiveFrom) {
      throw new TaxValidationError('effectiveTo must not precede effectiveFrom')
    }
  }

  // The final value is always re-validated against the category, whether
  // or not this update actually touches ratePpm — this is what closes
  // the gap where a previously-stored value could otherwise be carried
  // forward without ever being checked again (e.g. if it were somehow
  // already inconsistent with the category, an update to only
  // effectiveFrom/effectiveTo would silently perpetuate that instead of
  // catching it).
  const proposedRatePpm = input.ratePpm !== undefined ? input.ratePpm : existing.ratePpm
  const nextRatePpm = validateRateAgainstCategory(taxCode.category, proposedRatePpm)

  assertNoOverlap(tx, existing.taxCodeId, toRange(nextEffectiveFrom, nextEffectiveTo), id)

  tx.update(taxRateVersions)
    .set({
      ratePpm: nextRatePpm,
      effectiveFrom: nextEffectiveFrom,
      effectiveTo: nextEffectiveTo,
      updatedAt: now
    })
    .where(eq(taxRateVersions.id, id))
    .run()

  const updated = tx.select().from(taxRateVersions).where(eq(taxRateVersions.id, id)).get()
  if (!updated) {
    throw new TaxRateVersionError('Tax rate version disappeared during update')
  }
  return toTaxRateVersion(updated)
}

function toTaxRateVersion(row: typeof taxRateVersions.$inferSelect): TaxRateVersion {
  return {
    id: row.id,
    taxCodeId: row.taxCodeId,
    ratePpm: row.ratePpm,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}
