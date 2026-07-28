import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { customerContacts, customers } from './schema'
import {
  normalizeOptionalContactField,
  requireTrimmedContactName
} from './validation/customerContactValidation'
import { record, type AuditActor } from '../audit/auditService'
import type { AppDb } from './dbTypes'

export class CustomerContactServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomerContactServiceError'
  }
}

export interface CustomerContact {
  id: string
  customerId: string
  name: string
  role: string | null
  phone: string | null
  email: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateCustomerContactInput {
  customerId: string
  name: string
  role?: string | null
  phone?: string | null
  email?: string | null
}

/**
 * customerId is deliberately absent from this type -- a contact's
 * parent is fixed at creation and never reassigned, and this is a
 * structural guarantee that no caller can even attempt to move a
 * contact to a different customer via an "update."
 */
export interface UpdateCustomerContactInput {
  name?: string
  role?: string | null
  phone?: string | null
  email?: string | null
}

function toCustomerContact(row: typeof customerContacts.$inferSelect): CustomerContact {
  return {
    id: row.id,
    customerId: row.customerId,
    name: row.name,
    role: row.role,
    phone: row.phone,
    email: row.email,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

/**
 * Mutations require the parent customer to exist and be currently
 * active -- reads (listContactsForCustomer, getCustomerContactById) are
 * never gated this way, so an inactive customer's contacts remain
 * fully visible for historical reference. Not expressible as a CHECK
 * constraint since SQLite CHECK constraints cannot see another table's
 * row.
 */
function requireActiveParentCustomer(db: AppDb, customerId: string): void {
  const parent = db
    .select({ isActive: customers.isActive })
    .from(customers)
    .where(eq(customers.id, customerId))
    .get()
  if (!parent) {
    throw new CustomerContactServiceError(`No customer exists with id "${customerId}"`)
  }
  if (!parent.isActive) {
    throw new CustomerContactServiceError(
      `Customer "${customerId}" is not active; contacts cannot be added or changed while it is inactive`
    )
  }
}

export function listContactsForCustomer(db: AppDb, customerId: string): CustomerContact[] {
  const rows = db
    .select()
    .from(customerContacts)
    .where(eq(customerContacts.customerId, customerId))
    .all()
  return rows.map(toCustomerContact)
}

export function getCustomerContactById(db: AppDb, id: string): CustomerContact | undefined {
  const row = db.select().from(customerContacts).where(eq(customerContacts.id, id)).get()
  return row ? toCustomerContact(row) : undefined
}

export function createCustomerContact(
  db: AppDb,
  input: CreateCustomerContactInput,
  actor: AuditActor,
  now: Date = new Date()
): CustomerContact {
  requireActiveParentCustomer(db, input.customerId)

  const name = requireTrimmedContactName(input.name)
  const role = normalizeOptionalContactField(input.role)
  const phone = normalizeOptionalContactField(input.phone)
  const email = normalizeOptionalContactField(input.email)

  const id = `customer_contact_${randomUUID()}`

  db.transaction((tx) => {
    tx.insert(customerContacts)
      .values({
        id,
        customerId: input.customerId,
        name,
        role,
        phone,
        email,
        isActive: true,
        createdAt: now,
        updatedAt: now
      })
      .run()

    record(
      tx,
      {
        entityType: 'customer_contact',
        entityId: id,
        entityLabel: name,
        action: 'create',
        actor,
        companyId: null,
        before: null,
        after: { customerId: input.customerId, name, role, phone, email, isActive: true }
      },
      now
    )
  })

  const created = getCustomerContactById(db, id)
  if (!created) {
    throw new CustomerContactServiceError('Customer contact was not persisted after creation')
  }
  return created
}

/**
 * A no-op update writes no audit row, matching the established
 * no-op-suppression convention used by every prior create/update
 * service in this codebase.
 */
export function updateCustomerContact(
  db: AppDb,
  id: string,
  input: UpdateCustomerContactInput,
  actor: AuditActor,
  now: Date = new Date()
): CustomerContact {
  const existing = getCustomerContactById(db, id)
  if (!existing) {
    throw new CustomerContactServiceError(`No customer contact exists with id "${id}"`)
  }
  requireActiveParentCustomer(db, existing.customerId)

  const name = input.name !== undefined ? requireTrimmedContactName(input.name) : existing.name
  const role = input.role !== undefined ? normalizeOptionalContactField(input.role) : existing.role
  const phone =
    input.phone !== undefined ? normalizeOptionalContactField(input.phone) : existing.phone
  const email =
    input.email !== undefined ? normalizeOptionalContactField(input.email) : existing.email

  if (
    name === existing.name &&
    role === existing.role &&
    phone === existing.phone &&
    email === existing.email
  ) {
    return existing
  }

  db.transaction((tx) => {
    tx.update(customerContacts)
      .set({ name, role, phone, email, updatedAt: now })
      .where(eq(customerContacts.id, id))
      .run()

    record(
      tx,
      {
        entityType: 'customer_contact',
        entityId: id,
        entityLabel: existing.name,
        action: 'update',
        actor,
        companyId: null,
        before: {
          name: existing.name,
          role: existing.role,
          phone: existing.phone,
          email: existing.email
        },
        after: { name, role, phone, email }
      },
      now
    )
  })

  const updated = getCustomerContactById(db, id)
  if (!updated) {
    throw new CustomerContactServiceError('Customer contact disappeared during update')
  }
  return updated
}

export function deactivateCustomerContact(
  db: AppDb,
  id: string,
  actor: AuditActor,
  now: Date = new Date()
): CustomerContact {
  return setActiveState(db, id, false, actor, now)
}

export function reactivateCustomerContact(
  db: AppDb,
  id: string,
  actor: AuditActor,
  now: Date = new Date()
): CustomerContact {
  return setActiveState(db, id, true, actor, now)
}

function setActiveState(
  db: AppDb,
  id: string,
  isActive: boolean,
  actor: AuditActor,
  now: Date
): CustomerContact {
  const existing = getCustomerContactById(db, id)
  if (!existing) {
    throw new CustomerContactServiceError(`No customer contact exists with id "${id}"`)
  }
  requireActiveParentCustomer(db, existing.customerId)
  if (existing.isActive === isActive) {
    return existing
  }

  db.transaction((tx) => {
    tx.update(customerContacts)
      .set({ isActive, updatedAt: now })
      .where(eq(customerContacts.id, id))
      .run()

    record(
      tx,
      {
        entityType: 'customer_contact',
        entityId: id,
        entityLabel: existing.name,
        action: isActive ? 'reactivate' : 'deactivate',
        actor,
        companyId: null,
        before: { isActive: existing.isActive },
        after: { isActive }
      },
      now
    )
  })

  const updated = getCustomerContactById(db, id)
  if (!updated) {
    throw new CustomerContactServiceError(
      'Customer contact disappeared during deactivation/reactivation'
    )
  }
  return updated
}
