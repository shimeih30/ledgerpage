import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { inventoryItems, inventoryLots, PRIMARY_COMPANY_ID, stockMovements } from './schema'
import { listConsumableLotsForInventoryItem } from './inventoryLotService'
import { requireApprovedReferenceType } from './validation/stockMovementValidation'
import { record, type AuditActor } from '../audit/auditService'
import type { AppDb } from './dbTypes'

export class FifoConsumptionServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FifoConsumptionServiceError'
  }
}

export interface ConsumeStockOverride {
  reason: string
}

export interface ConsumeStockInput {
  inventoryItemId: string
  quantityScaled: number
  referenceType: string
  referenceId?: string | null
  /**
   * Presence of this field means an override has been authorized by
   * the caller (the ipc/service layer above this function is
   * responsible for confirming the actor holds
   * inventory_lots.override before ever passing this) — it allows
   * drawing from quarantined and/or expired lots that would otherwise
   * be skipped. A reason is required whenever an override is used.
   */
  override?: ConsumeStockOverride | null
}

export interface LotAllocation {
  inventoryLotId: string
  internalLotNumber: string
  quantityConsumedScaled: number
  costMinor: number
  movementId: string
}

export interface ConsumeStockResult {
  totalQuantityConsumedScaled: number
  totalCostMinor: number
  lotAllocations: LotAllocation[]
}

function requireActiveInventoryItem(db: AppDb, inventoryItemId: string): void {
  const row = db
    .select({ isActive: inventoryItems.isActive })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, inventoryItemId))
    .get()
  if (!row) {
    throw new FifoConsumptionServiceError(`No inventory item exists with id "${inventoryItemId}"`)
  }
  if (!row.isActive) {
    throw new FifoConsumptionServiceError(
      `Inventory item "${inventoryItemId}" is not active; stock cannot be consumed against it`
    )
  }
}

function totalOutstandingReservedForLot(db: AppDb, inventoryLotId: string): number {
  const rows = db
    .select({ delta: stockMovements.reservedQuantityDeltaScaled })
    .from(stockMovements)
    .where(eq(stockMovements.inventoryLotId, inventoryLotId))
    .all()
  return rows.reduce((sum, r) => sum + r.delta, 0)
}

interface EligibleLot {
  id: string
  internalLotNumber: string
  quantityRemainingScaled: number
  costRemainingMinor: number
  usableQuantityScaled: number
}

function isLotExpired(expiryDate: Date | null, now: Date): boolean {
  return expiryDate !== null && expiryDate.getTime() < now.getTime()
}

/**
 * Determines the FIFO-ordered, override-filtered list of lots this
 * consumption is permitted to draw from: depleted and zero-remaining
 * lots are already excluded by listConsumableLotsForInventoryItem;
 * quarantined and expired lots are additionally skipped here unless an
 * override is present. "Usable" quantity per lot accounts for any
 * outstanding reservation against that lot, so consumption never eats
 * into stock already reserved for something else.
 */
function resolveEligibleLots(
  db: AppDb,
  inventoryItemId: string,
  now: Date,
  override: ConsumeStockOverride | null | undefined
): EligibleLot[] {
  const candidates = listConsumableLotsForInventoryItem(db, inventoryItemId)
  const eligible: EligibleLot[] = []
  for (const lot of candidates) {
    if (lot.lifecycleStatus === 'quarantined' && !override) {
      continue
    }
    if (isLotExpired(lot.expiryDate, now) && !override) {
      continue
    }
    const reserved = totalOutstandingReservedForLot(db, lot.id)
    const usable = lot.quantityRemainingScaled - reserved
    if (usable <= 0) {
      continue
    }
    eligible.push({
      id: lot.id,
      internalLotNumber: lot.internalLotNumber,
      quantityRemainingScaled: lot.quantityRemainingScaled,
      costRemainingMinor: lot.costRemainingMinor,
      usableQuantityScaled: usable
    })
  }
  return eligible
}

/**
 * Given an already-FIFO-ordered, override-filtered set of eligible
 * lots, allocates the requested quantity oldest-first, computing each
 * lot's cost contribution with exact integer arithmetic: a full
 * depletion of a lot consumes its entire costRemainingMinor exactly
 * (never a rounded proportional figure that could leave a stray
 * remainder); a partial draw computes
 * round(costRemainingMinor * quantityDrawn / quantityRemainingScaled)
 * — the same deliberate, singular currency-rounding step used
 * elsewhere in this codebase for proportional cost allocation (see
 * computeTotalCostMinor's own doc comment), never a floating-point
 * multiplication of a decimal string.
 */
