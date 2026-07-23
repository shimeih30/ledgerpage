import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import { numberingRuleId } from '../../../src/main/db/numberingDefaults'
import {
  FUNCTIONAL_CURRENCY_ID,
  numberingRules,
  PRIMARY_COMPANY_ID
} from '../../../src/main/db/schema'
import { createProduct, deactivateProduct, type Product } from '../../../src/main/db/productService'
import { createTaxCode, deactivateTaxCode } from '../../../src/main/db/taxCodeService'
import * as productVariantService from '../../../src/main/db/productVariantService'
import {
  createVariant,
  deactivateVariant,
  DuplicateBarcodeError,
  DuplicateVariantCodeError,
  getVariantById,
  listVariantsForProduct,
  ProductVariantServiceError,
  reactivateVariant,
  updateVariant
} from '../../../src/main/db/productVariantService'
import { ProductValidationError } from '../../../src/main/db/validation/productValidation'
import type { AuditActor } from '../../../src/main/audit/auditService'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const SYSTEM_ACTOR: AuditActor = { type: 'system' }

describe('productVariantService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let manufacturedProduct: Product
  let serviceProduct: Product

  beforeEach(() => {
    dir = createTempDir('ledgerpage-product-variant-service')
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
    const now = new Date()
    db.insert(numberingRules)
      .values({
        id: numberingRuleId('product'),
        companyId: PRIMARY_COMPANY_ID,
        documentTypeKey: 'product',
        prefix: 'PRD',
        paddingLength: 6,
        resetBehavior: 'never',
        currentSequenceValue: 0,
        currentSequenceYear: null,
        createdAt: now,
        updatedAt: now
      })
      .run()

    manufacturedProduct = createProduct(db, { name: 'Jam', type: 'manufactured' }, SYSTEM_ACTOR)
    serviceProduct = createProduct(db, { name: 'Delivery', type: 'service' }, SYSTEM_ACTOR)
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

  describe('create', () => {
    it('creates a variant with the given fields', () => {
      const variant = createVariant(
        db,
        {
          productId: manufacturedProduct.id,
          code: '100ml',
          name: '100 ml jar',
          sellingPriceMinor: 500
        },
        SYSTEM_ACTOR
      )
      expect(variant.productId).toBe(manufacturedProduct.id)
      expect(variant.name).toBe('100 ml jar')
      expect(variant.sellingPriceMinor).toBe(500)
      expect(variant.isActive).toBe(true)
    })

    it('always stores currencyId as FUNCTIONAL_CURRENCY_ID', () => {
      const variant = createVariant(
        db,
        { productId: manufacturedProduct.id, code: '100ml', name: 'X', sellingPriceMinor: 500 },
        SYSTEM_ACTOR
      )
      expect(variant.currencyId).toBe(FUNCTIONAL_CURRENCY_ID)
    })

    it('normalizes code: trims and upper-cases', () => {
      const variant = createVariant(
        db,
        { productId: manufacturedProduct.id, code: '  100ml  ', name: 'X', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      expect(variant.code).toBe('100ML')
    })

    it('rejects a duplicate code within the same product', () => {
      createVariant(
        db,
        { productId: manufacturedProduct.id, code: '100ML', name: 'A', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      expect(() =>
        createVariant(
          db,
          { productId: manufacturedProduct.id, code: '100ml', name: 'B', sellingPriceMinor: 0 },
          SYSTEM_ACTOR
        )
      ).toThrow(DuplicateVariantCodeError)
    })

    it('allows the same code across two different products', () => {
      createVariant(
        db,
        { productId: manufacturedProduct.id, code: '100ML', name: 'A', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      const second = createVariant(
        db,
        { productId: serviceProduct.id, code: '100ML', name: 'B', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      expect(second.code).toBe('100ML')
    })

    it('rejects a negative selling price', () => {
      expect(() =>
        createVariant(
          db,
          { productId: manufacturedProduct.id, code: 'X', name: 'X', sellingPriceMinor: -1 },
          SYSTEM_ACTOR
        )
      ).toThrow(ProductValidationError)
    })

    it('rejects a non-integer selling price', () => {
      expect(() =>
        createVariant(
          db,
          { productId: manufacturedProduct.id, code: 'X', name: 'X', sellingPriceMinor: 1.5 },
          SYSTEM_ACTOR
        )
      ).toThrow(ProductValidationError)
    })

    it('accepts a zero selling price', () => {
      const variant = createVariant(
        db,
        { productId: manufacturedProduct.id, code: 'X', name: 'X', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      expect(variant.sellingPriceMinor).toBe(0)
    })

    it('throws for a nonexistent product', () => {
      expect(() =>
        createVariant(
          db,
          { productId: 'does-not-exist', code: 'X', name: 'X', sellingPriceMinor: 0 },
          SYSTEM_ACTOR
        )
      ).toThrow(ProductVariantServiceError)
    })

    describe('barcode', () => {
      it('trims a barcode', () => {
        const variant = createVariant(
          db,
          {
            productId: manufacturedProduct.id,
            code: 'X',
            name: 'X',
            sellingPriceMinor: 0,
            barcode: '  12345  '
          },
          SYSTEM_ACTOR
        )
        expect(variant.barcode).toBe('12345')
      })

      it('normalizes an empty-string barcode to null', () => {
        const variant = createVariant(
          db,
          {
            productId: manufacturedProduct.id,
            code: 'X',
            name: 'X',
            sellingPriceMinor: 0,
            barcode: '   '
          },
          SYSTEM_ACTOR
        )
        expect(variant.barcode).toBeNull()
      })

      it('a null/omitted barcode is fine on its own', () => {
        const variant = createVariant(
          db,
          { productId: manufacturedProduct.id, code: 'X', name: 'X', sellingPriceMinor: 0 },
          SYSTEM_ACTOR
        )
        expect(variant.barcode).toBeNull()
      })

      it('two variants may both have a null barcode without colliding', () => {
        createVariant(
          db,
          { productId: manufacturedProduct.id, code: 'A', name: 'A', sellingPriceMinor: 0 },
          SYSTEM_ACTOR
        )
        const second = createVariant(
          db,
          { productId: manufacturedProduct.id, code: 'B', name: 'B', sellingPriceMinor: 0 },
          SYSTEM_ACTOR
        )
        expect(second.barcode).toBeNull()
      })

      it('rejects a duplicate non-null barcode across different products', () => {
        createVariant(
          db,
          {
            productId: manufacturedProduct.id,
            code: 'A',
            name: 'A',
            sellingPriceMinor: 0,
            barcode: '000111222'
          },
          SYSTEM_ACTOR
        )
        expect(() =>
          createVariant(
            db,
            {
              productId: serviceProduct.id,
              code: 'B',
              name: 'B',
              sellingPriceMinor: 0,
              barcode: '000111222'
            },
            SYSTEM_ACTOR
          )
        ).toThrow(DuplicateBarcodeError)
      })
    })

    describe('tax code reference', () => {
      it('accepts a valid, active, primary-company tax code', () => {
        const taxCode = createTaxCode(
          db,
          { code: 'STD', name: 'Standard', category: 'standard' },
          SYSTEM_ACTOR
        )
        const variant = createVariant(
          db,
          {
            productId: manufacturedProduct.id,
            code: 'X',
            name: 'X',
            sellingPriceMinor: 0,
            taxCodeId: taxCode.id
          },
          SYSTEM_ACTOR
        )
        expect(variant.taxCodeId).toBe(taxCode.id)
      })

      it('rejects a nonexistent tax code id', () => {
        expect(() =>
          createVariant(
            db,
            {
              productId: manufacturedProduct.id,
              code: 'X',
              name: 'X',
              sellingPriceMinor: 0,
              taxCodeId: 'does-not-exist'
            },
            SYSTEM_ACTOR
          )
        ).toThrow(ProductValidationError)
      })

      it('rejects an inactive tax code', () => {
        const taxCode = createTaxCode(
          db,
          { code: 'STD', name: 'Standard', category: 'standard' },
          SYSTEM_ACTOR
        )
        deactivateTaxCode(db, taxCode.id, SYSTEM_ACTOR)
        expect(() =>
          createVariant(
            db,
            {
              productId: manufacturedProduct.id,
              code: 'X',
              name: 'X',
              sellingPriceMinor: 0,
              taxCodeId: taxCode.id
            },
            SYSTEM_ACTOR
          )
        ).toThrow(ProductValidationError)
      })

      it('a null taxCodeId is fine', () => {
        const variant = createVariant(
          db,
          {
            productId: manufacturedProduct.id,
            code: 'X',
            name: 'X',
            sellingPriceMinor: 0,
            taxCodeId: null
          },
          SYSTEM_ACTOR
        )
        expect(variant.taxCodeId).toBeNull()
      })

      it('a later deactivation of an already-assigned tax code does not clear the stored reference', () => {
        const taxCode = createTaxCode(
          db,
          { code: 'STD', name: 'Standard', category: 'standard' },
          SYSTEM_ACTOR
        )
        const variant = createVariant(
          db,
          {
            productId: manufacturedProduct.id,
            code: 'X',
            name: 'X',
            sellingPriceMinor: 0,
            taxCodeId: taxCode.id
          },
          SYSTEM_ACTOR
        )
        deactivateTaxCode(db, taxCode.id, SYSTEM_ACTOR)
        const stillReferenced = getVariantById(db, variant.id)
        expect(stillReferenced?.taxCodeId).toBe(taxCode.id)
      })

      it("taxCodeLabel resolves to the referenced tax code's own code, for both listVariantsForProduct and getVariantById", () => {
        const taxCode = createTaxCode(
          db,
          { code: 'STD', name: 'Standard', category: 'standard' },
          SYSTEM_ACTOR
        )
        const variant = createVariant(
          db,
          {
            productId: manufacturedProduct.id,
            code: 'X',
            name: 'X',
            sellingPriceMinor: 0,
            taxCodeId: taxCode.id
          },
          SYSTEM_ACTOR
        )
        expect(getVariantById(db, variant.id)?.taxCodeLabel).toBe('STD')
        expect(listVariantsForProduct(db, manufacturedProduct.id)[0].taxCodeLabel).toBe('STD')
      })

      it('taxCodeLabel is null when taxCodeId is null', () => {
        const variant = createVariant(
          db,
          { productId: manufacturedProduct.id, code: 'X', name: 'X', sellingPriceMinor: 0 },
          SYSTEM_ACTOR
        )
        expect(getVariantById(db, variant.id)?.taxCodeLabel).toBeNull()
      })

      it('taxCodeLabel still resolves correctly after the referenced tax code is deactivated -- the join is not filtered by isActive', () => {
        const taxCode = createTaxCode(
          db,
          { code: 'STD', name: 'Standard', category: 'standard' },
          SYSTEM_ACTOR
        )
        const variant = createVariant(
          db,
          {
            productId: manufacturedProduct.id,
            code: 'X',
            name: 'X',
            sellingPriceMinor: 0,
            taxCodeId: taxCode.id
          },
          SYSTEM_ACTOR
        )
        deactivateTaxCode(db, taxCode.id, SYSTEM_ACTOR)

        const reloaded = getVariantById(db, variant.id)
        expect(reloaded?.taxCodeId).toBe(taxCode.id)
        expect(reloaded?.taxCodeLabel).toBe('STD')
      })
    })

    describe('service vs. manufactured stock-level rule', () => {
      it('a manufactured variant defaults minimumFinishedStockLevel to 0 when omitted', () => {
        const variant = createVariant(
          db,
          { productId: manufacturedProduct.id, code: 'X', name: 'X', sellingPriceMinor: 0 },
          SYSTEM_ACTOR
        )
        expect(variant.minimumFinishedStockLevel).toBe(0)
      })

      it('a manufactured variant accepts a nonzero, non-negative minimumFinishedStockLevel', () => {
        const variant = createVariant(
          db,
          {
            productId: manufacturedProduct.id,
            code: 'X',
            name: 'X',
            sellingPriceMinor: 0,
            minimumFinishedStockLevel: 25
          },
          SYSTEM_ACTOR
        )
        expect(variant.minimumFinishedStockLevel).toBe(25)
      })

      it('a manufactured variant rejects a negative minimumFinishedStockLevel', () => {
        expect(() =>
          createVariant(
            db,
            {
              productId: manufacturedProduct.id,
              code: 'X',
              name: 'X',
              sellingPriceMinor: 0,
              minimumFinishedStockLevel: -1
            },
            SYSTEM_ACTOR
          )
        ).toThrow(ProductValidationError)
      })

      it('a service variant defaults minimumFinishedStockLevel to 0 when omitted', () => {
        const variant = createVariant(
          db,
          { productId: serviceProduct.id, code: 'X', name: 'X', sellingPriceMinor: 0 },
          SYSTEM_ACTOR
        )
        expect(variant.minimumFinishedStockLevel).toBe(0)
      })

      it('a service variant accepts an explicit 0', () => {
        const variant = createVariant(
          db,
          {
            productId: serviceProduct.id,
            code: 'X',
            name: 'X',
            sellingPriceMinor: 0,
            minimumFinishedStockLevel: 0
          },
          SYSTEM_ACTOR
        )
        expect(variant.minimumFinishedStockLevel).toBe(0)
      })

      it('a service variant rejects a direct attempt at a nonzero minimumFinishedStockLevel', () => {
        expect(() =>
          createVariant(
            db,
            {
              productId: serviceProduct.id,
              code: 'X',
              name: 'X',
              sellingPriceMinor: 0,
              minimumFinishedStockLevel: 5
            },
            SYSTEM_ACTOR
          )
        ).toThrow(ProductValidationError)
      })
    })

    it('writes exactly one create audit row per variant created', () => {
      const variant = createVariant(
        db,
        { productId: manufacturedProduct.id, code: 'X', name: 'X', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      expect(rawAuditRowsFor(variant.id)).toEqual([{ action: 'create' }])
    })
  })

  describe('update', () => {
    it('updates fields and re-validates code uniqueness when code changes', () => {
      createVariant(
        db,
        { productId: manufacturedProduct.id, code: 'A', name: 'A', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      const b = createVariant(
        db,
        { productId: manufacturedProduct.id, code: 'B', name: 'B', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      expect(() => updateVariant(db, b.id, { code: 'A' }, SYSTEM_ACTOR)).toThrow(
        DuplicateVariantCodeError
      )
    })

    it('allows updating a variant to keep its own existing code unchanged', () => {
      const a = createVariant(
        db,
        { productId: manufacturedProduct.id, code: 'A', name: 'A', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      const updated = updateVariant(db, a.id, { code: 'A', name: 'Renamed' }, SYSTEM_ACTOR)
      expect(updated.code).toBe('A')
      expect(updated.name).toBe('Renamed')
    })

    it('re-validates barcode uniqueness when barcode changes', () => {
      createVariant(
        db,
        {
          productId: manufacturedProduct.id,
          code: 'A',
          name: 'A',
          sellingPriceMinor: 0,
          barcode: '111'
        },
        SYSTEM_ACTOR
      )
      const b = createVariant(
        db,
        { productId: manufacturedProduct.id, code: 'B', name: 'B', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      expect(() => updateVariant(db, b.id, { barcode: '111' }, SYSTEM_ACTOR)).toThrow(
        DuplicateBarcodeError
      )
    })

    it('enforces the service-variant zero-stock rule on update too', () => {
      const variant = createVariant(
        db,
        { productId: serviceProduct.id, code: 'X', name: 'X', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      expect(() =>
        updateVariant(db, variant.id, { minimumFinishedStockLevel: 5 }, SYSTEM_ACTOR)
      ).toThrow(ProductValidationError)
    })

    it('throws for a nonexistent variant', () => {
      expect(() => updateVariant(db, 'does-not-exist', { name: 'X' }, SYSTEM_ACTOR)).toThrow(
        ProductVariantServiceError
      )
    })

    it('a no-op update writes no additional audit row', () => {
      const variant = createVariant(
        db,
        { productId: manufacturedProduct.id, code: 'A', name: 'Same', sellingPriceMinor: 100 },
        SYSTEM_ACTOR
      )
      updateVariant(db, variant.id, { name: 'Same' }, SYSTEM_ACTOR)
      expect(rawAuditRowsFor(variant.id)).toEqual([{ action: 'create' }])
    })
  })

  describe('deactivate / reactivate', () => {
    it('deactivating a variant changes only that variant, not the parent product or a sibling variant', () => {
      const a = createVariant(
        db,
        { productId: manufacturedProduct.id, code: 'A', name: 'A', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      const b = createVariant(
        db,
        { productId: manufacturedProduct.id, code: 'B', name: 'B', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      deactivateVariant(db, a.id, SYSTEM_ACTOR)

      const reloadedA = getVariantById(db, a.id)
      const reloadedB = getVariantById(db, b.id)
      expect(reloadedA?.isActive).toBe(false)
      expect(reloadedB?.isActive).toBe(true)

      const parentRow = rawDb
        .prepare('SELECT is_active FROM products WHERE id = ?')
        .get(manufacturedProduct.id) as { is_active: number }
      expect(parentRow.is_active).toBe(1)
    })

    it('writes exactly one audit row for deactivate and one for reactivate', () => {
      const variant = createVariant(
        db,
        { productId: manufacturedProduct.id, code: 'A', name: 'A', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      deactivateVariant(db, variant.id, SYSTEM_ACTOR)
      reactivateVariant(db, variant.id, SYSTEM_ACTOR)
      expect(rawAuditRowsFor(variant.id)).toEqual([
        { action: 'create' },
        { action: 'deactivate' },
        { action: 'reactivate' }
      ])
    })

    it('reactivating an already-active variant is a no-op: no additional audit row', () => {
      const variant = createVariant(
        db,
        { productId: manufacturedProduct.id, code: 'A', name: 'A', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      reactivateVariant(db, variant.id, SYSTEM_ACTOR)
      expect(rawAuditRowsFor(variant.id)).toEqual([{ action: 'create' }])
    })
  })

  describe('deactivating a product does not cascade to its variants', () => {
    it('a product deactivated after variant creation leaves every variant active', () => {
      const a = createVariant(
        db,
        { productId: manufacturedProduct.id, code: 'A', name: 'A', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      deactivateProduct(db, manufacturedProduct.id, SYSTEM_ACTOR)
      const reloaded = getVariantById(db, a.id)
      expect(reloaded?.isActive).toBe(true)
    })
  })

  describe('listVariantsForProduct', () => {
    it('returns only the variants belonging to the given product', () => {
      createVariant(
        db,
        { productId: manufacturedProduct.id, code: 'A', name: 'A', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      createVariant(
        db,
        { productId: serviceProduct.id, code: 'B', name: 'B', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      const list = listVariantsForProduct(db, manufacturedProduct.id)
      expect(list).toHaveLength(1)
      expect(list[0].code).toBe('A')
    })
  })

  describe('direct SQL bypass -- database-level constraints hold independent of the service layer', () => {
    it('rejects a second variant with a duplicate (product_id, code) pair', () => {
      const variant = createVariant(
        db,
        { productId: manufacturedProduct.id, code: 'A', name: 'A', sellingPriceMinor: 0 },
        SYSTEM_ACTOR
      )
      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO product_variants
             (id, product_id, code, name, selling_price_minor, currency_id, minimum_finished_stock_level, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
          )
          .run(
            'variant_dupe',
            manufacturedProduct.id,
            variant.code,
            'Dupe',
            0,
            FUNCTIONAL_CURRENCY_ID,
            Date.now(),
            Date.now()
          )
      ).toThrow()
    })

    it('rejects a negative selling_price_minor at the database level', () => {
      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO product_variants
             (id, product_id, code, name, selling_price_minor, currency_id, minimum_finished_stock_level, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
          )
          .run(
            'variant_bad_price',
            manufacturedProduct.id,
            'X',
            'X',
            -1,
            FUNCTIONAL_CURRENCY_ID,
            Date.now(),
            Date.now()
          )
      ).toThrow()
    })

    it('rejects a duplicate non-null barcode at the database level', () => {
      createVariant(
        db,
        {
          productId: manufacturedProduct.id,
          code: 'A',
          name: 'A',
          sellingPriceMinor: 0,
          barcode: '999'
        },
        SYSTEM_ACTOR
      )
      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO product_variants
             (id, product_id, code, name, selling_price_minor, currency_id, barcode, minimum_finished_stock_level, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
          )
          .run(
            'variant_dupe_barcode',
            manufacturedProduct.id,
            'B',
            'B',
            0,
            FUNCTIONAL_CURRENCY_ID,
            '999',
            Date.now(),
            Date.now()
          )
      ).toThrow()
    })
  })

  it('exports no direct SQL/delete surface beyond the documented CRUD functions and error classes', () => {
    const exportedFunctionNames = Object.keys(productVariantService).filter((key) => {
      const value = (productVariantService as unknown as Record<string, unknown>)[key]
      return (
        typeof value === 'function' && !/^class\s/.test(Function.prototype.toString.call(value))
      )
    })
    expect(exportedFunctionNames.sort()).toEqual(
      [
        'listVariantsForProduct',
        'getVariantById',
        'createVariant',
        'updateVariant',
        'deactivateVariant',
        'reactivateVariant'
      ].sort()
    )
  })
})
