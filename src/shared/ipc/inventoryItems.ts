/**
 * Shared IPC contract for Slice 12's inventory-items channels.
 *
 * `code` never appears on UpdateInventoryItemInput — it is ordinary
 * user-entered input at creation (approved decision: no numbering rule
 * added for this table) but immutable thereafter; there is no
 * representable way for a caller to supply or change it through an
 * update. `itemType` is likewise absent from UpdateInventoryItemInput
 * for the same reason.
 */

export const INVENTORY_ITEMS_LIST_CHANNEL = 'inventory-items:list' as const
export const INVENTORY_ITEMS_GET_CHANNEL = 'inventory-items:get' as const
export const INVENTORY_ITEMS_CREATE_CHANNEL = 'inventory-items:create' as const
export const INVENTORY_ITEMS_UPDATE_CHANNEL = 'inventory-items:update' as const
export const INVENTORY_ITEMS_DEACTIVATE_CHANNEL = 'inventory-items:deactivate' as const
export const INVENTORY_ITEMS_REACTIVATE_CHANNEL = 'inventory-items:reactivate' as const

/**
 * A narrow, read-only lookup for the create/edit form's unit-of-measure
 * dropdown — Slice 4's reference-data tables have no dedicated IPC
 * surface of their own yet, so this is new, minimal surface introduced
 * by this slice specifically for that one purpose. Gated by
 * inventory_items.read in registerInventoryItemHandlers.ts, mirroring
 * products:list-assignable-tax-codes's own precedent exactly — no unit
 * mutation channel exists anywhere in this contract.
 */
export const INVENTORY_ITEMS_LIST_ASSIGNABLE_UNITS_CHANNEL =
  'inventory-items:list-assignable-units' as const

export type InventoryItemType = 'ingredient' | 'packaging' | 'consumable' | 'other'

export type InventoryItemsErrorCode =
  | 'not_authorized'
  | 'invalid_input'
  | 'duplicate_code'
  | 'not_found'
  | 'session_invalid'
  | 'unexpected_error'

export interface SafeInventoryItem {
  id: string
  code: string
  name: string
  category: string
  itemType: InventoryItemType
  unitOfMeasureId: string
  /**
   * The referenced unit's own code (e.g. "kg"), resolved server-side on
   * every read, regardless of whether that unit is currently active —
   * lets the edit form show "currently references kg" even after kg is
   * deactivated, without ever making kg newly assignable again
   * (listAssignableUnitsOfMeasure is a separate, active-only read path).
   */
  unitOfMeasureLabel: string
  minimumStock: number
  reorderQuantity: number
  maximumStock: number | null
  leadTimeDays: number
  lotTracked: boolean
  expiryTracked: boolean
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export type ListInventoryItemsResult =
  | { success: true; inventoryItems: SafeInventoryItem[] }
  | { success: false; errorCode: InventoryItemsErrorCode }

export interface InventoryItemIdInput {
  inventoryItemId: string
}

export type GetInventoryItemResult =
  | { success: true; inventoryItem: SafeInventoryItem }
  | { success: false; errorCode: InventoryItemsErrorCode }

export interface CreateInventoryItemInput {
  code: string
  name: string
  category: string
  itemType: InventoryItemType
  unitOfMeasureId: string
  minimumStock: number
  reorderQuantity: number
  maximumStock?: number | null
  leadTimeDays: number
  lotTracked?: boolean
  expiryTracked?: boolean
}

export type CreateInventoryItemResult =
  | { success: true; inventoryItem: SafeInventoryItem }
  | { success: false; errorCode: InventoryItemsErrorCode }

export interface UpdateInventoryItemInput {
  inventoryItemId: string
  name?: string
  category?: string
  unitOfMeasureId?: string
  minimumStock?: number
  reorderQuantity?: number
  maximumStock?: number | null
  leadTimeDays?: number
  lotTracked?: boolean
  expiryTracked?: boolean
}

export type UpdateInventoryItemResult =
  | { success: true; inventoryItem: SafeInventoryItem }
  | { success: false; errorCode: InventoryItemsErrorCode }

export type MutateInventoryItemResult =
  | { success: true; inventoryItem: SafeInventoryItem }
  | { success: false; errorCode: InventoryItemsErrorCode }

export interface AssignableUnitOfMeasure {
  id: string
  code: string
  name: string
  category: string
}

export type ListAssignableUnitsOfMeasureResult =
  | { success: true; units: AssignableUnitOfMeasure[] }
  | { success: false; errorCode: InventoryItemsErrorCode }

export interface LedgerPageInventoryItemsApi {
  listInventoryItems: () => Promise<ListInventoryItemsResult>
  getInventoryItem: (input: InventoryItemIdInput) => Promise<GetInventoryItemResult>
  createInventoryItem: (input: CreateInventoryItemInput) => Promise<CreateInventoryItemResult>
  updateInventoryItem: (input: UpdateInventoryItemInput) => Promise<UpdateInventoryItemResult>
  deactivateInventoryItem: (input: InventoryItemIdInput) => Promise<MutateInventoryItemResult>
  reactivateInventoryItem: (input: InventoryItemIdInput) => Promise<MutateInventoryItemResult>
  listAssignableUnitsOfMeasure: () => Promise<ListAssignableUnitsOfMeasureResult>
}
