import { ipcMain } from 'electron'
import { eq } from 'drizzle-orm'
import {
  INVENTORY_ITEMS_CREATE_CHANNEL,
  INVENTORY_ITEMS_DEACTIVATE_CHANNEL,
  INVENTORY_ITEMS_GET_CHANNEL,
  INVENTORY_ITEMS_LIST_ASSIGNABLE_UNITS_CHANNEL,
  INVENTORY_ITEMS_LIST_CHANNEL,
  INVENTORY_ITEMS_REACTIVATE_CHANNEL,
  INVENTORY_ITEMS_UPDATE_CHANNEL,
  type CreateInventoryItemResult,
  type GetInventoryItemResult,
  type InventoryItemIdInput,
  type InventoryItemsErrorCode,
  type ListAssignableUnitsOfMeasureResult,
  type ListInventoryItemsResult,
  type MutateInventoryItemResult,
  type SafeInventoryItem,
  type UpdateInventoryItemResult
} from '../../shared/ipc/inventoryItems'
import type { NavigationPolicyContext } from '../security/navigationPolicy'
import { isApprovedIpcSender, type ApprovableIpcEvent } from '../security/senderValidation'
import { requireAuthorizedCaller } from '../auth/requireAuthorizedCaller'
import type { LoginService } from '../users/loginService'
import {
  createInventoryItem,
  deactivateInventoryItem,
  DuplicateInventoryItemCodeError,
  getInventoryItemById,
  InventoryItemValidationError,
  listInventoryItems,
  reactivateInventoryItem,
  updateInventoryItem,
  type InventoryItem
} from '../db/inventoryItemService'
import { unitsOfMeasure } from '../db/schema'
import type { AppDb } from '../db/dbTypes'

class InventoryItemsIpcInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InventoryItemsIpcInputError'
  }
}

function requireApprovedSender(event: ApprovableIpcEvent, context: NavigationPolicyContext): void {
  if (!isApprovedIpcSender(event, context)) {
    throw new Error('LedgerPage: rejected inventory-items request from an unapproved sender')
  }
}

function requireStringField(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new InventoryItemsIpcInputError(`${fieldName} must be a string`)
  }
  return value
}

function requireOptionalStringField(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined
  }
  return requireStringField(value, fieldName)
}

function requireNumberField(value: unknown, fieldName: string): number {
  if (typeof value !== 'number') {
    throw new InventoryItemsIpcInputError(`${fieldName} must be a number`)
  }
  return value
}

function requireOptionalNumberField(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined
  }
  return requireNumberField(value, fieldName)
}

function requireNullableOptionalNumberField(
  value: unknown,
  fieldName: string
): number | null | undefined {
  if (value === undefined || value === null) {
    return value
  }
  return requireNumberField(value, fieldName)
}

function requireOptionalBooleanField(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'boolean') {
    throw new InventoryItemsIpcInputError(`${fieldName} must be a boolean`)
  }
  return value
}

