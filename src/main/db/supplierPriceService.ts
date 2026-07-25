import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import {
  FUNCTIONAL_CURRENCY_ID,
  inventoryItems,
  PRIMARY_COMPANY_ID,
  suppliers,
  supplierItemPrices,
  unitsOfMeasure
} from './schema'
import {
  normalizeSupplierItemCode,
  requireNonNegativeSafeIntegerPrice,
  requireValidEffectiveFrom
} from './validation/supplierPriceValidation'
import { record, type AuditActor } from '../audit/auditService'
import type { AppDb } from './dbTypes'

export class SupplierPriceServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupplierPriceServiceError'
  }
}

/**
 * Thrown by the service layer, never the raw SQLite unique-constraint
 * error -- matching productVariantService's DuplicateVariantCodeError
 * precedent exactly. The service pre-checks for an existing row with
 * the same (supplierId, inventoryItemId, effectiveFrom) before
 * inserting, rather than catching the constraint violation after the
 * fact, matching requireUniqueCodeWithinProduct's own established
 * approach.
 */
export class DuplicateEffectivePriceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateEffectivePriceError'
  }
}

export interface SupplierItemPrice {
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
  effectiveFrom: Date
  createdAt: Date
}

export interface RecordSupplierPriceInput {
  supplierId: string
  inventoryItemId: string
  priceMinor: number
  effectiveFrom: Date
  supplierItemCode?: string | null
}

function requireActiveSupplier(db: AppDb, supplierId: string): void {
  const supplier = db
    .select({ isActive: suppliers.isActive })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .get()
  if (!supplier) {
    throw new SupplierPriceServiceError(`No supplier exists with id "${supplierId}"`)
  }
  if (!supplier.isActive) {
    throw new SupplierPriceServiceError(
      `Supplier "${supplierId}" is not active; a new price cannot be recorded against it`
    )
  }
}

function requireActiveInventoryItem(db: AppDb, inventoryItemId: string): void {
  const item = db
    .select({ isActive: inventoryItems.isActive })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, inventoryItemId))
    .get()
  if (!item) {
    throw new SupplierPriceServiceError(`No inventory item exists with id "${inventoryItemId}"`)
  }
  if (!item.isActive) {
    throw new SupplierPriceServiceError(
      `Inventory item "${inventoryItemId}" is not active; a new price cannot be recorded against it`
    )
  }
}

function requireNoExistingRowAtSameEffectiveMoment(
  db: AppDb,
  supplierId: string,
  inventoryItemId: string,
  effectiveFrom: Date
): void {
  const existing = db
    .select({ id: supplierItemPrices.id })
    .from(supplierItemPrices)
    .where(
      and(
        eq(supplierItemPrices.supplierId, supplierId),
        eq(supplierItemPrices.inventoryItemId, inventoryItemId),
        eq(supplierItemPrices.effectiveFrom, effectiveFrom)
      )
    )
    .get()
  if (existing) {
    throw new DuplicateEffectivePriceError(
      `A price already exists for this supplier and item at the same effective timestamp`
    )
  }
}

const PRICE_JOIN_COLUMNS = {
  id: supplierItemPrices.id,
  supplierId: supplierItemPrices.supplierId,
  supplierCode: suppliers.code,
  supplierName: suppliers.name,
  supplierIsActive: suppliers.isActive,
  inventoryItemId: supplierItemPrices.inventoryItemId,
  inventoryItemCode: inventoryItems.code,
  inventoryItemName: inventoryItems.name,
  inventoryItemIsActive: inventoryItems.isActive,
  unitOfMeasureLabel: unitsOfMeasure.code,
  supplierItemCode: supplierItemPrices.supplierItemCode,
  priceMinor: supplierItemPrices.priceMinor,
  currencyId: supplierItemPrices.currencyId,
  effectiveFrom: supplierItemPrices.effectiveFrom,
  createdAt: supplierItemPrices.createdAt
}

function joinedPriceQuery(db: AppDb) {
  return db
    .select(PRICE_JOIN_COLUMNS)
    .from(supplierItemPrices)
    .innerJoin(suppliers, eq(supplierItemPrices.supplierId, suppliers.id))
    .innerJoin(inventoryItems, eq(supplierItemPrices.inventoryItemId, inventoryItems.id))
    .innerJoin(unitsOfMeasure, eq(inventoryItems.unitOfMeasureId, unitsOfMeasure.id))
}

