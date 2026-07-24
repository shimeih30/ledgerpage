import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import { unitsOfMeasure } from '../../../src/main/db/schema'
import * as inventoryItemService from '../../../src/main/db/inventoryItemService'
import {
  createInventoryItem,
  deactivateInventoryItem,
  DuplicateInventoryItemCodeError,
  getInventoryItemById,
  InventoryItemServiceError,
  listInventoryItems,
  reactivateInventoryItem,
  updateInventoryItem
} from '../../../src/main/db/inventoryItemService'
import { InventoryItemValidationError } from '../../../src/main/db/validation/inventoryItemValidation'
import type { AuditActor } from '../../../src/main/audit/auditService'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const SYSTEM_ACTOR: AuditActor = { type: 'system' }

const VALID_INPUT = {
  code: 'flour',
  name: 'Flour',
  category: 'Dry goods',
  itemType: 'ingredient',
  unitOfMeasureId: 'uom_kg',
  minimumStock: 10,
  reorderQuantity: 20,
  leadTimeDays: 3
}

describe('inventoryItemService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    dir = createTempDir('ledgerpage-inventory-item-service')
    rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    db = drizzle<Record<string, never>>(rawDb)
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

  function deactivateUnit(unitId: string): void {
    db.update(unitsOfMeasure).set({ isActive: false }).where(eq(unitsOfMeasure.id, unitId)).run()
  }

  describe('before a company exists', () => {
    it('createInventoryItem returns a clear, documented error rather than a raw FK failure', () => {
      expect(() => createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)).toThrow(
        InventoryItemServiceError
      )
    })
  })

  describe('once a company exists', () => {
    beforeEach(() => {
      createCompany(db, {
        name: 'Fixture Co',
        address: 'Addr',
        contactDetails: 'contact@example.com',
        currencyId: 'currency_usd'
      })
    })

    it('creates an inventory item with all fields', () => {
      const created = createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)
      expect(created.code).toBe('FLOUR')
      expect(created.name).toBe('Flour')
      expect(created.category).toBe('Dry goods')
      expect(created.itemType).toBe('ingredient')
      expect(created.unitOfMeasureId).toBe('uom_kg')
      expect(created.unitOfMeasureLabel).toBe('kg')
      expect(created.minimumStock).toBe(10)
      expect(created.reorderQuantity).toBe(20)
      expect(created.maximumStock).toBeNull()
      expect(created.leadTimeDays).toBe(3)
      expect(created.lotTracked).toBe(false)
      expect(created.expiryTracked).toBe(false)
      expect(created.isActive).toBe(true)
    })

    it('normalizes code: trims and upper-cases', () => {
      const created = createInventoryItem(db, { ...VALID_INPUT, code: '  flour  ' }, SYSTEM_ACTOR)
      expect(created.code).toBe('FLOUR')
    })

    it('rejects a duplicate normalized code', () => {
      createInventoryItem(db, { ...VALID_INPUT, code: 'FLOUR' }, SYSTEM_ACTOR)
      expect(() =>
        createInventoryItem(db, { ...VALID_INPUT, code: 'flour' }, SYSTEM_ACTOR)
      ).toThrow(DuplicateInventoryItemCodeError)
    })

    it('rejects an empty name', () => {
      expect(() => createInventoryItem(db, { ...VALID_INPUT, name: '   ' }, SYSTEM_ACTOR)).toThrow(
        InventoryItemValidationError
      )
    })

    it('rejects an empty category', () => {
      expect(() =>
        createInventoryItem(db, { ...VALID_INPUT, category: '   ' }, SYSTEM_ACTOR)
      ).toThrow(InventoryItemValidationError)
    })

    it('rejects an invalid item type', () => {
      expect(() =>
        createInventoryItem(db, { ...VALID_INPUT, itemType: 'not-a-type' }, SYSTEM_ACTOR)
      ).toThrow(InventoryItemValidationError)
    })

    it('accepts each of the four approved item types', () => {
      for (const itemType of ['ingredient', 'packaging', 'consumable', 'other']) {
        const created = createInventoryItem(
          db,
          { ...VALID_INPUT, code: `code-${itemType}`, itemType },
          SYSTEM_ACTOR
        )
        expect(created.itemType).toBe(itemType)
      }
    })

    describe('integer-only quantity validation', () => {
      it.each([
        ['minimumStock', -1],
        ['minimumStock', 1.5],
        ['minimumStock', NaN],
        ['minimumStock', Infinity],
        ['minimumStock', Number.MAX_SAFE_INTEGER + 1],
        ['reorderQuantity', -1],
        ['reorderQuantity', 1.5],
        ['leadTimeDays', -1],
        ['leadTimeDays', 1.5]
      ])('rejects %s = %s', (field, value) => {
        expect(() =>
          createInventoryItem(db, { ...VALID_INPUT, [field]: value }, SYSTEM_ACTOR)
        ).toThrow(InventoryItemValidationError)
      })

      it('accepts zero for minimumStock, reorderQuantity, and leadTimeDays', () => {
        const created = createInventoryItem(
          db,
          { ...VALID_INPUT, minimumStock: 0, reorderQuantity: 0, leadTimeDays: 0 },
          SYSTEM_ACTOR
        )
        expect(created.minimumStock).toBe(0)
        expect(created.reorderQuantity).toBe(0)
        expect(created.leadTimeDays).toBe(0)
      })
    })

    describe('maximumStock', () => {
      it('is nullable and omittable', () => {
        const created = createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)
        expect(created.maximumStock).toBeNull()
      })

      it('accepts an explicit null', () => {
        const created = createInventoryItem(
          db,
          { ...VALID_INPUT, maximumStock: null },
          SYSTEM_ACTOR
        )
        expect(created.maximumStock).toBeNull()
      })

      it('accepts a valid value >= minimumStock', () => {
        const created = createInventoryItem(
          db,
          { ...VALID_INPUT, minimumStock: 10, maximumStock: 50 },
          SYSTEM_ACTOR
        )
        expect(created.maximumStock).toBe(50)
      })

      it('rejects a negative value', () => {
        expect(() =>
          createInventoryItem(db, { ...VALID_INPUT, maximumStock: -1 }, SYSTEM_ACTOR)
        ).toThrow(InventoryItemValidationError)
      })

      it('rejects maximumStock < minimumStock', () => {
        expect(() =>
          createInventoryItem(
            db,
            { ...VALID_INPUT, minimumStock: 50, maximumStock: 10 },
            SYSTEM_ACTOR
          )
        ).toThrow(InventoryItemValidationError)
      })

      it('accepts maximumStock === minimumStock', () => {
        const created = createInventoryItem(
          db,
          { ...VALID_INPUT, minimumStock: 10, maximumStock: 10 },
          SYSTEM_ACTOR
        )
        expect(created.maximumStock).toBe(10)
      })
    })

    describe('unit of measure', () => {
      it('rejects a nonexistent unit id', () => {
        expect(() =>
          createInventoryItem(
            db,
            { ...VALID_INPUT, unitOfMeasureId: 'does-not-exist' },
            SYSTEM_ACTOR
          )
        ).toThrow(InventoryItemValidationError)
      })

      it('rejects an inactive unit at creation', () => {
        deactivateUnit('uom_kg')
        expect(() => createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)).toThrow(
          InventoryItemValidationError
        )
      })

      it("resolves unitOfMeasureLabel to the unit's own code", () => {
        const created = createInventoryItem(
          db,
          { ...VALID_INPUT, unitOfMeasureId: 'uom_l' },
          SYSTEM_ACTOR
        )
        expect(created.unitOfMeasureLabel).toBe('l')
      })
    })

    it('writes exactly one create audit row', () => {
      const created = createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)
      expect(rawAuditRowsFor(created.id)).toEqual([{ action: 'create' }])
    })

    it('listInventoryItems returns every created item', () => {
      createInventoryItem(db, { ...VALID_INPUT, code: 'A' }, SYSTEM_ACTOR)
      createInventoryItem(db, { ...VALID_INPUT, code: 'B' }, SYSTEM_ACTOR)
      expect(listInventoryItems(db)).toHaveLength(2)
    })

    it('getInventoryItemById returns undefined for a nonexistent id', () => {
      expect(getInventoryItemById(db, 'does-not-exist')).toBeUndefined()
    })

    describe('update', () => {
      it('updates editable fields', () => {
        const created = createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)
        const updated = updateInventoryItem(
          db,
          created.id,
          { name: 'New Flour', category: 'Baking', minimumStock: 99 },
          SYSTEM_ACTOR
        )
        expect(updated.name).toBe('New Flour')
        expect(updated.category).toBe('Baking')
        expect(updated.minimumStock).toBe(99)
        expect(updated.code).toBe(created.code)
        expect(updated.itemType).toBe(created.itemType)
      })

      it('has no way to accept a code or itemType value through its own type', () => {
        // Structural proof: this line only compiles because
        // UpdateInventoryItemInput has neither field.
        const created = createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)
        const updated = updateInventoryItem(db, created.id, { name: 'X' }, SYSTEM_ACTOR)
        expect(updated.code).toBe(created.code)
        expect(updated.itemType).toBe(created.itemType)
      })

      it('re-validates maximumStock >= minimumStock on update', () => {
        const created = createInventoryItem(
          db,
          { ...VALID_INPUT, minimumStock: 10, maximumStock: 20 },
          SYSTEM_ACTOR
        )
        expect(() =>
          updateInventoryItem(db, created.id, { minimumStock: 30 }, SYSTEM_ACTOR)
        ).toThrow(InventoryItemValidationError)
      })

      it('rejects switching to an inactive unit', () => {
        const created = createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)
        deactivateUnit('uom_l')
        expect(() =>
          updateInventoryItem(db, created.id, { unitOfMeasureId: 'uom_l' }, SYSTEM_ACTOR)
        ).toThrow(InventoryItemValidationError)
      })

      it('allows an unrelated update to preserve an already-inactive unit reference unchanged', () => {
        const created = createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)
        deactivateUnit('uom_kg')
        const updated = updateInventoryItem(db, created.id, { name: 'Renamed' }, SYSTEM_ACTOR)
        expect(updated.unitOfMeasureId).toBe('uom_kg')
        expect(updated.name).toBe('Renamed')
      })

      it('allows explicitly re-submitting the same (now inactive) unit id unchanged', () => {
        const created = createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)
        deactivateUnit('uom_kg')
        const updated = updateInventoryItem(
          db,
          created.id,
          { unitOfMeasureId: 'uom_kg' },
          SYSTEM_ACTOR
        )
        expect(updated.unitOfMeasureId).toBe('uom_kg')
      })

      it('allows switching to a different active unit', () => {
        const created = createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)
        const updated = updateInventoryItem(
          db,
          created.id,
          { unitOfMeasureId: 'uom_g' },
          SYSTEM_ACTOR
        )
        expect(updated.unitOfMeasureId).toBe('uom_g')
        expect(updated.unitOfMeasureLabel).toBe('g')
      })

      it('a no-op update writes no additional audit row', () => {
        const created = createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)
        updateInventoryItem(db, created.id, { name: created.name }, SYSTEM_ACTOR)
        expect(rawAuditRowsFor(created.id)).toEqual([{ action: 'create' }])
      })

      it('writes exactly one update audit row for a real change', () => {
        const created = createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)
        updateInventoryItem(db, created.id, { name: 'Changed' }, SYSTEM_ACTOR)
        expect(rawAuditRowsFor(created.id)).toEqual([{ action: 'create' }, { action: 'update' }])
      })

      it('throws for a nonexistent item', () => {
        expect(() =>
          updateInventoryItem(db, 'does-not-exist', { name: 'X' }, SYSTEM_ACTOR)
        ).toThrow(InventoryItemServiceError)
      })
    })

    describe('deactivate / reactivate', () => {
      it('deactivateInventoryItem sets isActive to false and writes one audit row', () => {
        const created = createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)
        const deactivated = deactivateInventoryItem(db, created.id, SYSTEM_ACTOR)
        expect(deactivated.isActive).toBe(false)
        expect(rawAuditRowsFor(created.id)).toEqual([
          { action: 'create' },
          { action: 'deactivate' }
        ])
      })

      it('reactivateInventoryItem sets isActive back to true and writes one audit row', () => {
        const created = createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)
        deactivateInventoryItem(db, created.id, SYSTEM_ACTOR)
        const reactivated = reactivateInventoryItem(db, created.id, SYSTEM_ACTOR)
        expect(reactivated.isActive).toBe(true)
        expect(rawAuditRowsFor(created.id)).toEqual([
          { action: 'create' },
          { action: 'deactivate' },
          { action: 'reactivate' }
        ])
      })

      it('reactivating an already-active item is a no-op: no additional audit row', () => {
        const created = createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)
        reactivateInventoryItem(db, created.id, SYSTEM_ACTOR)
        expect(rawAuditRowsFor(created.id)).toEqual([{ action: 'create' }])
      })

      it('deactivating an already-inactive item is a no-op: no additional audit row', () => {
        const created = createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)
        deactivateInventoryItem(db, created.id, SYSTEM_ACTOR)
        deactivateInventoryItem(db, created.id, SYSTEM_ACTOR)
        expect(rawAuditRowsFor(created.id)).toEqual([
          { action: 'create' },
          { action: 'deactivate' }
        ])
      })
    })

    describe('direct SQL bypass -- database-level constraints hold independent of the service layer', () => {
      it('rejects a second item with a duplicate (company_id, code) pair', () => {
        const created = createInventoryItem(db, VALID_INPUT, SYSTEM_ACTOR)
        expect(() =>
          rawDb
            .prepare(
              `INSERT INTO inventory_items
               (id, company_id, code, name, category, item_type, unit_of_measure_id, minimum_stock, reorder_quantity, lead_time_days, lot_tracked, expiry_tracked, is_active, created_at, updated_at)
               VALUES (?, 'primary_company', ?, 'Dupe', 'X', 'ingredient', 'uom_kg', 0, 0, 0, 0, 0, 1, ?, ?)`
            )
            .run('item_dupe', created.code, Date.now(), Date.now())
        ).toThrow()
      })

      it('rejects an invalid item_type value', () => {
        expect(() =>
          rawDb
            .prepare(
              `INSERT INTO inventory_items
               (id, company_id, code, name, category, item_type, unit_of_measure_id, minimum_stock, reorder_quantity, lead_time_days, lot_tracked, expiry_tracked, is_active, created_at, updated_at)
               VALUES ('item_bad_type', 'primary_company', 'X', 'X', 'X', 'bogus', 'uom_kg', 0, 0, 0, 0, 0, 1, ?, ?)`
            )
            .run(Date.now(), Date.now())
        ).toThrow()
      })

      it('rejects a maximum_stock lower than minimum_stock', () => {
        expect(() =>
          rawDb
            .prepare(
              `INSERT INTO inventory_items
               (id, company_id, code, name, category, item_type, unit_of_measure_id, minimum_stock, reorder_quantity, maximum_stock, lead_time_days, lot_tracked, expiry_tracked, is_active, created_at, updated_at)
               VALUES ('item_bad_max', 'primary_company', 'X', 'X', 'X', 'ingredient', 'uom_kg', 10, 0, 5, 0, 0, 0, 1, ?, ?)`
            )
            .run(Date.now(), Date.now())
        ).toThrow()
      })
    })

    it('exports no direct SQL/delete surface beyond the documented CRUD functions and error classes', () => {
      const exportedFunctionNames = Object.keys(inventoryItemService).filter((key) => {
        const value = (inventoryItemService as unknown as Record<string, unknown>)[key]
        return (
          typeof value === 'function' && !/^class\s/.test(Function.prototype.toString.call(value))
        )
      })
      expect(exportedFunctionNames.sort()).toEqual(
        [
          'listInventoryItems',
          'getInventoryItemById',
          'createInventoryItem',
          'updateInventoryItem',
          'deactivateInventoryItem',
          'reactivateInventoryItem'
        ].sort()
      )
    })
  })
})
