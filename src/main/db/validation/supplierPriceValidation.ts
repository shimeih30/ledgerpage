export class SupplierPriceValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupplierPriceValidationError'
  }
}

/**
 * Same strictness posture as inventoryItemService's
 * requireNonNegativeIntegerQuantity -- a dedicated copy for this
 * domain, matching this codebase's established one-copy-per-domain
 * convention for validation helpers, rather than a cross-domain import.
 * Rejects non-numbers, NaN, Infinity, non-integers, and unsafe
 * integers as separately-reasoned checks.
 */
export function requireNonNegativeSafeIntegerPrice(value: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new SupplierPriceValidationError(
      `priceMinor must be a finite number, received ${String(value)}`
    )
  }
  if (!Number.isInteger(value)) {
    throw new SupplierPriceValidationError(
      `priceMinor must be an integer, received ${String(value)}`
    )
  }
  if (!Number.isSafeInteger(value)) {
    throw new SupplierPriceValidationError('priceMinor must be a safe integer')
  }
  if (value < 0) {
    throw new SupplierPriceValidationError(
      `priceMinor must not be negative, received ${String(value)}`
    )
  }
  return value
}

/**
 * supplierItemCode is nullable, trimmed, and a blank (post-trim) value
 * normalizes to null -- matching contactDetails' own "blank becomes
 * null" convention. Represents the supplier's own SKU/reference for
 * this item at the time this specific price was recorded; historical
 * rows preserve whatever value (or null) was given at insertion time,
 * since this table is append-only and never updated.
 */
export function normalizeSupplierItemCode(
  supplierItemCode: string | null | undefined
): string | null {
  if (supplierItemCode === null || supplierItemCode === undefined) {
    return null
  }
  const trimmed = supplierItemCode.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * effectiveFrom accepts any valid past, present, or future timestamp --
 * approved decision: no restriction on backdating or scheduling ahead.
 * Only rejects a genuinely invalid Date (e.g. constructed from garbage
 * input upstream).
 */
export function requireValidEffectiveFrom(value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new SupplierPriceValidationError('effectiveFrom must be a valid date')
  }
  return value
}
