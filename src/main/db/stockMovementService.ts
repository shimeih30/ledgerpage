import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { inventoryLots, PRIMARY_COMPANY_ID, stockMovements } from './schema'
import {
  requireApprovedReferenceType,
  requireReasonForAdjustmentOrReversal,
  requireStableReference,
  type StockMovementReferenceType,
  type StockMovementType
} from './validation/stockMovementValidation'
import { record, type AuditActor } from '../audit/auditService'
import type { AppDb } from './dbTypes'

export class StockMovementServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StockMovementServiceError'
  }
}

export interface StockMovement {
  id: string
  companyId: string
  inventoryLotId: string
  movementType: StockMovementType
  physicalQuantityDeltaScaled: number
  reservedQuantityDeltaScaled: number
  costDeltaMinor: number
  referenceType: StockMovementReferenceType
  referenceId: string | null
  reversedMovementId: string | null
  reason: string | null
  createdAt: Date
}

function toStockMovement(row: typeof stockMovements.$inferSelect): StockMovement {
  return {
    id: row.id,
    companyId: row.companyId,
    inventoryLotId: row.inventoryLotId,
    movementType: row.movementType as StockMovementType,
    physicalQuantityDeltaScaled: row.physicalQuantityDeltaScaled,
    reservedQuantityDeltaScaled: row.reservedQuantityDeltaScaled,
    costDeltaMinor: row.costDeltaMinor,
    referenceType: row.referenceType as StockMovementReferenceType,
    referenceId: row.referenceId,
    reversedMovementId: row.reversedMovementId,
    reason: row.reason,
    createdAt: row.createdAt
  }
}

export function listMovementsForLot(db: AppDb, inventoryLotId: string): StockMovement[] {
  const rows = db
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.inventoryLotId, inventoryLotId))
    .orderBy(asc(stockMovements.createdAt), asc(stockMovements.id))
    .all()
  return rows.map(toStockMovement)
}

function getMovementById(db: AppDb, id: string): StockMovement | undefined {
  const row = db.select().from(stockMovements).where(eq(stockMovements.id, id)).get()
  return row ? toStockMovement(row) : undefined
}

interface LoadedLot {
  id: string
  inventoryItemId: string
  quantityRemainingScaled: number
  costRemainingMinor: number
  totalCostMinor: number
  lifecycleStatus: string
  internalLotNumber: string
}

/**
 * Loads a lot's own current state — queried directly here (not via
 * inventoryLotService.ts's own exports) to avoid a circular module
 * dependency between the two services, matching this codebase's
 * established pattern of a child service querying a parent table
 * directly (e.g. customerContactService.ts's own
 * requireActiveParentCustomer).
 */
function loadLotForMutation(db: AppDb, inventoryLotId: string): LoadedLot {
  const row = db
    .select({
      id: inventoryLots.id,
      inventoryItemId: inventoryLots.inventoryItemId,
      quantityRemainingScaled: inventoryLots.quantityRemainingScaled,
      costRemainingMinor: inventoryLots.costRemainingMinor,
      totalCostMinor: inventoryLots.totalCostMinor,
      lifecycleStatus: inventoryLots.lifecycleStatus,
      internalLotNumber: inventoryLots.internalLotNumber
    })
    .from(inventoryLots)
    .where(eq(inventoryLots.id, inventoryLotId))
    .get()
  if (!row) {
    throw new StockMovementServiceError(`No inventory lot exists with id "${inventoryLotId}"`)
  }
  return row
}

/**
 * Sums every reservation/release delta recorded against this exact lot
 * for a given stable reference — the "outstanding reservation" amount
 * that a release cannot exceed.
 */
function outstandingReservedForReference(
  db: AppDb,
  inventoryLotId: string,
  referenceType: string,
  referenceId: string
): number {
  const rows = db
    .select({ delta: stockMovements.reservedQuantityDeltaScaled })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.inventoryLotId, inventoryLotId),
        eq(stockMovements.referenceType, referenceType),
        eq(stockMovements.referenceId, referenceId)
      )
    )
    .all()
  return rows.reduce((sum, r) => sum + r.delta, 0)
}

