/**
 * Shared IPC contract for Slice 13's suppliers and supplier-pricing
 * channels.
 *
 * `code` never appears on UpdateSupplierInput — it is system-generated
 * at creation (via the existing frozen `supplier` numbering rule) and
 * immutable thereafter; there is no representable way for a caller to
 * supply or change it through an update.
 *
 * No update or delete channel exists for supplier prices anywhere in
 * this contract — supplier_item_prices is append-only; corrections are
 * recorded as new rows via SUPPLIER_PRICES_RECORD_CHANNEL.
 *
 * No dedicated "assignable inventory items" lookup is introduced here:
 * every role that holds suppliers.manage also holds inventory_items.read
 * (confirmed directly against authorizationService.ts's matrix), so the
 * existing inventory-items:list channel already safely satisfies the
 * price-recording form's item picker without a redundant new channel.
 */

export const SUPPLIERS_LIST_CHANNEL = 'suppliers:list' as const
export const SUPPLIERS_GET_CHANNEL = 'suppliers:get' as const
export const SUPPLIERS_CREATE_CHANNEL = 'suppliers:create' as const
export const SUPPLIERS_UPDATE_CHANNEL = 'suppliers:update' as const
export const SUPPLIERS_DEACTIVATE_CHANNEL = 'suppliers:deactivate' as const
export const SUPPLIERS_REACTIVATE_CHANNEL = 'suppliers:reactivate' as const

export const SUPPLIER_PRICES_RECORD_CHANNEL = 'suppliers:record-price' as const
export const SUPPLIER_PRICES_LIST_FOR_SUPPLIER_CHANNEL =
  'suppliers:list-prices-for-supplier' as const
export const SUPPLIER_PRICES_LIST_FOR_ITEM_CHANNEL =
  'suppliers:list-prices-for-inventory-item' as const
export const SUPPLIER_PRICES_GET_CURRENT_CHANNEL = 'suppliers:get-current-price' as const

export type SuppliersErrorCode =
  | 'not_authorized'
  | 'invalid_input'
  | 'not_found'
  | 'duplicate_effective_price'
  | 'session_invalid'
  | 'unexpected_error'

export interface SafeSupplier {
  id: string
  code: string
  name: string
  contactDetails: string | null
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export type ListSuppliersResult =
  { success: true; suppliers: SafeSupplier[] } | { success: false; errorCode: SuppliersErrorCode }

export interface SupplierIdInput {
  supplierId: string
}

export type GetSupplierResult =
  { success: true; supplier: SafeSupplier } | { success: false; errorCode: SuppliersErrorCode }

export interface CreateSupplierInput {
  name: string
  contactDetails?: string | null
}

export type CreateSupplierResult =
  { success: true; supplier: SafeSupplier } | { success: false; errorCode: SuppliersErrorCode }

export interface UpdateSupplierInput {
  supplierId: string
  name?: string
  contactDetails?: string | null
}

export type UpdateSupplierResult =
  { success: true; supplier: SafeSupplier } | { success: false; errorCode: SuppliersErrorCode }

export type MutateSupplierResult =
  { success: true; supplier: SafeSupplier } | { success: false; errorCode: SuppliersErrorCode }

/**
 * The full, resolved, renderer-safe shape of a single recorded price.
 * supplierLabel/inventoryItemLabel-style fields are resolved server-side
 * so the price-history view can display a supplier's and item's name
 * even if either has since been deactivated, without a second
 * round-trip — mirrors taxCodeLabel/unitOfMeasureLabel's precedent.
 * Never exposes company_id, actor, or any audit-internal field.
 */
export interface SafeSupplierItemPrice {
  id: string
  supplierId: string
  supplierCode: string
  supplierName: string
  supplierIsActive: boolean
  inventoryItemId: string
  inventoryItemCode: string
  inventoryItemName: string
  inventoryItemIsActive: boolean
  unitOfMeasureLabel: string
  supplierItemCode: string | null
  priceMinor: number
  currencyId: string
  effectiveFrom: number
  createdAt: number
}

export interface RecordSupplierPriceInput {
  supplierId: string
  inventoryItemId: string
  priceMinor: number
  effectiveFrom: number
  supplierItemCode?: string | null
}

export type RecordSupplierPriceResult =
  | { success: true; price: SafeSupplierItemPrice }
  | { success: false; errorCode: SuppliersErrorCode }

export type ListSupplierItemPricesResult =
  | { success: true; prices: SafeSupplierItemPrice[] }
  | { success: false; errorCode: SuppliersErrorCode }

export interface SupplierItemPairInput {
  supplierId: string
  inventoryItemId: string
}

export type GetCurrentSupplierItemPriceResult =
  | { success: true; price: SafeSupplierItemPrice | null }
  | { success: false; errorCode: SuppliersErrorCode }

export interface LedgerPageSuppliersApi {
  listSuppliers: () => Promise<ListSuppliersResult>
  getSupplier: (input: SupplierIdInput) => Promise<GetSupplierResult>
  createSupplier: (input: CreateSupplierInput) => Promise<CreateSupplierResult>
  updateSupplier: (input: UpdateSupplierInput) => Promise<UpdateSupplierResult>
  deactivateSupplier: (input: SupplierIdInput) => Promise<MutateSupplierResult>
  reactivateSupplier: (input: SupplierIdInput) => Promise<MutateSupplierResult>
  recordSupplierPrice: (input: RecordSupplierPriceInput) => Promise<RecordSupplierPriceResult>
  listPricesForSupplier: (input: SupplierIdInput) => Promise<ListSupplierItemPricesResult>
  listPricesForInventoryItem: (
    input: Pick<SupplierItemPairInput, 'inventoryItemId'>
  ) => Promise<ListSupplierItemPricesResult>
  getCurrentSupplierItemPrice: (
    input: SupplierItemPairInput
  ) => Promise<GetCurrentSupplierItemPriceResult>
}
