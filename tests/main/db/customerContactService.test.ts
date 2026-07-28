import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import { createCustomer, deactivateCustomer } from '../../../src/main/db/customerService'
import * as customerContactService from '../../../src/main/db/customerContactService'
import {
  createCustomerContact,
  CustomerContactServiceError,
  deactivateCustomerContact,
  getCustomerContactById,
  listContactsForCustomer,
  reactivateCustomerContact,
  updateCustomerContact
} from '../../../src/main/db/customerContactService'
import { CustomerContactValidationError } from '../../../src/main/db/validation/customerContactValidation'
import type { AuditActor } from '../../../src/main/audit/auditService'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const SYSTEM_ACTOR: AuditActor = { type: 'system' }

describe('customerContactService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let customerId: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-customer-contact-service')
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
           VALUES ('numbering_rule_customer', 'primary_company', 'customer', 'CUS', 6, 'never', 0, NULL, ?, ?)`
      )
      .run(now, now)
    customerId = createCustomer(db, { name: 'Acme Retail' }, SYSTEM_ACTOR).id
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

  it('creates a contact with the required and optional fields', () => {
    const contact = createCustomerContact(
      db,
      {
        customerId,
        name: 'Jane Doe',
        role: 'Accounts Payable',
        phone: '555-1234',
        email: 'jane@acme.com'
      },
      SYSTEM_ACTOR
    )
    expect(contact.customerId).toBe(customerId)
    expect(contact.name).toBe('Jane Doe')
    expect(contact.role).toBe('Accounts Payable')
    expect(contact.phone).toBe('555-1234')
    expect(contact.email).toBe('jane@acme.com')
    expect(contact.isActive).toBe(true)
  })

  it('name is required and trimmed; role/phone/email are optional and omittable', () => {
    const contact = createCustomerContact(db, { customerId, name: '  Jane Doe  ' }, SYSTEM_ACTOR)
    expect(contact.name).toBe('Jane Doe')
    expect(contact.role).toBeNull()
    expect(contact.phone).toBeNull()
    expect(contact.email).toBeNull()
  })

  it('rejects an empty name', () => {
    expect(() => createCustomerContact(db, { customerId, name: '   ' }, SYSTEM_ACTOR)).toThrow(
      CustomerContactValidationError
    )
  })

  it('blank optional fields normalize to null', () => {
    const contact = createCustomerContact(
      db,
      { customerId, name: 'Jane Doe', role: '   ', phone: '  ', email: '' },
      SYSTEM_ACTOR
    )
    expect(contact.role).toBeNull()
    expect(contact.phone).toBeNull()
    expect(contact.email).toBeNull()
  })

  it('trims provided optional fields', () => {
    const contact = createCustomerContact(
      db,
      {
        customerId,
        name: 'Jane Doe',
        role: '  Owner  ',
        phone: '  555-1234  ',
        email: '  jane@acme.com  '
      },
      SYSTEM_ACTOR
    )
    expect(contact.role).toBe('Owner')
    expect(contact.phone).toBe('555-1234')
    expect(contact.email).toBe('jane@acme.com')
  })

  describe('active parent customer requirement for mutations', () => {
    it('rejects creating a contact for a nonexistent customer', () => {
      expect(() =>
        createCustomerContact(db, { customerId: 'does-not-exist', name: 'Jane Doe' }, SYSTEM_ACTOR)
      ).toThrow(CustomerContactServiceError)
    })

    it('rejects creating a contact for an inactive customer', () => {
      deactivateCustomer(db, customerId, SYSTEM_ACTOR)
      expect(() =>
        createCustomerContact(db, { customerId, name: 'Jane Doe' }, SYSTEM_ACTOR)
      ).toThrow(CustomerContactServiceError)
    })

    it('rejects updating a contact whose parent customer has since been deactivated', () => {
      const contact = createCustomerContact(db, { customerId, name: 'Jane Doe' }, SYSTEM_ACTOR)
      deactivateCustomer(db, customerId, SYSTEM_ACTOR)
      expect(() =>
        updateCustomerContact(db, contact.id, { name: 'Jane Smith' }, SYSTEM_ACTOR)
      ).toThrow(CustomerContactServiceError)
    })

    it('rejects deactivating a contact whose parent customer has since been deactivated', () => {
      const contact = createCustomerContact(db, { customerId, name: 'Jane Doe' }, SYSTEM_ACTOR)
      deactivateCustomer(db, customerId, SYSTEM_ACTOR)
      expect(() => deactivateCustomerContact(db, contact.id, SYSTEM_ACTOR)).toThrow(
        CustomerContactServiceError
      )
    })

    it('inactive parent still permits historical contact reads', () => {
      const contact = createCustomerContact(db, { customerId, name: 'Jane Doe' }, SYSTEM_ACTOR)
      deactivateCustomer(db, customerId, SYSTEM_ACTOR)
      expect(getCustomerContactById(db, contact.id)).toBeDefined()
      expect(listContactsForCustomer(db, customerId)).toHaveLength(1)
    })
  })

  it('customer deactivation does not cascade to its contacts', () => {
    const contact = createCustomerContact(db, { customerId, name: 'Jane Doe' }, SYSTEM_ACTOR)
    deactivateCustomer(db, customerId, SYSTEM_ACTOR)
    const stillThere = getCustomerContactById(db, contact.id)
    expect(stillThere?.isActive).toBe(true)
  })

  it('listContactsForCustomer returns every contact for that customer', () => {
    createCustomerContact(db, { customerId, name: 'Jane Doe' }, SYSTEM_ACTOR)
    createCustomerContact(db, { customerId, name: 'John Smith' }, SYSTEM_ACTOR)
    expect(listContactsForCustomer(db, customerId)).toHaveLength(2)
  })

  it('getCustomerContactById returns undefined for a nonexistent id', () => {
    expect(getCustomerContactById(db, 'does-not-exist')).toBeUndefined()
  })

  it('writes exactly one create audit row', () => {
    const contact = createCustomerContact(db, { customerId, name: 'Jane Doe' }, SYSTEM_ACTOR)
    expect(rawAuditRowsFor(contact.id)).toEqual([{ action: 'create' }])
  })

  describe('update', () => {
    it('updates editable fields', () => {
      const contact = createCustomerContact(db, { customerId, name: 'Jane Doe' }, SYSTEM_ACTOR)
      const updated = updateCustomerContact(
        db,
        contact.id,
        { name: 'Jane Smith', role: 'Manager', phone: '555-9999', email: 'jane.smith@acme.com' },
        SYSTEM_ACTOR
      )
      expect(updated.name).toBe('Jane Smith')
      expect(updated.role).toBe('Manager')
      expect(updated.phone).toBe('555-9999')
      expect(updated.email).toBe('jane.smith@acme.com')
    })

    it('has no way to move a contact to a different customer -- customerId is absent from the update type', () => {
      // Structural proof: this line only compiles because
      // UpdateCustomerContactInput has no customerId field.
      const contact = createCustomerContact(db, { customerId, name: 'Jane Doe' }, SYSTEM_ACTOR)
      const updated = updateCustomerContact(db, contact.id, { name: 'X' }, SYSTEM_ACTOR)
      expect(updated.customerId).toBe(customerId)
    })

    it('a no-op update writes no additional audit row', () => {
      const contact = createCustomerContact(db, { customerId, name: 'Jane Doe' }, SYSTEM_ACTOR)
      updateCustomerContact(db, contact.id, { name: contact.name }, SYSTEM_ACTOR)
      expect(rawAuditRowsFor(contact.id)).toEqual([{ action: 'create' }])
    })

    it('writes exactly one update audit row for a real change', () => {
      const contact = createCustomerContact(db, { customerId, name: 'Jane Doe' }, SYSTEM_ACTOR)
      updateCustomerContact(db, contact.id, { name: 'Changed' }, SYSTEM_ACTOR)
      expect(rawAuditRowsFor(contact.id)).toEqual([{ action: 'create' }, { action: 'update' }])
    })

    it('throws for a nonexistent contact', () => {
      expect(() =>
        updateCustomerContact(db, 'does-not-exist', { name: 'X' }, SYSTEM_ACTOR)
      ).toThrow(CustomerContactServiceError)
    })
  })

  describe('deactivate / reactivate (soft activation only)', () => {
    it('deactivateCustomerContact sets isActive to false and writes one audit row', () => {
      const contact = createCustomerContact(db, { customerId, name: 'Jane Doe' }, SYSTEM_ACTOR)
      const deactivated = deactivateCustomerContact(db, contact.id, SYSTEM_ACTOR)
      expect(deactivated.isActive).toBe(false)
      expect(rawAuditRowsFor(contact.id)).toEqual([{ action: 'create' }, { action: 'deactivate' }])
    })

    it('reactivateCustomerContact sets isActive back to true and writes one audit row', () => {
      const contact = createCustomerContact(db, { customerId, name: 'Jane Doe' }, SYSTEM_ACTOR)
      deactivateCustomerContact(db, contact.id, SYSTEM_ACTOR)
      const reactivated = reactivateCustomerContact(db, contact.id, SYSTEM_ACTOR)
      expect(reactivated.isActive).toBe(true)
      expect(rawAuditRowsFor(contact.id)).toEqual([
        { action: 'create' },
        { action: 'deactivate' },
        { action: 'reactivate' }
      ])
    })

    it('reactivating an already-active contact is a no-op: no additional audit row', () => {
      const contact = createCustomerContact(db, { customerId, name: 'Jane Doe' }, SYSTEM_ACTOR)
      reactivateCustomerContact(db, contact.id, SYSTEM_ACTOR)
      expect(rawAuditRowsFor(contact.id)).toEqual([{ action: 'create' }])
    })

    it('deactivating an already-inactive contact is a no-op: no additional audit row', () => {
      const contact = createCustomerContact(db, { customerId, name: 'Jane Doe' }, SYSTEM_ACTOR)
      deactivateCustomerContact(db, contact.id, SYSTEM_ACTOR)
      deactivateCustomerContact(db, contact.id, SYSTEM_ACTOR)
      expect(rawAuditRowsFor(contact.id)).toEqual([{ action: 'create' }, { action: 'deactivate' }])
    })

    it('an inactive contact remains visible in listContactsForCustomer', () => {
      const contact = createCustomerContact(db, { customerId, name: 'Jane Doe' }, SYSTEM_ACTOR)
      deactivateCustomerContact(db, contact.id, SYSTEM_ACTOR)
      const contacts = listContactsForCustomer(db, customerId)
      expect(contacts).toHaveLength(1)
      expect(contacts[0].isActive).toBe(false)
    })
  })

  describe('no hard delete', () => {
    it('exports no delete/remove function for customer contacts', () => {
      const exportedNames = Object.keys(customerContactService)
      for (const name of exportedNames) {
        expect(name.toLowerCase()).not.toContain('delete')
        expect(name.toLowerCase()).not.toContain('remove')
      }
      expect(exportedNames.sort()).toEqual(
        [
          'CustomerContactServiceError',
          'listContactsForCustomer',
          'getCustomerContactById',
          'createCustomerContact',
          'updateCustomerContact',
          'deactivateCustomerContact',
          'reactivateCustomerContact'
        ].sort()
      )
    })
  })

  describe('direct SQL bypass -- database-level constraints hold independent of the service layer', () => {
    it('the customer_id foreign key rejects a reference to a nonexistent customer', () => {
      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO customer_contacts (id, customer_id, name, is_active, created_at, updated_at)
             VALUES ('contact_x', 'does-not-exist', 'X', 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/FOREIGN KEY constraint failed/)
    })
  })
})
