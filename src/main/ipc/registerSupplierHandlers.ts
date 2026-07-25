import { ipcMain } from 'electron'
import {
  SUPPLIER_PRICES_GET_CURRENT_CHANNEL,
  SUPPLIER_PRICES_LIST_FOR_ITEM_CHANNEL,
  SUPPLIER_PRICES_LIST_FOR_SUPPLIER_CHANNEL,
  SUPPLIER_PRICES_RECORD_CHANNEL,
  SUPPLIERS_CREATE_CHANNEL,
  SUPPLIERS_DEACTIVATE_CHANNEL,
  SUPPLIERS_GET_CHANNEL,
  SUPPLIERS_LIST_CHANNEL,
  SUPPLIERS_REACTIVATE_CHANNEL,
  SUPPLIERS_UPDATE_CHANNEL,
  type CreateSupplierResult,
  type GetCurrentSupplierItemPriceResult,
  type GetSupplierResult,
  type ListSupplierItemPricesResult,
  type ListSuppliersResult,
  type MutateSupplierResult,
  type RecordSupplierPriceResult,
  type SafeSupplier,
  type SafeSupplierItemPrice,
  type SuppliersErrorCode,
  type SupplierIdInput,
  type UpdateSupplierResult
} from '../../shared/ipc/suppliers'
import type { NavigationPolicyContext } from '../security/navigationPolicy'
import { isApprovedIpcSender, type ApprovableIpcEvent } from '../security/senderValidation'
import { requireAuthorizedCaller } from '../auth/requireAuthorizedCaller'
import type { LoginService } from '../users/loginService'
import {
  createSupplier,
  deactivateSupplier,
  getSupplierById,
  listSuppliers,
  reactivateSupplier,
  SupplierServiceError,
  updateSupplier,
  type Supplier
} from '../db/supplierService'
import {
  DuplicateEffectivePriceError,
  getCurrentPriceForSupplierItem,
  listPricesForInventoryItem,
  listPricesForSupplier,
  recordSupplierPrice,
  SupplierPriceServiceError,
  type SupplierItemPrice
} from '../db/supplierPriceService'
import { SupplierValidationError } from '../db/validation/supplierValidation'
import { SupplierPriceValidationError } from '../db/validation/supplierPriceValidation'
import type { AppDb } from '../db/dbTypes'

class SuppliersIpcInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SuppliersIpcInputError'
  }
}

function requireApprovedSender(event: ApprovableIpcEvent, context: NavigationPolicyContext): void {
  if (!isApprovedIpcSender(event, context)) {
    throw new Error('LedgerPage: rejected suppliers request from an unapproved sender')
  }
}

function requireStringField(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new SuppliersIpcInputError(`${fieldName} must be a string`)
  }
  return value
}

function requireOptionalStringField(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined
  }
  return requireStringField(value, fieldName)
}

function requireNullableOptionalStringField(
  value: unknown,
  fieldName: string
): string | null | undefined {
  if (value === undefined || value === null) {
    return value
  }
  return requireStringField(value, fieldName)
}

function requireNumberField(value: unknown, fieldName: string): number {
  if (typeof value !== 'number') {
    throw new SuppliersIpcInputError(`${fieldName} must be a number`)
  }
  return value
}

