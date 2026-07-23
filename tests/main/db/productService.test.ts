import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import { numberingRuleId } from '../../../src/main/db/numberingDefaults'
import { numberingRules, PRIMARY_COMPANY_ID } from '../../../src/main/db/schema'
import * as productService from '../../../src/main/db/productService'
import {
  createProduct,
  deactivateProduct,
  getProductById,
  listProducts,
  ProductServiceError,
  reactivateProduct,
  updateProduct
} from '../../../src/main/db/productService'
import { ProductValidationError } from '../../../src/main/db/validation/productValidation'
import type { AuditActor } from '../../../src/main/audit/auditService'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const SYSTEM_ACTOR: AuditActor = { type: 'system' }

describe('productService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    dir = createTempDir('ledgerpage-product-service')
    rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    db = drizzle<Record<string, never>>(rawDb)
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  function seedProductNumberingRule(): void {
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
  }

  function rawAuditRowsFor(entityId: string) {
    return rawDb
      .prepare('SELECT action FROM audit_log_entries WHERE entity_id = ?')
      .all(entityId) as { action: string }[]
  }

  describe('before a company exists', () => {
    it('createProduct returns a clear, documented error rather than a raw FK failure', () => {
      expect(() =>
        createProduct(db, { name: 'Widget', type: 'manufactured' }, SYSTEM_ACTOR)
      ).toThrow(ProductServiceError)
    })
  })

  describe('once a company exists with the product numbering rule seeded', () => {
    beforeEach(() => {
      createCompany(db, {
        name: 'Fixture Co',
        address: 'Addr',
        contactDetails: 'contact@example.com',
        currencyId: 'currency_usd'
      })
      seedProductNumberingRule()
    })

    it('createProduct without the numbering rule throws rather than allocating a malformed code', () => {
      // A separate, rule-less company scenario to prove allocateNext's
      // own "no numbering rule exists" failure surfaces through
      // createProduct rather than being silently swallowed.
      rawDb.prepare('DELETE FROM numbering_rules WHERE document_type_key = ?').run('product')
      expect(() =>
        createProduct(db, { name: 'Widget', type: 'manufactured' }, SYSTEM_ACTOR)
      ).toThrow()
    })

    it('creates a manufactured product, allocating the first PRD code', () => {
      const created = createProduct(db, { name: 'Jam Jar', type: 'manufactured' }, SYSTEM_ACTOR)
      expect(created.code).toBe('PRD-000001')
      expect(created.name).toBe('Jam Jar')
      expect(created.type).toBe('manufactured')
      expect(created.isActive).toBe(true)
    })

    it('creates a service product', () => {
      const created = createProduct(db, { name: 'Delivery', type: 'service' }, SYSTEM_ACTOR)
      expect(created.type).toBe('service')
    })

    it('allocates sequential codes across successive creates, never reusing one', () => {
      const first = createProduct(db, { name: 'A', type: 'manufactured' }, SYSTEM_ACTOR)
      const second = createProduct(db, { name: 'B', type: 'manufactured' }, SYSTEM_ACTOR)
      const third = createProduct(db, { name: 'C', type: 'service' }, SYSTEM_ACTOR)
      expect([first.code, second.code, third.code]).toEqual([
        'PRD-000001',
        'PRD-000002',
        'PRD-000003'
      ])
    })

    it('rejects an empty name', () => {
      expect(() => createProduct(db, { name: '   ', type: 'manufactured' }, SYSTEM_ACTOR)).toThrow(
        ProductValidationError
      )
    })

    it('rejects an invalid type', () => {
      expect(() => createProduct(db, { name: 'Widget', type: 'not-a-type' }, SYSTEM_ACTOR)).toThrow(
        ProductValidationError
      )
    })

    it('trims a name with surrounding whitespace', () => {
      const created = createProduct(db, { name: '  Jam Jar  ', type: 'manufactured' }, SYSTEM_ACTOR)
      expect(created.name).toBe('Jam Jar')
    })

    it('writes exactly one create audit row per product created', () => {
      const created = createProduct(db, { name: 'Jam Jar', type: 'manufactured' }, SYSTEM_ACTOR)
      expect(rawAuditRowsFor(created.id)).toEqual([{ action: 'create' }])
    })

    it('numbering-rule counter allocation does not receive a separate audit row', () => {
      const created = createProduct(db, { name: 'Jam Jar', type: 'manufactured' }, SYSTEM_ACTOR)
      // Exactly one audit row total for this creation -- not two (one
      // for the product, one for the numbering_rules counter change).
      const allRows = rawDb.prepare('SELECT COUNT(*) as count FROM audit_log_entries').get() as {
        count: number
      }
      expect(allRows.count).toBe(1)
      expect(rawAuditRowsFor(created.id)).toHaveLength(1)
    })

    it('listProducts returns every created product', () => {
      createProduct(db, { name: 'A', type: 'manufactured' }, SYSTEM_ACTOR)
      createProduct(db, { name: 'B', type: 'service' }, SYSTEM_ACTOR)
      expect(listProducts(db)).toHaveLength(2)
    })

    it('getProductById returns undefined for a nonexistent id', () => {
      expect(getProductById(db, 'does-not-exist')).toBeUndefined()
    })

    describe('update', () => {
      it('updates the name', () => {
        const created = createProduct(db, { name: 'Old Name', type: 'manufactured' }, SYSTEM_ACTOR)
        const updated = updateProduct(db, created.id, { name: 'New Name' }, SYSTEM_ACTOR)
        expect(updated.name).toBe('New Name')
        expect(updated.code).toBe(created.code)
        expect(updated.type).toBe(created.type)
      })

      it('writes exactly one update audit row for a real change', () => {
        const created = createProduct(db, { name: 'Old Name', type: 'manufactured' }, SYSTEM_ACTOR)
        updateProduct(db, created.id, { name: 'New Name' }, SYSTEM_ACTOR)
        expect(rawAuditRowsFor(created.id)).toEqual([{ action: 'create' }, { action: 'update' }])
      })

      it('a no-op update (identical name) writes no additional audit row', () => {
        const created = createProduct(db, { name: 'Same Name', type: 'manufactured' }, SYSTEM_ACTOR)
        updateProduct(db, created.id, { name: 'Same Name' }, SYSTEM_ACTOR)
        expect(rawAuditRowsFor(created.id)).toEqual([{ action: 'create' }])
      })

      it('throws for a nonexistent product', () => {
        expect(() => updateProduct(db, 'does-not-exist', { name: 'X' }, SYSTEM_ACTOR)).toThrow(
          ProductServiceError
        )
      })

      it('has no way to accept a code value through its own type -- UpdateProductInput has no code field', () => {
        // Structural proof, not just a runtime one: this line only
        // compiles because UpdateProductInput omits `code` entirely.
        const created = createProduct(db, { name: 'X', type: 'manufactured' }, SYSTEM_ACTOR)
        const updated = updateProduct(db, created.id, { name: 'Y' }, SYSTEM_ACTOR)
        expect(updated.code).toBe(created.code)
      })
    })

    describe('deactivate / reactivate', () => {
      it('deactivateProduct sets isActive to false and writes one audit row', () => {
        const created = createProduct(db, { name: 'X', type: 'manufactured' }, SYSTEM_ACTOR)
        const deactivated = deactivateProduct(db, created.id, SYSTEM_ACTOR)
        expect(deactivated.isActive).toBe(false)
        expect(rawAuditRowsFor(created.id)).toEqual([
          { action: 'create' },
          { action: 'deactivate' }
        ])
      })

      it('reactivateProduct sets isActive back to true and writes one audit row', () => {
        const created = createProduct(db, { name: 'X', type: 'manufactured' }, SYSTEM_ACTOR)
        deactivateProduct(db, created.id, SYSTEM_ACTOR)
        const reactivated = reactivateProduct(db, created.id, SYSTEM_ACTOR)
        expect(reactivated.isActive).toBe(true)
        expect(rawAuditRowsFor(created.id)).toEqual([
          { action: 'create' },
          { action: 'deactivate' },
          { action: 'reactivate' }
        ])
      })

      it('reactivating an already-active product is a no-op: no additional audit row', () => {
        const created = createProduct(db, { name: 'X', type: 'manufactured' }, SYSTEM_ACTOR)
        reactivateProduct(db, created.id, SYSTEM_ACTOR)
        expect(rawAuditRowsFor(created.id)).toEqual([{ action: 'create' }])
      })

      it('deactivating changes only the product row -- no cascading write to any other table', () => {
        const created = createProduct(db, { name: 'X', type: 'manufactured' }, SYSTEM_ACTOR)
        const beforeCount = rawDb.prepare('SELECT COUNT(*) as count FROM products').get() as {
          count: number
        }
        deactivateProduct(db, created.id, SYSTEM_ACTOR)
        const afterCount = rawDb.prepare('SELECT COUNT(*) as count FROM products').get() as {
          count: number
        }
        expect(afterCount.count).toBe(beforeCount.count)
      })
    })

    describe('direct SQL bypass -- database-level constraints hold independent of the service layer', () => {
      it('rejects a second product row with a duplicate (company_id, code) pair', () => {
        const created = createProduct(db, { name: 'X', type: 'manufactured' }, SYSTEM_ACTOR)
        expect(() =>
          rawDb
            .prepare(
              `INSERT INTO products (id, company_id, code, name, type, is_active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
            )
            .run(
              'product_dupe',
              PRIMARY_COMPANY_ID,
              created.code,
              'Dupe',
              'manufactured',
              Date.now(),
              Date.now()
            )
        ).toThrow()
      })

      it('rejects an invalid type value', () => {
        expect(() =>
          rawDb
            .prepare(
              `INSERT INTO products (id, company_id, code, name, type, is_active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
            )
            .run(
              'product_bad_type',
              PRIMARY_COMPANY_ID,
              'PRD-999999',
              'X',
              'not-a-type',
              Date.now(),
              Date.now()
            )
        ).toThrow()
      })

      it('rejects a company_id other than the singleton', () => {
        expect(() =>
          rawDb
            .prepare(
              `INSERT INTO products (id, company_id, code, name, type, is_active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
            )
            .run(
              'product_bad_company',
              'some_other_company',
              'PRD-999999',
              'X',
              'manufactured',
              Date.now(),
              Date.now()
            )
        ).toThrow()
      })
    })

    it('exports no direct SQL/delete surface beyond the documented CRUD functions', () => {
      const exportedFunctionNames = Object.keys(productService).filter((key) => {
        const value = (productService as unknown as Record<string, unknown>)[key]
        return (
          typeof value === 'function' && !/^class\s/.test(Function.prototype.toString.call(value))
        )
      })
      expect(exportedFunctionNames.sort()).toEqual(
        [
          'listProducts',
          'getProductById',
          'createProduct',
          'updateProduct',
          'deactivateProduct',
          'reactivateProduct'
        ].sort()
      )
    })
  })
})
