import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
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
  listConsumableLotsForInventoryItem,
  listLotsForInventoryItem,
  InventoryLotServiceError,
  setLotActive,
  setLotQuarantined
} from '../../../src/main/db/inventoryLotService'
import { InventoryLotValidationError } from '../../../src/main/db/validation/inventoryLotValidation'
import { FUNCTIONAL_CURRENCY_ID, stockMovements } from '../../../src/main/db/schema'
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

describe('inventoryLotService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let itemId: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-inventory-lot-service')
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

  function rawAuditRowsFor(entityId: string) {
    return rawDb
      .prepare(
        'SELECT action, entity_type as entityType FROM audit_log_entries WHERE entity_id = ?'
      )
      .all(entityId) as { action: string; entityType: string }[]
  }

  describe('createOpeningLot', () => {
    it('creates a lot with a system-generated, sequential internal lot number', () => {
      const first = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-01'),
          quantityReceivedScaled: 20000,
          unitCostMinor: 350
        },
        SYSTEM_ACTOR
      )
      const second = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-02'),
          quantityReceivedScaled: 50000,
          unitCostMinor: 420
        },
        SYSTEM_ACTOR
      )
      expect(first.internalLotNumber).toBe('LOT-000001')
      expect(second.internalLotNumber).toBe('LOT-000002')
    })

    it('sets quantityRemainingScaled equal to quantityReceivedScaled and lifecycleStatus active', () => {
      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-01'),
          quantityReceivedScaled: 20000,
          unitCostMinor: 350
        },
        SYSTEM_ACTOR
      )
      expect(lot.quantityRemainingScaled).toBe(20000)
      expect(lot.lifecycleStatus).toBe('active')
    })

    it('computes totalCostMinor and costRemainingMinor per the worked example (20.000 kg @ $3.50 = $70.00)', () => {
      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-01'),
          quantityReceivedScaled: 20000,
          unitCostMinor: 350
        },
        SYSTEM_ACTOR
      )
      expect(lot.totalCostMinor).toBe(7000)
      expect(lot.costRemainingMinor).toBe(7000)
    })

    it('currencyId is always FUNCTIONAL_CURRENCY_ID', () => {
      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-01'),
          quantityReceivedScaled: 20000,
          unitCostMinor: 350
        },
        SYSTEM_ACTOR
      )
      expect(lot.currencyId).toBe(FUNCTIONAL_CURRENCY_ID)
    })

    it('rejects a nonexistent inventory item', () => {
      expect(() =>
        createOpeningLot(
          db,
          {
            inventoryItemId: 'does-not-exist',
            receivedDate: new Date(),
            quantityReceivedScaled: 1000,
            unitCostMinor: 100
          },
          SYSTEM_ACTOR
        )
      ).toThrow(InventoryLotServiceError)
    })

    it('rejects an inactive inventory item', () => {
      deactivateInventoryItem(db, itemId, SYSTEM_ACTOR)
      expect(() =>
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
      ).toThrow(InventoryLotServiceError)
    })

    it('rejects a non-positive quantityReceivedScaled', () => {
      expect(() =>
        createOpeningLot(
          db,
          {
            inventoryItemId: itemId,
            receivedDate: new Date(),
            quantityReceivedScaled: 0,
            unitCostMinor: 100
          },
          SYSTEM_ACTOR
        )
      ).toThrow(RangeError)
    })

    it('rejects a negative unitCostMinor', () => {
      expect(() =>
        createOpeningLot(
          db,
          {
            inventoryItemId: itemId,
            receivedDate: new Date(),
            quantityReceivedScaled: 1000,
            unitCostMinor: -1
          },
          SYSTEM_ACTOR
        )
      ).toThrow(InventoryLotValidationError)
    })

    describe('expiry-required behavior', () => {
      it('rejects a missing expiryDate when the item has expiryTracked=true', () => {
        const expiryTrackedItemId = createInventoryItem(
          db,
          { ...FLOUR_ITEM_INPUT, code: 'PERISHABLE' },
          SYSTEM_ACTOR
        ).id
        rawDb
          .prepare('UPDATE inventory_items SET expiry_tracked = 1 WHERE id = ?')
          .run(expiryTrackedItemId)

        expect(() =>
          createOpeningLot(
            db,
            {
              inventoryItemId: expiryTrackedItemId,
              receivedDate: new Date(),
              quantityReceivedScaled: 1000,
              unitCostMinor: 100
            },
            SYSTEM_ACTOR
          )
        ).toThrow(InventoryLotValidationError)
      })

      it('accepts a provided expiryDate when the item has expiryTracked=true', () => {
        const expiryTrackedItemId = createInventoryItem(
          db,
          { ...FLOUR_ITEM_INPUT, code: 'PERISHABLE' },
          SYSTEM_ACTOR
        ).id
        rawDb
          .prepare('UPDATE inventory_items SET expiry_tracked = 1 WHERE id = ?')
          .run(expiryTrackedItemId)

        const lot = createOpeningLot(
          db,
          {
            inventoryItemId: expiryTrackedItemId,
            receivedDate: new Date(),
            quantityReceivedScaled: 1000,
            unitCostMinor: 100,
            expiryDate: new Date('2027-01-01')
          },
          SYSTEM_ACTOR
        )
        expect(lot.expiryDate).toEqual(new Date('2027-01-01'))
      })

      it('rejects a provided expiryDate when the item has expiryTracked=false', () => {
        expect(() =>
          createOpeningLot(
            db,
            {
              inventoryItemId: itemId,
              receivedDate: new Date(),
              quantityReceivedScaled: 1000,
              unitCostMinor: 100,
              expiryDate: new Date('2027-01-01')
            },
            SYSTEM_ACTOR
          )
        ).toThrow(InventoryLotValidationError)
      })

      it('omits expiryDate cleanly when the item has expiryTracked=false', () => {
        const lot = createOpeningLot(
          db,
          {
            inventoryItemId: itemId,
            receivedDate: new Date(),
            quantityReceivedScaled: 1000,
            unitCostMinor: 100
          },
          SYSTEM_ACTOR
        )
        expect(lot.expiryDate).toBeNull()
      })
    })

    describe('supplierLotNumber', () => {
      it('is nullable and omittable', () => {
        const lot = createOpeningLot(
          db,
          {
            inventoryItemId: itemId,
            receivedDate: new Date(),
            quantityReceivedScaled: 1000,
            unitCostMinor: 100
          },
          SYSTEM_ACTOR
        )
        expect(lot.supplierLotNumber).toBeNull()
      })

      it('trims a provided value', () => {
        const lot = createOpeningLot(
          db,
          {
            inventoryItemId: itemId,
            receivedDate: new Date(),
            quantityReceivedScaled: 1000,
            unitCostMinor: 100,
            supplierLotNumber: '  ABC-123  '
          },
          SYSTEM_ACTOR
        )
        expect(lot.supplierLotNumber).toBe('ABC-123')
      })

      it('normalizes a blank value to null', () => {
        const lot = createOpeningLot(
          db,
          {
            inventoryItemId: itemId,
            receivedDate: new Date(),
            quantityReceivedScaled: 1000,
            unitCostMinor: 100,
            supplierLotNumber: '   '
          },
          SYSTEM_ACTOR
        )
        expect(lot.supplierLotNumber).toBeNull()
      })
    })

    it('creates exactly one receipt/opening_stock movement atomically with the lot', () => {
      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-01'),
          quantityReceivedScaled: 20000,
          unitCostMinor: 350
        },
        SYSTEM_ACTOR
      )
      const movements = db
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.inventoryLotId, lot.id))
        .all()
      expect(movements).toHaveLength(1)
      expect(movements[0].movementType).toBe('receipt')
      expect(movements[0].referenceType).toBe('opening_stock')
      expect(movements[0].physicalQuantityDeltaScaled).toBe(20000)
      expect(movements[0].costDeltaMinor).toBe(7000)
    })

    it('writes exactly one inventory_lot audit row and one stock_movement audit row', () => {
      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-01'),
          quantityReceivedScaled: 20000,
          unitCostMinor: 350
        },
        SYSTEM_ACTOR
      )
      const lotAuditRows = rawAuditRowsFor(lot.id)
      expect(lotAuditRows).toEqual([{ action: 'create', entityType: 'inventory_lot' }])

      const allAuditRows = rawDb
        .prepare(
          "SELECT entity_type as entityType FROM audit_log_entries WHERE entity_type = 'stock_movement'"
        )
        .all() as { entityType: string }[]
      expect(allAuditRows).toHaveLength(1)
    })
  })

  describe('listLotsForInventoryItem / listConsumableLotsForInventoryItem', () => {
    it('listLotsForInventoryItem returns every lot for that item, oldest first', () => {
      const first = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-01'),
          quantityReceivedScaled: 20000,
          unitCostMinor: 350
        },
        SYSTEM_ACTOR
      )
      const second = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-02'),
          quantityReceivedScaled: 50000,
          unitCostMinor: 420
        },
        SYSTEM_ACTOR
      )
      const lots = listLotsForInventoryItem(db, itemId)
      expect(lots.map((l) => l.id)).toEqual([first.id, second.id])
    })

    it('listConsumableLotsForInventoryItem excludes a lot with zero quantity remaining', () => {
      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-01'),
          quantityReceivedScaled: 20000,
          unitCostMinor: 350
        },
        SYSTEM_ACTOR
      )
      rawDb
        .prepare(
          "UPDATE inventory_lots SET quantity_remaining_scaled = 0, lifecycle_status = 'depleted' WHERE id = ?"
        )
        .run(lot.id)

      expect(listConsumableLotsForInventoryItem(db, itemId)).toHaveLength(0)
    })

    it('listConsumableLotsForInventoryItem includes a quarantined lot with remaining stock', () => {
      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date('2026-01-01'),
          quantityReceivedScaled: 20000,
          unitCostMinor: 350
        },
        SYSTEM_ACTOR
      )
      setLotQuarantined(db, lot.id, SYSTEM_ACTOR)
      const consumable = listConsumableLotsForInventoryItem(db, itemId)
      expect(consumable).toHaveLength(1)
      expect(consumable[0].lifecycleStatus).toBe('quarantined')
    })
  })

  describe('setLotQuarantined / setLotActive', () => {
    it('setLotQuarantined sets lifecycleStatus and writes one audit row (audit action = "update")', () => {
      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date(),
          quantityReceivedScaled: 1000,
          unitCostMinor: 100
        },
        SYSTEM_ACTOR
      )
      const quarantined = setLotQuarantined(db, lot.id, SYSTEM_ACTOR)
      expect(quarantined.lifecycleStatus).toBe('quarantined')
      expect(rawAuditRowsFor(lot.id)).toEqual([
        { action: 'create', entityType: 'inventory_lot' },
        { action: 'update', entityType: 'inventory_lot' }
      ])
    })

    it('setLotActive restores lifecycleStatus from quarantined and writes one audit row', () => {
      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date(),
          quantityReceivedScaled: 1000,
          unitCostMinor: 100
        },
        SYSTEM_ACTOR
      )
      setLotQuarantined(db, lot.id, SYSTEM_ACTOR)
      const reactivated = setLotActive(db, lot.id, SYSTEM_ACTOR)
      expect(reactivated.lifecycleStatus).toBe('active')
      expect(rawAuditRowsFor(lot.id)).toEqual([
        { action: 'create', entityType: 'inventory_lot' },
        { action: 'update', entityType: 'inventory_lot' },
        { action: 'reactivate', entityType: 'inventory_lot' }
      ])
    })

    it('a no-op status change writes no additional audit row', () => {
      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date(),
          quantityReceivedScaled: 1000,
          unitCostMinor: 100
        },
        SYSTEM_ACTOR
      )
      setLotActive(db, lot.id, SYSTEM_ACTOR)
      expect(rawAuditRowsFor(lot.id)).toEqual([{ action: 'create', entityType: 'inventory_lot' }])
    })

    it('a depleted lot can no longer have its lifecycle status changed', () => {
      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date(),
          quantityReceivedScaled: 1000,
          unitCostMinor: 100
        },
        SYSTEM_ACTOR
      )
      rawDb
        .prepare("UPDATE inventory_lots SET lifecycle_status = 'depleted' WHERE id = ?")
        .run(lot.id)
      expect(() => setLotQuarantined(db, lot.id, SYSTEM_ACTOR)).toThrow(InventoryLotServiceError)
      expect(() => setLotActive(db, lot.id, SYSTEM_ACTOR)).toThrow(InventoryLotServiceError)
    })
  })

  describe('historical lots and inactive items remain readable', () => {
    it('a lot for a now-inactive item remains fully readable', () => {
      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date(),
          quantityReceivedScaled: 1000,
          unitCostMinor: 100
        },
        SYSTEM_ACTOR
      )
      deactivateInventoryItem(db, itemId, SYSTEM_ACTOR)
      expect(getInventoryLotById(db, lot.id)).toBeDefined()
      expect(listLotsForInventoryItem(db, itemId)).toHaveLength(1)
    })
  })

  describe('direct SQL bypass -- database-level constraints hold independent of the service layer', () => {
    it('rejects a duplicate (company_id, internal_lot_number) pair', () => {
      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date(),
          quantityReceivedScaled: 1000,
          unitCostMinor: 100
        },
        SYSTEM_ACTOR
      )
      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO inventory_lots
             (id, company_id, inventory_item_id, received_date, quantity_received_scaled, quantity_remaining_scaled, unit_cost_minor, total_cost_minor, cost_remaining_minor, currency_id, internal_lot_number, lifecycle_status, created_at, updated_at)
             VALUES ('lot_dupe', 'primary_company', ?, ?, 1000, 1000, 100, 100000, 100000, 'currency_usd', ?, 'active', ?, ?)`
          )
          .run(itemId, Date.now(), lot.internalLotNumber, Date.now(), Date.now())
      ).toThrow(/UNIQUE constraint failed/)
    })

    it('rejects quantity_remaining_scaled exceeding quantity_received_scaled', () => {
      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO inventory_lots
             (id, company_id, inventory_item_id, received_date, quantity_received_scaled, quantity_remaining_scaled, unit_cost_minor, total_cost_minor, cost_remaining_minor, currency_id, internal_lot_number, lifecycle_status, created_at, updated_at)
             VALUES ('lot_x', 'primary_company', ?, ?, 1000, 2000, 100, 100000, 100000, 'currency_usd', 'LOT-999999', 'active', ?, ?)`
          )
          .run(itemId, Date.now(), Date.now(), Date.now())
      ).toThrow(/CHECK constraint failed/)
    })
  })
})
