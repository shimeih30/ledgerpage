import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import { createInventoryItem } from '../../../src/main/db/inventoryItemService'
import { createOpeningLot } from '../../../src/main/db/inventoryLotService'
import {
  recordAdjustment,
  releaseReservation,
  reserveStock,
  reverseMovement
} from '../../../src/main/db/stockMovementService'
import { consumeStock } from '../../../src/main/db/fifoConsumptionService'
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

interface RawMovement {
  id: string
  movementType: string
  physicalQuantityDeltaScaled: number
  reservedQuantityDeltaScaled: number
  costDeltaMinor: number
  referenceType: string
  reversedMovementId: string | null
  reason: string | null
}

interface RawLot {
  quantityRemainingScaled: number
  costRemainingMinor: number
  quantityReceivedScaled: number
  totalCostMinor: number
  lifecycleStatus: string
}

/**
 * This entire file deliberately never calls stockQuantityService for
 * any cached-balance reconciliation calculation (only the one
 * dedicated "incoming is always zero" test at the bottom uses it, per
 * its own narrow scope) -- everything else here queries inventory_lots
 * and stock_movements directly via raw SQL, reconstructing balances
 * from first principles rather than trusting any service's own
 * derived output.
 */
describe('stock ledger reconciliation (independent of stockQuantityService)', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let itemId: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-stock-ledger-reconciliation')
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

  /** Loads a lot's cached balance columns directly via raw SQL. */
  function loadLotDirect(lotId: string): RawLot {
    const row = rawDb
      .prepare(
        `SELECT
           quantity_remaining_scaled as quantityRemainingScaled,
           cost_remaining_minor as costRemainingMinor,
           quantity_received_scaled as quantityReceivedScaled,
           total_cost_minor as totalCostMinor,
           lifecycle_status as lifecycleStatus
         FROM inventory_lots
         WHERE id = ?`
      )
      .get(lotId) as RawLot | undefined
    if (!row) {
      throw new Error(`No lot found with id ${lotId}`)
    }
    return row
  }

  /** Loads every movement for a lot directly via raw SQL, ordered by createdAt ASC, id ASC. */
  function loadMovementsDirect(lotId: string): RawMovement[] {
    return rawDb
      .prepare(
        `SELECT
           id,
           movement_type as movementType,
           physical_quantity_delta_scaled as physicalQuantityDeltaScaled,
           reserved_quantity_delta_scaled as reservedQuantityDeltaScaled,
           cost_delta_minor as costDeltaMinor,
           reference_type as referenceType,
           reversed_movement_id as reversedMovementId,
           reason
         FROM stock_movements
         WHERE inventory_lot_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(lotId) as RawMovement[]
  }

  function sumPhysicalDeltas(movements: RawMovement[]): number {
    return movements.reduce((sum, m) => sum + m.physicalQuantityDeltaScaled, 0)
  }

  function sumReservedDeltas(movements: RawMovement[]): number {
    return movements.reduce((sum, m) => sum + m.reservedQuantityDeltaScaled, 0)
  }

  function sumCostDeltas(movements: RawMovement[]): number {
    return movements.reduce((sum, m) => sum + m.costDeltaMinor, 0)
  }

  function findOpeningReceipt(movements: RawMovement[]): RawMovement {
    const receipt = movements.find(
      (m) => m.movementType === 'receipt' && m.referenceType === 'opening_stock'
    )
    if (!receipt) {
      throw new Error('No opening receipt movement found')
    }
    return receipt
  }

  /**
   * The core reconciliation assertion used throughout this file: the
   * cached quantity_remaining_scaled/cost_remaining_minor columns must
   * always exactly equal the sum of every physicalQuantityDeltaScaled/
   * costDeltaMinor across the lot's complete movement history. The
   * opening receipt's own positive delta is already included in that
   * sum (it is itself a movement row), so quantityReceivedScaled/
   * totalCostMinor are never added again on top.
   */
  function assertReconciled(lotId: string): { lot: RawLot; movements: RawMovement[] } {
    const lot = loadLotDirect(lotId)
    const movements = loadMovementsDirect(lotId)
    expect(lot.quantityRemainingScaled).toBe(sumPhysicalDeltas(movements))
    expect(lot.costRemainingMinor).toBe(sumCostDeltas(movements))
    return { lot, movements }
  }

  function auditRowsFor(entityId: string): { action: string; entityType: string }[] {
    return rawDb
      .prepare(
        'SELECT action, entity_type as entityType FROM audit_log_entries WHERE entity_id = ?'
      )
      .all(entityId) as { action: string; entityType: string }[]
  }

  describe('A. Opening stock', () => {
    it('exactly one receipt movement exists, cached values reconcile, reserved sum is zero', () => {
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

      const { lot: rawLot, movements } = assertReconciled(lot.id)
      expect(movements).toHaveLength(1)
      expect(movements[0].movementType).toBe('receipt')
      expect(movements[0].referenceType).toBe('opening_stock')
      expect(sumReservedDeltas(movements)).toBe(0)

      const openingReceipt = findOpeningReceipt(movements)
      expect(rawLot.quantityReceivedScaled).toBe(openingReceipt.physicalQuantityDeltaScaled)
      expect(rawLot.totalCostMinor).toBe(openingReceipt.costDeltaMinor)
    })

    it('writes exactly one inventory_lot audit row and one stock_movement audit row (never one combined row)', () => {
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
      const movements = loadMovementsDirect(lot.id)

      const lotAuditRows = auditRowsFor(lot.id)
      expect(lotAuditRows).toEqual([{ action: 'create', entityType: 'inventory_lot' }])

      const movementAuditRows = auditRowsFor(movements[0].id)
      expect(movementAuditRows).toEqual([{ action: 'create', entityType: 'stock_movement' }])
    })
  })

  describe('B. Partial FIFO consumption', () => {
    it('reconciles cached quantity/cost from receipt + consumption rows, remaining values non-negative', () => {
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
      consumeStock(
        db,
        { inventoryItemId: itemId, quantityScaled: 5000, referenceType: 'manual_adjustment' },
        SYSTEM_ACTOR
      )

      const { lot: rawLot, movements } = assertReconciled(lot.id)
      expect(movements.map((m) => m.movementType)).toEqual(['receipt', 'consumption'])
      expect(rawLot.quantityRemainingScaled).toBeGreaterThanOrEqual(0)
      expect(rawLot.costRemainingMinor).toBeGreaterThanOrEqual(0)
      expect(rawLot.quantityRemainingScaled).toBe(15000)
    })
  })

  describe('C. Full depletion', () => {
    it('cached quantity and cost reach exactly zero, lifecycleStatus becomes depleted, movement sums reconcile exactly', () => {
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
      consumeStock(
        db,
        { inventoryItemId: itemId, quantityScaled: 20000, referenceType: 'manual_adjustment' },
        SYSTEM_ACTOR
      )

      const { lot: rawLot } = assertReconciled(lot.id)
      expect(rawLot.quantityRemainingScaled).toBe(0)
      expect(rawLot.costRemainingMinor).toBe(0)
      expect(rawLot.lifecycleStatus).toBe('depleted')
    })
  })

  describe('D. Multi-lot FIFO consumption', () => {
    it('each lot reconciles independently; first lot fully depleted, second partially consumed; allocation costs match consumption movement cost deltas exactly', () => {
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

      const { lot: firstRawLot } = assertReconciled(firstLot.id)
      const { lot: secondRawLot } = assertReconciled(secondLot.id)

      expect(firstRawLot.quantityRemainingScaled).toBe(0)
      expect(firstRawLot.costRemainingMinor).toBe(0)
      expect(firstRawLot.lifecycleStatus).toBe('depleted')

      expect(secondRawLot.quantityRemainingScaled).toBe(40000)
      expect(secondRawLot.lifecycleStatus).toBe('active')

      const firstLotConsumptionMovements = loadMovementsDirect(firstLot.id).filter(
        (m) => m.movementType === 'consumption'
      )
      const secondLotConsumptionMovements = loadMovementsDirect(secondLot.id).filter(
        (m) => m.movementType === 'consumption'
      )
      const sumOfInsertedConsumptionCostDeltas =
        Math.abs(sumCostDeltas(firstLotConsumptionMovements)) +
        Math.abs(sumCostDeltas(secondLotConsumptionMovements))
      expect(result.totalCostMinor).toBe(sumOfInsertedConsumptionCostDeltas)
      expect(result.totalCostMinor).toBe(11200)
    })
  })

  describe('E. Adjustment', () => {
    it('a positive correction within quantityReceivedScaled reconciles, with the movement reason preserved and no untracked cached change', () => {
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
      // First reduce stock, so a later positive correction stays
      // within quantityReceivedScaled (the database's own CHECK
      // constraint forbids a positive adjustment from ever exceeding
      // what was originally received).
      recordAdjustment(
        db,
        {
          inventoryLotId: lot.id,
          physicalQuantityDeltaScaled: -5000,
          costDeltaMinor: -1750,
          reason: 'Initial over-count'
        },
        SYSTEM_ACTOR
      )
      const balanceBeforeCorrection = loadLotDirect(lot.id)

      recordAdjustment(
        db,
        {
          inventoryLotId: lot.id,
          physicalQuantityDeltaScaled: 1000,
          costDeltaMinor: 350,
          reason: 'Correcting over-counted reduction'
        },
        SYSTEM_ACTOR
      )

      const { lot: rawLot, movements } = assertReconciled(lot.id)
      const correctionMovement = movements[movements.length - 1]
      expect(correctionMovement.movementType).toBe('adjustment')
      expect(correctionMovement.reason).toBe('Correcting over-counted reduction')

      // No cached value changed by more than exactly what this
      // movement's own delta specifies.
      expect(rawLot.quantityRemainingScaled).toBe(
        balanceBeforeCorrection.quantityRemainingScaled + 1000
      )
      expect(rawLot.costRemainingMinor).toBe(balanceBeforeCorrection.costRemainingMinor + 350)
    })
  })

  describe('F. Reservation', () => {
    it('physical sum unchanged, reserved sum increases, available = physical - reserved, available non-negative', () => {
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
      const physicalSumBefore = sumPhysicalDeltas(loadMovementsDirect(lot.id))

      reserveStock(
        db,
        { inventoryLotId: lot.id, quantityScaled: 5000, referenceType: 'sales', referenceId: 'o1' },
        SYSTEM_ACTOR
      )

      const { lot: rawLot, movements } = assertReconciled(lot.id)
      const physicalSumAfter = sumPhysicalDeltas(movements)
      const reservedSum = sumReservedDeltas(movements)

      expect(physicalSumAfter).toBe(physicalSumBefore)
      expect(reservedSum).toBe(5000)
      const available = rawLot.quantityRemainingScaled - reservedSum
      expect(available).toBe(15000)
      expect(available).toBeGreaterThanOrEqual(0)
    })
  })

  describe('G. Release', () => {
    it('physical sum unchanged, reserved sum decreases, available increases by the released amount, release never produces a positive physical delta', () => {
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
        { inventoryLotId: lot.id, quantityScaled: 8000, referenceType: 'sales', referenceId: 'o1' },
        SYSTEM_ACTOR
      )
      const physicalSumBefore = sumPhysicalDeltas(loadMovementsDirect(lot.id))
      const availableBefore =
        loadLotDirect(lot.id).quantityRemainingScaled -
        sumReservedDeltas(loadMovementsDirect(lot.id))

      const releaseMovement = releaseReservation(
        db,
        { inventoryLotId: lot.id, quantityScaled: 3000, referenceType: 'sales', referenceId: 'o1' },
        SYSTEM_ACTOR
      )
      expect(releaseMovement.physicalQuantityDeltaScaled).toBe(0)
      expect(releaseMovement.reservedQuantityDeltaScaled).toBeLessThan(0)

      const { lot: rawLot, movements } = assertReconciled(lot.id)
      const physicalSumAfter = sumPhysicalDeltas(movements)
      const reservedSumAfter = sumReservedDeltas(movements)
      const availableAfter = rawLot.quantityRemainingScaled - reservedSumAfter

      expect(physicalSumAfter).toBe(physicalSumBefore)
      expect(reservedSumAfter).toBe(5000)
      expect(availableAfter).toBe(availableBefore + 3000)
    })
  })

  describe('H. Reversal', () => {
    it('reversal deltas are the exact negation of the original for physical, reserved, and cost; reversedMovementId links correctly; balances remain correct; a second reversal is rejected', () => {
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
      const original = recordAdjustment(
        db,
        {
          inventoryLotId: lot.id,
          physicalQuantityDeltaScaled: -4000,
          costDeltaMinor: -1400,
          reason: 'Mistaken write-off'
        },
        SYSTEM_ACTOR
      )
      const reversal = reverseMovement(db, original.id, 'Undo mistaken write-off', SYSTEM_ACTOR)

      const movements = loadMovementsDirect(lot.id)
      const originalRow = movements.find((m) => m.id === original.id)
      const reversalRow = movements.find((m) => m.id === reversal.id)
      expect(originalRow).toBeDefined()
      expect(reversalRow).toBeDefined()

      expect(reversalRow?.physicalQuantityDeltaScaled).toBe(
        -(originalRow?.physicalQuantityDeltaScaled ?? 0)
      )
      // reservedQuantityDeltaScaled is 0 for both rows here (this was
      // an adjustment, not a reservation) -- asserted directly rather
      // than via -(0), since JS's unary negation of 0 produces -0,
      // which toBe (Object.is semantics) would not consider equal to
      // the stored +0.
      expect(originalRow?.reservedQuantityDeltaScaled).toBe(0)
      expect(reversalRow?.reservedQuantityDeltaScaled).toBe(0)
      expect(reversalRow?.costDeltaMinor).toBe(-(originalRow?.costDeltaMinor ?? 0))
      expect(reversalRow?.reversedMovementId).toBe(original.id)

      const { lot: rawLot } = assertReconciled(lot.id)
      // Net effect of the adjustment plus its exact reversal is zero.
      expect(rawLot.quantityRemainingScaled).toBe(20000)
      expect(rawLot.costRemainingMinor).toBe(7000)

      expect(() => reverseMovement(db, original.id, 'Second attempt', SYSTEM_ACTOR)).toThrow()
    })
  })

  describe('I. Combined lifecycle', () => {
    it('opening -> partial consumption -> reservation -> release -> adjustment -> reversal all reconcile after every step', () => {
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
      assertReconciled(lot.id)

      consumeStock(
        db,
        { inventoryItemId: itemId, quantityScaled: 3000, referenceType: 'manual_adjustment' },
        SYSTEM_ACTOR
      )
      assertReconciled(lot.id)

      reserveStock(
        db,
        { inventoryLotId: lot.id, quantityScaled: 2000, referenceType: 'sales', referenceId: 'o1' },
        SYSTEM_ACTOR
      )
      assertReconciled(lot.id)

      releaseReservation(
        db,
        { inventoryLotId: lot.id, quantityScaled: 1000, referenceType: 'sales', referenceId: 'o1' },
        SYSTEM_ACTOR
      )
      assertReconciled(lot.id)

      const adjustment = recordAdjustment(
        db,
        {
          inventoryLotId: lot.id,
          physicalQuantityDeltaScaled: -500,
          costDeltaMinor: -87,
          reason: 'Minor correction'
        },
        SYSTEM_ACTOR
      )
      assertReconciled(lot.id)

      reverseMovement(db, adjustment.id, 'Undo minor correction', SYSTEM_ACTOR)
      const { lot: finalLot, movements: finalMovements } = assertReconciled(lot.id)

      expect(finalMovements.map((m) => m.movementType)).toEqual([
        'receipt',
        'consumption',
        'reservation',
        'release',
        'adjustment',
        'reversal'
      ])
      expect(finalLot.quantityRemainingScaled).toBeGreaterThanOrEqual(0)
      expect(finalLot.costRemainingMinor).toBeGreaterThanOrEqual(0)
      const reservedFinal = sumReservedDeltas(finalMovements)
      expect(reservedFinal).toBeGreaterThanOrEqual(0)
      expect(finalLot.quantityRemainingScaled - reservedFinal).toBeGreaterThanOrEqual(0)
    })
  })

  describe('J. Incoming quantity', () => {
    it('remains zero in Slice 15 (this narrow test alone may use stockQuantityService; not used for balance reconciliation elsewhere)', async () => {
      const { getIncomingQuantity } = await import('../../../src/main/db/stockQuantityService')
      createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date(),
          quantityReceivedScaled: 10000,
          unitCostMinor: 200
        },
        SYSTEM_ACTOR
      )
      expect(getIncomingQuantity(db, itemId)).toBe(0)
    })
  })

  describe('K. Structural append-only guarantee', () => {
    it('stockMovementService exports no update/delete/remove function of any kind', async () => {
      const stockMovementService = await import('../../../src/main/db/stockMovementService')
      const forbidden = ['update', 'delete', 'remove']
      for (const name of Object.keys(stockMovementService)) {
        const lower = name.toLowerCase()
        for (const term of forbidden) {
          expect(lower).not.toContain(term)
        }
      }
    })

    it('inventoryLotService exports no direct balance setter or hard-delete function', async () => {
      const inventoryLotService = await import('../../../src/main/db/inventoryLotService')
      const prohibitedNames = [
        'updateInventoryLotBalances',
        'setQuantityRemaining',
        'setCostRemaining',
        'deleteInventoryLot',
        'removeInventoryLot',
        'hardDeleteInventoryLot'
      ]
      const exportedNames = Object.keys(inventoryLotService)
      for (const name of prohibitedNames) {
        expect(exportedNames).not.toContain(name)
      }
    })

    it('fifoConsumptionService exports no movement update/delete/remove function', async () => {
      const fifoConsumptionService = await import('../../../src/main/db/fifoConsumptionService')
      const forbidden = ['update', 'delete', 'remove']
      for (const name of Object.keys(fifoConsumptionService)) {
        const lower = name.toLowerCase()
        for (const term of forbidden) {
          expect(lower).not.toContain(term)
        }
      }
    })
  })
})