/**
 * Total reserved quantity currently outstanding against a lot, across
 * every reference — what a new reservation's "cannot exceed usable
 * physical quantity" check is measured against.
 */
function totalOutstandingReservedForLot(db: AppDb, inventoryLotId: string): number {
  const rows = db
    .select({ delta: stockMovements.reservedQuantityDeltaScaled })
    .from(stockMovements)
    .where(eq(stockMovements.inventoryLotId, inventoryLotId))
    .all()
  return rows.reduce((sum, r) => sum + r.delta, 0)
}

interface InsertMovementArgs {
  lot: LoadedLot
  movementType: StockMovementType
  physicalQuantityDeltaScaled: number
  reservedQuantityDeltaScaled: number
  costDeltaMinor: number
  referenceType: StockMovementReferenceType
  referenceId: string | null
  reversedMovementId: string | null
  reason: string | null
  actor: AuditActor
  now: Date
}

/**
 * The single internal choke point every movement-creating function in
 * this file goes through: applies the physical/cost deltas to the
 * lot's own balances (if any — reservation/release movements carry a
 * zero physical delta and never touch the lot's stored balances at
 * all, since "reserved" is purely a derived sum over the movement
 * ledger, not a stored column), inserts the movement row, and writes
 * one audit row, all inside the same transaction — atomic, and never
 * allowing the lot's quantity_remaining_scaled or cost_remaining_minor
 * to go negative (the negative-stock guarantee's actual enforcement
 * point, backed by the database's own CHECK constraints as a second
 * line of defense).
 */
function insertMovementAndApplyToLot(db: AppDb, args: InsertMovementArgs): StockMovement {
  const {
    lot,
    movementType,
    physicalQuantityDeltaScaled,
    reservedQuantityDeltaScaled,
    costDeltaMinor,
    referenceType,
    referenceId,
    reversedMovementId,
    reason,
    actor,
    now
  } = args

  const newQuantityRemaining = lot.quantityRemainingScaled + physicalQuantityDeltaScaled
  const newCostRemaining = lot.costRemainingMinor + costDeltaMinor

  if (newQuantityRemaining < 0) {
    throw new StockMovementServiceError(
      `This movement would take lot "${lot.internalLotNumber}" below zero physical quantity, which is never permitted`
    )
  }
  if (newCostRemaining < 0) {
    throw new StockMovementServiceError(
      `This movement would take lot "${lot.internalLotNumber}" below zero remaining cost, which is never permitted`
    )
  }

  const movementId = `stock_movement_${randomUUID()}`

  db.transaction((tx) => {
    if (physicalQuantityDeltaScaled !== 0 || costDeltaMinor !== 0) {
      const newLifecycleStatus =
        newQuantityRemaining === 0 && lot.lifecycleStatus !== 'quarantined'
          ? 'depleted'
          : lot.lifecycleStatus
      tx.update(inventoryLots)
        .set({
          quantityRemainingScaled: newQuantityRemaining,
          costRemainingMinor: newCostRemaining,
          lifecycleStatus: newLifecycleStatus,
          updatedAt: now
        })
        .where(eq(inventoryLots.id, lot.id))
        .run()
    }

    tx.insert(stockMovements)
      .values({
        id: movementId,
        companyId: PRIMARY_COMPANY_ID,
        inventoryLotId: lot.id,
        movementType,
        physicalQuantityDeltaScaled,
        reservedQuantityDeltaScaled,
        costDeltaMinor,
        referenceType,
        referenceId,
        reversedMovementId,
        reason,
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
          movementType,
          physicalQuantityDeltaScaled,
          reservedQuantityDeltaScaled,
          costDeltaMinor,
          referenceType,
          referenceId,
          reversedMovementId,
          reason
        }
      },
      now
    )
  })

  const created = getMovementById(db, movementId)
  if (!created) {
    throw new StockMovementServiceError('Stock movement was not persisted after creation')
  }
  return created
}

export interface RecordAdjustmentInput {
  inventoryLotId: string
  physicalQuantityDeltaScaled: number
  costDeltaMinor: number
  reason: string
}