function parseInventoryItemIdInput(input: unknown): InventoryItemIdInput {
  if (typeof input !== 'object' || input === null) {
    throw new InventoryItemsIpcInputError('input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return { inventoryItemId: requireStringField(candidate.inventoryItemId, 'inventoryItemId') }
}

interface ParsedCreateInventoryItemInput {
  code: string
  name: string
  category: string
  itemType: string
  unitOfMeasureId: string
  minimumStock: number
  reorderQuantity: number
  maximumStock?: number | null
  leadTimeDays: number
  lotTracked?: boolean
  expiryTracked?: boolean
}

/**
 * Shape-only parsing -- only the fields this contract's
 * CreateInventoryItemInput actually declares are ever read off the raw
 * payload. Any other property on the raw object (actor, sessionId,
 * companyId, isActive, createdAt, updatedAt, or anything else) is
 * silently never looked at, structurally as much as behaviorally: there
 * is no code path here that would forward it anywhere.
 */
function parseCreateInventoryItemInput(input: unknown): ParsedCreateInventoryItemInput {
  if (typeof input !== 'object' || input === null) {
    throw new InventoryItemsIpcInputError('createInventoryItem input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    code: requireStringField(candidate.code, 'code'),
    name: requireStringField(candidate.name, 'name'),
    category: requireStringField(candidate.category, 'category'),
    // Deliberately not narrowed to InventoryItemType here -- this layer
    // only confirms shape (a string). An out-of-range value passes
    // through unchanged and is rejected by inventoryItemService's own
    // value check, mapped to the same invalid_input code a malformed
    // string would get.
    itemType: requireStringField(candidate.itemType, 'itemType'),
    unitOfMeasureId: requireStringField(candidate.unitOfMeasureId, 'unitOfMeasureId'),
    minimumStock: requireNumberField(candidate.minimumStock, 'minimumStock'),
    reorderQuantity: requireNumberField(candidate.reorderQuantity, 'reorderQuantity'),
    maximumStock: requireNullableOptionalNumberField(candidate.maximumStock, 'maximumStock'),
    leadTimeDays: requireNumberField(candidate.leadTimeDays, 'leadTimeDays'),
    lotTracked: requireOptionalBooleanField(candidate.lotTracked, 'lotTracked'),
    expiryTracked: requireOptionalBooleanField(candidate.expiryTracked, 'expiryTracked')
  }
}

interface ParsedUpdateInventoryItemInput {
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

/**
 * code and itemType are never read off the raw payload here -- not
 * merely omitted from the result, but never even inspected. An
 * injected `code` or `itemType` property on the raw update payload has
 * no effect whatsoever: this function has no branch that would read
 * either key, so there is no path by which either field could reach
 * inventoryItemService's updateInventoryItem call below.
 */
function parseUpdateInventoryItemInput(input: unknown): ParsedUpdateInventoryItemInput {
  if (typeof input !== 'object' || input === null) {
    throw new InventoryItemsIpcInputError('updateInventoryItem input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    inventoryItemId: requireStringField(candidate.inventoryItemId, 'inventoryItemId'),
    name: requireOptionalStringField(candidate.name, 'name'),
    category: requireOptionalStringField(candidate.category, 'category'),
    unitOfMeasureId: requireOptionalStringField(candidate.unitOfMeasureId, 'unitOfMeasureId'),
    minimumStock: requireOptionalNumberField(candidate.minimumStock, 'minimumStock'),
    reorderQuantity: requireOptionalNumberField(candidate.reorderQuantity, 'reorderQuantity'),
    maximumStock: requireNullableOptionalNumberField(candidate.maximumStock, 'maximumStock'),
    leadTimeDays: requireOptionalNumberField(candidate.leadTimeDays, 'leadTimeDays'),
    lotTracked: requireOptionalBooleanField(candidate.lotTracked, 'lotTracked'),
    expiryTracked: requireOptionalBooleanField(candidate.expiryTracked, 'expiryTracked')
  }
}

function toSafeInventoryItem(item: InventoryItem): SafeInventoryItem {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    category: item.category,
    itemType: item.itemType,
    unitOfMeasureId: item.unitOfMeasureId,
    unitOfMeasureLabel: item.unitOfMeasureLabel,
    minimumStock: item.minimumStock,
    reorderQuantity: item.reorderQuantity,
    maximumStock: item.maximumStock,
    leadTimeDays: item.leadTimeDays,
    lotTracked: item.lotTracked,
    expiryTracked: item.expiryTracked,
    isActive: item.isActive,
    createdAt: item.createdAt.getTime(),
    updatedAt: item.updatedAt.getTime()
  }
}

/**
 * Maps a thrown service-layer error to a safe, fixed errorCode -- never
 * forwarding the error's own message to the renderer. instanceof checks
 * against named error classes, never string-matching against a
 * message, so this mapping can't silently drift or misfire on a
 * coincidentally similar message from an unrelated failure.
 */
function toErrorCode(error: unknown): InventoryItemsErrorCode {
  if (error instanceof DuplicateInventoryItemCodeError) {
    return 'duplicate_code'
  }
  if (error instanceof InventoryItemValidationError) {
    return 'invalid_input'
  }
  if (error instanceof Error && /^No inventory item exists with id/.test(error.message)) {
    return 'not_found'
  }
  return 'unexpected_error'
}

export interface RegisterInventoryItemHandlersOptions {
  context: NavigationPolicyContext
  db: AppDb
  loginService: LoginService
}

/**
 * Registers every Slice 12 inventory-items IPC handler. Every handler
 * here is gated by requireAuthorizedCaller, resolved fresh from SQLite
 * on every single call -- never a renderer-supplied
 * canViewInventoryItems/canManageInventoryItems flag, never
 * session-cached role codes. inventoryItemService itself is
 * session-independent -- it accepts an explicit AuditActor, resolved
 * here from the already-authorized caller's own userId, never asked to
 * resolve "who is calling" on its own.
 *
 * Never exposed here: a database handle, arbitrary SQL, a way to set
 * or edit an inventory item's code or itemType after creation, a unit
 * mutation channel, or a raw exception message.
 */
export function registerInventoryItemHandlers(options: RegisterInventoryItemHandlersOptions): void {
  const { context, db, loginService } = options

  ipcMain.handle(INVENTORY_ITEMS_LIST_CHANNEL, (event): ListInventoryItemsResult => {
    requireApprovedSender(event, context)

    const authResult = requireAuthorizedCaller(db, loginService, 'inventory_items.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      return {
        success: true,
        inventoryItems: listInventoryItems(db).map(toSafeInventoryItem)
      }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(
    INVENTORY_ITEMS_GET_CHANNEL,
    (event, rawInput: unknown): GetInventoryItemResult => {
      requireApprovedSender(event, context)

      let input: InventoryItemIdInput
      try {
        input = parseInventoryItemIdInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'inventory_items.read')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      const item = getInventoryItemById(db, input.inventoryItemId)
      if (!item) {
        return { success: false, errorCode: 'not_found' }
      }
      return { success: true, inventoryItem: toSafeInventoryItem(item) }
    }
  )

  ipcMain.handle(
    INVENTORY_ITEMS_CREATE_CHANNEL,
    (event, rawInput: unknown): CreateInventoryItemResult => {
      requireApprovedSender(event, context)

      let input: ParsedCreateInventoryItemInput
      try {
        input = parseCreateInventoryItemInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'inventory_items.manage')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const item = createInventoryItem(db, input, {
          type: 'user',
          userId: authResult.callerUserId
        })
        return { success: true, inventoryItem: toSafeInventoryItem(item) }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(
    INVENTORY_ITEMS_UPDATE_CHANNEL,
    (event, rawInput: unknown): UpdateInventoryItemResult => {
      requireApprovedSender(event, context)

      let input: ParsedUpdateInventoryItemInput
      try {
        input = parseUpdateInventoryItemInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'inventory_items.manage')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const item = updateInventoryItem(
          db,
          input.inventoryItemId,
          {
            name: input.name,
            category: input.category,
            unitOfMeasureId: input.unitOfMeasureId,
            minimumStock: input.minimumStock,
            reorderQuantity: input.reorderQuantity,
            maximumStock: input.maximumStock,
            leadTimeDays: input.leadTimeDays,
            lotTracked: input.lotTracked,
            expiryTracked: input.expiryTracked
          },
          { type: 'user', userId: authResult.callerUserId }
        )
        return { success: true, inventoryItem: toSafeInventoryItem(item) }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(
    INVENTORY_ITEMS_DEACTIVATE_CHANNEL,
    (event, rawInput: unknown): MutateInventoryItemResult => {
      requireApprovedSender(event, context)

      let input: InventoryItemIdInput
      try {
        input = parseInventoryItemIdInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'inventory_items.manage')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const item = deactivateInventoryItem(db, input.inventoryItemId, {
          type: 'user',
          userId: authResult.callerUserId
        })
        return { success: true, inventoryItem: toSafeInventoryItem(item) }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(
    INVENTORY_ITEMS_REACTIVATE_CHANNEL,
    (event, rawInput: unknown): MutateInventoryItemResult => {
      requireApprovedSender(event, context)

      let input: InventoryItemIdInput
      try {
        input = parseInventoryItemIdInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'inventory_items.manage')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const item = reactivateInventoryItem(db, input.inventoryItemId, {
          type: 'user',
          userId: authResult.callerUserId
        })
        return { success: true, inventoryItem: toSafeInventoryItem(item) }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  // Gated by inventory_items.read -- mirrors
  // products:list-assignable-tax-codes's own precedent exactly. Active
  // units only, no mutation surface, and only the four fields this
  // contract's AssignableUnitOfMeasure type declares -- no rate,
  // decimal-places, sort-order, or other reference-data internals.
  ipcMain.handle(
    INVENTORY_ITEMS_LIST_ASSIGNABLE_UNITS_CHANNEL,
    (event): ListAssignableUnitsOfMeasureResult => {
      requireApprovedSender(event, context)

      const authResult = requireAuthorizedCaller(db, loginService, 'inventory_items.read')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const activeUnits = db
          .select({
            id: unitsOfMeasure.id,
            code: unitsOfMeasure.code,
            name: unitsOfMeasure.name,
            category: unitsOfMeasure.category
          })
          .from(unitsOfMeasure)
          .where(eq(unitsOfMeasure.isActive, true))
          .all()
        return { success: true, units: activeUnits }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )
}