/**
 * Records a new supplier price. Requires both the supplier and the
 * inventory item to be currently active (approved decision) -- an
 * existing historical row is never affected by either side's later
 * deactivation; only recording a NEW price is gated this way.
 * currencyId is always FUNCTIONAL_CURRENCY_ID, never accepted from the
 * caller. No update or delete path exists for this table anywhere in
 * this codebase -- corrections are recorded as new rows, matching the
 * append-only design.
 */
export function recordSupplierPrice(
  db: AppDb,
  input: RecordSupplierPriceInput,
  actor: AuditActor,
  now: Date = new Date()
): SupplierItemPrice {
  requireActiveSupplier(db, input.supplierId)
  requireActiveInventoryItem(db, input.inventoryItemId)

  const priceMinor = requireNonNegativeSafeIntegerPrice(input.priceMinor)
  const effectiveFrom = requireValidEffectiveFrom(input.effectiveFrom)
  const supplierItemCode = normalizeSupplierItemCode(input.supplierItemCode)

  requireNoExistingRowAtSameEffectiveMoment(
    db,
    input.supplierId,
    input.inventoryItemId,
    effectiveFrom
  )

  const id = `supplier_item_price_${randomUUID()}`

  db.transaction((tx) => {
    tx.insert(supplierItemPrices)
      .values({
        id,
        supplierId: input.supplierId,
        inventoryItemId: input.inventoryItemId,
        supplierItemCode,
        priceMinor,
        currencyId: FUNCTIONAL_CURRENCY_ID,
        effectiveFrom,
        createdAt: now
      })
      .run()

    record(
      tx,
      {
        entityType: 'supplier_item_price',
        entityId: id,
        entityLabel: `${input.supplierId}:${input.inventoryItemId}`,
        action: 'create',
        actor,
        companyId: PRIMARY_COMPANY_ID,
        before: null,
        after: {
          supplierId: input.supplierId,
          inventoryItemId: input.inventoryItemId,
          supplierItemCode,
          priceMinor,
          currencyId: FUNCTIONAL_CURRENCY_ID,
          effectiveFrom
        }
      },
      now
    )
  })

  const created = joinedPriceQuery(db).where(eq(supplierItemPrices.id, id)).get()
  if (!created) {
    throw new SupplierPriceServiceError('Supplier price was not persisted after creation')
  }
  return created
}

export function listPricesForSupplier(db: AppDb, supplierId: string): SupplierItemPrice[] {
  return joinedPriceQuery(db)
    .where(eq(supplierItemPrices.supplierId, supplierId))
    .orderBy(desc(supplierItemPrices.effectiveFrom), desc(supplierItemPrices.createdAt))
    .all()
}

export function listPricesForInventoryItem(
  db: AppDb,
  inventoryItemId: string
): SupplierItemPrice[] {
  return joinedPriceQuery(db)
    .where(eq(supplierItemPrices.inventoryItemId, inventoryItemId))
    .orderBy(desc(supplierItemPrices.effectiveFrom), desc(supplierItemPrices.createdAt))
    .all()
}

/**
 * "Current" means the latest row whose effectiveFrom is <= now --
 * approved decision. A future-dated row is a scheduled price and must
 * never be returned here, even if it is the most recently created row
 * overall. Ties on effectiveFrom are broken by createdAt descending,
 * for a fully deterministic result.
 */
export function getCurrentPriceForSupplierItem(
  db: AppDb,
  supplierId: string,
  inventoryItemId: string,
  now: Date = new Date()
): SupplierItemPrice | undefined {
  return joinedPriceQuery(db)
    .where(
      and(
        eq(supplierItemPrices.supplierId, supplierId),
        eq(supplierItemPrices.inventoryItemId, inventoryItemId)
      )
    )
    .orderBy(desc(supplierItemPrices.effectiveFrom), desc(supplierItemPrices.createdAt))
    .all()
    .find((row) => row.effectiveFrom.getTime() <= now.getTime())
}
