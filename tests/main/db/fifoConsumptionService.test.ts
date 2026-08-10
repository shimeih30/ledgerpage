import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import {
  createInventoryItem,
  deactivateInventoryItem
} from '../../../src/main/db/inventoryItemService'
import {
  createOpeningLot,
  getInventoryLotById,
  setLotQuarantined
} from '../../../src/main/db/inventoryLotService'
import { reserveStock } from '../../../src/main/db/stockMovementService'
import {
  consumeStock,
  FifoConsumptionServiceError
} from '../../../src/main/db/fifoConsumptionService'
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

describe('fifoConsumptionService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let itemId: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-fifo-consumption-service')
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

  describe('worked FIFO acceptance example', () => {
    it('20.000 kg @ $3.50, then 50.000 kg @ $4.20; consuming 30.000 kg draws 20.000 from the first lot and 10.000 from the second, totalling exactly US$112.00', () => {
      const firstLot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-01'),
          quantityReceivedScaled: 20000,
          unitCostMinor: 350
        },
        SYSTEM_ACTOR
      )
      const secondLot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-02'),
          quantityReceivedScaled: 50000,
          unitCostMinor: 420
        },
        SYSTEM_ACTOR
      )

      const result = consumeStock(
        db,
        { inventoryItemId: itemId, quantityScaled: 30000, referenceType: 'manual_adjustment' },
        SYSTEM_ACTOR
      )

      expect(result.totalQuantityConsumedScaled).toBe(30000)
      expect(result.totalCostMinor).toBe(11200)

      expect(result.lotAllocations).toHaveLength(2)
      expect(result.lotAllocations[0].inventoryLotId).toBe(firstLot.id)
      expect(result.lotAllocations[0].quantityConsumedScaled).toBe(20000)
      expect(result.lotAllocations[0].costMinor).toBe(7000)
      expect(result.lotAllocations[1].inventoryLotId).toBe(secondLot.id)
      expect(result.lotAllocations[1].quantityConsumedScaled).toBe(10000)
      expect(result.lotAllocations[1].costMinor).toBe(4200)

      const firstLotAfter = getInventoryLotById(db, firstLot.id)
      expect(firstLotAfter?.quantityRemainingScaled).toBe(0)
      expect(firstLotAfter?.costRemainingMinor).toBe(0)
      expect(firstLotAfter?.lifecycleStatus).toBe('depleted')

      const secondLotAfter = getInventoryLotById(db, secondLot.id)
      expect(secondLotAfter?.quantityRemainingScaled).toBe(40000)
      expect(secondLotAfter?.costRemainingMinor).toBe(16800)
      expect(secondLotAfter?.lifecycleStatus).toBe('active')
    })
  })

  it('rejects consumption against an inactive inventory item', () => {
    createOpeningLot(
      db,
      {
        inventoryItemId: itemId,
        receivedDate: new Date(),
        quantityReceivedScaled: 20000,
        unitCostMinor: 350
      },
      SYSTEM_ACTOR
    )
    deactivateInventoryItem(db, itemId, SYSTEM_ACTOR)
    expect(() =>
      consumeStock(
        db,
        { inventoryItemId: itemId, quantityScaled: 1000, referenceType: 'manual_adjustment' },
        SYSTEM_ACTOR
      )
    ).toThrow(FifoConsumptionServiceError)
  })

  it('rejects a non-positive requested quantity', () => {
    createOpeningLot(
      db,
      {
        inventoryItemId: itemId,
        receivedDate: new Date(),
        quantityReceivedScaled: 20000,
        unitCostMinor: 350
      },
      SYSTEM_ACTOR
    )
    expect(() =>
      consumeStock(
        db,
        { inventoryItemId: itemId, quantityScaled: 0, referenceType: 'manual_adjustment' },
        SYSTEM_ACTOR
      )
    ).toThrow(FifoConsumptionServiceError)
  })

  it('rejects a request exceeding available stock, and leaves every lot untouched (whole-transaction rollback)', () => {
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
    expect(() =>
      consumeStock(
        db,
        { inventoryItemId: itemId, quantityScaled: 20001, referenceType: 'manual_adjustment' },
        SYSTEM_ACTOR
      )
    ).toThrow(FifoConsumptionServiceError)

    const lotAfter = getInventoryLotById(db, lot.id)
    expect(lotAfter?.quantityRemainingScaled).toBe(20000)
    expect(lotAfter?.costRemainingMinor).toBe(7000)
  })

  it('skips a depleted lot', () => {
    const depletedLot = createOpeningLot(
      db,
      {
        inventoryItemId: itemId,
        receivedDate: new Date('2026-01-01'),
        quantityReceivedScaled: 1000,
        unitCostMinor: 100
      },
      SYSTEM_ACTOR
    )
    consumeStock(
      db,
      { inventoryItemId: itemId, quantityScaled: 1000, referenceType: 'manual_adjustment' },
      SYSTEM_ACTOR
    )
    const secondLot = createOpeningLot(
      db,
      {
        inventoryItemId: itemId,
        receivedDate: new Date('2026-01-02'),
        quantityReceivedScaled: 5000,
        unitCostMinor: 200
      },
      SYSTEM_ACTOR
    )

    const result = consumeStock(
      db,
      { inventoryItemId: itemId, quantityScaled: 1000, referenceType: 'manual_adjustment' },
      SYSTEM_ACTOR
    )
    expect(result.lotAllocations).toHaveLength(1)
    expect(result.lotAllocations[0].inventoryLotId).toBe(secondLot.id)
    expect(result.lotAllocations[0].inventoryLotId).not.toBe(depletedLot.id)
  })

  describe('quarantined lots', () => {
    it('skips a quarantined lot without an override', () => {
      const quarantinedLot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-01'),
          quantityReceivedScaled: 20000,
          unitCostMinor: 350
        },
        SYSTEM_ACTOR
      )
      setLotQuarantined(db, quarantinedLot.id, SYSTEM_ACTOR)
      const activeLot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-02'),
          quantityReceivedScaled: 5000,
          unitCostMinor: 200
        },
        SYSTEM_ACTOR
      )

      const result = consumeStock(
        db,
        { inventoryItemId: itemId, quantityScaled: 1000, referenceType: 'manual_adjustment' },
        SYSTEM_ACTOR
      )
      expect(result.lotAllocations).toHaveLength(1)
      expect(result.lotAllocations[0].inventoryLotId).toBe(activeLot.id)
    })

    it('draws from a quarantined lot when an authorized override with a reason is supplied', () => {
      const quarantinedLot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-01'),
          quantityReceivedScaled: 20000,
          unitCostMinor: 350
        },
        SYSTEM_ACTOR
      )
      setLotQuarantined(db, quarantinedLot.id, SYSTEM_ACTOR)

      const result = consumeStock(
        db,
        {
          inventoryItemId: itemId,
          quantityScaled: 1000,
          referenceType: 'manual_adjustment',
          override: { reason: 'Authorized emergency use of quarantined stock' }
        },
        SYSTEM_ACTOR
      )
      expect(result.lotAllocations).toHaveLength(1)
      expect(result.lotAllocations[0].inventoryLotId).toBe(quarantinedLot.id)
    })

    it('an override with a blank reason is rejected', () => {
      const quarantinedLot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date(),
          quantityReceivedScaled: 20000,
          unitCostMinor: 350
        },
        SYSTEM_ACTOR
      )
      setLotQuarantined(db, quarantinedLot.id, SYSTEM_ACTOR)

      expect(() =>
        consumeStock(
          db,
          {
            inventoryItemId: itemId,
            quantityScaled: 1000,
            referenceType: 'manual_adjustment',
            override: { reason: '   ' }
          },
          SYSTEM_ACTOR
        )
      ).toThrow(FifoConsumptionServiceError)
    })
  })

  describe('expired lots', () => {
    it('skips an expired lot without an override', () => {
      const expiryTrackedItemId = createInventoryItem(
        db,
        { ...FLOUR_ITEM_INPUT, code: 'PERISHABLE' },
        SYSTEM_ACTOR
      ).id
      rawDb
        .prepare('UPDATE inventory_items SET expiry_tracked = 1 WHERE id = ?')
        .run(expiryTrackedItemId)

      const expiredLot = createOpeningLot(
        db,
        {
          inventoryItemId: expiryTrackedItemId,
          receivedDate: new Date('2020-01-01'),
          quantityReceivedScaled: 20000,
          unitCostMinor: 350,
          expiryDate: new Date('2020-06-01')
        },
        SYSTEM_ACTOR
      )
      const freshLot = createOpeningLot(
        db,
        {
          inventoryItemId: expiryTrackedItemId,
          receivedDate: new Date('2026-01-02'),
          quantityReceivedScaled: 5000,
          unitCostMinor: 200,
          expiryDate: new Date('2099-01-01')
        },
        SYSTEM_ACTOR
      )

      const result = consumeStock(
        db,
        {
          inventoryItemId: expiryTrackedItemId,
          quantityScaled: 1000,
          referenceType: 'manual_adjustment'
        },
        SYSTEM_ACTOR
      )
      expect(result.lotAllocations).toHaveLength(1)
      expect(result.lotAllocations[0].inventoryLotId).toBe(freshLot.id)
      expect(result.lotAllocations[0].inventoryLotId).not.toBe(expiredLot.id)
    })

    it('draws from an expired lot when an authorized override with a reason is supplied', () => {
      const expiryTrackedItemId = createInventoryItem(
        db,
        { ...FLOUR_ITEM_INPUT, code: 'PERISHABLE' },
        SYSTEM_ACTOR
      ).id
      rawDb
        .prepare('UPDATE inventory_items SET expiry_tracked = 1 WHERE id = ?')
        .run(expiryTrackedItemId)

      const expiredLot = createOpeningLot(
        db,
        {
          inventoryItemId: expiryTrackedItemId,
          receivedDate: new Date('2020-01-01'),
          quantityReceivedScaled: 20000,
          unitCostMinor: 350,
          expiryDate: new Date('2020-06-01')
        },
        SYSTEM_ACTOR
      )

      const result = consumeStock(
        db,
        {
          inventoryItemId: expiryTrackedItemId,
          quantityScaled: 1000,
          referenceType: 'manual_adjustment',
          override: { reason: 'Authorized use of expired stock' }
        },
        SYSTEM_ACTOR
      )
      expect(result.lotAllocations[0].inventoryLotId).toBe(expiredLot.id)
    })
  })

  describe('cost conservation across multiple partial consumptions', () => {
    it('repeated partial draws from a lot with an unevenly-divisible cost sum to exactly the original total cost, with zero residual on final depletion', () => {
      // unitCostMinor=333, quantityReceivedScaled=3000 (3.000 kg) =>
      // totalCostMinor = round(333 * 3000 / 1000) = 999. Drawing this
      // down in three unequal partial steps (1000, 700, 1300 -- none
      // evenly dividing 999) is exactly the scenario where a
      // proportional-rounding bug could leak or strand cost.
      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-01'),
          quantityReceivedScaled: 3000,
          unitCostMinor: 333
        },
        SYSTEM_ACTOR
      )
      expect(lot.totalCostMinor).toBe(999)

      const first = consumeStock(
        db,
        { inventoryItemId: itemId, quantityScaled: 1000, referenceType: 'manual_adjustment' },
        SYSTEM_ACTOR
      )
      const second = consumeStock(
        db,
        { inventoryItemId: itemId, quantityScaled: 700, referenceType: 'manual_adjustment' },
        SYSTEM_ACTOR
      )
      const third = consumeStock(
        db,
        { inventoryItemId: itemId, quantityScaled: 1300, referenceType: 'manual_adjustment' },
        SYSTEM_ACTOR
      )

      const sumOfAllocatedCost = first.totalCostMinor + second.totalCostMinor + third.totalCostMinor
      expect(sumOfAllocatedCost).toBe(999)

      const lotAfter = getInventoryLotById(db, lot.id)
      expect(lotAfter?.quantityRemainingScaled).toBe(0)
      expect(lotAfter?.costRemainingMinor).toBe(0)
      expect(lotAfter?.lifecycleStatus).toBe('depleted')
    })
  })

  it('one consumption movement is recorded per lot used', () => {
    createOpeningLot(
      db,
      {
        inventoryItemId: itemId,
        receivedDate: new Date('2026-01-01'),
        quantityReceivedScaled: 10000,
        unitCostMinor: 100
      },
      SYSTEM_ACTOR
    )
    createOpeningLot(
      db,
      {
        inventoryItemId: itemId,
        receivedDate: new Date('2026-01-02'),
        quantityReceivedScaled: 10000,
        unitCostMinor: 100
      },
      SYSTEM_ACTOR
    )
    createOpeningLot(
      db,
      {
        inventoryItemId: itemId,
        receivedDate: new Date('2026-01-03'),
        quantityReceivedScaled: 10000,
        unitCostMinor: 100
      },
      SYSTEM_ACTOR
    )

    const result = consumeStock(
      db,
      { inventoryItemId: itemId, quantityScaled: 25000, referenceType: 'manual_adjustment' },
      SYSTEM_ACTOR
    )
    expect(result.lotAllocations).toHaveLength(3)
    const movementIds = new Set(result.lotAllocations.map((a) => a.movementId))
    expect(movementIds.size).toBe(3)
  })

  it('respects existing reservations -- consumption cannot eat into reserved stock', () => {
    const lot = createOpeningLot(
      db,
      {
        inventoryItemId: itemId,
        receivedDate: new Date(),
        quantityReceivedScaled: 10000,
        unitCostMinor: 100
      },
      SYSTEM_ACTOR
    )
    reserveStock(
      db,
      { inventoryLotId: lot.id, quantityScaled: 8000, referenceType: 'sales', referenceId: 'o1' },
      SYSTEM_ACTOR
    )

    expect(() =>
      consumeStock(
        db,
        { inventoryItemId: itemId, quantityScaled: 2001, referenceType: 'manual_adjustment' },
        SYSTEM_ACTOR
      )
    ).toThrow(FifoConsumptionServiceError)

    expect(() =>
      consumeStock(
        db,
        { inventoryItemId: itemId, quantityScaled: 2000, referenceType: 'manual_adjustment' },
        SYSTEM_ACTOR
      )
    ).not.toThrow()
  })
})
