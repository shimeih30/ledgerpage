import { ipcMain } from 'electron'
import { eq } from 'drizzle-orm'
import {
  INVENTORY_LOTS_GET_CHANNEL,
  INVENTORY_LOTS_LIST_FOR_ITEM_CHANNEL,
  INVENTORY_LOTS_LIST_MOVEMENTS_CHANNEL,
  STOCK_GET_SUMMARY_CHANNEL,
  STOCK_LIST_SUMMARIES_CHANNEL,
  type GetInventoryLotResult,
  type GetStockSummaryResult,
  type StockItemIdInput,
  type InventoryLotEffectiveStatus,
  type InventoryLotIdInput,
  type InventoryLotsErrorCode,
  type ListInventoryLotMovementsResult,
  type ListInventoryLotsForItemResult,
  type ListStockSummariesResult,
  type SafeInventoryLot,
  type SafeStockMovement,
  type SafeStockSummary
} from '../../shared/ipc/inventoryLots'
import type { NavigationPolicyContext } from '../security/navigationPolicy'
import { isApprovedIpcSender, type ApprovableIpcEvent } from '../security/senderValidation'
import { requireAuthorizedCaller } from '../auth/requireAuthorizedCaller'
import type { LoginService } from '../users/loginService'
import {
  getInventoryLotById,
  listLotsForInventoryItem,
  type InventoryLot
} from '../db/inventoryLotService'
import { listMovementsForLot, type StockMovement } from '../db/stockMovementService'
import {
  getStockSummaryForItem,
  listStockSummaries,
  StockQuantityServiceError,
  type StockSummaryForItem
} from '../db/stockQuantityService'
import { formatScaledIntegerAsQuantity } from '../db/quantityScale'
import { inventoryItems, suppliers, unitsOfMeasure } from '../db/schema'
import type { AppDb } from '../db/dbTypes'

class InventoryLotsIpcInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InventoryLotsIpcInputError'
  }
}

function requireApprovedSender(event: ApprovableIpcEvent, context: NavigationPolicyContext): void {
  if (!isApprovedIpcSender(event, context)) {
    throw new Error('LedgerPage: rejected inventory-lots/stock request from an unapproved sender')
  }
}

function requireStringField(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InventoryLotsIpcInputError(`${fieldName} must be a non-empty string`)
  }
  return value
}