/**
 * Records a manual correction against an existing lot — the delta may
 * be positive or negative, but must be nonzero, and a reason is always
 * required (approved decision). Never allows the lot's physical or
 * cost balance to go negative. Note that the database's own
 * quantity_remaining_scaled <= quantity_received_scaled CHECK means a
 * positive adjustment can only restore quantity up to the lot's
 * original received amount — correcting an over-counted prior
 * reduction, never adding stock beyond what was ever received.
 */
export function recordAdjustment(
  db: AppDb,
  input: RecordAdjustmentInput,
  actor: AuditActor,
  now: Date = new Date()
): StockMovement {
  if (input.physicalQuantityDeltaScaled === 0) {
    throw new StockMovementServiceError('An adjustment must have a nonzero quantity delta')
  }
  const reason = requireReasonForAdjustmentOrReversal(input.reason)
  const lot = loadLotForMutation(db, input.inventoryLotId)

  return insertMovementAndApplyToLot(db, {
    lot,
    movementType: 'adjustment',
    physicalQuantityDeltaScaled: input.physicalQuantityDeltaScaled,
    reservedQuantityDeltaScaled: 0,
    costDeltaMinor: input.costDeltaMinor,
    referenceType: 'manual_adjustment',
    referenceId: null,
    reversedMovementId: null,
    reason,
    actor,
    now
  })
}

export interface ReserveStockInput {
  inventoryLotId: string
  quantityScaled: number
  referenceType: string
  referenceId: string
}

/**
 * Reserving stock never changes physical quantity — it only records a
 * positive reservedQuantityDeltaScaled, which the read layer
 * (stockQuantityService.ts) sums to compute "reserved", and therefore
 * "available" (physical - reserved). Cannot exceed usable physical
 * quantity: (lot's own quantityRemainingScaled - already-outstanding
 * reservations on this lot) must be >= the requested amount. A stable
 * (referenceType, referenceId) is required, so a later release can be
 * matched back to exactly this reservation.
 */
export function reserveStock(
  db: AppDb,
  input: ReserveStockInput,
  actor: AuditActor,
  now: Date = new Date()
): StockMovement {
  if (!(input.quantityScaled > 0)) {
    throw new StockMovementServiceError('A reservation quantity must be a positive number')
  }
  const { referenceType, referenceId } = requireStableReference(
    input.referenceType,
    input.referenceId
  )
  const lot = loadLotForMutation(db, input.inventoryLotId)
  const alreadyReserved = totalOutstandingReservedForLot(db, input.inventoryLotId)
  const usable = lot.quantityRemainingScaled - alreadyReserved
  if (input.quantityScaled > usable) {
    throw new StockMovementServiceError(
      `Cannot reserve ${input.quantityScaled} against lot "${lot.internalLotNumber}": only ${usable} is currently usable`
    )
  }

  return insertMovementAndApplyToLot(db, {
    lot,
    movementType: 'reservation',
    physicalQuantityDeltaScaled: 0,
    reservedQuantityDeltaScaled: input.quantityScaled,
    costDeltaMinor: 0,
    referenceType,
    referenceId,
    reversedMovementId: null,
    reason: null,
    actor,
    now
  })
}

export interface ReleaseReservationInput {
  inventoryLotId: string
  quantityScaled: number
  referenceType: string
  referenceId: string
}

/**
 * Releasing never changes physical quantity — it records a negative
 * reservedQuantityDeltaScaled, and cannot exceed the reservation
 * currently outstanding for that exact (lot, referenceType,
 * referenceId) triple.
 */
export function releaseReservation(
  db: AppDb,
  input: ReleaseReservationInput,
  actor: AuditActor,
  now: Date = new Date()
): StockMovement {
  if (!(input.quantityScaled > 0)) {
    throw new StockMovementServiceError('A release quantity must be a positive number')
  }
  const referenceType = requireApprovedReferenceType(input.referenceType)
  const lot = loadLotForMutation(db, input.inventoryLotId)
  const outstanding = outstandingReservedForReference(
    db,
    input.inventoryLotId,
    referenceType,
    input.referenceId
  )
  if (input.quantityScaled > outstanding) {
    throw new StockMovementServiceError(
      `Cannot release ${input.quantityScaled} against lot "${lot.internalLotNumber}" for this reference: only ${outstanding} is currently reserved`
    )
  }

  return insertMovementAndApplyToLot(db, {
    lot,
    movementType: 'release',
    physicalQuantityDeltaScaled: 0,
    reservedQuantityDeltaScaled: -input.quantityScaled,
    costDeltaMinor: 0,
    referenceType,
    referenceId: input.referenceId,
    reversedMovementId: null,
    reason: null,
    actor,
    now
  })
}

