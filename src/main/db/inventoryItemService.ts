import { randomUUID } from 'node:crypto'
import { and, eq, ne } from 'drizzle-orm'
import { company, inventoryItems, PRIMARY_COMPANY_ID, unitsOfMeasure } from './schema'
import {
  InventoryItemValidationError,
  normalizeInventoryItemCode,
  requireMaximumStockAtLeastMinimumStock,
  requireNonNegativeIntegerQuantity,
  requireNullableNonNegativeIntegerQuantity,
  requireTrimmedInventoryItemCategory,
  requireTrimmedInventoryItemName,
  requireValidInventoryItemType,
  type InventoryItemType
} from './validation/inventoryItemValidation'
import { record, type AuditActor } from '../audit/auditService'
import type { AppDb } from './dbTypes'

export class InventoryItemServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InventoryItemServiceError'
  }
}

/**
 * Thrown by the service layer, never the raw SQLite unique-constraint
 * error — matching productVariantService's DuplicateVariantCodeError
 * precedent exactly, so the IPC layer can map this to a clean,
 * catchable errorCode rather than a raw constraint-violation message.
 */
export class DuplicateInventoryItemCodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateInventoryItemCodeError'
  }
}

export interface InventoryItem {
  id: string
  companyId: string
  code: string
  name: string
  category: string
  itemType: InventoryItemType
  unitOfMeasureId: string
  /**
   * The referenced unit's own `code` (e.g. "kg"), resolved server-side
   * via a LEFT JOIN on every read, mirroring productVariantService's
   * taxCodeLabel pattern exactly -- resolved regardless of whether that
   * unit is currently active, so the edit form can display "currently
   * references kg" even after kg is deactivated, without kg ever
   * becoming newly assignable again (listAssignableUnitsOfMeasure is a
   * separate, active-only read path). Unlike taxCodeLabel, this column
   * is never null in practice: unit_of_measure_id is NOT NULL and
   * references a table nothing in this codebase ever deletes from, so
   * the join always finds a match.
   */
  unitOfMeasureLabel: string
  minimumStock: number
  reorderQuantity: number
  maximumStock: number | null
  leadTimeDays: number
  lotTracked: boolean
  expiryTracked: boolean
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateInventoryItemInput {
  code: string
  name: string
  category: string
  /**
   * Deliberately plain string, not InventoryItemType -- matching
   * CreateProductInput.type's own precedent. requireValidInventoryItemType
   * validates and narrows it internally.
   */
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
 * code and itemType are both immutable after creation -- approved
 * decision for code (no numbering rule, ordinary user-entered input,
 * but frozen thereafter), and itemType is deliberately excluded from
 * this type entirely, a structural guarantee (not merely a
 * runtime-rejected one) that no caller can even attempt to change it.
 */
export interface UpdateInventoryItemInput {
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

function requireCompanyExists(db: AppDb): void {
  const found = db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.id, PRIMARY_COMPANY_ID))
    .get()
  if (!found) {
    throw new InventoryItemServiceError(
      'Cannot manage inventory items: no company profile exists yet. Complete first-run setup first.'
    )
  }
}

function requireUniqueCode(db: AppDb, normalizedCode: string, excludeItemId?: string): void {
  const conditions = [
    eq(inventoryItems.companyId, PRIMARY_COMPANY_ID),
    eq(inventoryItems.code, normalizedCode)
  ]
  if (excludeItemId) {
    conditions.push(ne(inventoryItems.id, excludeItemId))
  }
  const existing = db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(and(...conditions))
    .get()
  if (existing) {
    throw new DuplicateInventoryItemCodeError(
      `An inventory item with the normalized code "${normalizedCode}" already exists`
    )
  }
}

/**
 * Required at creation, and required again whenever an update actually
 * changes unitOfMeasureId to a different value -- an unrelated update
 * that leaves unitOfMeasureId unchanged never re-validates it, so an
 * item already referencing a unit that has since been deactivated keeps
 * working normally until someone deliberately picks a different unit.
 */
function requireActiveUnitOfMeasure(db: AppDb, unitOfMeasureId: string): void {
  const unit = db
    .select({ isActive: unitsOfMeasure.isActive })
    .from(unitsOfMeasure)
    .where(eq(unitsOfMeasure.id, unitOfMeasureId))
    .get()
  if (!unit) {
    throw new InventoryItemValidationError(`No unit of measure exists with id "${unitOfMeasureId}"`)
  }
  if (!unit.isActive) {
    throw new InventoryItemValidationError(
      `Unit of measure "${unitOfMeasureId}" is not active and cannot be newly assigned`
    )
  }
}

interface JoinedInventoryItemRow {
  id: string
  companyId: string
  code: string
  name: string
  category: string
  itemType: string
  unitOfMeasureId: string
  minimumStock: number
  reorderQuantity: number
  maximumStock: number | null
  leadTimeDays: number
  lotTracked: boolean
  expiryTracked: boolean
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  unitOfMeasureLabel: string | null
}

const INVENTORY_ITEM_JOIN_COLUMNS = {
  id: inventoryItems.id,
  companyId: inventoryItems.companyId,
  code: inventoryItems.code,
  name: inventoryItems.name,
  category: inventoryItems.category,
  itemType: inventoryItems.itemType,
  unitOfMeasureId: inventoryItems.unitOfMeasureId,
  minimumStock: inventoryItems.minimumStock,
  reorderQuantity: inventoryItems.reorderQuantity,
  maximumStock: inventoryItems.maximumStock,
  leadTimeDays: inventoryItems.leadTimeDays,
  lotTracked: inventoryItems.lotTracked,
  expiryTracked: inventoryItems.expiryTracked,
  isActive: inventoryItems.isActive,
  createdAt: inventoryItems.createdAt,
  updatedAt: inventoryItems.updatedAt,
  unitOfMeasureLabel: unitsOfMeasure.code
}

export function listInventoryItems(db: AppDb): InventoryItem[] {
  const rows = db
    .select(INVENTORY_ITEM_JOIN_COLUMNS)
    .from(inventoryItems)
    .leftJoin(unitsOfMeasure, eq(inventoryItems.unitOfMeasureId, unitsOfMeasure.id))
    .where(eq(inventoryItems.companyId, PRIMARY_COMPANY_ID))
    .all()
  return rows.map(toInventoryItem)
}

export function getInventoryItemById(db: AppDb, id: string): InventoryItem | undefined {
  const row = db
    .select(INVENTORY_ITEM_JOIN_COLUMNS)
    .from(inventoryItems)
    .leftJoin(unitsOfMeasure, eq(inventoryItems.unitOfMeasureId, unitsOfMeasure.id))
    .where(and(eq(inventoryItems.companyId, PRIMARY_COMPANY_ID), eq(inventoryItems.id, id)))
    .get()
  return row ? toInventoryItem(row) : undefined
}

export function createInventoryItem(
  db: AppDb,
  input: CreateInventoryItemInput,
  actor: AuditActor,
  now: Date = new Date()
): InventoryItem {
  requireCompanyExists(db)

  const code = normalizeInventoryItemCode(input.code)
  const name = requireTrimmedInventoryItemName(input.name)
  const category = requireTrimmedInventoryItemCategory(input.category)
  const itemType = requireValidInventoryItemType(input.itemType)
  const minimumStock = requireNonNegativeIntegerQuantity(input.minimumStock, 'minimumStock')
  const reorderQuantity = requireNonNegativeIntegerQuantity(
    input.reorderQuantity,
    'reorderQuantity'
  )
  const maximumStock = requireNullableNonNegativeIntegerQuantity(input.maximumStock, 'maximumStock')
  const leadTimeDays = requireNonNegativeIntegerQuantity(input.leadTimeDays, 'leadTimeDays')
  requireMaximumStockAtLeastMinimumStock(maximumStock, minimumStock)
  requireUniqueCode(db, code)
  requireActiveUnitOfMeasure(db, input.unitOfMeasureId)

  const id = `inventory_item_${randomUUID()}`
  const lotTracked = input.lotTracked ?? false
  const expiryTracked = input.expiryTracked ?? false

  db.transaction((tx) => {
    tx.insert(inventoryItems)
      .values({
        id,
        companyId: PRIMARY_COMPANY_ID,
        code,
        name,
        category,
        itemType,
        unitOfMeasureId: input.unitOfMeasureId,
        minimumStock,
        reorderQuantity,
        maximumStock,
        leadTimeDays,
        lotTracked,
        expiryTracked,
        isActive: true,
        createdAt: now,
        updatedAt: now
      })
      .run()

    record(
      tx,
      {
        entityType: 'inventory_item',
        entityId: id,
        entityLabel: code,
        action: 'create',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: null,
        after: {
          code,
          name,
          category,
          itemType,
          unitOfMeasureId: input.unitOfMeasureId,
          minimumStock,
          reorderQuantity,
          maximumStock,
          leadTimeDays,
          lotTracked,
          expiryTracked,
          isActive: true
        }
      },
      now
    )
  })

  const created = getInventoryItemById(db, id)
  if (!created) {
    throw new InventoryItemServiceError('Inventory item was not persisted after creation')
  }
  return created
}

export function updateInventoryItem(
  db: AppDb,
  id: string,
  input: UpdateInventoryItemInput,
  actor: AuditActor,
  now: Date = new Date()
): InventoryItem {
  const existing = getInventoryItemById(db, id)
  if (!existing) {
    throw new InventoryItemServiceError(`No inventory item exists with id "${id}"`)
  }

  const name =
    input.name !== undefined ? requireTrimmedInventoryItemName(input.name) : existing.name
  const category =
    input.category !== undefined
      ? requireTrimmedInventoryItemCategory(input.category)
      : existing.category
  const unitOfMeasureId =
    input.unitOfMeasureId !== undefined ? input.unitOfMeasureId : existing.unitOfMeasureId
  const minimumStock =
    input.minimumStock !== undefined
      ? requireNonNegativeIntegerQuantity(input.minimumStock, 'minimumStock')
      : existing.minimumStock
  const reorderQuantity =
    input.reorderQuantity !== undefined
      ? requireNonNegativeIntegerQuantity(input.reorderQuantity, 'reorderQuantity')
      : existing.reorderQuantity
  const maximumStock =
    input.maximumStock !== undefined
      ? requireNullableNonNegativeIntegerQuantity(input.maximumStock, 'maximumStock')
      : existing.maximumStock
  const leadTimeDays =
    input.leadTimeDays !== undefined
      ? requireNonNegativeIntegerQuantity(input.leadTimeDays, 'leadTimeDays')
      : existing.leadTimeDays
  const lotTracked = input.lotTracked !== undefined ? input.lotTracked : existing.lotTracked
  const expiryTracked =
    input.expiryTracked !== undefined ? input.expiryTracked : existing.expiryTracked

  requireMaximumStockAtLeastMinimumStock(maximumStock, minimumStock)
  if (unitOfMeasureId !== existing.unitOfMeasureId) {
    requireActiveUnitOfMeasure(db, unitOfMeasureId)
  }

  db.transaction((tx) => {
    tx.update(inventoryItems)
      .set({
        name,
        category,
        unitOfMeasureId,
        minimumStock,
        reorderQuantity,
        maximumStock,
        leadTimeDays,
        lotTracked,
        expiryTracked,
        updatedAt: now
      })
      .where(and(eq(inventoryItems.companyId, PRIMARY_COMPANY_ID), eq(inventoryItems.id, id)))
      .run()

    record(
      tx,
      {
        entityType: 'inventory_item',
        entityId: id,
        entityLabel: existing.code,
        action: 'update',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: {
          name: existing.name,
          category: existing.category,
          unitOfMeasureId: existing.unitOfMeasureId,
          minimumStock: existing.minimumStock,
          reorderQuantity: existing.reorderQuantity,
          maximumStock: existing.maximumStock,
          leadTimeDays: existing.leadTimeDays,
          lotTracked: existing.lotTracked,
          expiryTracked: existing.expiryTracked
        },
        after: {
          name,
          category,
          unitOfMeasureId,
          minimumStock,
          reorderQuantity,
          maximumStock,
          leadTimeDays,
          lotTracked,
          expiryTracked
        }
      },
      now
    )
  })

  const updated = getInventoryItemById(db, id)
  if (!updated) {
    throw new InventoryItemServiceError('Inventory item disappeared during update')
  }
  return updated
}

export function deactivateInventoryItem(
  db: AppDb,
  id: string,
  actor: AuditActor,
  now: Date = new Date()
): InventoryItem {
  return setActiveState(db, id, false, actor, now)
}

export function reactivateInventoryItem(
  db: AppDb,
  id: string,
  actor: AuditActor,
  now: Date = new Date()
): InventoryItem {
  return setActiveState(db, id, true, actor, now)
}

function setActiveState(
  db: AppDb,
  id: string,
  isActive: boolean,
  actor: AuditActor,
  now: Date
): InventoryItem {
  const existing = getInventoryItemById(db, id)
  if (!existing) {
    throw new InventoryItemServiceError(`No inventory item exists with id "${id}"`)
  }

  db.transaction((tx) => {
    tx.update(inventoryItems)
      .set({ isActive, updatedAt: now })
      .where(and(eq(inventoryItems.companyId, PRIMARY_COMPANY_ID), eq(inventoryItems.id, id)))
      .run()

    record(
      tx,
      {
        entityType: 'inventory_item',
        entityId: id,
        entityLabel: existing.code,
        action: isActive ? 'reactivate' : 'deactivate',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: { isActive: existing.isActive },
        after: { isActive }
      },
      now
    )
  })

  const updated = getInventoryItemById(db, id)
  if (!updated) {
    throw new InventoryItemServiceError(
      'Inventory item disappeared during deactivation/reactivation'
    )
  }
  return updated
}

function toInventoryItem(row: JoinedInventoryItemRow): InventoryItem {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    name: row.name,
    category: row.category,
    itemType: row.itemType as InventoryItemType,
    unitOfMeasureId: row.unitOfMeasureId,
    // See this file's InventoryItem doc comment: never actually null in
    // practice, since unit_of_measure_id is NOT NULL and nothing deletes
    // units_of_measure rows -- the fallback is defense-in-depth only.
    unitOfMeasureLabel: row.unitOfMeasureLabel ?? row.unitOfMeasureId,
    minimumStock: row.minimumStock,
    reorderQuantity: row.reorderQuantity,
    maximumStock: row.maximumStock,
    leadTimeDays: row.leadTimeDays,
    lotTracked: row.lotTracked,
    expiryTracked: row.expiryTracked,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export { InventoryItemValidationError }