function planAllocations(
  eligibleLots: EligibleLot[],
  requestedQuantityScaled: number
): { lotId: string; quantityScaled: number; costMinor: number }[] {
  const plan: { lotId: string; quantityScaled: number; costMinor: number }[] = []
  let remaining = requestedQuantityScaled

  for (const lot of eligibleLots) {
    if (remaining <= 0) {
      break
    }
    const drawFromThisLot = Math.min(remaining, lot.usableQuantityScaled)
    const isFullDepletion = drawFromThisLot === lot.quantityRemainingScaled
    const costMinor = isFullDepletion
      ? lot.costRemainingMinor
      : Math.round((lot.costRemainingMinor * drawFromThisLot) / lot.quantityRemainingScaled)
    plan.push({ lotId: lot.id, quantityScaled: drawFromThisLot, costMinor })
    remaining -= drawFromThisLot
  }

  return plan
}

/**
 * Given an item and a quantity, selects lots oldest-first
 * (receivedDate ASC, createdAt ASC, id ASC), returns the exact
 * lot/quantity/cost breakdown, and records one `consumption` movement
 * per lot drawn from — all inside a single transaction, so a request
 * that cannot be fully satisfied rolls back entirely rather than
 * partially consuming stock. Never mutates negative stock (backed by
 * the same negative-stock guard as every other movement-creating
 * function, plus the database's own CHECK constraints as a second line
 * of defense). Rejects expired/quarantined lots unless an authorized
 * override with a reason is supplied.
 */
export function consumeStock(
  db: AppDb,
  input: ConsumeStockInput,
  actor: AuditActor,
  now: Date = new Date()
): ConsumeStockResult {
  requireActiveInventoryItem(db, input.inventoryItemId)

  if (!(input.quantityScaled > 0)) {
    throw new FifoConsumptionServiceError('Requested consumption quantity must be positive')
  }

  if (input.override && input.override.reason.trim().length === 0) {
    throw new FifoConsumptionServiceError('An override requires a reason')
  }

  const referenceType = requireApprovedReferenceType(input.referenceType)

  const eligibleLots = resolveEligibleLots(db, input.inventoryItemId, now, input.override)
  const totalUsable = eligibleLots.reduce((sum, lot) => sum + lot.usableQuantityScaled, 0)
  if (totalUsable < input.quantityScaled) {
    throw new FifoConsumptionServiceError(
      `Cannot consume ${input.quantityScaled} of inventory item "${input.inventoryItemId}": only ${totalUsable} is available`
    )
  }

  const plan = planAllocations(eligibleLots, input.quantityScaled)

  const lotAllocations: LotAllocation[] = []

  db.transaction((tx) => {
    for (const step of plan) {
      const lot = eligibleLots.find((l) => l.id === step.lotId)
      if (!lot) {
        throw new FifoConsumptionServiceError('Internal error: planned lot not found')
      }
      const newQuantityRemaining = lot.quantityRemainingScaled - step.quantityScaled
      const newCostRemaining = lot.costRemainingMinor - step.costMinor
      if (newQuantityRemaining < 0 || newCostRemaining < 0) {
        throw new FifoConsumptionServiceError(
          `Consuming from lot "${lot.internalLotNumber}" would take it below zero, which is never permitted`
        )
      }

      const movementId = `stock_movement_${randomUUID()}`
      const newLifecycleStatus = newQuantityRemaining === 0 ? 'depleted' : undefined

      tx.update(inventoryLots)
        .set({
          quantityRemainingScaled: newQuantityRemaining,
          costRemainingMinor: newCostRemaining,
          ...(newLifecycleStatus ? { lifecycleStatus: newLifecycleStatus } : {}),
          updatedAt: now
        })
        .where(eq(inventoryLots.id, lot.id))
        .run()

      tx.insert(stockMovements)
        .values({
          id: movementId,
          companyId: PRIMARY_COMPANY_ID,
          inventoryLotId: lot.id,
          movementType: 'consumption',
          physicalQuantityDeltaScaled: -step.quantityScaled,
          reservedQuantityDeltaScaled: 0,
          costDeltaMinor: -step.costMinor,
          referenceType,
          referenceId: input.referenceId ?? null,
          reversedMovementId: null,
          reason: input.override ? input.override.reason.trim() : null,
          createdAt: now
        })
        .run()

      record(
        tx,
        {
          entityType: 'stock_movement',
          entityId: movementId,
          entityLabel: lot.internalLotNumber,
          action: 'create',
          actor,
          companyId: PRIMARY_COMPANY_ID,
          before: null,
          after: {
            inventoryLotId: lot.id,
            movementType: 'consumption',
            physicalQuantityDeltaScaled: -step.quantityScaled,
            costDeltaMinor: -step.costMinor,
            referenceType,
            referenceId: input.referenceId ?? null
          }
        },
        now
      )

      lotAllocations.push({
        inventoryLotId: lot.id,
        internalLotNumber: lot.internalLotNumber,
        quantityConsumedScaled: step.quantityScaled,
        costMinor: step.costMinor,
        movementId
      })
    }
  })

  return {
    totalQuantityConsumedScaled: lotAllocations.reduce(
      (sum, a) => sum + a.quantityConsumedScaled,
      0
    ),
    totalCostMinor: lotAllocations.reduce((sum, a) => sum + a.costMinor, 0),
    lotAllocations
  }
}
