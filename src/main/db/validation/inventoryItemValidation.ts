import { INVENTORY_ITEM_TYPES } from '../schema'

export class InventoryItemValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InventoryItemValidationError'
  }
}

export type InventoryItemType = (typeof INVENTORY_ITEM_TYPES)[number]

export function isApprovedInventoryItemType(value: string): value is InventoryItemType {
  return (INVENTORY_ITEM_TYPES as readonly string[]).includes(value)
}

export function requireValidInventoryItemType(value: string): InventoryItemType {
  if (!isApprovedInventoryItemType(value)) {
    throw new InventoryItemValidationError(
      `itemType must be one of ${INVENTORY_ITEM_TYPES.join(', ')}; received "${value}"`
    )
  }
  return value
}

export function requireTrimmedInventoryItemName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new InventoryItemValidationError('name must not be empty')
  }
  return trimmed
}

export function requireTrimmedInventoryItemCategory(category: string): string {
  const trimmed = category.trim()
  if (trimmed.length === 0) {
    throw new InventoryItemValidationError('category must not be empty')
  }
  return trimmed
}

/**
 * Normalizes an inventory item code to its stored/compared form: trimmed
 * and upper-cased, matching normalizeVariantCode's established
 * convention for "code"-like fields elsewhere in this codebase — approved
 * decision for this slice: no numbering rule is added, so this is
 * ordinary user-entered input, immutable after creation (enforced in
 * inventoryItemService.ts, where UpdateInventoryItemInput has no code
 * field at all — a structural guarantee, not merely a runtime-rejected
 * one).
 */
export function normalizeInventoryItemCode(code: string): string {
  const trimmed = code.trim()
  if (trimmed.length === 0) {
    throw new InventoryItemValidationError('code must not be empty')
  }
  return trimmed.toUpperCase()
}

/**
 * Strict non-negative integer validation for minimum_stock,
 * reorder_quantity, and lead_time_days — rejects decimals, negative
 * values, NaN, Infinity, and unsafe integers explicitly (not merely
 * relying on `value < 0` or `Number.isInteger` alone, since NaN and
 * Infinity both fail `Number.isInteger` already, but this makes each
 * failure mode an explicit, separately-reasoned check rather than an
 * incidental side effect of a single condition).
 */
export function requireNonNegativeIntegerQuantity(value: number, fieldLabel: string): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new InventoryItemValidationError(
      `${fieldLabel} must be a finite number, received ${String(value)}`
    )
  }
  if (!Number.isInteger(value)) {
    throw new InventoryItemValidationError(
      `${fieldLabel} must be an integer, received ${String(value)}`
    )
  }
  if (!Number.isSafeInteger(value)) {
    throw new InventoryItemValidationError(`${fieldLabel} must be a safe integer`)
  }
  if (value < 0) {
    throw new InventoryItemValidationError(
      `${fieldLabel} must not be negative, received ${String(value)}`
    )
  }
  return value
}

/**
 * Same strictness as requireNonNegativeIntegerQuantity, but for the
 * nullable maximum_stock field: null/undefined pass through unchanged
 * (meaning "no maximum set"), anything else is validated with the same
 * non-negative-integer rule. The maximum_stock >= minimum_stock
 * cross-field rule is enforced separately, by the caller, once both
 * values are already known to individually be valid non-negative
 * integers.
 */
export function requireNullableNonNegativeIntegerQuantity(
  value: number | null | undefined,
  fieldLabel: string
): number | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireNonNegativeIntegerQuantity(value, fieldLabel)
}

export function requireMaximumStockAtLeastMinimumStock(
  maximumStock: number | null,
  minimumStock: number
): void {
  if (maximumStock !== null && maximumStock < minimumStock) {
    throw new InventoryItemValidationError(
      `maximumStock (${maximumStock}) must be greater than or equal to minimumStock (${minimumStock})`
    )
  }
}
