/**
 * Slice 15's IPC surface is read-only, mirroring the plan's own
 * "read-only stock renderer and IPC" approved architecture. No channel
 * exists here (or anywhere else in this codebase) for
 * createOpeningLot, recordReceipt, recordAdjustment, reserveStock,
 * releaseReservation, reverseMovement, consumeStock, setLotQuarantined,
 * or setLotActive — those mutation services exist purely for later
 * slices (Purchasing, Sales, Production) to call in-process. This
 * contract exposes exactly 5 read channels.
 */

export const INVENTORY_LOTS_LIST_FOR_ITEM_CHANNEL = 'inventory-lots:list-for-item' as const
export const INVENTORY_LOTS_GET_CHANNEL = 'inventory-lots:get' as const
export const INVENTORY_LOTS_LIST_MOVEMENTS_CHANNEL = 'inventory-lots:list-movements' as const
export const STOCK_LIST_SUMMARIES_CHANNEL = 'stock:list-summaries' as const
export const STOCK_GET_SUMMARY_CHANNEL = 'stock:get-summary' as const

export type InventoryLotsErrorCode =
  'not_authorized' | 'invalid_input' | 'not_found' | 'session_invalid' | 'unexpected_error'

/**
 * active/quarantined/depleted are the only values ever persisted
 * (lifecycleStatus). effectiveStatus additionally folds in "expired"
 * (derived at read time from expiryDate vs. the current moment) --
 * never stored, since whether a lot is expired as of right now is a
 * function of the clock, not a fact to persist and let go stale.
 */
export type InventoryLotLifecycleStatus = 'active' | 'quarantined' | 'depleted'
export type InventoryLotEffectiveStatus = 'active' | 'quarantined' | 'depleted' | 'expired'

export interface SafeInventoryLot {
  id: string
  internalLotNumber: string
  supplierLotNumber: string | null
  inventoryItemId: string
  itemCode: string
  itemName: string
  supplierId: string | null
  supplierCode: string | null
  supplierName: string | null
  receivedDate: number
  quantityReceivedScaled: number
  quantityRemainingScaled: number
  formattedQuantityReceived: string
  formattedQuantityRemaining: string
  unitCode: string
  unitName: string
  decimalPlaces: number
  unitCostMinor: number
  totalCostMinor: number
  costRemainingMinor: number
  currencyId: string
  expiryDate: number | null
  lifecycleStatus: InventoryLotLifecycleStatus
  effectiveStatus: InventoryLotEffectiveStatus
  createdAt: number
  updatedAt: number
}

export interface SafeStockMovement {
  id: string
  inventoryLotId: string
  movementType: string
  physicalQuantityDeltaScaled: number
  reservedQuantityDeltaScaled: number
  formattedPhysicalQuantityDelta: string
  formattedReservedQuantityDelta: string
  costDeltaMinor: number
  referenceType: string
  referenceId: string | null
  reversedMovementId: string | null
  reason: string | null
  createdAt: number
}

export interface SafeStockSummary {
  inventoryItemId: string
  itemCode: string
  itemName: string
  unitCode: string
  unitName: string
  decimalPlaces: number
  physicalQuantityScaled: number
  reservedQuantityScaled: number
  availableQuantityScaled: number
  incomingQuantityScaled: number
  formattedPhysicalQuantity: string
  formattedReservedQuantity: string
  formattedAvailableQuantity: string
  formattedIncomingQuantity: string
  lotCount: number
}

export interface StockItemIdInput {
  inventoryItemId: string
}

export interface InventoryLotIdInput {
  lotId: string
}

export type ListInventoryLotsForItemResult =
  | { success: true; lots: SafeInventoryLot[] }
  | { success: false; errorCode: InventoryLotsErrorCode }

export type GetInventoryLotResult =
  { success: true; lot: SafeInventoryLot } | { success: false; errorCode: InventoryLotsErrorCode }

export type ListInventoryLotMovementsResult =
  | { success: true; movements: SafeStockMovement[] }
  | { success: false; errorCode: InventoryLotsErrorCode }

export type ListStockSummariesResult =
  | { success: true; summaries: SafeStockSummary[] }
  | { success: false; errorCode: InventoryLotsErrorCode }

export type GetStockSummaryResult =
  | { success: true; summary: SafeStockSummary }
  | { success: false; errorCode: InventoryLotsErrorCode }

export interface LedgerPageInventoryLotsApi {
  listInventoryLotsForItem: (input: StockItemIdInput) => Promise<ListInventoryLotsForItemResult>
  getInventoryLot: (input: InventoryLotIdInput) => Promise<GetInventoryLotResult>
  listInventoryLotMovements: (
    input: InventoryLotIdInput
  ) => Promise<ListInventoryLotMovementsResult>
  listStockSummaries: () => Promise<ListStockSummariesResult>
  getStockSummary: (input: StockItemIdInput) => Promise<GetStockSummaryResult>
}
