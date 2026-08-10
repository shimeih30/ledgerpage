import { eq } from 'drizzle-orm'
import {
  inventoryItems,
  inventoryLots,
  PRIMARY_COMPANY_ID,
  stockMovements,
  unitsOfMeasure
} from './schema'
import { formatScaledIntegerAsQuantity } from './quantityScale'
import type { AppDb } from './dbTypes'

export class StockQuantityServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StockQuantityServiceError'
  }
}

export interface StockSummaryForItem {
  inventoryItemId: string
  inventoryItemCode: string
  inventoryItemName: string
  unitOfMeasureId: string
  unitOfMeasureCode: string
  unitOfMeasureName: string
  decimalPlaces: number
  physicalQuantityScaled: number
  reservedQuantityScaled: number
  availableQuantityScaled: number
  incomingQuantityScaled: number
  physicalQuantityFormatted: string
  reservedQuantityFormatted: string
  availableQuantityFormatted: string
  incomingQuantityFormatted: string
  lotCount: number
}

interface ResolvedItem {
  id: string
  code: string
  name: string
  unitOfMeasureId: string
  unitOfMeasureCode: string
  unitOfMeasureName: string
  decimalPlaces: number
}

function requireInventoryItem(db: AppDb, inventoryItemId: string): ResolvedItem {
  const row = db
    .select({
      id: inventoryItems.id,
      code: inventoryItems.code,
      name: inventoryItems.name,
      unitOfMeasureId: inventoryItems.unitOfMeasureId,
      unitOfMeasureCode: unitsOfMeasure.code,
      unitOfMeasureName: unitsOfMeasure.name,
      decimalPlaces: unitsOfMeasure.decimalPlaces
    })
    .from(inventoryItems)
    .innerJoin(unitsOfMeasure, eq(inventoryItems.unitOfMeasureId, unitsOfMeasure.id))
    .where(eq(inventoryItems.id, inventoryItemId))
    .get()
  if (!row) {
    throw new StockQuantityServiceError(`No inventory item exists with id "${inventoryItemId}"`)
  }
  return row
}

/**
 * physical = sum of quantityRemainingScaled across every lot for the
 * item, regardless of lifecycle status — a quarantined lot's stock is
 * still physically on the shelf, just not normally consumable.
 * depleted lots contribute 0 by definition (their own
 * quantityRemainingScaled is always 0).
 */
export function getPhysicalQuantity(db: AppDb, inventoryItemId: string): number {
  const rows = db
    .select({ quantity: inventoryLots.quantityRemainingScaled })
    .from(inventoryLots)
    .where(eq(inventoryLots.inventoryItemId, inventoryItemId))
    .all()
  return rows.reduce((sum, r) => sum + r.quantity, 0)
}

/**
 * reserved = the sum of every outstanding reservedQuantityDeltaScaled
 * across every lot for the item (reservation movements are positive,
 * release movements are negative, so the running sum is always the
 * true outstanding total).
 */
export function getReservedQuantity(db: AppDb, inventoryItemId: string): number {
  const rows = db
    .select({ delta: stockMovements.reservedQuantityDeltaScaled })
    .from(stockMovements)
    .innerJoin(inventoryLots, eq(stockMovements.inventoryLotId, inventoryLots.id))
    .where(eq(inventoryLots.inventoryItemId, inventoryItemId))
    .all()
  return rows.reduce((sum, r) => sum + r.delta, 0)
}

export function getAvailableQuantity(db: AppDb, inventoryItemId: string): number {
  return getPhysicalQuantity(db, inventoryItemId) - getReservedQuantity(db, inventoryItemId)
}

/**
 * Incoming is always 0 in Slice 15 (approved decision) — nothing in
 * this slice creates an incoming purchase order or production batch;
 * this is a stub for the interface Slice 18 (Purchasing) will
 * eventually populate.
 */
export function getIncomingQuantity(db: AppDb, inventoryItemId: string): number {
  void db
  void inventoryItemId
  return 0
}

export function getStockSummaryForItem(db: AppDb, inventoryItemId: string): StockSummaryForItem {
  const item = requireInventoryItem(db, inventoryItemId)
  const physical = getPhysicalQuantity(db, inventoryItemId)
  const reserved = getReservedQuantity(db, inventoryItemId)
  const available = physical - reserved
  const incoming = getIncomingQuantity(db, inventoryItemId)
  const lotCount = db
    .select({ id: inventoryLots.id })
    .from(inventoryLots)
    .where(eq(inventoryLots.inventoryItemId, inventoryItemId))
    .all().length

  return {
    inventoryItemId: item.id,
    inventoryItemCode: item.code,
    inventoryItemName: item.name,
    unitOfMeasureId: item.unitOfMeasureId,
    unitOfMeasureCode: item.unitOfMeasureCode,
    unitOfMeasureName: item.unitOfMeasureName,
    decimalPlaces: item.decimalPlaces,
    physicalQuantityScaled: physical,
    reservedQuantityScaled: reserved,
    availableQuantityScaled: available,
    incomingQuantityScaled: incoming,
    physicalQuantityFormatted: formatScaledIntegerAsQuantity(physical, item.decimalPlaces),
    reservedQuantityFormatted: formatScaledIntegerAsQuantity(reserved, item.decimalPlaces),
    availableQuantityFormatted: formatScaledIntegerAsQuantity(available, item.decimalPlaces),
    incomingQuantityFormatted: formatScaledIntegerAsQuantity(incoming, item.decimalPlaces),
    lotCount
  }
}

/**
 * Stock summaries for every inventory item in the primary company that
 * has at least one lot — items with zero lots ever created are
 * omitted, since a stock-on-hand view has nothing meaningful to show
 * for an item that has never been received.
 */
export function listStockSummaries(db: AppDb): StockSummaryForItem[] {
  const itemIds = db
    .selectDistinct({ inventoryItemId: inventoryLots.inventoryItemId })
    .from(inventoryLots)
    .innerJoin(inventoryItems, eq(inventoryLots.inventoryItemId, inventoryItems.id))
    .where(eq(inventoryItems.companyId, PRIMARY_COMPANY_ID))
    .all()
  return itemIds.map((row) => getStockSummaryForItem(db, row.inventoryItemId))
}