/**
 * Creates a new movement with exactly the opposite physical/reserved/
 * cost deltas of the movement being reversed, linked via
 * reversedMovementId. A movement can be reversed once only — enforced
 * both here (an explicit pre-check) and by the database's own unique
 * constraint on reversed_movement_id as a second line of defense.
 * Releases/reversals may unwind state for a lot whose parent item has
 * since gone inactive (approved decision) — unlike every other new
 * mutation in this file, reverseMovement does not require the parent
 * item to be active, since undoing a past action should never be
 * blocked by a later, unrelated deactivation.
 */
export function reverseMovement(
  db: AppDb,
  movementId: string,
  reason: string,
  actor: AuditActor,
  now: Date = new Date()
): StockMovement {
  const requiredReason = requireReasonForAdjustmentOrReversal(reason)
  const original = getMovementById(db, movementId)
  if (!original) {
    throw new StockMovementServiceError(`No stock movement exists with id "${movementId}"`)
  }

  const existingReversal = db
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(eq(stockMovements.reversedMovementId, movementId))
    .get()
  if (existingReversal) {
    throw new StockMovementServiceError(
      `Stock movement "${movementId}" has already been reversed and cannot be reversed again`
    )
  }

  const lot = loadLotForMutation(db, original.inventoryLotId)

  const reversalId = `stock_movement_${randomUUID()}`
  const newQuantityRemaining = lot.quantityRemainingScaled - original.physicalQuantityDeltaScaled
  const newCostRemaining = lot.costRemainingMinor - original.costDeltaMinor
  if (newQuantityRemaining < 0 || newCostRemaining < 0) {
    throw new StockMovementServiceError(
      `Reversing movement "${movementId}" would take lot "${lot.internalLotNumber}" below zero, which is never permitted`
    )
  }

  db.transaction((tx) => {
    if (original.physicalQuantityDeltaScaled !== 0 || original.costDeltaMinor !== 0) {
      const newLifecycleStatus =
        newQuantityRemaining === 0 && lot.lifecycleStatus !== 'quarantined'
          ? 'depleted'
          : newQuantityRemaining > 0 && lot.lifecycleStatus === 'depleted'
            ? 'active'
            : lot.lifecycleStatus
      tx.update(inventoryLots)
        .set({
          quantityRemainingScaled: newQuantityRemaining,
          costRemainingMinor: newCostRemaining,
          lifecycleStatus: newLifecycleStatus,
          updatedAt: now
        })
        .where(eq(inventoryLots.id, lot.id))
        .run()
    }

    tx.insert(stockMovements)
      .values({
        id: reversalId,
        companyId: PRIMARY_COMPANY_ID,
        inventoryLotId: lot.id,
        movementType: 'reversal',
        physicalQuantityDeltaScaled: -original.physicalQuantityDeltaScaled,
        reservedQuantityDeltaScaled: -original.reservedQuantityDeltaScaled,
        costDeltaMinor: -original.costDeltaMinor,
        referenceType: 'reversal',
        referenceId: null,
        reversedMovementId: movementId,
        reason: requiredReason,
        createdAt: now
      })
      .run()

    record(
      tx,
      {
        entityType: 'stock_movement',
        entityId: reversalId,
        entityLabel: lot.internalLotNumber,
        action: 'create',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: null,
        after: {
          inventoryLotId: lot.id,
          movementType: 'reversal',
          reversedMovementId: movementId,
          reason: requiredReason
        }
      },
      now
    )
  })

  const created = getMovementById(db, reversalId)
  if (!created) {
    throw new StockMovementServiceError('Reversal movement was not persisted after creation')
  }
  return created
}
