import { PRODUCT_TYPES } from '../schema'

export class ProductValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductValidationError'
  }
}

export type ProductType = (typeof PRODUCT_TYPES)[number]

export function isApprovedProductType(value: string): value is ProductType {
  return (PRODUCT_TYPES as readonly string[]).includes(value)
}

export function requireValidProductType(value: string): ProductType {
  if (!isApprovedProductType(value)) {
    throw new ProductValidationError(
      `type must be one of ${PRODUCT_TYPES.join(', ')}; received "${value}"`
    )
  }
  return value
}

export function requireTrimmedProductName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new ProductValidationError('name must not be empty')
  }
  return trimmed
}

export function requireTrimmedVariantName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new ProductValidationError('name must not be empty')
  }
  return trimmed
}

/**
 * Normalizes a variant code to its stored/compared form: trimmed and
 * upper-cased, matching normalizeTaxCode's established convention for
 * "code"-like fields elsewhere in this codebase — "100ml", " 100ML ",
 * and "100ML" all normalize to the same stored value, so they can never
 * silently coexist as distinct rows within the same product.
 */
export function normalizeVariantCode(code: string): string {
  const trimmed = code.trim()
  if (trimmed.length === 0) {
    throw new ProductValidationError('code must not be empty')
  }
  return trimmed.toUpperCase()
}

/**
 * Trims a barcode and normalizes an empty result to null — the decision
 * explicitly approved for this slice, so "" and "   " are never stored
 * as a distinct, accidentally-colliding empty-string value alongside a
 * genuine null.
 */
export function normalizeBarcode(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

export function requireNonNegativeIntegerMinorAmount(value: number, fieldLabel: string): number {
  if (!Number.isInteger(value)) {
    throw new ProductValidationError(
      `${fieldLabel} must be an integer number of minor currency units, received ${String(value)}`
    )
  }
  if (value < 0) {
    throw new ProductValidationError(
      `${fieldLabel} must not be negative, received ${String(value)}`
    )
  }
  return value
}

export function requireNonNegativeIntegerStockLevel(value: number, fieldLabel: string): number {
  if (!Number.isInteger(value)) {
    throw new ProductValidationError(
      `${fieldLabel} must be a non-negative integer, received ${String(value)}`
    )
  }
  if (value < 0) {
    throw new ProductValidationError(
      `${fieldLabel} must not be negative, received ${String(value)}`
    )
  }
  return value
}
