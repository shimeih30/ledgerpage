import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import { createSupplier, deactivateSupplier } from '../../../src/main/db/supplierService'
import {
  createInventoryItem,
  deactivateInventoryItem
} from '../../../src/main/db/inventoryItemService'
import * as supplierPriceService from '../../../src/main/db/supplierPriceService'
import {
  DuplicateEffectivePriceError,
  getCurrentPriceForSupplierItem,
  listPricesForInventoryItem,
  listPricesForSupplier,
  recordSupplierPrice,
  SupplierPriceServiceError
} from '../../../src/main/db/supplierPriceService'
import { SupplierPriceValidationError } from '../../../src/main/db/validation/supplierPriceValidation'
import { FUNCTIONAL_CURRENCY_ID } from '../../../src/main/db/schema'
import type { AuditActor } from '../../../src/main/audit/auditService'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const SYSTEM_ACTOR: AuditActor = { type: 'system' }

const VALID_ITEM_INPUT = {
  code: 'flour',
  name: 'Flour',
  category: 'Dry goods',
  itemType: 'ingredient',
  unitOfMeasureId: 'uom_kg',
  minimumStock: 0,
  reorderQuantity: 0,
  leadTimeDays: 0
}

describe('supplierPriceService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let supplierId: string
  let itemId: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-supplier-price-service')
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
           VALUES ('numbering_rule_supplier', 'primary_company', 'supplier', 'SUP', 6, 'never', 0, NULL, ?, ?)`
      )
      .run(now, now)
    supplierId = createSupplier(db, { name: 'Acme Foods' }, SYSTEM_ACTOR).id
    itemId = createInventoryItem(db, VALID_ITEM_INPUT, SYSTEM_ACTOR).id
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

  const DAY_MS = 24 * 60 * 60 * 1000

  it('records a price with the required fields resolved server-side', () => {
    const price = recordSupplierPrice(
      db,
      { supplierId, inventoryItemId: itemId, priceMinor: 1000, effectiveFrom: new Date() },
      SYSTEM_ACTOR
    )
    expect(price.supplierId).toBe(supplierId)
    expect(price.supplierCode).toBe('SUP-000001')
    expect(price.supplierName).toBe('Acme Foods')
    expect(price.inventoryItemId).toBe(itemId)
    expect(price.inventoryItemCode).toBe('FLOUR')
    expect(price.inventoryItemName).toBe('Flour')
    expect(price.unitOfMeasureLabel).toBe('kg')
    expect(price.priceMinor).toBe(1000)
    expect(price.currencyId).toBe(FUNCTIONAL_CURRENCY_ID)
    expect(price.supplierItemCode).toBeNull()
  })

  describe('active supplier / item requirement', () => {
    it('rejects a nonexistent supplier', () => {
      expect(() =>
        recordSupplierPrice(
          db,
          {
            supplierId: 'does-not-exist',
            inventoryItemId: itemId,
            priceMinor: 100,
            effectiveFrom: new Date()
          },
          SYSTEM_ACTOR
        )
      ).toThrow(SupplierPriceServiceError)
    })

    it('rejects an inactive supplier', () => {
      deactivateSupplier(db, supplierId, SYSTEM_ACTOR)
      expect(() =>
        recordSupplierPrice(
          db,
          { supplierId, inventoryItemId: itemId, priceMinor: 100, effectiveFrom: new Date() },
          SYSTEM_ACTOR
        )
      ).toThrow(SupplierPriceServiceError)
    })

    it('rejects a nonexistent inventory item', () => {
      expect(() =>
        recordSupplierPrice(
          db,
          {
            supplierId,
            inventoryItemId: 'does-not-exist',
            priceMinor: 100,
            effectiveFrom: new Date()
          },
          SYSTEM_ACTOR
        )
      ).toThrow(SupplierPriceServiceError)
    })

    it('rejects an inactive inventory item', () => {
      deactivateInventoryItem(db, itemId, SYSTEM_ACTOR)
      expect(() =>
        recordSupplierPrice(
          db,
          { supplierId, inventoryItemId: itemId, priceMinor: 100, effectiveFrom: new Date() },
          SYSTEM_ACTOR
        )
      ).toThrow(SupplierPriceServiceError)
    })
  })

  describe('priceMinor validation', () => {
    it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
      'rejects priceMinor = %s',
      (priceMinor) => {
        expect(() =>
          recordSupplierPrice(
            db,
            { supplierId, inventoryItemId: itemId, priceMinor, effectiveFrom: new Date() },
            SYSTEM_ACTOR
          )
        ).toThrow(SupplierPriceValidationError)
      }
    )

    it('accepts zero', () => {
      const price = recordSupplierPrice(
        db,
        { supplierId, inventoryItemId: itemId, priceMinor: 0, effectiveFrom: new Date() },
        SYSTEM_ACTOR
      )
      expect(price.priceMinor).toBe(0)
    })
  })

  describe('supplierItemCode', () => {
    it('is nullable and omittable', () => {
      const price = recordSupplierPrice(
        db,
        { supplierId, inventoryItemId: itemId, priceMinor: 100, effectiveFrom: new Date() },
        SYSTEM_ACTOR
      )
      expect(price.supplierItemCode).toBeNull()
    })

    it('trims a provided value', () => {
      const price = recordSupplierPrice(
        db,
        {
          supplierId,
          inventoryItemId: itemId,
          priceMinor: 100,
          effectiveFrom: new Date(),
          supplierItemCode: '  ACME-FLR-1  '
        },
        SYSTEM_ACTOR
      )
      expect(price.supplierItemCode).toBe('ACME-FLR-1')
    })

    it('normalizes a blank value to null', () => {
      const price = recordSupplierPrice(
        db,
        {
          supplierId,
          inventoryItemId: itemId,
          priceMinor: 100,
          effectiveFrom: new Date(),
          supplierItemCode: '   '
        },
        SYSTEM_ACTOR
      )
      expect(price.supplierItemCode).toBeNull()
    })

    it('preserves the historical value even after a later price omits it', () => {
      const first = recordSupplierPrice(
        db,
        {
          supplierId,
          inventoryItemId: itemId,
          priceMinor: 100,
          effectiveFrom: new Date(Date.now() - DAY_MS),
          supplierItemCode: 'OLD-CODE'
        },
        SYSTEM_ACTOR
      )
      recordSupplierPrice(
        db,
        { supplierId, inventoryItemId: itemId, priceMinor: 110, effectiveFrom: new Date() },
        SYSTEM_ACTOR
      )
      const history = listPricesForSupplier(db, supplierId)
      const firstRow = history.find((r) => r.id === first.id)
      expect(firstRow?.supplierItemCode).toBe('OLD-CODE')
    })
  })

  describe('currency', () => {
    it('is always FUNCTIONAL_CURRENCY_ID regardless of any other value', () => {
      const price = recordSupplierPrice(
        db,
        { supplierId, inventoryItemId: itemId, priceMinor: 100, effectiveFrom: new Date() },
        SYSTEM_ACTOR
      )
      expect(price.currencyId).toBe(FUNCTIONAL_CURRENCY_ID)
    })
  })

  describe('duplicate effective timestamp', () => {
    it('rejects a second price for the same supplier/item at the same effectiveFrom', () => {
      const effectiveFrom = new Date('2026-01-01T00:00:00.000Z')
      recordSupplierPrice(
        db,
        { supplierId, inventoryItemId: itemId, priceMinor: 100, effectiveFrom },
        SYSTEM_ACTOR
      )
      expect(() =>
        recordSupplierPrice(
          db,
          { supplierId, inventoryItemId: itemId, priceMinor: 200, effectiveFrom },
          SYSTEM_ACTOR
        )
      ).toThrow(DuplicateEffectivePriceError)
    })

    it('allows the same effectiveFrom for a different item', () => {
      const otherItemId = createInventoryItem(
        db,
        { ...VALID_ITEM_INPUT, code: 'SUGAR' },
        SYSTEM_ACTOR
      ).id
      const effectiveFrom = new Date('2026-01-01T00:00:00.000Z')
      recordSupplierPrice(
        db,
        { supplierId, inventoryItemId: itemId, priceMinor: 100, effectiveFrom },
        SYSTEM_ACTOR
      )
      expect(() =>
        recordSupplierPrice(
          db,
          { supplierId, inventoryItemId: otherItemId, priceMinor: 200, effectiveFrom },
          SYSTEM_ACTOR
        )
      ).not.toThrow()
    })
  })

  describe('multiple suppliers per item and multiple items per supplier', () => {
    it('an item can have prices from multiple suppliers', () => {
      const otherSupplierId = createSupplier(db, { name: 'Beta Supplies' }, SYSTEM_ACTOR).id
      recordSupplierPrice(
        db,
        { supplierId, inventoryItemId: itemId, priceMinor: 100, effectiveFrom: new Date() },
        SYSTEM_ACTOR
      )
      recordSupplierPrice(
        db,
        {
          supplierId: otherSupplierId,
          inventoryItemId: itemId,
          priceMinor: 120,
          effectiveFrom: new Date()
        },
        SYSTEM_ACTOR
      )
      const history = listPricesForInventoryItem(db, itemId)
      expect(history.map((r) => r.supplierId).sort()).toEqual([supplierId, otherSupplierId].sort())
    })

    it('a supplier can have prices for multiple items', () => {
      const otherItemId = createInventoryItem(
        db,
        { ...VALID_ITEM_INPUT, code: 'SUGAR' },
        SYSTEM_ACTOR
      ).id
      recordSupplierPrice(
        db,
        { supplierId, inventoryItemId: itemId, priceMinor: 100, effectiveFrom: new Date() },
        SYSTEM_ACTOR
      )
      recordSupplierPrice(
        db,
        { supplierId, inventoryItemId: otherItemId, priceMinor: 200, effectiveFrom: new Date() },
        SYSTEM_ACTOR
      )
      const history = listPricesForSupplier(db, supplierId)
      expect(history.map((r) => r.inventoryItemId).sort()).toEqual([itemId, otherItemId].sort())
    })
  })

  describe('append-only guarantee', () => {
    it('recording a new price never modifies any prior price row', () => {
      const first = recordSupplierPrice(
        db,
        {
          supplierId,
          inventoryItemId: itemId,
          priceMinor: 100,
          effectiveFrom: new Date(Date.now() - DAY_MS)
        },
        SYSTEM_ACTOR
      )
      recordSupplierPrice(
        db,
        { supplierId, inventoryItemId: itemId, priceMinor: 999, effectiveFrom: new Date() },
        SYSTEM_ACTOR
      )
      const history = listPricesForSupplier(db, supplierId)
      const firstRowAfter = history.find((r) => r.id === first.id)
      expect(firstRowAfter?.priceMinor).toBe(100)
    })

    it('exports no update or delete function for this table', () => {
      const exportedNames = Object.keys(supplierPriceService)
      expect(exportedNames).not.toContain('updateSupplierPrice')
      expect(exportedNames).not.toContain('deleteSupplierPrice')
      expect(exportedNames).not.toContain('deactivateSupplierPrice')
      expect(exportedNames).not.toContain('reactivateSupplierPrice')
    })
  })

  describe('current price', () => {
    it('returns the latest row with effectiveFrom <= now', () => {
      recordSupplierPrice(
        db,
        {
          supplierId,
          inventoryItemId: itemId,
          priceMinor: 100,
          effectiveFrom: new Date(Date.now() - DAY_MS)
        },
        SYSTEM_ACTOR
      )
      const second = recordSupplierPrice(
        db,
        { supplierId, inventoryItemId: itemId, priceMinor: 150, effectiveFrom: new Date() },
        SYSTEM_ACTOR
      )
      const current = getCurrentPriceForSupplierItem(db, supplierId, itemId)
      expect(current?.id).toBe(second.id)
      expect(current?.priceMinor).toBe(150)
    })

    it('excludes a future-dated (scheduled) price', () => {
      const past = recordSupplierPrice(
        db,
        {
          supplierId,
          inventoryItemId: itemId,
          priceMinor: 100,
          effectiveFrom: new Date(Date.now() - DAY_MS)
        },
        SYSTEM_ACTOR
      )
      recordSupplierPrice(
        db,
        {
          supplierId,
          inventoryItemId: itemId,
          priceMinor: 500,
          effectiveFrom: new Date(Date.now() + DAY_MS)
        },
        SYSTEM_ACTOR
      )
      const current = getCurrentPriceForSupplierItem(db, supplierId, itemId)
      expect(current?.id).toBe(past.id)
      expect(current?.priceMinor).toBe(100)
    })

    it('returns undefined when only future-dated prices exist', () => {
      recordSupplierPrice(
        db,
        {
          supplierId,
          inventoryItemId: itemId,
          priceMinor: 500,
          effectiveFrom: new Date(Date.now() + DAY_MS)
        },
        SYSTEM_ACTOR
      )
      expect(getCurrentPriceForSupplierItem(db, supplierId, itemId)).toBeUndefined()
    })

    it('returns undefined when no price exists at all', () => {
      expect(getCurrentPriceForSupplierItem(db, supplierId, itemId)).toBeUndefined()
    })
  })

  describe('history ordering', () => {
    it('lists prices ordered by effectiveFrom descending, createdAt descending as a tiebreaker', () => {
      const older = recordSupplierPrice(
        db,
        {
          supplierId,
          inventoryItemId: itemId,
          priceMinor: 100,
          effectiveFrom: new Date(Date.now() - 2 * DAY_MS)
        },
        SYSTEM_ACTOR
      )
      const newer = recordSupplierPrice(
        db,
        {
          supplierId,
          inventoryItemId: itemId,
          priceMinor: 150,
          effectiveFrom: new Date(Date.now() - DAY_MS)
        },
        SYSTEM_ACTOR
      )
      const history = listPricesForSupplier(db, supplierId)
      expect(history.map((r) => r.id)).toEqual([newer.id, older.id])
    })
  })

  describe('historical display after deactivation', () => {
    it('a price row referencing a later-deactivated supplier still resolves the supplier label', () => {
      const price = recordSupplierPrice(
        db,
        { supplierId, inventoryItemId: itemId, priceMinor: 100, effectiveFrom: new Date() },
        SYSTEM_ACTOR
      )
      deactivateSupplier(db, supplierId, SYSTEM_ACTOR)
      const history = listPricesForSupplier(db, supplierId)
      const row = history.find((r) => r.id === price.id)
      expect(row?.supplierName).toBe('Acme Foods')
      expect(row?.supplierIsActive).toBe(false)
    })

    it('a price row referencing a later-deactivated inventory item still resolves the item label', () => {
      const price = recordSupplierPrice(
        db,
        { supplierId, inventoryItemId: itemId, priceMinor: 100, effectiveFrom: new Date() },
        SYSTEM_ACTOR
      )
      deactivateInventoryItem(db, itemId, SYSTEM_ACTOR)
      const history = listPricesForSupplier(db, supplierId)
      const row = history.find((r) => r.id === price.id)
      expect(row?.inventoryItemName).toBe('Flour')
      expect(row?.inventoryItemIsActive).toBe(false)
    })
  })

  it('writes exactly one audit row per recorded price', () => {
    const price = recordSupplierPrice(
      db,
      { supplierId, inventoryItemId: itemId, priceMinor: 100, effectiveFrom: new Date() },
      SYSTEM_ACTOR
    )
    expect(rawAuditRowsFor(price.id)).toEqual([{ action: 'create' }])
  })

  describe('direct SQL bypass -- database-level constraints hold independent of the service layer', () => {
    it('rejects a negative price_minor', () => {
      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO supplier_item_prices
             (id, supplier_id, inventory_item_id, price_minor, currency_id, effective_from, created_at)
             VALUES ('p1', ?, ?, -1, 'currency_usd', ?, ?)`
          )
          .run(supplierId, itemId, Date.now(), Date.now())
      ).toThrow()
    })

    it('rejects a duplicate (supplier_id, inventory_item_id, effective_from) triple', () => {
      const effectiveFrom = Date.now()
      rawDb
        .prepare(
          `INSERT INTO supplier_item_prices
           (id, supplier_id, inventory_item_id, price_minor, currency_id, effective_from, created_at)
           VALUES ('p1', ?, ?, 100, 'currency_usd', ?, ?)`
        )
        .run(supplierId, itemId, effectiveFrom, Date.now())
      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO supplier_item_prices
             (id, supplier_id, inventory_item_id, price_minor, currency_id, effective_from, created_at)
             VALUES ('p2', ?, ?, 200, 'currency_usd', ?, ?)`
          )
          .run(supplierId, itemId, effectiveFrom, Date.now())
      ).toThrow()
    })
  })
})
