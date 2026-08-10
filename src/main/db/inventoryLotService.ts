import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import {
  company,
  FUNCTIONAL_CURRENCY_ID,
  inventoryItems,
  inventoryLots,
  PRIMARY_COMPANY_ID,
  stockMovements,
  unitsOfMeasure
} from './schema'
import {
  computeTotalCostMinor,
  normalizeSupplierLotNumber,
  requireExpiryDateMatchingItemTracking,
  requireNonNegativeUnitCostMinor,
  requireValidReceivedDate
} from './validation/inventoryLotValidation'
import { requirePositiveScaledInteger } from './quantityScale'
import { allocateNext } from './numberingService'
import { record, type AuditActor } from '../audit/auditService'
import type { AppDb, AppTransaction } from './dbTypes'

export class InventoryLotServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InventoryLotServiceError'
  }
}

export interface InventoryLot {
  id: string
  companyId: string
  inventoryItemId: string
  supplierId: string | null
  receivedDate: Date
  quantityReceivedScaled: number
  quantityRemainingScaled: number
  unitCostMinor: number
  totalCostMinor: number
  costRemainingMinor: number
  currencyId: string
  supplierLotNumber: string | null
  internalLotNumber: string
  expiryDate: Date | null
  lifecycleStatus: 'active' | 'quarantined' | 'depleted'
  createdAt: Date
  updatedAt: Date
}

export interface CreateOpeningLotInput {
  inventoryItemId: string
  supplierId?: string | null
  receivedDate: Date
  quantityReceivedScaled: number
  unitCostMinor: number
  supplierLotNumber?: string | null
  expiryDate?: Date | null
}

