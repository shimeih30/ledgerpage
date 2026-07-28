import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import {
  createCustomer,
  deactivateCustomer,
  getCustomerById,
  listCustomers,
  reactivateCustomer,
  CustomerServiceError,
  updateCustomer
} from '../../../src/main/db/customerService'
import { CustomerValidationError } from '../../../src/main/db/validation/customerValidation'
import { FUNCTIONAL_CURRENCY_ID } from '../../../src/main/db/schema'
import type { AuditActor } from '../../../src/main/audit/auditService'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const SYSTEM_ACTOR: AuditActor = { type: 'system' }

describe('customerService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    dir = createTempDir('ledgerpage-customer-service')
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

  function seedCustomerNumberingRule(): void {
    const now = Date.now()
    rawDb
      .prepare(
        `INSERT INTO numbering_rules
           (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at)
           VALUES ('numbering_rule_customer', 'primary_company', 'customer', 'CUS', 6, 'never', 0, NULL, ?, ?)`
      )
      .run(now, now)
  }

  describe('before a company exists', () => {
    it('createCustomer returns a clear, documented error rather than a raw failure', () => {
      expect(() => createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)).toThrow(
        CustomerServiceError
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
      seedCustomerNumberingRule()
    })

    it('creates a customer with a system-generated code', () => {
      const created = createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)
      expect(created.code).toBe('CUS-000001')
      expect(created.name).toBe('Acme Retail')
      expect(created.contactDetails).toBeNull()
      expect(created.paymentTermsDays).toBeNull()
      expect(created.creditLimitMinor).toBeNull()
      expect(created.currencyId).toBe(FUNCTIONAL_CURRENCY_ID)
      expect(created.isActive).toBe(true)
    })

    it('allocates sequential codes for successive customers', () => {
      const first = createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)
      const second = createCustomer(db, { name: 'Beta Traders' }, SYSTEM_ACTOR)
      expect(first.code).toBe('CUS-000001')
      expect(second.code).toBe('CUS-000002')
    })

    it('trims name and rejects an empty one', () => {
      const created = createCustomer(db, { name: '  Acme Retail  ' }, SYSTEM_ACTOR)
      expect(created.name).toBe('Acme Retail')
      expect(() => createCustomer(db, { name: '   ' }, SYSTEM_ACTOR)).toThrow(
        CustomerValidationError
      )
    })

    describe('contactDetails', () => {
      it('is nullable and omittable', () => {
        const created = createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)
        expect(created.contactDetails).toBeNull()
      })

      it('trims a provided value', () => {
        const created = createCustomer(
          db,
          { name: 'Acme Retail', contactDetails: '  buyer@acme.com  ' },
          SYSTEM_ACTOR
        )
        expect(created.contactDetails).toBe('buyer@acme.com')
      })

      it('normalizes a blank (post-trim) value to null', () => {
        const created = createCustomer(
          db,
          { name: 'Acme Retail', contactDetails: '   ' },
          SYSTEM_ACTOR
        )
        expect(created.contactDetails).toBeNull()
      })
    })

    describe('paymentTermsDays', () => {
      it('is nullable and omittable, meaning no default configured', () => {
        const created = createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)
        expect(created.paymentTermsDays).toBeNull()
      })

      it('accepts 0, meaning payment is due immediately', () => {
        const created = createCustomer(
          db,
          { name: 'Acme Retail', paymentTermsDays: 0 },
          SYSTEM_ACTOR
        )
        expect(created.paymentTermsDays).toBe(0)
      })

      it('accepts a positive integer', () => {
        const created = createCustomer(
          db,
          { name: 'Acme Retail', paymentTermsDays: 30 },
          SYSTEM_ACTOR
        )
        expect(created.paymentTermsDays).toBe(30)
      })

      it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
        'rejects paymentTermsDays = %s',
        (paymentTermsDays) => {
          expect(() =>
            createCustomer(db, { name: 'Acme Retail', paymentTermsDays }, SYSTEM_ACTOR)
          ).toThrow(CustomerValidationError)
        }
      )
    })

    describe('creditLimitMinor', () => {
      it('is nullable and omittable, meaning no configured limit', () => {
        const created = createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)
        expect(created.creditLimitMinor).toBeNull()
      })

      it('accepts zero', () => {
        const created = createCustomer(
          db,
          { name: 'Acme Retail', creditLimitMinor: 0 },
          SYSTEM_ACTOR
        )
        expect(created.creditLimitMinor).toBe(0)
      })

      it('accepts a positive integer', () => {
        const created = createCustomer(
          db,
          { name: 'Acme Retail', creditLimitMinor: 500000 },
          SYSTEM_ACTOR
        )
        expect(created.creditLimitMinor).toBe(500000)
      })

      it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
        'rejects creditLimitMinor = %s',
        (creditLimitMinor) => {
          expect(() =>
            createCustomer(db, { name: 'Acme Retail', creditLimitMinor }, SYSTEM_ACTOR)
          ).toThrow(CustomerValidationError)
        }
      )

      it('is always FUNCTIONAL_CURRENCY_ID regardless of anything else', () => {
        const created = createCustomer(
          db,
          { name: 'Acme Retail', creditLimitMinor: 1000 },
          SYSTEM_ACTOR
        )
        expect(created.currencyId).toBe(FUNCTIONAL_CURRENCY_ID)
      })
    })

    it('writes exactly one create audit row', () => {
      const created = createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)
      expect(rawAuditRowsFor(created.id)).toEqual([{ action: 'create' }])
    })

    it('listCustomers returns every created customer', () => {
      createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)
      createCustomer(db, { name: 'Beta Traders' }, SYSTEM_ACTOR)
      expect(listCustomers(db)).toHaveLength(2)
    })

    it('getCustomerById returns undefined for a nonexistent id', () => {
      expect(getCustomerById(db, 'does-not-exist')).toBeUndefined()
    })

    describe('update', () => {
      it('updates editable fields', () => {
        const created = createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)
        const updated = updateCustomer(
          db,
          created.id,
          {
            name: 'Acme Retail Ltd',
            contactDetails: 'new@acme.com',
            paymentTermsDays: 15,
            creditLimitMinor: 200000
          },
          SYSTEM_ACTOR
        )
        expect(updated.name).toBe('Acme Retail Ltd')
        expect(updated.contactDetails).toBe('new@acme.com')
        expect(updated.paymentTermsDays).toBe(15)
        expect(updated.creditLimitMinor).toBe(200000)
        expect(updated.code).toBe(created.code)
      })

      it('has no way to accept a code or currencyId value through its own type', () => {
        // Structural proof: this line only compiles because
        // UpdateCustomerInput has neither field.
        const created = createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)
        const updated = updateCustomer(db, created.id, { name: 'X' }, SYSTEM_ACTOR)
        expect(updated.code).toBe(created.code)
        expect(updated.currencyId).toBe(FUNCTIONAL_CURRENCY_ID)
      })

      it('a no-op update writes no additional audit row', () => {
        const created = createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)
        updateCustomer(db, created.id, { name: created.name }, SYSTEM_ACTOR)
        expect(rawAuditRowsFor(created.id)).toEqual([{ action: 'create' }])
      })

      it('writes exactly one update audit row for a real change', () => {
        const created = createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)
        updateCustomer(db, created.id, { name: 'Changed' }, SYSTEM_ACTOR)
        expect(rawAuditRowsFor(created.id)).toEqual([{ action: 'create' }, { action: 'update' }])
      })

      it('throws for a nonexistent customer', () => {
        expect(() => updateCustomer(db, 'does-not-exist', { name: 'X' }, SYSTEM_ACTOR)).toThrow(
          CustomerServiceError
        )
      })
    })

    describe('deactivate / reactivate', () => {
      it('deactivateCustomer sets isActive to false and writes one audit row', () => {
        const created = createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)
        const deactivated = deactivateCustomer(db, created.id, SYSTEM_ACTOR)
        expect(deactivated.isActive).toBe(false)
        expect(rawAuditRowsFor(created.id)).toEqual([
          { action: 'create' },
          { action: 'deactivate' }
        ])
      })

      it('reactivateCustomer sets isActive back to true and writes one audit row', () => {
        const created = createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)
        deactivateCustomer(db, created.id, SYSTEM_ACTOR)
        const reactivated = reactivateCustomer(db, created.id, SYSTEM_ACTOR)
        expect(reactivated.isActive).toBe(true)
        expect(rawAuditRowsFor(created.id)).toEqual([
          { action: 'create' },
          { action: 'deactivate' },
          { action: 'reactivate' }
        ])
      })

      it('reactivating an already-active customer is a no-op: no additional audit row', () => {
        const created = createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)
        reactivateCustomer(db, created.id, SYSTEM_ACTOR)
        expect(rawAuditRowsFor(created.id)).toEqual([{ action: 'create' }])
      })

      it('deactivating an already-inactive customer is a no-op: no additional audit row', () => {
        const created = createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)
        deactivateCustomer(db, created.id, SYSTEM_ACTOR)
        deactivateCustomer(db, created.id, SYSTEM_ACTOR)
        expect(rawAuditRowsFor(created.id)).toEqual([
          { action: 'create' },
          { action: 'deactivate' }
        ])
      })
    })

    describe('direct SQL bypass -- database-level constraints hold independent of the service layer', () => {
      it('rejects a second customer with a duplicate (company_id, code) pair', () => {
        const created = createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR)
        expect(() =>
          rawDb
            .prepare(
              `INSERT INTO customers (id, company_id, code, name, currency_id, is_active, created_at, updated_at)
               VALUES (?, 'primary_company', ?, 'Dupe', 'currency_usd', 1, ?, ?)`
            )
            .run('customer_dupe', created.code, Date.now(), Date.now())
        ).toThrow()
      })

      it('rejects a company_id other than the singleton', () => {
        expect(() =>
          rawDb
            .prepare(
              `INSERT INTO customers (id, company_id, code, name, currency_id, is_active, created_at, updated_at)
               VALUES ('customer_x', 'some_other_company', 'CUS-999999', 'X', 'currency_usd', 1, ?, ?)`
            )
            .run(Date.now(), Date.now())
        ).toThrow()
      })

      it('rejects a negative payment_terms_days', () => {
        expect(() =>
          rawDb
            .prepare(
              `INSERT INTO customers (id, company_id, code, name, payment_terms_days, currency_id, is_active, created_at, updated_at)
               VALUES ('customer_y', 'primary_company', 'CUS-999998', 'X', -1, 'currency_usd', 1, ?, ?)`
            )
            .run(Date.now(), Date.now())
        ).toThrow(/CHECK constraint failed/)
      })

      it('rejects a negative credit_limit_minor', () => {
        expect(() =>
          rawDb
            .prepare(
              `INSERT INTO customers (id, company_id, code, name, credit_limit_minor, currency_id, is_active, created_at, updated_at)
               VALUES ('customer_z', 'primary_company', 'CUS-999997', 'X', -1, 'currency_usd', 1, ?, ?)`
            )
            .run(Date.now(), Date.now())
        ).toThrow(/CHECK constraint failed/)
      })
    })
  })
})
