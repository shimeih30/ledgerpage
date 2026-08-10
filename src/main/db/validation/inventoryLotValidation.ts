export class InventoryLotValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InventoryLotValidationError'
  }
}

/**
 * A lot's supplier lot number is optional, trimmed, blank-becomes-null
 * -- matching this codebase's established convention for optional text
 * fields.
 */
export function normalizeSupplierLotNumber(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * Expiry is required exactly when the parent inventory item has
 * expiryTracked=true, and must be omitted (not merely ignored) when
 * false -- approved decision. A provided-but-not-applicable expiry
 * date is rejected outright rather than silently dropped, since
 * silently discarding caller input could mask a caller's mistaken
 * assumption about which items are expiry-tracked.
 */
export function requireExpiryDateMatchingItemTracking(
  expiryDate: Date | null | undefined,
  expiryTracked: boolean
): Date | null {
  if (expiryTracked) {
    if (expiryDate === null || expiryDate === undefined) {
      throw new InventoryLotValidationError(
        'expiryDate is required because this inventory item has expiryTracked=true'
      )
    }
    if (Number.isNaN(expiryDate.getTime())) {
      throw new InventoryLotValidationError('expiryDate must be a valid date')
    }
    return expiryDate
  }
  if (expiryDate !== null && expiryDate !== undefined) {
    throw new InventoryLotValidationError(
      'expiryDate must not be provided because this inventory item has expiryTracked=false'
    )
  }
  return null
}

export function requireValidReceivedDate(value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new InventoryLotValidationError('receivedDate must be a valid date')
  }
  return value
}

/**
 * unitCostMinor is a non-negative safe integer -- the same strictness
 * posture as every other money-bearing field in this codebase. Zero is
 * a valid (if unusual) cost; negative and non-integer values are not.
 */
export function requireNonNegativeUnitCostMinor(value: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new InventoryLotValidationError(
      `unitCostMinor must be a finite number, received ${String(value)}`
    )
  }
  if (!Number.isInteger(value)) {
    throw new InventoryLotValidationError(
      `unitCostMinor must be an integer, received ${String(value)}`
    )
  }
  if (!Number.isSafeInteger(value)) {
    throw new InventoryLotValidationError('unitCostMinor must be a safe integer')
  }
  if (value < 0) {
    throw new InventoryLotValidationError(
      `unitCostMinor must not be negative, received ${String(value)}`
    )
  }
  return value
}

/**
 * Computes a lot's total cost from its unit cost (cost per one whole
 * base unit, in integer minor currency units) and its scaled received
 * quantity, using exact integer multiply-then-divide (never
 * divide-then-multiply, to minimize intermediate error) — e.g.
 * unitCostMinor=350 ($3.50/kg), quantityReceivedScaled=20000 (20.000 kg
 * at scale 1000) => 350 * 20000 / 1000 = 7000 ($70.00), matching the
 * worked acceptance example exactly. The product of two safe integers
 * divided by a power-of-ten scale is not always itself an integer, so
 * a single, deliberate Math.round is applied here as the currency-
 * rounding step — this is fundamentally different from the
 * floating-point-multiplication-of-a-decimal-string bug this codebase
 * avoids elsewhere (e.g. `Number("0.29") * 100`), since both operands
 * here are already exact integers and this is a proportional
 * allocation, not a decimal-string parse.
 */
export function computeTotalCostMinor(
  unitCostMinor: number,
  quantityReceivedScaled: number,
  quantityScale: number
): number {
  return Math.round((unitCostMinor * quantityReceivedScaled) / quantityScale)
}