function toInventoryLot(row: typeof inventoryLots.$inferSelect): InventoryLot {
  return {
    id: row.id,
    companyId: row.companyId,
    inventoryItemId: row.inventoryItemId,
    supplierId: row.supplierId,
    receivedDate: row.receivedDate,
    quantityReceivedScaled: row.quantityReceivedScaled,
    quantityRemainingScaled: row.quantityRemainingScaled,
    unitCostMinor: row.unitCostMinor,
    totalCostMinor: row.totalCostMinor,
    costRemainingMinor: row.costRemainingMinor,
    currencyId: row.currencyId,
    supplierLotNumber: row.supplierLotNumber,
    internalLotNumber: row.internalLotNumber,
    expiryDate: row.expiryDate,
    lifecycleStatus: row.lifecycleStatus as InventoryLot['lifecycleStatus'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export function getInventoryLotById(db: AppDb, id: string): InventoryLot | undefined {
  const row = db.select().from(inventoryLots).where(eq(inventoryLots.id, id)).get()
  return row ? toInventoryLot(row) : undefined
}

export function listLotsForInventoryItem(db: AppDb, inventoryItemId: string): InventoryLot[] {
  const rows = db
    .select()
    .from(inventoryLots)
    .where(eq(inventoryLots.inventoryItemId, inventoryItemId))
    .orderBy(asc(inventoryLots.receivedDate), asc(inventoryLots.createdAt), asc(inventoryLots.id))
    .all()
  return rows.map(toInventoryLot)
}

/**
 * Lots that are still structurally eligible to be drawn from by FIFO
 * consumption: not depleted, and with remaining quantity. This
 * deliberately still includes quarantined lots -- fifoConsumptionService
 * itself decides whether to skip a quarantined (or expired) lot based
 * on its own override rules; this list is "not permanently excluded",
 * not "immediately consumable". Ordered oldest-first
 * (receivedDate ASC, createdAt ASC, id ASC), matching FIFO order and
 * this codebase's established deterministic-tiebreak convention.
 */
export function listConsumableLotsForInventoryItem(
  db: AppDb,
  inventoryItemId: string
): InventoryLot[] {
  const rows = db
    .select()
    .from(inventoryLots)
    .where(
      and(
        eq(inventoryLots.inventoryItemId, inventoryItemId),
        eq(inventoryLots.companyId, PRIMARY_COMPANY_ID)
      )
    )
    .orderBy(asc(inventoryLots.receivedDate), asc(inventoryLots.createdAt), asc(inventoryLots.id))
    .all()
  return rows
    .map(toInventoryLot)
    .filter((lot) => lot.lifecycleStatus !== 'depleted' && lot.quantityRemainingScaled > 0)
}

interface ResolvedInventoryItemForLot {
  isActive: boolean
  expiryTracked: boolean
  decimalPlaces: number
}

function requireActiveInventoryItemForLot(
  db: AppDb,
  inventoryItemId: string
): ResolvedInventoryItemForLot {
  const row = db
    .select({
      isActive: inventoryItems.isActive,
      expiryTracked: inventoryItems.expiryTracked,
      decimalPlaces: unitsOfMeasure.decimalPlaces
    })
    .from(inventoryItems)
    .innerJoin(unitsOfMeasure, eq(inventoryItems.unitOfMeasureId, unitsOfMeasure.id))
    .where(eq(inventoryItems.id, inventoryItemId))
    .get()
  if (!row) {
    throw new InventoryLotServiceError(`No inventory item exists with id "${inventoryItemId}"`)
  }
  if (!row.isActive) {
    throw new InventoryLotServiceError(
      `Inventory item "${inventoryItemId}" is not active; a new lot cannot be created against it`
    )
  }
  return row
}

function requireCompanyExists(db: AppDb): void {
  const found = db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.id, PRIMARY_COMPANY_ID))
    .get()
  if (!found) {
    throw new InventoryLotServiceError(
      'Cannot manage inventory lots: no company profile exists yet. Complete first-run setup first.'
    )
  }
}

/**
 * Atomically: (1) validates the parent inventory item is active,
 * (2) validates expiryDate is present exactly when the item's own
 * expiryTracked=true, (3) allocates the internal lot number via the
 * `inventory_lot` numbering rule, (4) inserts the lot row,
 * (5) inserts the lot's initial `receipt`/`opening_stock` movement
 * row, (6) writes one audit row for the lot and one for the movement,
 * all inside a single transaction — a failure at any step rolls
 * everything back, never leaving an allocated lot number with no
 * corresponding lot, or a lot with no corresponding opening movement.
 *
 * currencyId is always FUNCTIONAL_CURRENCY_ID, assigned server-side.
 * internalLotNumber, currencyId, companyId, every balance field, and
 * lifecycleStatus are all absent from CreateOpeningLotInput entirely —
 * a structural guarantee that no caller can inject any of them.
 */
export function createOpeningLot(
  db: AppDb,
  input: CreateOpeningLotInput,
  actor: AuditActor,
  now: Date = new Date()
): InventoryLot {
  requireCompanyExists(db)

  const resolvedItem = requireActiveInventoryItemForLot(db, input.inventoryItemId)
  const receivedDate = requireValidReceivedDate(input.receivedDate)
  const quantityReceivedScaled = requirePositiveScaledInteger(input.quantityReceivedScaled)
  const unitCostMinor = requireNonNegativeUnitCostMinor(input.unitCostMinor)
  const supplierLotNumber = normalizeSupplierLotNumber(input.supplierLotNumber)
  const expiryDate = requireExpiryDateMatchingItemTracking(
    input.expiryDate,
    resolvedItem.expiryTracked
  )
  const quantityScale = 10 ** resolvedItem.decimalPlaces
  const totalCostMinor = computeTotalCostMinor(unitCostMinor, quantityReceivedScaled, quantityScale)

  const lotId = `inventory_lot_${randomUUID()}`
  const movementId = `stock_movement_${randomUUID()}`

  db.transaction((tx) => {
    const internalLotNumber = allocateNext(tx as AppTransaction, 'inventory_lot', now)

    tx.insert(inventoryLots)
      .values({
        id: lotId,
        companyId: PRIMARY_COMPANY_ID,
        inventoryItemId: input.inventoryItemId,
        supplierId: input.supplierId ?? null,
        receivedDate,
        quantityReceivedScaled,
        quantityRemainingScaled: quantityReceivedScaled,
        unitCostMinor,
        totalCostMinor,
        costRemainingMinor: totalCostMinor,
        currencyId: FUNCTIONAL_CURRENCY_ID,
        supplierLotNumber,
        internalLotNumber,
        expiryDate,
        lifecycleStatus: 'active',
        createdAt: now,
        updatedAt: now
      })
      .run()

    record(
      tx,
      {
        entityType: 'inventory_lot',
        entityId: lotId,
        entityLabel: internalLotNumber,
        action: 'create',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: null,
        after: {
          inventoryItemId: input.inventoryItemId,
          supplierId: input.supplierId ?? null,
          quantityReceivedScaled,
          unitCostMinor,
          totalCostMinor,
          currencyId: FUNCTIONAL_CURRENCY_ID,
          internalLotNumber,
          lifecycleStatus: 'active'
        }
      },
      now
    )

    tx.insert(stockMovements)
      .values({
        id: movementId,
        companyId: PRIMARY_COMPANY_ID,
        inventoryLotId: lotId,
        movementType: 'receipt',
        physicalQuantityDeltaScaled: quantityReceivedScaled,
        reservedQuantityDeltaScaled: 0,
        costDeltaMinor: totalCostMinor,
        referenceType: 'opening_stock',
        referenceId: null,
        reversedMovementId: null,
        reason: null,
        createdAt: now
      })
      .run()

    record(
      tx,
      {
        entityType: 'stock_movement',
        entityId: movementId,
        entityLabel: internalLotNumber,
        action: 'create',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: null,
        after: {
          inventoryLotId: lotId,
          movementType: 'receipt',
          physicalQuantityDeltaScaled: quantityReceivedScaled,
          costDeltaMinor: totalCostMinor,
          referenceType: 'opening_stock'
        }
      },
      now
    )
  })

  const created = getInventoryLotById(db, lotId)
  if (!created) {
    throw new InventoryLotServiceError('Inventory lot was not persisted after creation')
  }
  return created
}

/**
 * quarantine/reactivate are handled as a plain lifecycleStatus update,
 * not a distinct audit action -- AuditAction is a fixed union
 * ('create' | 'update' | 'deactivate' | 'reactivate') with no
 * 'quarantine' value, so quarantining a lot logs as 'update' while
 * restoring it to active logs as 'reactivate' (the closer semantic
 * match of the four available actions).
 */
function setLifecycleStatus(
  db: AppDb,
  id: string,
  lifecycleStatus: 'active' | 'quarantined',
  actor: AuditActor,
  now: Date
): InventoryLot {
  const existing = getInventoryLotById(db, id)
  if (!existing) {
    throw new InventoryLotServiceError(`No inventory lot exists with id "${id}"`)
  }
  if (existing.lifecycleStatus === 'depleted') {
    throw new InventoryLotServiceError(
      `Inventory lot "${id}" is depleted; its lifecycle status can no longer be changed`
    )
  }
  if (existing.lifecycleStatus === lifecycleStatus) {
    return existing
  }

  db.transaction((tx) => {
    tx.update(inventoryLots)
      .set({ lifecycleStatus, updatedAt: now })
      .where(eq(inventoryLots.id, id))
      .run()

    record(
      tx,
      {
        entityType: 'inventory_lot',
        entityId: id,
        entityLabel: existing.internalLotNumber,
        action: lifecycleStatus === 'quarantined' ? 'update' : 'reactivate',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: { lifecycleStatus: existing.lifecycleStatus },
        after: { lifecycleStatus }
      },
      now
    )
  })

  const updated = getInventoryLotById(db, id)
  if (!updated) {
    throw new InventoryLotServiceError('Inventory lot disappeared during status change')
  }
  return updated
}

export function setLotQuarantined(
  db: AppDb,
  id: string,
  actor: AuditActor,
  now: Date = new Date()
): InventoryLot {
  return setLifecycleStatus(db, id, 'quarantined', actor, now)
}

export function setLotActive(
  db: AppDb,
  id: string,
  actor: AuditActor,
  now: Date = new Date()
): InventoryLot {
  return setLifecycleStatus(db, id, 'active', actor, now)
}
