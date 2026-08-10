import { STOCK_MOVEMENT_REFERENCE_TYPES, STOCK_MOVEMENT_TYPES } from '../schema'

export class StockMovementValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StockMovementValidationError'
  }
}

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number]
export type StockMovementReferenceType = (typeof STOCK_MOVEMENT_REFERENCE_TYPES)[number]

export function isApprovedMovementType(value: string): value is StockMovementType {
  return (STOCK_MOVEMENT_TYPES as readonly string[]).includes(value)
}

export function isApprovedReferenceType(value: string): value is StockMovementReferenceType {
  return (STOCK_MOVEMENT_REFERENCE_TYPES as readonly string[]).includes(value)
}

export function requireApprovedReferenceType(value: string): StockMovementReferenceType {
  if (!isApprovedReferenceType(value)) {
    throw new StockMovementValidationError(
      `referenceType must be one of ${STOCK_MOVEMENT_REFERENCE_TYPES.join(', ')}; received "${value}"`
    )
  }
  return value
}

/**
 * A reason is required for adjustment and reversal movements
 * specifically (approved decision) — distinguishing a deliberate
 * correction from an automated receipt/consumption/reservation, which
 * carry their own reference instead. Blank (post-trim) is treated as
 * absent, not a valid reason.
 */
export function requireReasonForAdjustmentOrReversal(reason: string | null | undefined): string {
  const trimmed = (reason ?? '').trim()
  if (trimmed.length === 0) {
    throw new StockMovementValidationError('reason is required for this movement type')
  }
  return trimmed
}

/**
 * A stable reference (referenceType + referenceId) is required for
 * reservations, so a later release can be matched back to the exact
 * reservation it is releasing.
 */
export function requireStableReference(
  referenceType: string,
  referenceId: string | null | undefined
): { referenceType: StockMovementReferenceType; referenceId: string } {
  const approvedType = requireApprovedReferenceType(referenceType)
  const trimmedId = (referenceId ?? '').trim()
  if (trimmedId.length === 0) {
    throw new StockMovementValidationError('referenceId is required for a reservation')
  }
  return { referenceType: approvedType, referenceId: trimmedId }
}
