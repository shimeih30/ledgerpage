import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import { createInventoryItem } from '../../../src/main/db/inventoryItemService'
import { createOpeningLot } from '../../../src/main/db/inventoryLotService'
import { reserveStock, releaseReservation } from '../../../src/main/db/stockMovementService'
import {
  getAvailableQuantity,
  getIncomingQuantity,
  getPhysicalQuantity,
  getReservedQuantity,
  getStockSummaryForItem,
  listStockSummaries
} from '../../../src/main/db/stockQuantityService'
import type { AuditActor } from '../../../src/main/audit/auditService'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const SYSTEM_ACTOR: AuditActor = { type: 'system' }

const FLOUR_ITEM_INPUT = {
  code: 'flour',
  name: 'Flour',
  category: 'Dry goods',
  itemType: 'ingredient',
  unitOfMeasureId: 'uom_kg',
  minimumStock: 0,
  reorderQuantity: 0,
  leadTimeDays: 0
}

describe('stockQuantityService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let itemId: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-stock-quantity-service')
    rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    db = drizzle<Record<string, never>>(rawDb)
    createCompany(db, {
      name: 'Fixture Co',
      address: 'Addr',
      contactDetails: 'contact@example.com',
      currencyId: 'currency_usd'
    })
    const now = Date.now()
    rawDb
      .prepare(
        `INSERT INTO numbering_rules
           (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at)
           VALUES ('numbering_rule_inventory_lot', 'primary_company', 'inventory_lot', 'LOT', 6, 'never', 0, NULL, ?, ?)`
      )
      .run(now, now)
    itemId = createInventoryItem(db, FLOUR_ITEM_INPUT, SYSTEM_ACTOR).id
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  it('getPhysicalQuantity sums quantityRemainingScaled across every lot', () => {
    createOpeningLot(
      db,
      {
        inventoryItemId: itemId,
        receivedDate: new Date('2026-01-01'),
        quantityReceivedScaled: 20000,
        unitCostMinor: 350
      },
      SYSTEM_ACTOR
    )
    createOpeningLot(
      db,
      {
        inventoryItemId: itemId,
        receivedDate: new Date('2026-01-02'),
        quantityReceivedScaled: 50000,
        unitCostMinor: 420
      },
      SYSTEM_ACTOR
    )
    expect(getPhysicalQuantity(db, itemId)).toBe(70000)
  })

  it('reserving stock reduces available without reducing physical', () => {
    const lot = createOpeningLot(
      db,
      {
        inventoryItemId: itemId,
        receivedDate: new Date(),
        quantityReceivedScaled: 20000,
        unitCostMinor: 350
      },
      SYSTEM_ACTOR
    )
    reserveStock(
      db,
      { inventoryLotId: lot.id, quantityScaled: 5000, referenceType: 'sales', referenceId: 'o1' },
      SYSTEM_ACTOR
    )

    expect(getPhysicalQuantity(db, itemId)).toBe(20000)
    expect(getReservedQuantity(db, itemId)).toBe(5000)
    expect(getAvailableQuantity(db, itemId)).toBe(15000)
  })

  it('releasing a reservation restores available', () => {
    const lot = createOpeningLot(
      db,
      {
        inventoryItemId: itemId,
        receivedDate: new Date(),
        quantityReceivedScaled: 20000,
        unitCostMinor: 350
      },
      SYSTEM_ACTOR
    )
    reserveStock(
      db,
      { inventoryLotId: lot.id, quantityScaled: 5000, referenceType: 'sales', referenceId: 'o1' },
      SYSTEM_ACTOR
    )
    releaseReservation(
      db,
      { inventoryLotId: lot.id, quantityScaled: 5000, referenceType: 'sales', referenceId: 'o1' },
      SYSTEM_ACTOR
    )

    expect(getReservedQuantity(db, itemId)).toBe(0)
    expect(getAvailableQuantity(db, itemId)).toBe(20000)
  })

  it('getIncomingQuantity is always zero in Slice 15', () => {
    expect(getIncomingQuantity(db, itemId)).toBe(0)
  })

  it('getStockSummaryForItem returns resolved unit labels and formatted quantities', () => {
    const lot = createOpeningLot(
      db,
      {
        inventoryItemId: itemId,
        receivedDate: new Date(),
        quantityReceivedScaled: 1500,
        unitCostMinor: 350
      },
      SYSTEM_ACTOR
    )
    reserveStock(
      db,
      { inventoryLotId: lot.id, quantityScaled: 500, referenceType: 'sales', referenceId: 'o1' },
      SYSTEM_ACTOR
    )

    const summary = getStockSummaryForItem(db, itemId)
    expect(summary.inventoryItemCode).toBe('FLOUR')
    expect(summary.unitOfMeasureCode).toBe('kg')
    expect(summary.decimalPlaces).toBe(3)
    expect(summary.physicalQuantityScaled).toBe(1500)
    expect(summary.reservedQuantityScaled).toBe(500)
    expect(summary.availableQuantityScaled).toBe(1000)
    expect(summary.physicalQuantityFormatted).toBe('1.500')
    expect(summary.reservedQuantityFormatted).toBe('0.500')
    expect(summary.availableQuantityFormatted).toBe('1.000')
    expect(summary.incomingQuantityFormatted).toBe('0.000')
    expect(summary.lotCount).toBe(1)
  })

  it('listStockSummaries returns a summary for every item with at least one lot, omitting items with none', () => {
    const secondItemId = createInventoryItem(
      db,
      { ...FLOUR_ITEM_INPUT, code: 'SUGAR' },
      SYSTEM_ACTOR
    ).id
    const neverStockedItemId = createInventoryItem(
      db,
      { ...FLOUR_ITEM_INPUT, code: 'NEVER_STOCKED' },
      SYSTEM_ACTOR
    ).id
    void neverStockedItemId

    createOpeningLot(
      db,
      {
        inventoryItemId: itemId,
        receivedDate: new Date(),
        quantityReceivedScaled: 1000,
        unitCostMinor: 100
      },
      SYSTEM_ACTOR
    )
    createOpeningLot(
      db,
      {
        inventoryItemId: secondItemId,
        receivedDate: new Date(),
        quantityReceivedScaled: 2000,
        unitCostMinor: 200
      },
      SYSTEM_ACTOR
    )

    const summaries = listStockSummaries(db)
    expect(summaries.map((s) => s.inventoryItemId).sort()).toEqual([itemId, secondItemId].sort())
  })
})