function parseInventoryItemIdInput(input: unknown): StockItemIdInput {
  if (typeof input !== 'object' || input === null) {
    throw new InventoryLotsIpcInputError('input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return { inventoryItemId: requireStringField(candidate.inventoryItemId, 'inventoryItemId') }
}

function parseInventoryLotIdInput(input: unknown): InventoryLotIdInput {
  if (typeof input !== 'object' || input === null) {
    throw new InventoryLotsIpcInputError('input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return { lotId: requireStringField(candidate.lotId, 'lotId') }
}

interface ResolvedItemLabels {
  itemCode: string
  itemName: string
  unitCode: string
  unitName: string
  decimalPlaces: number
}

function resolveItemLabels(db: AppDb, inventoryItemId: string): ResolvedItemLabels | undefined {
  const row = db
    .select({
      itemCode: inventoryItems.code,
      itemName: inventoryItems.name,
      unitCode: unitsOfMeasure.code,
      unitName: unitsOfMeasure.name,
      decimalPlaces: unitsOfMeasure.decimalPlaces
    })
    .from(inventoryItems)
    .innerJoin(unitsOfMeasure, eq(inventoryItems.unitOfMeasureId, unitsOfMeasure.id))
    .where(eq(inventoryItems.id, inventoryItemId))
    .get()
  return row
}

interface ResolvedSupplierLabels {
  supplierCode: string
  supplierName: string
}

function resolveSupplierLabels(
  db: AppDb,
  supplierId: string | null
): ResolvedSupplierLabels | undefined {
  if (!supplierId) {
    return undefined
  }
  const row = db
    .select({ supplierCode: suppliers.code, supplierName: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .get()
  return row
}

/**
 * lifecycleStatus is the only thing ever persisted (active /
 * quarantined / depleted). effectiveStatus additionally folds in
 * "expired" purely as a read-time computation against the supplied
 * `now` — never written back to the row, so no database update ever
 * happens merely because time passed.
 */
function deriveEffectiveStatus(lot: InventoryLot, now: Date): InventoryLotEffectiveStatus {
  if (lot.lifecycleStatus === 'depleted') {
    return 'depleted'
  }
  if (lot.lifecycleStatus === 'quarantined') {
    return 'quarantined'
  }
  if (lot.expiryDate !== null && lot.expiryDate.getTime() < now.getTime()) {
    return 'expired'
  }
  return 'active'
}

function toSafeInventoryLot(db: AppDb, lot: InventoryLot, now: Date): SafeInventoryLot {
  const itemLabels = resolveItemLabels(db, lot.inventoryItemId)
  const supplierLabels = resolveSupplierLabels(db, lot.supplierId)
  const decimalPlaces = itemLabels?.decimalPlaces ?? 0

  return {
    id: lot.id,
    internalLotNumber: lot.internalLotNumber,
    supplierLotNumber: lot.supplierLotNumber,
    inventoryItemId: lot.inventoryItemId,
    itemCode: itemLabels?.itemCode ?? '',
    itemName: itemLabels?.itemName ?? '',
    supplierId: lot.supplierId,
    supplierCode: supplierLabels?.supplierCode ?? null,
    supplierName: supplierLabels?.supplierName ?? null,
    receivedDate: lot.receivedDate.getTime(),
    quantityReceivedScaled: lot.quantityReceivedScaled,
    quantityRemainingScaled: lot.quantityRemainingScaled,
    formattedQuantityReceived: formatScaledIntegerAsQuantity(
      lot.quantityReceivedScaled,
      decimalPlaces
    ),
    formattedQuantityRemaining: formatScaledIntegerAsQuantity(
      lot.quantityRemainingScaled,
      decimalPlaces
    ),
    unitCode: itemLabels?.unitCode ?? '',
    unitName: itemLabels?.unitName ?? '',
    decimalPlaces,
    unitCostMinor: lot.unitCostMinor,
    totalCostMinor: lot.totalCostMinor,
    costRemainingMinor: lot.costRemainingMinor,
    currencyId: lot.currencyId,
    expiryDate: lot.expiryDate ? lot.expiryDate.getTime() : null,
    lifecycleStatus: lot.lifecycleStatus,
    effectiveStatus: deriveEffectiveStatus(lot, now),
    createdAt: lot.createdAt.getTime(),
    updatedAt: lot.updatedAt.getTime()
  }
}

function toSafeStockMovement(movement: StockMovement, decimalPlaces: number): SafeStockMovement {
  return {
    id: movement.id,
    inventoryLotId: movement.inventoryLotId,
    movementType: movement.movementType,
    physicalQuantityDeltaScaled: movement.physicalQuantityDeltaScaled,
    reservedQuantityDeltaScaled: movement.reservedQuantityDeltaScaled,
    formattedPhysicalQuantityDelta: formatScaledIntegerAsQuantity(
      movement.physicalQuantityDeltaScaled,
      decimalPlaces
    ),
    formattedReservedQuantityDelta: formatScaledIntegerAsQuantity(
      movement.reservedQuantityDeltaScaled,
      decimalPlaces
    ),
    costDeltaMinor: movement.costDeltaMinor,
    referenceType: movement.referenceType,
    referenceId: movement.referenceId,
    reversedMovementId: movement.reversedMovementId,
    reason: movement.reason,
    createdAt: movement.createdAt.getTime()
  }
}

function toSafeStockSummary(summary: StockSummaryForItem): SafeStockSummary {
  return {
    inventoryItemId: summary.inventoryItemId,
    itemCode: summary.inventoryItemCode,
    itemName: summary.inventoryItemName,
    unitCode: summary.unitOfMeasureCode,
    unitName: summary.unitOfMeasureName,
    decimalPlaces: summary.decimalPlaces,
    physicalQuantityScaled: summary.physicalQuantityScaled,
    reservedQuantityScaled: summary.reservedQuantityScaled,
    availableQuantityScaled: summary.availableQuantityScaled,
    incomingQuantityScaled: summary.incomingQuantityScaled,
    formattedPhysicalQuantity: summary.physicalQuantityFormatted,
    formattedReservedQuantity: summary.reservedQuantityFormatted,
    formattedAvailableQuantity: summary.availableQuantityFormatted,
    formattedIncomingQuantity: summary.incomingQuantityFormatted,
    lotCount: summary.lotCount
  }
}

/**
 * Maps a thrown service-layer error to a safe, fixed errorCode — never
 * forwarding the error's own message to the renderer.
 */
function toErrorCode(error: unknown): InventoryLotsErrorCode {
  if (error instanceof StockQuantityServiceError) {
    return 'not_found'
  }
  return 'unexpected_error'
}

export interface RegisterInventoryLotHandlersOptions {
  context: NavigationPolicyContext
  db: AppDb
  loginService: LoginService
}

/**
 * Registers Slice 15's entire IPC surface: exactly 5 read-only
 * channels. Every handler is gated by requireAuthorizedCaller against
 * 'inventory_lots.read', resolved fresh from SQLite on every call —
 * never a renderer-supplied canViewInventoryLots flag. There is no
 * mutation channel registered anywhere in this function, structurally
 * as well as by convention — this slice's own approved architecture is
 * "read-only stock renderer and IPC"; createOpeningLot,
 * recordAdjustment, reserveStock, releaseReservation, reverseMovement,
 * consumeStock, setLotQuarantined, and setLotActive all remain
 * internal-only, callable in-process by later slices, never exposed
 * over IPC in this slice.
 */
export function registerInventoryLotHandlers(options: RegisterInventoryLotHandlersOptions): void {
  const { context, db, loginService } = options

  ipcMain.handle(
    INVENTORY_LOTS_LIST_FOR_ITEM_CHANNEL,
    (event, rawInput: unknown): ListInventoryLotsForItemResult => {
      requireApprovedSender(event, context)

      let input: StockItemIdInput
      try {
        input = parseInventoryItemIdInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'inventory_lots.read')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const now = new Date()
        const lots = listLotsForInventoryItem(db, input.inventoryItemId)
        return { success: true, lots: lots.map((lot) => toSafeInventoryLot(db, lot, now)) }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(INVENTORY_LOTS_GET_CHANNEL, (event, rawInput: unknown): GetInventoryLotResult => {
    requireApprovedSender(event, context)

    let input: InventoryLotIdInput
    try {
      input = parseInventoryLotIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'inventory_lots.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    const lot = getInventoryLotById(db, input.lotId)
    if (!lot) {
      return { success: false, errorCode: 'not_found' }
    }
    return { success: true, lot: toSafeInventoryLot(db, lot, new Date()) }
  })

  ipcMain.handle(
    INVENTORY_LOTS_LIST_MOVEMENTS_CHANNEL,
    (event, rawInput: unknown): ListInventoryLotMovementsResult => {
      requireApprovedSender(event, context)

      let input: InventoryLotIdInput
      try {
        input = parseInventoryLotIdInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'inventory_lots.read')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      const lot = getInventoryLotById(db, input.lotId)
      if (!lot) {
        return { success: false, errorCode: 'not_found' }
      }

      try {
        const itemLabels = resolveItemLabels(db, lot.inventoryItemId)
        const decimalPlaces = itemLabels?.decimalPlaces ?? 0
        const movements = listMovementsForLot(db, input.lotId)
        return {
          success: true,
          movements: movements.map((m) => toSafeStockMovement(m, decimalPlaces))
        }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(STOCK_LIST_SUMMARIES_CHANNEL, (event): ListStockSummariesResult => {
    requireApprovedSender(event, context)

    const authResult = requireAuthorizedCaller(db, loginService, 'inventory_lots.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const summaries = listStockSummaries(db)
      return { success: true, summaries: summaries.map(toSafeStockSummary) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(STOCK_GET_SUMMARY_CHANNEL, (event, rawInput: unknown): GetStockSummaryResult => {
    requireApprovedSender(event, context)

    let input: StockItemIdInput
    try {
      input = parseInventoryItemIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'inventory_lots.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const summary = getStockSummaryForItem(db, input.inventoryItemId)
      return { success: true, summary: toSafeStockSummary(summary) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })
}
