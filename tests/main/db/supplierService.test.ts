import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import {
  createSupplier,
  deactivateSupplier,
  getSupplierById,
  listSuppliers,
  reactivateSupplier,
  SupplierServiceError,
  updateSupplier
} from '../../../src/main/db/supplierService'
import { SupplierValidationError } from '../../../src/main/db/validation/supplierValidation'
import type { AuditActor } from '../../../src/main/audit/auditService'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const SYSTEM_ACTOR: AuditActor = { type: 'system' }

describe('supplierService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    dir = createTempDir('ledgerpage-supplier-service')
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

  function seedSupplierNumberingRule(): void {
    const now = Date.now()
    rawDb
      .prepare(
        `INSERT INTO numbering_rules
           (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at)
           VALUES ('numbering_rule_supplier', 'primary_company', 'supplier', 'SUP', 6, 'never', 0, NULL, ?, ?)`
      )
      .run(now, now)
  }

  describe('before a company exists', () => {
    it('createSupplier returns a clear, documented error rather than a raw failure', () => {
      expect(() => createSupplier(db, { name: 'Acme Foods' }, SYSTEM_ACTOR)).toThrow(
        SupplierServiceError
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
      seedSupplierNumberingRule()
    })

    it('creates a supplier with a system-generated code', () => {
      const created = createSupplier(db, { name: 'Acme Foods' }, SYSTEM_ACTOR)
      expect(created.code).toBe('SUP-000001')
      expect(created.name).toBe('Acme Foods')
      expect(created.contactDetails).toBeNull()
      expect(created.isActive).toBe(true)
    })

    it('allocates sequential codes for successive suppliers', () => {
      const first = createSupplier(db, { name: 'Acme Foods' }, SYSTEM_ACTOR)
      const second = createSupplier(db, { name: 'Beta Supplies' }, SYSTEM_ACTOR)
      expect(first.code).toBe('SUP-000001')
      expect(second.code).toBe('SUP-000002')
    })

    it('trims name and rejects an empty one', () => {
      const created = createSupplier(db, { name: '  Acme Foods  ' }, SYSTEM_ACTOR)
      expect(created.name).toBe('Acme Foods')
      expect(() => createSupplier(db, { name: '   ' }, SYSTEM_ACTOR)).toThrow(
        SupplierValidationError
      )
    })

    describe('contactDetails', () => {
      it('is nullable and omittable', () => {
        const created = createSupplier(db, { name: 'Acme Foods' }, SYSTEM_ACTOR)
        expect(created.contactDetails).toBeNull()
      })

      it('trims a provided value', () => {
        const created = createSupplier(
          db,
          { name: 'Acme Foods', contactDetails: '  buyer@acme.com  ' },
          SYSTEM_ACTOR
        )
        expect(created.contactDetails).toBe('buyer@acme.com')
      })

      it('normalizes a blank (post-trim) value to null', () => {
        const created = createSupplier(
          db,
          { name: 'Acme Foods', contactDetails: '   ' },
          SYSTEM_ACTOR
        )
        expect(created.contactDetails).toBeNull()
      })
    })

    it('writes exactly one create audit row', () => {
      const created = createSupplier(db, { name: 'Acme Foods' }, SYSTEM_ACTOR)
      expect(rawAuditRowsFor(created.id)).toEqual([{ action: 'create' }])
    })

    it('listSuppliers returns every created supplier', () => {
      createSupplier(db, { name: 'Acme Foods' }, SYSTEM_ACTOR)
      createSupplier(db, { name: 'Beta Supplies' }, SYSTEM_ACTOR)
      expect(listSuppliers(db)).toHaveLength(2)
    })

    it('getSupplierById returns undefined for a nonexistent id', () => {
      expect(getSupplierById(db, 'does-not-exist')).toBeUndefined()
    })

    describe('update', () => {
      it('updates editable fields', () => {
        const created = createSupplier(db, { name: 'Acme Foods' }, SYSTEM_ACTOR)
        const updated = updateSupplier(
          db,
          created.id,
          { name: 'Acme Foods Ltd', contactDetails: 'new@acme.com' },
          SYSTEM_ACTOR
        )
        expect(updated.name).toBe('Acme Foods Ltd')
        expect(updated.contactDetails).toBe('new@acme.com')
        expect(updated.code).toBe(created.code)
      })

      it('has no way to accept a code value through its own type', () => {
        // Structural proof: this line only compiles because
        // UpdateSupplierInput has no code field.
        const created = createSupplier(db, { name: 'Acme Foods' }, SYSTEM_ACTOR)
        const updated = updateSupplier(db, created.id, { name: 'X' }, SYSTEM_ACTOR)
        expect(updated.code).toBe(created.code)
      })

      it('a no-op update writes no additional audit row', () => {
        const created = createSupplier(db, { name: 'Acme Foods' }, SYSTEM_ACTOR)
        updateSupplier(db, created.id, { name: created.name }, SYSTEM_ACTOR)
        expect(rawAuditRowsFor(created.id)).toEqual([{ action: 'create' }])
      })

      it('writes exactly one update audit row for a real change', () => {
        const created = createSupplier(db, { name: 'Acme Foods' }, SYSTEM_ACTOR)
        updateSupplier(db, created.id, { name: 'Changed' }, SYSTEM_ACTOR)
        expect(rawAuditRowsFor(created.id)).toEqual([{ action: 'create' }, { action: 'update' }])
      })

      it('throws for a nonexistent supplier', () => {
        expect(() => updateSupplier(db, 'does-not-exist', { name: 'X' }, SYSTEM_ACTOR)).toThrow(
          SupplierServiceError
        )
      })
    })

    describe('deactivate / reactivate', () => {
      it('deactivateSupplier sets isActive to false and writes one audit row', () => {
        const created = createSupplier(db, { name: 'Acme Foods' }, SYSTEM_ACTOR)
        const deactivated = deactivateSupplier(db, created.id, SYSTEM_ACTOR)
        expect(deactivated.isActive).toBe(false)
        expect(rawAuditRowsFor(created.id)).toEqual([
          { action: 'create' },
          { action: 'deactivate' }
        ])
      })

      it('reactivateSupplier sets isActive back to true and writes one audit row', () => {
        const created = createSupplier(db, { name: 'Acme Foods' }, SYSTEM_ACTOR)
        deactivateSupplier(db, created.id, SYSTEM_ACTOR)
        const reactivated = reactivateSupplier(db, created.id, SYSTEM_ACTOR)
        expect(reactivated.isActive).toBe(true)
        expect(rawAuditRowsFor(created.id)).toEqual([
          { action: 'create' },
          { action: 'deactivate' },
          { action: 'reactivate' }
        ])
      })

      it('reactivating an already-active supplier is a no-op: no additional audit row', () => {
        const created = createSupplier(db, { name: 'Acme Foods' }, SYSTEM_ACTOR)
        reactivateSupplier(db, created.id, SYSTEM_ACTOR)
        expect(rawAuditRowsFor(created.id)).toEqual([{ action: 'create' }])
      })

      it('deactivating an already-inactive supplier is a no-op: no additional audit row', () => {
        const created = createSupplier(db, { name: 'Acme Foods' }, SYSTEM_ACTOR)
        deactivateSupplier(db, created.id, SYSTEM_ACTOR)
        deactivateSupplier(db, created.id, SYSTEM_ACTOR)
        expect(rawAuditRowsFor(created.id)).toEqual([
          { action: 'create' },
          { action: 'deactivate' }
        ])
      })
    })

    describe('direct SQL bypass -- database-level constraints hold independent of the service layer', () => {
      it('rejects a second supplier with a duplicate (company_id, code) pair', () => {
        const created = createSupplier(db, { name: 'Acme Foods' }, SYSTEM_ACTOR)
        expect(() =>
          rawDb
            .prepare(
              `INSERT INTO suppliers (id, company_id, code, name, is_active, created_at, updated_at)
               VALUES (?, 'primary_company', ?, 'Dupe', 1, ?, ?)`
            )
            .run('supplier_dupe', created.code, Date.now(), Date.now())
        ).toThrow()
      })

      it('rejects a company_id other than the singleton', () => {
        expect(() =>
          rawDb
            .prepare(
              `INSERT INTO suppliers (id, company_id, code, name, is_active, created_at, updated_at)
               VALUES ('supplier_x', 'some_other_company', 'SUP-999999', 'X', 1, ?, ?)`
            )
            .run(Date.now(), Date.now())
        ).toThrow()
      })
    })
  })
})
