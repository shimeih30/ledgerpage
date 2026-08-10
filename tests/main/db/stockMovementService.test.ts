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
import { createOpeningLot, getInventoryLotById } from '../../../src/main/db/inventoryLotService'
import * as stockMovementService from '../../../src/main/db/stockMovementService'
import {
  listMovementsForLot,
  recordAdjustment,
  releaseReservation,
  reserveStock,
  reverseMovement,
  StockMovementServiceError
} from '../../../src/main/db/stockMovementService'
import { StockMovementValidationError } from '../../../src/main/db/validation/stockMovementValidation'
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

describe('stockMovementService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let itemId: string
  let lotId: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-stock-movement-service')
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
    lotId = createOpeningLot(
      db,
      {
        inventoryItemId: itemId,
        receivedDate: new Date('2026-01-01'),
        quantityReceivedScaled: 20000,
        unitCostMinor: 350
      },
      SYSTEM_ACTOR
    ).id
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  function rawAuditRowsFor(entityId: string) {
    return rawDb
      .prepare('SELECT action FROM audit_log_entries WHERE entity_id = ?')
      .all(entityId) as { action: string }[]
  }

  describe('recordAdjustment', () => {
    it('applies a positive adjustment to the lot balances (correcting an over-counted prior reduction, staying within the original received amount)', () => {
      recordAdjustment(
        db,
        {
          inventoryLotId: lotId,
          physicalQuantityDeltaScaled: -5000,
          costDeltaMinor: -1750,
          reason: 'Initial (later found to be an over-count)'
        },
        SYSTEM_ACTOR
      )
      const movement = recordAdjustment(
        db,
        {
          inventoryLotId: lotId,
          physicalQuantityDeltaScaled: 1000,
          costDeltaMinor: 350,
          reason: 'Correcting over-counted reduction'
        },
        SYSTEM_ACTOR
      )
      expect(movement.movementType).toBe('adjustment')
      expect(movement.physicalQuantityDeltaScaled).toBe(1000)
      const lot = getInventoryLotById(db, lotId)
      expect(lot?.quantityRemainingScaled).toBe(16000)
      expect(lot?.costRemainingMinor).toBe(5600)
    })

    it('applies a negative adjustment to the lot balances', () => {
      recordAdjustment(
        db,
        {
          inventoryLotId: lotId,
          physicalQuantityDeltaScaled: -5000,
          costDeltaMinor: -1750,
          reason: 'Spoilage'
        },
        SYSTEM_ACTOR
      )
      const lot = getInventoryLotById(db, lotId)
      expect(lot?.quantityRemainingScaled).toBe(15000)
      expect(lot?.costRemainingMinor).toBe(5250)
    })

    it('rejects a zero quantity delta', () => {
      expect(() =>
        recordAdjustment(
          db,
          {
            inventoryLotId: lotId,
            physicalQuantityDeltaScaled: 0,
            costDeltaMinor: 0,
            reason: 'X'
          },
          SYSTEM_ACTOR
        )
      ).toThrow(StockMovementServiceError)
    })

    it('requires a reason', () => {
      expect(() =>
        recordAdjustment(
          db,
          {
            inventoryLotId: lotId,
            physicalQuantityDeltaScaled: 100,
            costDeltaMinor: 0,
            reason: ''
          },
          SYSTEM_ACTOR
        )
      ).toThrow(StockMovementValidationError)
      expect(() =>
        recordAdjustment(
          db,
          {
            inventoryLotId: lotId,
            physicalQuantityDeltaScaled: 100,
            costDeltaMinor: 0,
            reason: '   '
          },
          SYSTEM_ACTOR
        )
      ).toThrow(StockMovementValidationError)
    })

    it('never allows negative stock: rejects a negative adjustment exceeding remaining quantity', () => {
      expect(() =>
        recordAdjustment(
          db,
          {
            inventoryLotId: lotId,
            physicalQuantityDeltaScaled: -20001,
            costDeltaMinor: 0,
            reason: 'Too much'
          },
          SYSTEM_ACTOR
        )
      ).toThrow(StockMovementServiceError)
      const lot = getInventoryLotById(db, lotId)
      expect(lot?.quantityRemainingScaled).toBe(20000)
    })

    it('a full depletion sets lifecycleStatus to depleted', () => {
      recordAdjustment(
        db,
        {
          inventoryLotId: lotId,
          physicalQuantityDeltaScaled: -20000,
          costDeltaMinor: -7000,
          reason: 'Full write-off'
        },
        SYSTEM_ACTOR
      )
      const lot = getInventoryLotById(db, lotId)
      expect(lot?.quantityRemainingScaled).toBe(0)
      expect(lot?.lifecycleStatus).toBe('depleted')
    })

    it('writes exactly one audit row per adjustment', () => {
      const movement = recordAdjustment(
        db,
        {
          inventoryLotId: lotId,
          physicalQuantityDeltaScaled: -100,
          costDeltaMinor: -35,
          reason: 'X'
        },
        SYSTEM_ACTOR
      )
      expect(rawAuditRowsFor(movement.id)).toEqual([{ action: 'create' }])
    })
  })

  describe('reserveStock / releaseReservation', () => {
    it('reserving stock increases reserved but never changes physical quantity', () => {
      reserveStock(
        db,
        {
          inventoryLotId: lotId,
          quantityScaled: 5000,
          referenceType: 'sales',
          referenceId: 'order_1'
        },
        SYSTEM_ACTOR
      )
      const lot = getInventoryLotById(db, lotId)
      expect(lot?.quantityRemainingScaled).toBe(20000)
    })

    it('cannot reserve more than usable physical quantity', () => {
      expect(() =>
        reserveStock(
          db,
          {
            inventoryLotId: lotId,
            quantityScaled: 20001,
            referenceType: 'sales',
            referenceId: 'order_1'
          },
          SYSTEM_ACTOR
        )
      ).toThrow(StockMovementServiceError)
    })

    it('a second reservation cannot exceed remaining usable quantity after the first', () => {
      reserveStock(
        db,
        {
          inventoryLotId: lotId,
          quantityScaled: 15000,
          referenceType: 'sales',
          referenceId: 'order_1'
        },
        SYSTEM_ACTOR
      )
      expect(() =>
        reserveStock(
          db,
          {
            inventoryLotId: lotId,
            quantityScaled: 6000,
            referenceType: 'sales',
            referenceId: 'order_2'
          },
          SYSTEM_ACTOR
        )
      ).toThrow(StockMovementServiceError)
    })

    it('requires a stable referenceId', () => {
      expect(() =>
        reserveStock(
          db,
          {
            inventoryLotId: lotId,
            quantityScaled: 1000,
            referenceType: 'sales',
            referenceId: ''
          },
          SYSTEM_ACTOR
        )
      ).toThrow(StockMovementValidationError)
    })

    it('releasing a reservation restores available without changing physical quantity', () => {
      reserveStock(
        db,
        {
          inventoryLotId: lotId,
          quantityScaled: 5000,
          referenceType: 'sales',
          referenceId: 'order_1'
        },
        SYSTEM_ACTOR
      )
      releaseReservation(
        db,
        {
          inventoryLotId: lotId,
          quantityScaled: 5000,
          referenceType: 'sales',
          referenceId: 'order_1'
        },
        SYSTEM_ACTOR
      )
      const lot = getInventoryLotById(db, lotId)
      expect(lot?.quantityRemainingScaled).toBe(20000)
      expect(() =>
        reserveStock(
          db,
          {
            inventoryLotId: lotId,
            quantityScaled: 20000,
            referenceType: 'sales',
            referenceId: 'order_3'
          },
          SYSTEM_ACTOR
        )
      ).not.toThrow()
    })

    it('cannot release more than the outstanding reservation for that reference', () => {
      reserveStock(
        db,
        {
          inventoryLotId: lotId,
          quantityScaled: 3000,
          referenceType: 'sales',
          referenceId: 'order_1'
        },
        SYSTEM_ACTOR
      )
      expect(() =>
        releaseReservation(
          db,
          {
            inventoryLotId: lotId,
            quantityScaled: 3001,
            referenceType: 'sales',
            referenceId: 'order_1'
          },
          SYSTEM_ACTOR
        )
      ).toThrow(StockMovementServiceError)
    })

    it('cannot release against a reference with no outstanding reservation', () => {
      expect(() =>
        releaseReservation(
          db,
          {
            inventoryLotId: lotId,
            quantityScaled: 100,
            referenceType: 'sales',
            referenceId: 'never-reserved'
          },
          SYSTEM_ACTOR
        )
      ).toThrow(StockMovementServiceError)
    })
  })

  describe('reverseMovement', () => {
    it('applies exactly the opposite physical/cost deltas of the original movement', () => {
      const original = recordAdjustment(
        db,
        {
          inventoryLotId: lotId,
          physicalQuantityDeltaScaled: -5000,
          costDeltaMinor: -1750,
          reason: 'Mistaken write-off'
        },
        SYSTEM_ACTOR
      )
      const lotAfterAdjustment = getInventoryLotById(db, lotId)
      expect(lotAfterAdjustment?.quantityRemainingScaled).toBe(15000)

      const reversal = reverseMovement(
        db,
        original.id,
        'Correcting mistaken write-off',
        SYSTEM_ACTOR
      )
      expect(reversal.physicalQuantityDeltaScaled).toBe(5000)
      expect(reversal.costDeltaMinor).toBe(1750)
      expect(reversal.reversedMovementId).toBe(original.id)

      const lotAfterReversal = getInventoryLotById(db, lotId)
      expect(lotAfterReversal?.quantityRemainingScaled).toBe(20000)
    })

    it('requires a reason', () => {
      const original = recordAdjustment(
        db,
        {
          inventoryLotId: lotId,
          physicalQuantityDeltaScaled: -100,
          costDeltaMinor: 0,
          reason: 'X'
        },
        SYSTEM_ACTOR
      )
      expect(() => reverseMovement(db, original.id, '', SYSTEM_ACTOR)).toThrow(
        StockMovementValidationError
      )
    })

    it('a movement can be reversed once only', () => {
      const original = recordAdjustment(
        db,
        {
          inventoryLotId: lotId,
          physicalQuantityDeltaScaled: -100,
          costDeltaMinor: 0,
          reason: 'X'
        },
        SYSTEM_ACTOR
      )
      reverseMovement(db, original.id, 'First reversal', SYSTEM_ACTOR)
      expect(() => reverseMovement(db, original.id, 'Second attempt', SYSTEM_ACTOR)).toThrow(
        StockMovementServiceError
      )
    })

    it('rejects reversing a nonexistent movement', () => {
      expect(() => reverseMovement(db, 'does-not-exist', 'X', SYSTEM_ACTOR)).toThrow(
        StockMovementServiceError
      )
    })

    it('releases/reversals may unwind state for a lot whose parent item has since gone inactive', () => {
      const original = recordAdjustment(
        db,
        {
          inventoryLotId: lotId,
          physicalQuantityDeltaScaled: -100,
          costDeltaMinor: 0,
          reason: 'X'
        },
        SYSTEM_ACTOR
      )
      deactivateInventoryItem(db, itemId, SYSTEM_ACTOR)
      expect(() =>
        reverseMovement(db, original.id, 'Unwind after item deactivation', SYSTEM_ACTOR)
      ).not.toThrow()
    })

    it('other new mutations (adjustment) require the parent item to be active -- structural contrast with reversal', () => {
      deactivateInventoryItem(db, itemId, SYSTEM_ACTOR)
      expect(() =>
        recordAdjustment(
          db,
          {
            inventoryLotId: lotId,
            physicalQuantityDeltaScaled: -100,
            costDeltaMinor: -35,
            reason: 'X'
          },
          SYSTEM_ACTOR
        )
      ).not.toThrow()
    })
  })

  describe('listMovementsForLot', () => {
    it('returns every movement for a lot in chronological order', () => {
      const adjustment = recordAdjustment(
        db,
        {
          inventoryLotId: lotId,
          physicalQuantityDeltaScaled: -100,
          costDeltaMinor: -35,
          reason: 'X'
        },
        SYSTEM_ACTOR
      )
      const movements = listMovementsForLot(db, lotId)
      expect(movements.map((m) => m.id)).toEqual([movements[0].id, adjustment.id])
      expect(movements[0].movementType).toBe('receipt')
      expect(movements[1].movementType).toBe('adjustment')
    })
  })

  describe('append-only guarantee', () => {
    it('exports no update or delete function for stock movements', () => {
      const exportedNames = Object.keys(stockMovementService)
      for (const name of exportedNames) {
        expect(name.toLowerCase()).not.toContain('update')
        expect(name.toLowerCase()).not.toContain('delete')
      }
      expect(exportedNames.sort()).toEqual(
        [
          'StockMovementServiceError',
          'listMovementsForLot',
          'recordAdjustment',
          'reserveStock',
          'releaseReservation',
          'reverseMovement'
        ].sort()
      )
    })
  })

  describe('direct SQL bypass -- database-level constraints hold independent of the service layer', () => {
    it('rejects a second reversal of the same movement', () => {
      const original = recordAdjustment(
        db,
        {
          inventoryLotId: lotId,
          physicalQuantityDeltaScaled: -100,
          costDeltaMinor: 0,
          reason: 'X'
        },
        SYSTEM_ACTOR
      )
      reverseMovement(db, original.id, 'First reversal', SYSTEM_ACTOR)
      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO stock_movements
             (id, company_id, inventory_lot_id, movement_type, physical_quantity_delta_scaled, reserved_quantity_delta_scaled, cost_delta_minor, reference_type, reversed_movement_id, reason, created_at)
             VALUES ('mv_dupe', 'primary_company', ?, 'reversal', 100, 0, 0, 'reversal', ?, 'dup', ?)`
          )
          .run(lotId, original.id, Date.now())
      ).toThrow(/UNIQUE constraint failed/)
    })

    it('rejects a movement with both physical and reserved deltas at zero', () => {
      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO stock_movements
             (id, company_id, inventory_lot_id, movement_type, physical_quantity_delta_scaled, reserved_quantity_delta_scaled, cost_delta_minor, reference_type, created_at)
             VALUES ('mv_zero', 'primary_company', ?, 'adjustment', 0, 0, 0, 'manual_adjustment', ?)`
          )
          .run(lotId, Date.now())
      ).toThrow(/CHECK constraint failed/)
    })
  })
})