function parseSupplierIdInput(input: unknown): SupplierIdInput {
  if (typeof input !== 'object' || input === null) {
    throw new SuppliersIpcInputError('input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return { supplierId: requireStringField(candidate.supplierId, 'supplierId') }
}

interface ParsedCreateSupplierInput {
  name: string
  contactDetails?: string | null
}

/**
 * Shape-only parsing — only the fields CreateSupplierInput actually
 * declares are ever read off the raw payload. An injected code, actor,
 * sessionId, companyId, isActive, or timestamp field on the raw object
 * is silently never looked at, structurally as much as behaviorally:
 * there is no code path here that would forward it anywhere.
 */
function parseCreateSupplierInput(input: unknown): ParsedCreateSupplierInput {
  if (typeof input !== 'object' || input === null) {
    throw new SuppliersIpcInputError('createSupplier input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    name: requireStringField(candidate.name, 'name'),
    contactDetails: requireNullableOptionalStringField(candidate.contactDetails, 'contactDetails')
  }
}

interface ParsedUpdateSupplierInput {
  supplierId: string
  name?: string
  contactDetails?: string | null
}

/**
 * code is never read off the raw payload here — not merely omitted
 * from the result, but never even inspected. An injected `code`
 * property on the raw update payload has no effect whatsoever.
 */
function parseUpdateSupplierInput(input: unknown): ParsedUpdateSupplierInput {
  if (typeof input !== 'object' || input === null) {
    throw new SuppliersIpcInputError('updateSupplier input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    supplierId: requireStringField(candidate.supplierId, 'supplierId'),
    name: requireOptionalStringField(candidate.name, 'name'),
    contactDetails: requireNullableOptionalStringField(candidate.contactDetails, 'contactDetails')
  }
}

interface ParsedRecordSupplierPriceInput {
  supplierId: string
  inventoryItemId: string
  priceMinor: number
  effectiveFrom: number
  supplierItemCode?: string | null
}

/**
 * currencyId is never read off the raw payload here — not merely
 * omitted from the result, but never even inspected. An injected
 * `currencyId` property on the raw payload has no effect whatsoever:
 * this function has no branch that would read that key, so there is no
 * path by which a caller-chosen currency could reach
 * supplierPriceService's recordSupplierPrice call below, which always
 * writes FUNCTIONAL_CURRENCY_ID itself.
 */
function parseRecordSupplierPriceInput(input: unknown): ParsedRecordSupplierPriceInput {
  if (typeof input !== 'object' || input === null) {
    throw new SuppliersIpcInputError('recordSupplierPrice input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    supplierId: requireStringField(candidate.supplierId, 'supplierId'),
    inventoryItemId: requireStringField(candidate.inventoryItemId, 'inventoryItemId'),
    priceMinor: requireNumberField(candidate.priceMinor, 'priceMinor'),
    effectiveFrom: requireNumberField(candidate.effectiveFrom, 'effectiveFrom'),
    supplierItemCode: requireNullableOptionalStringField(
      candidate.supplierItemCode,
      'supplierItemCode'
    )
  }
}

function parseSupplierItemPairInput(input: unknown): {
  supplierId: string
  inventoryItemId: string
} {
  if (typeof input !== 'object' || input === null) {
    throw new SuppliersIpcInputError('input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    supplierId: requireStringField(candidate.supplierId, 'supplierId'),
    inventoryItemId: requireStringField(candidate.inventoryItemId, 'inventoryItemId')
  }
}

function parseInventoryItemIdOnlyInput(input: unknown): { inventoryItemId: string } {
  if (typeof input !== 'object' || input === null) {
    throw new SuppliersIpcInputError('input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return { inventoryItemId: requireStringField(candidate.inventoryItemId, 'inventoryItemId') }
}

function toSafeSupplier(supplier: Supplier): SafeSupplier {
  return {
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    contactDetails: supplier.contactDetails,
    isActive: supplier.isActive,
    createdAt: supplier.createdAt.getTime(),
    updatedAt: supplier.updatedAt.getTime()
  }
}

function toSafeSupplierItemPrice(price: SupplierItemPrice): SafeSupplierItemPrice {
  return {
    id: price.id,
    supplierId: price.supplierId,
    supplierCode: price.supplierCode,
    supplierName: price.supplierName,
    supplierIsActive: price.supplierIsActive,
    inventoryItemId: price.inventoryItemId,
    inventoryItemCode: price.inventoryItemCode,
    inventoryItemName: price.inventoryItemName,
    inventoryItemIsActive: price.inventoryItemIsActive,
    unitOfMeasureLabel: price.unitOfMeasureLabel,
    supplierItemCode: price.supplierItemCode,
    priceMinor: price.priceMinor,
    currencyId: price.currencyId,
    effectiveFrom: price.effectiveFrom.getTime(),
    createdAt: price.createdAt.getTime()
  }
}

/**
 * Maps a thrown service-layer error to a safe, fixed errorCode — never
 * forwarding the error's own message to the renderer. instanceof checks
 * against named error classes, never string-matching against a message.
 */
function toErrorCode(error: unknown): SuppliersErrorCode {
  if (error instanceof DuplicateEffectivePriceError) {
    return 'duplicate_effective_price'
  }
  if (error instanceof SupplierValidationError || error instanceof SupplierPriceValidationError) {
    return 'invalid_input'
  }
  if (error instanceof SupplierPriceServiceError) {
    // Both "no supplier/item exists" and "supplier/item is not active"
    // map to invalid_input here — deliberately not not_found, since an
    // inactive-but-existing reference is a validation failure on the
    // request (recording a new price against it is what's invalid), not
    // a missing-resource failure.
    return 'invalid_input'
  }
  if (error instanceof SupplierServiceError && /^No supplier exists with id/.test(error.message)) {
    return 'not_found'
  }
  return 'unexpected_error'
}

export interface RegisterSupplierHandlersOptions {
  context: NavigationPolicyContext
  db: AppDb
  loginService: LoginService
}

/**
 * Registers every Slice 13 suppliers and supplier-pricing IPC handler.
 * Every handler is gated by requireAuthorizedCaller, resolved fresh
 * from SQLite on every call — never a renderer-supplied
 * canViewSuppliers/canManageSuppliers flag. Reads require
 * suppliers.read; all supplier mutations AND price recording require
 * suppliers.manage — there is no separate action for pricing, mirroring
 * how product_variants reuses products.read/products.manage directly.
 *
 * No update or delete channel exists for supplier prices — corrections
 * are recorded as new rows via SUPPLIER_PRICES_RECORD_CHANNEL only.
 */
export function registerSupplierHandlers(options: RegisterSupplierHandlersOptions): void {
  const { context, db, loginService } = options

  ipcMain.handle(SUPPLIERS_LIST_CHANNEL, (event): ListSuppliersResult => {
    requireApprovedSender(event, context)

    const authResult = requireAuthorizedCaller(db, loginService, 'suppliers.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      return { success: true, suppliers: listSuppliers(db).map(toSafeSupplier) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(SUPPLIERS_GET_CHANNEL, (event, rawInput: unknown): GetSupplierResult => {
    requireApprovedSender(event, context)

    let input: SupplierIdInput
    try {
      input = parseSupplierIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'suppliers.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    const supplier = getSupplierById(db, input.supplierId)
    if (!supplier) {
      return { success: false, errorCode: 'not_found' }
    }
    return { success: true, supplier: toSafeSupplier(supplier) }
  })

  ipcMain.handle(SUPPLIERS_CREATE_CHANNEL, (event, rawInput: unknown): CreateSupplierResult => {
    requireApprovedSender(event, context)

    let input: ParsedCreateSupplierInput
    try {
      input = parseCreateSupplierInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'suppliers.manage')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const supplier = createSupplier(db, input, {
        type: 'user',
        userId: authResult.callerUserId
      })
      return { success: true, supplier: toSafeSupplier(supplier) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(SUPPLIERS_UPDATE_CHANNEL, (event, rawInput: unknown): UpdateSupplierResult => {
    requireApprovedSender(event, context)

    let input: ParsedUpdateSupplierInput
    try {
      input = parseUpdateSupplierInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'suppliers.manage')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const supplier = updateSupplier(
        db,
        input.supplierId,
        { name: input.name, contactDetails: input.contactDetails },
        { type: 'user', userId: authResult.callerUserId }
      )
      return { success: true, supplier: toSafeSupplier(supplier) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(SUPPLIERS_DEACTIVATE_CHANNEL, (event, rawInput: unknown): MutateSupplierResult => {
    requireApprovedSender(event, context)

    let input: SupplierIdInput
    try {
      input = parseSupplierIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'suppliers.manage')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const supplier = deactivateSupplier(db, input.supplierId, {
        type: 'user',
        userId: authResult.callerUserId
      })
      return { success: true, supplier: toSafeSupplier(supplier) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(SUPPLIERS_REACTIVATE_CHANNEL, (event, rawInput: unknown): MutateSupplierResult => {
    requireApprovedSender(event, context)

    let input: SupplierIdInput
    try {
      input = parseSupplierIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'suppliers.manage')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const supplier = reactivateSupplier(db, input.supplierId, {
        type: 'user',
        userId: authResult.callerUserId
      })
      return { success: true, supplier: toSafeSupplier(supplier) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(
    SUPPLIER_PRICES_RECORD_CHANNEL,
    (event, rawInput: unknown): RecordSupplierPriceResult => {
      requireApprovedSender(event, context)

      let input: ParsedRecordSupplierPriceInput
      try {
        input = parseRecordSupplierPriceInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'suppliers.manage')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const price = recordSupplierPrice(
          db,
          {
            supplierId: input.supplierId,
            inventoryItemId: input.inventoryItemId,
            priceMinor: input.priceMinor,
            effectiveFrom: new Date(input.effectiveFrom),
            supplierItemCode: input.supplierItemCode
          },
          { type: 'user', userId: authResult.callerUserId }
        )
        return { success: true, price: toSafeSupplierItemPrice(price) }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(
    SUPPLIER_PRICES_LIST_FOR_SUPPLIER_CHANNEL,
    (event, rawInput: unknown): ListSupplierItemPricesResult => {
      requireApprovedSender(event, context)

      let input: SupplierIdInput
      try {
        input = parseSupplierIdInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'suppliers.read')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        return {
          success: true,
          prices: listPricesForSupplier(db, input.supplierId).map(toSafeSupplierItemPrice)
        }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(
    SUPPLIER_PRICES_LIST_FOR_ITEM_CHANNEL,
    (event, rawInput: unknown): ListSupplierItemPricesResult => {
      requireApprovedSender(event, context)

      let input: { inventoryItemId: string }
      try {
        input = parseInventoryItemIdOnlyInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'suppliers.read')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        return {
          success: true,
          prices: listPricesForInventoryItem(db, input.inventoryItemId).map(toSafeSupplierItemPrice)
        }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(
    SUPPLIER_PRICES_GET_CURRENT_CHANNEL,
    (event, rawInput: unknown): GetCurrentSupplierItemPriceResult => {
      requireApprovedSender(event, context)

      let input: { supplierId: string; inventoryItemId: string }
      try {
        input = parseSupplierItemPairInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'suppliers.read')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const price = getCurrentPriceForSupplierItem(db, input.supplierId, input.inventoryItemId)
        return { success: true, price: price ? toSafeSupplierItemPrice(price) : null }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )
}
